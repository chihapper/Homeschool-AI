/**
 * Hume helpers: mint browser access tokens and create/update the EVI config that points at our CLM.
 */
import { HumeClient, fetchAccessToken } from "hume";
import type { Hume } from "hume";
import { config } from "../config.js";

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
  voiceName?: string;
}

/**
 * Create an EVI config whose language model is our Custom Language Model endpoint.
 * Returns the config id to put in HUME_CONFIG_ID.
 */
export async function createEviConfig(args: EviConfigArgs): Promise<{ id: string; version: number }> {
  if (!humeConfigured()) throw new Error("HUME_API_KEY and HUME_SECRET_KEY are required.");
  const client = new HumeClient({ apiKey: config.hume.apiKey! });
  const clmUrl = `${args.publicUrl.replace(/\/$/, "")}/clm/chat/completions`;
  const created = await client.empathicVoice.configs.createConfig({
    name: args.name ?? "Homeschool AI Socratic Tutor",
    eviVersion: "3",
    languageModel: {
      modelProvider: "CUSTOM_LANGUAGE_MODEL",
      // The SDK types model_resource as an enum of hosted models; for CUSTOM_LANGUAGE_MODEL the API takes the endpoint URL.
      modelResource: clmUrl as unknown as Hume.empathicVoice.LanguageModelType,
    },
    voice: { provider: "HUME_AI", name: args.voiceName ?? "Ava Song" },
    eventMessages: {
      // The CLM speaks first via our orchestrator; keep Hume's canned greeting off.
      onNewChat: { enabled: false, text: "" },
      onInactivityTimeout: { enabled: true, text: "Are you still there? Take your time." },
      onMaxDurationTimeout: { enabled: true, text: "We've reached the end of our time. Great work today." },
    },
    timeouts: {
      inactivity: { enabled: true, durationSecs: 120 },
      maxDuration: { enabled: true, durationSecs: 3600 },
    },
  });
  if (!created.id) throw new Error("Hume did not return a config id.");
  return { id: created.id, version: created.version ?? 0 };
}
