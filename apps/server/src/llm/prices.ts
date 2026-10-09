/**
 * List prices, in dollars, for the meter (domain/cost.ts). Checked 2026-10-08 against the Anthropic and OpenAI
 * pricing pages and the voice vendors' pages; the voice figures are the on-demand rates (Inworld) and the rate
 * measured on the account (ElevenLabs, 2026-09-24). A model or voice not listed here is metered but not priced:
 * the cost line says so rather than guessing. Update when a price changes or a model is added.
 */

/** Dollars per million tokens. */
export interface TokenPrice {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export const MODEL_PRICES: Record<string, TokenPrice> = {
  "claude-opus-5-5": { input: 4, output: 20, cacheRead: 0.2, cacheWrite: 5 },
  "claude-sonnet-5-5": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "claude-haiku-5-5": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
  "claude-opus-5": { input: 5, output: 25, cacheRead: 0.5, cacheWrite: 6.25 },
  "claude-sonnet-5": { input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
  "claude-haiku-4-5": { input: 1, output: 5, cacheRead: 0.1, cacheWrite: 1.25 },
  "gpt-6.1-sol": { input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
  "gpt-6-luna": { input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 },
};

export interface TokenCounts {
  inputTokens?: number;
  outputTokens?: number;
  cacheReadTokens?: number;
  cacheWriteTokens?: number;
}

/** The price row for a model ID, with a dated snapshot suffix ignored ("claude-haiku-4-5-20251001"). */
export function priceOf(model: string | undefined): TokenPrice | undefined {
  if (!model) return undefined;
  return MODEL_PRICES[model] ?? MODEL_PRICES[model.replace(/-\d{8}$/, "")];
}

/** Dollars for one call's tokens, or undefined when the model has no price on file. */
export function tokensUsd(model: string | undefined, t: TokenCounts): number | undefined {
  const p = priceOf(model);
  if (!p) return undefined;
  return ((t.inputTokens ?? 0) * p.input + (t.outputTokens ?? 0) * p.output + (t.cacheReadTokens ?? 0) * p.cacheRead + (t.cacheWriteTokens ?? 0) * p.cacheWrite) / 1e6;
}

/** Dollars per million characters spoken, by provider and model ("elevenlabs:*" covers every ElevenLabs model: the same credits are charged). */
export const TTS_PRICES_PER_MILLION_CHARS: Record<string, number> = {
  "inworld:inworld-tts-2": 25,
  "inworld:inworld-tts-2-flash": 15,
  "elevenlabs:*": 50,
};

/** Dollars per hour of audio streamed to the transcriber (AssemblyAI Universal-Streaming). */
export const STT_PRICE_PER_HOUR = 0.15;

export function ttsUsd(provider: string | undefined, model: string | undefined, chars: number): number | undefined {
  if (!provider || !chars) return chars ? undefined : 0;
  const rate = TTS_PRICES_PER_MILLION_CHARS[`${provider}:${model ?? ""}`] ?? TTS_PRICES_PER_MILLION_CHARS[`${provider}:*`];
  return rate === undefined ? undefined : (chars * rate) / 1e6;
}

export function sttUsd(seconds: number): number {
  return (seconds / 3600) * STT_PRICE_PER_HOUR;
}
