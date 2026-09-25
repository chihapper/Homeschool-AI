import { describe, expect, it } from "vitest";
import { endsInQuestion, streamTurn, type AgentTool, type MessageStream, type Streamer } from "../src/agents/base.js";

/** One scripted model round-trip: text deltas, then tool calls. */
interface Scripted {
  text?: string;
  tools?: Array<{ name: string; input: Record<string, unknown> }>;
}

/** A fake SDK stream that plays the scripted iterations in order and records how many were requested. */
function scriptedStreamer(script: Scripted[]): { streamer: Streamer; calls: () => number } {
  let n = 0;
  const streamer: Streamer = () => {
    const step = script[n++];
    if (!step) throw new Error(`model called ${n} times but only ${script.length} iterations were scripted`);
    const deltas = step.text ? step.text.match(/.{1,7}/g) ?? [] : [];
    const stream: MessageStream = {
      async *[Symbol.asyncIterator]() {
        for (const d of deltas) yield { type: "content_block_delta", delta: { type: "text_delta", text: d } };
      },
      async finalMessage() {
        const content = [
          ...(step.text ? [{ type: "text" as const, text: step.text, citations: null }] : []),
          ...(step.tools ?? []).map((t, i) => ({ type: "tool_use" as const, id: `tu_${n}_${i}`, name: t.name, input: t.input })),
        ];
        return { content, stop_reason: step.tools?.length ? "tool_use" : "end_turn", usage: { input_tokens: 10, output_tokens: 5, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 } } as never;
      },
    };
    return stream;
  };
  return { streamer, calls: () => n };
}

const spec = { name: "T", role: "r", skills: [] as string[], model: "claude-sonnet-5", effort: "low" as const };

function tools(log: string[]): AgentTool<never>[] {
  const lookup: AgentTool<{ query: string }> = {
    definition: { name: "lookup_source", input_schema: { type: "object" } },
    run: ({ query }) => {
      log.push(`lookup:${query}`);
      return "<passage>Plants make glucose in the leaves.</passage>";
    },
  };
  const record: AgentTool<{ evidence: string }> = {
    definition: { name: "record_observation", input_schema: { type: "object" } },
    run: ({ evidence }) => {
      log.push(`record:${evidence}`);
      return "Recorded.";
    },
    endsSpeech: "after-question",
  };
  const advance: AgentTool<{ to: string }> = {
    definition: { name: "advance", input_schema: { type: "object" } },
    run: ({ to }) => {
      log.push(`advance:${to}`);
      if (to === "next-concept") throw new Error("Refused: only 1 observation recorded.");
      return `OK: phase is now ${to}.`;
    },
    endsSpeech: "after-question",
  };
  const finish: AgentTool<{ reason: string }> = {
    definition: { name: "finish_intake", input_schema: { type: "object" } },
    run: () => {
      log.push("finish");
      return "Intake marked complete.";
    },
    endsSpeech: "always",
  };
  return [lookup, record, advance, finish] as AgentTool<never>[];
}

async function run(script: Scripted[]) {
  const log: string[] = [];
  const { streamer, calls } = scriptedStreamer(script);
  const gen = streamTurn({ spec, system: [], messages: [{ role: "user", content: "hi" }], tools: tools(log), streamer });
  const spoken: string[] = [];
  let r = await gen.next();
  while (!r.done) {
    spoken.push(r.value);
    r = await gen.next();
  }
  return { result: r.value, spoken: spoken.join(""), log, calls: calls() };
}

