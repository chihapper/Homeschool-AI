/**
 * Hume helpers: mint browser access tokens and create the EVI config that points at our CLM.
 */
import { fetchAccessToken } from "hume";
import { config } from "../config.js";

const BASE_URL = "https://api.hume.ai";

export function humeConfigured(): boolean {
  return Boolean(config.hume.apiKey && config.hume.secretKey);
}

export async function mintAccessToken(): Promise<string> {
  if (!humeConfigured()) throw new Error("HUME_API_KEY and HUME_SECRET_KEY are required.");
  return fetchAccessToken({ apiKey: config.hume.apiKey!, secretKey: config.hume.secretKey! });
}

export interface EviConfigArgs {
  name?: string;
  publicUrl: string;
  /** Voice Library name. Defaults to the tutor voice in Settings. */
  voiceName?: string;
  /** Silence, in ms, after which EVI decides the student has finished (Hume allows 500-3000; default 800). */
  endOfTurnSilenceMs?: number;
  /** How long the student must talk over the tutor before EVI treats it as an interruption (ms). */
  minInterruptionMs?: number;
}

/**
 * Create an EVI config whose language model is our Custom Language Model endpoint.
 * Returns the config id to put in HUME_CONFIG_ID.
 *
 * Done with a direct API call rather than the SDK: the SDK validates `model_resource` against its list of
 * hosted model names and refuses the endpoint URL that the CUSTOM_LANGUAGE_MODEL provider needs.
 */
export async function createEviConfig(args: EviConfigArgs): Promise<{ id: string; version: number; modelResource: string }> {
  if (!humeConfigured()) throw new Error("HUME_API_KEY and HUME_SECRET_KEY are required.");
  const clmUrl = `${args.publicUrl.replace(/\/$/, "")}/clm/chat/completions`;
  const body = {
    name: args.name ?? "Homeschool AI Socratic Tutor",
    evi_version: "3",
    language_model: { model_provider: "CUSTOM_LANGUAGE_MODEL", model_resource: clmUrl },
    voice: { provider: "HUME_AI", name: args.voiceName ?? config.ttsVoice },
    // EVI owns turn-taking in this path; these are the knobs the Settings tab tunes for the browser path.
    turn_detection: { end_of_turn_silence_ms: Math.min(3000, Math.max(500, args.endOfTurnSilenceMs ?? 800)) },
    interruption: { min_interruption_ms: args.minInterruptionMs ?? 300 },
    event_messages: {
      // Our orchestrator provides the opening line; keep Hume's canned greeting off.
      on_new_chat: { enabled: false, text: "" },
      on_inactivity_timeout: { enabled: true, text: "Are you still there? Take your time." },
      on_max_duration_timeout: { enabled: true, text: "We've reached the end of our time. Great work today." },
    },
    timeouts: {
      inactivity: { enabled: true, duration_secs: 120 },
      max_duration: { enabled: true, duration_secs: 3600 },
    },
  };
  const res = await fetch(`${BASE_URL}/v0/evi/configs`, {
    method: "POST",
    headers: { "X-Hume-Api-Key": config.hume.apiKey!, "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const text = await res.text();
  if (!res.ok) throw new Error(`Hume config error ${res.status}: ${text.slice(0, 400)}`);
  const created = JSON.parse(text) as { id?: string; version?: number; language_model?: { model_resource?: string } };
  if (!created.id) throw new Error(`Hume did not return a config id: ${text.slice(0, 200)}`);
  return { id: created.id, version: created.version ?? 0, modelResource: created.language_model?.model_resource ?? "" };
}
