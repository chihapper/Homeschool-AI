/**
 * The OpenAI side of `streamParsed`: the one seam every offline "one prompt in, one JSON document out" call
 * shares (the report, the profile pass, the intake write-ups, the course build). A request written for the
 * Claude API is translated to OpenAI's Responses API, and the reply comes back shaped like a Claude message
 * (stop_reason, usage, one text block), so the callers stay vendor-blind. The live tutor never comes through
 * here: its tool loop, prompt caching and two-call turn are the Claude API's.
 *
 * Built 2026-10-08 so the report could be tried on GPT-6.1 Sol. OpenAI's data terms as read that day
 * (developers.openai.com/api/docs/guides/your-data): API traffic is not used for training; abuse-monitoring
 * logs are kept up to 30 days; `store: false` keeps the response out of OpenAI's application state.
 *
 * Structured output: the JSON schema that `zodOutputFormat` builds for the Claude API already meets OpenAI's
 * strict mode (every object closed with additionalProperties false, every property required, bounds moved
 * into descriptions), so it is passed through as `text.format` with `strict: true`.
 */
import OpenAI from "openai";
import type Anthropic from "@anthropic-ai/sdk";
import type { MessageStreamParams } from "@anthropic-ai/sdk/resources/messages/messages.js";
import type { ReasoningEffort } from "openai/resources/shared.js";
import { config } from "../config.js";

let client: OpenAI | undefined;

/** The OpenAI client, made on first use; a clear error when the key is missing. */
export function openai(): OpenAI {
  if (!config.openai.apiKey) throw new Error("OPENAI_API_KEY is not set in .env; an OpenAI model needs it.");
  return (client ??= new OpenAI({ apiKey: config.openai.apiKey }));
}

/** "OPENAI_API_KEY is not set" or undefined, for the readiness check and the settings route. */
export function openaiKeyProblem(): string | undefined {
  return config.openai.apiKey ? undefined : "OPENAI_API_KEY is not set in .env.";
}

type TextBlock = { type: string; text?: string };
type ClaudeShaped = MessageStreamParams & {
  output_config?: { effort?: string; format?: { type?: string; schema?: Record<string, unknown> } };
};

function textOf(content: string | Array<TextBlock> | undefined): string {
  if (!content) return "";
  if (typeof content === "string") return content;
  return content
    .map((b) => {
      if (b.type === "text" && typeof b.text === "string") return b.text;
      throw new Error(`The OpenAI path takes text only; a "${b.type}" block was sent.`);
    })
    .join("\n\n");
}

/** What the Responses API gets for a Claude-shaped structured-output request. Pure, for the tests. */
export function toResponsesRequest(params: MessageStreamParams): OpenAI.Responses.ResponseCreateParamsNonStreaming {
  const p = params as ClaudeShaped;
  const instructions = textOf(p.system as string | Array<TextBlock> | undefined);
  const input: OpenAI.Responses.ResponseInput = p.messages.map((m) => ({
    role: m.role,
    content: textOf(m.content as string | Array<TextBlock>),
  }));
  const req: OpenAI.Responses.ResponseCreateParamsNonStreaming = {
    model: p.model,
    input,
    max_output_tokens: p.max_tokens,
    // Keep the conversation out of OpenAI's stored application state; the app keeps its own records.
    store: false,
  };
  if (instructions) req.instructions = instructions;
  const effort = p.output_config?.effort;
  if (effort) req.reasoning = { effort: effort as ReasoningEffort };
  const schema = p.output_config?.format?.schema;
  if (schema) req.text = { format: { type: "json_schema", name: "output", schema, strict: true } };
  return req;
}

/** The text the model wrote, and its refusal if it declined, from a Response's output items. */
function outputOf(res: OpenAI.Responses.Response): { text: string; refusal?: string } {
  let text = "";
  let refusal: string | undefined;
  for (const item of res.output ?? []) {
    if (item.type !== "message") continue;
    for (const part of item.content) {
      if (part.type === "output_text") text += part.text;
      else if (part.type === "refusal") refusal = part.refusal;
    }
  }
  return { text, refusal };
}

/** A Responses API reply as a Claude message, plus the parsed JSON document. Pure, for the tests. */
/**
 * @param firstDeltaMs how long the first text took to arrive, when the reply was streamed; it rides on `usage`
 *   beside `reasoning_tokens`, so an experiment can see where a slow report spent its time.
 */
export function fromResponse(res: OpenAI.Responses.Response, firstDeltaMs?: number): { message: Anthropic.Message; parsed: unknown | null } {
  const { text, refusal } = outputOf(res);
  const cutOff = res.status === "incomplete" && res.incomplete_details?.reason === "max_output_tokens";
  const stopReason = refusal !== undefined ? "refusal" : cutOff ? "max_tokens" : "end_turn";
  const cached = res.usage?.input_tokens_details?.cached_tokens ?? 0;
  const usage = {
    input_tokens: Math.max(0, (res.usage?.input_tokens ?? 0) - cached),
    output_tokens: res.usage?.output_tokens ?? 0,
    cache_read_input_tokens: cached,
    cache_creation_input_tokens: 0,
    reasoning_tokens: res.usage?.output_tokens_details?.reasoning_tokens ?? 0,
    ...(firstDeltaMs !== undefined ? { first_delta_ms: firstDeltaMs } : {}),
  };
  let parsed: unknown | null = null;
  if (stopReason === "end_turn" && text.trim()) {
    try {
      parsed = JSON.parse(text);
    } catch {
      parsed = null;
    }
  }
  const message = {
    id: res.id,
    type: "message",
    role: "assistant",
    model: res.model,
    content: [{ type: "text", text, citations: null }],
    stop_reason: stopReason,
    stop_sequence: null,
    ...(refusal !== undefined ? { stop_details: { category: null, explanation: refusal } } : {}),
    usage,
  } as unknown as Anthropic.Message;
  return { message, parsed };
}

/**
 * The OpenAI counterpart of `streamParsed`: streamed, so a long report never trips a request timeout and the
 * caller's progress callback sees the characters as they come.
 */
export async function streamParsedOpenAI<T>(
  params: MessageStreamParams,
  opts: { onProgress?: (charsSoFar: number) => void; timeout?: number } = {},
): Promise<{ message: Anthropic.Message; parsed: T | null }> {
  const req = toResponsesRequest(params);
  const stream = await openai().responses.create({ ...req, stream: true }, { timeout: opts.timeout ?? 30 * 60 * 1000 });
  let chars = 0;
  let final: OpenAI.Responses.Response | undefined;
  const t0 = performance.now();
  let firstDeltaMs: number | undefined;
  for await (const ev of stream) {
    if (ev.type === "response.output_text.delta") {
      firstDeltaMs ??= Math.round(performance.now() - t0);
      chars += ev.delta.length;
      opts.onProgress?.(chars);
    } else if (ev.type === "response.completed" || ev.type === "response.incomplete") {
      final = ev.response;
    } else if (ev.type === "response.failed") {
      throw new Error(`OpenAI request failed: ${ev.response.error?.message ?? "no reason given"}`);
    } else if (ev.type === "error") {
      throw new Error(`OpenAI stream error: ${ev.message}`);
    }
  }
  if (!final) throw new Error("OpenAI stream ended without a completed response.");
  const { message, parsed } = fromResponse(final, firstDeltaMs);
  if (message.stop_reason === "max_tokens") {
    throw new Error(`The model hit its output limit (max_output_tokens ${params.max_tokens}) before finishing, so the structured output is cut off. Ask for less at a time.`);
  }
  return { message, parsed: parsed as T | null };
}