describe("speech policy: one block of speech per turn", () => {
  it("stops after the bookkeeping batch; the model is not called again", async () => {
    const { result, spoken, log, calls } = await run([
      { text: "You got it. What are the three inputs?", tools: [{ name: "record_observation", input: { evidence: "it cooks" } }, { name: "advance", input: { to: "inquire" } }] },
      { text: "THIS MUST NEVER BE REQUESTED" },
    ]);
    expect(spoken).toBe("You got it. What are the three inputs?");
    expect(result.text).toBe(spoken);
    expect(log).toEqual(["record:it cooks", "advance:inquire"]);
    expect(calls).toBe(1);
    expect(result.latency.iterations).toBe(1);
    expect(result.latency.suppressedChars).toBe(0);
  });

  it("drops text the model writes after a state-changing tool, and counts it", async () => {
    const { result, spoken, calls } = await run([
      { text: "Nice work. Why does the plant need light?", tools: [{ name: "advance", input: { to: "next-concept" } }] }, // refused -> error -> one silent pass
      { text: "Let me note that first.", tools: [{ name: "record_observation", input: { evidence: "x" } }, { name: "advance", input: { to: "assess" } }] },
      { text: "NEVER" },
    ]);
    expect(spoken).toBe("Nice work. Why does the plant need light?");
    expect(calls).toBe(2);
    expect(result.latency.iterations).toBe(2);
    expect(result.latency.suppressedChars).toBe("Let me note that first.".length);
  });

  it("lets the model look a passage up before it speaks", async () => {
    const { result, spoken, log, calls } = await run([
      { tools: [{ name: "lookup_source", input: { query: "glucose" } }] },
      { text: "Your material says glucose is made in the leaves. Where, then, does the sugar come from?", tools: [{ name: "record_observation", input: { evidence: "asked" } }] },
    ]);
    expect(spoken).toBe("Your material says glucose is made in the leaves. Where, then, does the sugar come from?");
    expect(log).toEqual(["lookup:glucose", "record:asked"]);
    expect(calls).toBe(2);
    expect(result.latency.ttftMs).toBeGreaterThanOrEqual(0);
  });

  it("still lets the model speak when it does its bookkeeping first", async () => {
    const { result, spoken, log, calls } = await run([
      { tools: [{ name: "record_observation", input: { evidence: "from intake" } }, { name: "advance", input: { to: "inquire" } }] },
      { text: "Let's start with what you already figured out. What is photosynthesis, in your words?", tools: [{ name: "record_observation", input: { evidence: "asked" } }] },
      { text: "NEVER" },
    ]);
    expect(spoken).toBe("Let's start with what you already figured out. What is photosynthesis, in your words?");
    expect(log).toEqual(["record:from intake", "advance:inquire", "record:asked"]);
    expect(calls).toBe(2);
    expect(result.latency.suppressedChars).toBe(0);
  });

  it("lets the model ask its question after advancing, when the first segment had none", async () => {
    const { result, spoken, log, calls } = await run([
      { text: "Nicely put, you got there without the analogy.", tools: [{ name: "record_observation", input: { evidence: "own words" } }, { name: "advance", input: { to: "inquire" } }] },
      { text: "Now, what do you think makes a leaf green?", tools: [{ name: "record_observation", input: { evidence: "x" } }] },
      { text: "NEVER" },
    ]);
    expect(spoken).toBe("Nicely put, you got there without the analogy. Now, what do you think makes a leaf green?");
    expect(log).toEqual(["record:own words", "advance:inquire", "record:x"]);
    expect(calls).toBe(2);
    expect(result.latency.suppressedChars).toBe(0);
  });

  it("hard-stops after finish_intake even without a question", async () => {
    const { spoken, calls } = await run([
      { text: "Thanks for chatting, Sam. You reasoned that through really well.", tools: [{ name: "finish_intake", input: { reason: "enough evidence" } }] },
      { text: "NEVER" },
    ]);
    expect(spoken).toBe("Thanks for chatting, Sam. You reasoned that through really well.");
    expect(calls).toBe(1);
  });

  it("keeps speech segments apart when a lookup interrupts them", async () => {
    const { spoken, calls } = await run([
      { text: "Good question.", tools: [{ name: "lookup_source", input: { query: "algae" } }] },
      { text: "Your material also names algae. Which of the two did you expect?" },
    ]);
    expect(spoken).toBe("Good question. Your material also names algae. Which of the two did you expect?");
    expect(calls).toBe(2);
  });

  it("ends the turn when the model looks something up after asking its question", async () => {
    // Seen 2026-09-24: the question was out, a lookup followed, and the next pass narrated itself aloud.
    const { result, spoken, log, calls } = await run([
      { text: "Quick memory check: who were the two brothers in Rome's founding legend?", tools: [{ name: "lookup_source", input: { query: "Romulus" } }] },
      { text: "Waiting on their answer to that retrieval question, let me just ask it plainly and wait." },
    ]);
    expect(spoken).toBe("Quick memory check: who were the two brothers in Rome's founding legend?");
    expect(result.text).toBe(spoken);
    expect(log).toEqual(["lookup:Romulus"]);
    expect(calls).toBe(1);
  });

  it("still lets a lookup follow a question in the middle of the reply", async () => {
    const { spoken, calls } = await run([
      { text: "Remember the leaves? Let me find that page.", tools: [{ name: "lookup_source", input: { query: "leaves" } }] },
      { text: "Your material says glucose is made there. So where does the sugar come from?" },
    ]);
    expect(spoken).toBe("Remember the leaves? Let me find that page. Your material says glucose is made there. So where does the sugar come from?");
    expect(calls).toBe(2);
  });

  it("counts a question inside closing quotes as the end of the reply", () => {
    expect(endsInQuestion('So what did the senator mean by "citizen?" ')).toBe(true);
    expect(endsInQuestion("Remember the leaves? Let me find that page.")).toBe(false);
  });
});
