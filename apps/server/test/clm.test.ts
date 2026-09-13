import { describe, expect, it } from "vitest";
import { lastUserTurn, sseChunk, stripInlineExpressions, topExpressions } from "../src/voice/clm.js";

describe("CLM message parsing", () => {
  it("takes the last user message and top prosody labels", () => {
    const turn = lastUserTurn([
      { role: "system", content: "x" },
      { role: "user", content: "hi", models: { prosody: { scores: { Joy: 0.9 } } } },
      { role: "assistant", content: "hello" },
      { role: "user", content: "what is osmosis", models: { prosody: { scores: { Confusion: 0.6, Interest: 0.4, Boredom: 0.01 } } } },
    ]);
    expect(turn.text).toBe("what is osmosis");
    expect(turn.expressions).toEqual(["Confusion", "Interest"]);
  });

  it("handles array content and inline expression suffixes", () => {
    expect(lastUserTurn([{ role: "user", content: [{ type: "text", text: "hey " }, { type: "text", text: "there" }] }]).text).toBe("hey there");
    expect(stripInlineExpressions("I think so {confusion, interest}")).toEqual({ text: "I think so", expressions: ["confusion", "interest"] });
    expect(stripInlineExpressions("no braces")).toEqual({ text: "no braces", expressions: [] });
  });

  it("returns empty for no user turns", () => {
    expect(lastUserTurn([])).toEqual({ text: "", expressions: [] });
    expect(topExpressions(undefined)).toEqual([]);
  });
});

describe("sseChunk", () => {
  it("emits OpenAI-compatible chunks with the session fingerprint", () => {
    const line = sseChunk("id1", "sess-1", "Hello", null);
    expect(line.startsWith("data: ")).toBe(true);
    const json = JSON.parse(line.slice(6));
    expect(json.object).toBe("chat.completion.chunk");
    expect(json.system_fingerprint).toBe("sess-1");
    expect(json.choices[0].delta.content).toBe("Hello");
    expect(json.choices[0].finish_reason).toBeNull();
    const done = JSON.parse(sseChunk("id1", "sess-1", null, "stop").slice(6));
    expect(done.choices[0].delta).toEqual({});
    expect(done.choices[0].finish_reason).toBe("stop");
  });
});
