/**
 * Shared plumbing for agents: system-prompt assembly (cache-friendly) and a streaming tool loop.
 *
 * Every agent is `AgentSpec` (identity + skills + model settings). The stable part of the prompt
 * (role + skills) is rendered first and marked for prompt caching; per-session context comes after.
 */
import Anthropic from "@anthropic-ai/sdk";
import { anthropic, fallbackParams, reasoningParams, type Effort, type TurnLatency } from "../llm/client.js";
import { renderSkills } from "../skills/loader.js";

export interface AgentSpec {
  name: string;
  /** One paragraph describing who the agent is and what it is for. Stable across sessions. */
  role: string;
  /** Skill directory names under `skills/`. Order matters (it is part of the cached prefix). */
  skills: string[];
  model: string;
  effort: Effort;
  /** Only the live tutor sets this; offline agents keep adaptive thinking. */
  thinking?: "adaptive" | "disabled";
}

export type SystemBlock = Anthropic.Beta.BetaTextBlockParam;

/**
 * Build the system prompt: [stable role+skills (cached)] + [dynamic context blocks].
 * `cacheThrough` marks the first N dynamic blocks as part of a second cache breakpoint: use it for
 * per-session context that does not change between turns (course, lesson, learner profile).
 */
export function buildSystem(spec: AgentSpec, dynamic: string[], cacheThrough = 0): SystemBlock[] {
  const stable = `You are the ${spec.name}.\n\n${spec.role}\n\n${renderSkills(spec.skills)}`;
  const blocks: SystemBlock[] = [{ type: "text", text: stable, cache_control: { type: "ephemeral" } }];
  const kept = dynamic.filter((d) => d.trim());
  kept.forEach((d, i) => {
    const isCacheEdge = cacheThrough > 0 && i === Math.min(cacheThrough, kept.length) - 1;
    blocks.push(isCacheEdge ? { type: "text", text: d, cache_control: { type: "ephemeral" } } : { type: "text", text: d });
  });
  return blocks;
}

/** A tool the agent can call. `run` returns text that is fed back to the model. */
export interface AgentTool<I = unknown> {
  definition: Anthropic.Beta.BetaTool;
  run: (input: I) => Promise<string> | string;
}

export interface StreamTurnOptions {
  spec: AgentSpec;
  system: SystemBlock[];
  messages: Anthropic.Beta.BetaMessageParam[];
  tools?: AgentTool<never>[];
  maxTokens?: number;
  /** Cap on tool round-trips per user turn. */
  maxIterations?: number;
  signal?: AbortSignal;
  /** Called once with latency data when the turn completes. */
  onLatency?: (l: TurnLatency) => void;
}

export interface TurnResult {
  /** All assistant text produced this turn (may span several tool iterations). */
  text: string;
  /** The messages appended during this turn (assistant + tool results), for callers that keep history. */
  appended: Anthropic.Beta.BetaMessageParam[];
  stopReason: string | null;
  latency: TurnLatency;
}

/**
 * Run one agent turn, yielding text deltas as they stream, executing tools between iterations.
 * The generator's return value carries the full text and appended messages.
 */
export async function* streamTurn(opts: StreamTurnOptions): AsyncGenerator<string, TurnResult, void> {
  const tools = opts.tools ?? [];
  const byName = new Map(tools.map((t) => [t.definition.name, t] as const));
  const messages = [...opts.messages];
  const appended: Anthropic.Beta.BetaMessageParam[] = [];
  let fullText = "";
  let stopReason: string | null = null;
  const maxIterations = opts.maxIterations ?? 4;
  const t0 = performance.now();
  const latency: TurnLatency = { ttftMs: -1, totalMs: 0, iterations: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0 };

  for (let i = 0; i < maxIterations; i++) {
    latency.iterations += 1;
    const stream = anthropic.beta.messages.stream(
      {
        model: opts.spec.model,
        max_tokens: opts.maxTokens ?? 2048,
        system: opts.system,
        messages,
        tools: tools.length ? tools.map((t) => t.definition) : undefined,
        ...reasoningParams(opts.spec.model, opts.spec.effort, opts.spec.thinking),
        ...fallbackParams(),
      },
      { signal: opts.signal },
    );

    for await (const event of stream) {
      if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
        if (latency.ttftMs < 0) latency.ttftMs = Math.round(performance.now() - t0);
        fullText += event.delta.text;
        yield event.delta.text;
      }
    }
    const message = await stream.finalMessage();
    stopReason = message.stop_reason;
    latency.cacheReadTokens += message.usage.cache_read_input_tokens ?? 0;
    latency.cacheWriteTokens += message.usage.cache_creation_input_tokens ?? 0;
    latency.inputTokens += message.usage.input_tokens;
    latency.outputTokens += message.usage.output_tokens;

    if (message.stop_reason === "refusal") {
      const fallbackText = "I'm not able to go into that here. Let's get back to the lesson.";
      fullText += (fullText ? " " : "") + fallbackText;
      yield fallbackText;
      break;
    }

    const assistantTurn: Anthropic.Beta.BetaMessageParam = { role: "assistant", content: message.content };
    messages.push(assistantTurn);
    appended.push(assistantTurn);

    if (message.stop_reason === "pause_turn") continue;

    const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    if (!toolUses.length) break;

    const results: Anthropic.Beta.BetaToolResultBlockParam[] = [];
    for (const use of toolUses) {
      const tool = byName.get(use.name);
      let content: string;
      let isError = false;
      try {
        if (!tool) throw new Error(`Unknown tool ${use.name}`);
        content = await tool.run(use.input as never);
      } catch (err) {
        content = err instanceof Error ? err.message : String(err);
        isError = true;
      }
      results.push({ type: "tool_result", tool_use_id: use.id, content, is_error: isError || undefined });
    }
    const resultTurn: Anthropic.Beta.BetaMessageParam = { role: "user", content: results };
    messages.push(resultTurn);
    appended.push(resultTurn);
  }

  latency.totalMs = Math.round(performance.now() - t0);
  if (latency.ttftMs < 0) latency.ttftMs = latency.totalMs;
  opts.onLatency?.(latency);
  return { text: fullText.trim(), appended, stopReason, latency };
}

/**
 * Pre-warm the prompt cache for a system prompt (max_tokens: 0 runs prefill only, bills a cache write,
 * returns no output). Fire-and-forget at session start so the first spoken turn is a cache hit.
 * Must not be combined with streaming, structured outputs, or explicit `thinking.type: "enabled"`.
 */
export async function prewarm(spec: AgentSpec, system: SystemBlock[], tools: AgentTool<never>[] = []): Promise<void> {
  try {
    await anthropic.beta.messages.create({
      model: spec.model,
      max_tokens: 0,
      system,
      tools: tools.length ? tools.map((t) => t.definition) : undefined,
      messages: [{ role: "user", content: "warmup" }],
      ...(reasoningParams(spec.model, spec.effort, "adaptive") as object),
    });
  } catch (err) {
    console.warn("[prewarm] skipped:", err instanceof Error ? err.message : err);
  }
}

/** Convert a plain transcript into API messages (tool traffic is not persisted; only spoken text is). */
export function transcriptToMessages(
  transcript: Array<{ role: "user" | "assistant"; content: string; expressions?: string[] }>,
): Anthropic.Beta.BetaMessageParam[] {
  const out: Anthropic.Beta.BetaMessageParam[] = [];
  for (const t of transcript) {
    const text =
      t.role === "user" && t.expressions?.length ? `${t.content}\n[expressions: ${t.expressions.join(", ")}]` : t.content;
    if (!text.trim()) continue;
    // The API requires the first message to be from the user.
    if (!out.length && t.role === "assistant") continue;
    out.push({ role: t.role, content: text });
  }
  return out;
}
