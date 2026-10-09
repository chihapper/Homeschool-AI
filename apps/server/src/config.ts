/**
 * Runtime configuration.
 *
 * Two layers:
 *  1. Environment (.env or the shell), read once at startup. Only ANTHROPIC_API_KEY is required to run
 *     the text-mode tutor, ingestion, and assessment. Voice keys are needed only for the voice layer.
 *  2. Runtime overrides for the model settings (which model, effort, thinking, caching), changed from the
 *     web app's Settings tab and persisted to <DATA_DIR>/settings.json so they survive a restart.
 *     `config.tutorModel` etc. are getters, so every read sees the current value.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import { OutsideKnowledgeModeSchema, type OutsideKnowledgeMode } from "./domain/types.js";
import { DEFAULT_MODEL, DEFAULT_TUTOR_MODEL, MODEL_OPTIONS, normalizeModelId } from "./llm/models.js";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (apps/server/src -> ../../..). */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

// Load .env from the repo root (Node 20.12+ / 22 built-in). Shell environment wins over the file.
for (const candidate of [path.join(process.cwd(), ".env"), path.join(REPO_ROOT, ".env")]) {
  try {
    if (fs.existsSync(candidate)) {
      const before = { ...process.env };
      process.loadEnvFile(candidate);
      for (const k of Object.keys(process.env)) if (before[k] !== undefined) process.env[k] = before[k];
      break;
    }
  } catch {
    /* older Node without loadEnvFile: rely on the shell environment */
  }
}

function env(name: string, fallback?: string): string | undefined {
  const v = process.env[name];
  return v === undefined || v === "" ? fallback : v;
}

// Relative DATA_DIR / SKILLS_DIR are resolved against the repo root, not the cwd: npm runs workspace
// scripts from apps/server, which would otherwise scatter data under apps/server/data.
const dataDir = path.resolve(REPO_ROOT, env("DATA_DIR", "data")!);

// ---------------------------------------------------------------------------
// Model settings: env defaults + runtime overrides
// ---------------------------------------------------------------------------

export const EffortSchema = z.enum(["low", "medium", "high", "xhigh", "max"]);
export type Effort = z.infer<typeof EffortSchema>;

/** Who voices the tutor in browser voice mode. */
export const TTS_PROVIDERS = ["elevenlabs", "inworld"] as const;
export type TtsProvider = (typeof TTS_PROVIDERS)[number];

/** A number from the environment, or the fallback when it is missing or outside [min, max]. */
function envNumber(name: string, min: number, max: number, fallback: number): number {
  const n = Number(env(name));
  return Number.isFinite(n) && n >= min && n <= max ? n : fallback;
}

export const RuntimeSettingsSchema = z.object({
  /** Model used by the offline agents (curriculum, profile extraction, assessor). Normalised: "claude-opus-5.5" becomes "claude-opus-5-5". */
  model: z.string().min(1).transform(normalizeModelId),
  /** The live tutor and intake conversation are latency-sensitive; they can use a different model. */
  tutorModel: z.string().min(1).transform(normalizeModelId),
  /**
   * The tutor's reflect pass (notes, phase changes, the open thread) may run on a different model from the one
   * that speaks: a cheap speaker and a careful note-taker. Empty means the tutor's model. Each model keeps its
   * own prompt cache, so a split costs one extra cache write per session, off the clock.
   */
  reflectModel: z.string().transform(normalizeModelId),
  /** The assessor (the report after a session) may run on its own model; empty means the offline model. */
  assessorModel: z.string().transform(normalizeModelId),
  /** Effort for the live tutor. Lower effort = faster first token. */
  tutorEffort: EffortSchema,
  /** Effort for the offline agents. */
  analysisEffort: EffortSchema,
  /** Effort for the tutor's reflect pass (notes and phase changes), which runs while the learner listens. */
  reflectEffort: EffortSchema,
  /** Thinking for the live tutor: adaptive (model decides; rarely thinks at low effort) or disabled. */
  tutorThinking: z.enum(["adaptive", "disabled"]),
  /** Pre-warm the tutor's prompt cache when a session is created. */
  prewarmCache: z.boolean(),
  /** Route safety-classifier refusals to a fallback model automatically. */
  refusalFallbacks: z.boolean(),
  /** Facts from outside the family's material: answer and check against Wikipedia, answer only, or material only. Read when a session starts. */
  outsideKnowledge: OutsideKnowledgeModeSchema,
  /** How long a lesson may run before the tutor closes it, in minutes (3 to 60). Frozen on the session when it starts (domain/clock.ts). */
  sessionMaxMinutes: z.number().int().min(3).max(60),
  /** Who voices the tutor in browser voice mode. Read at the start of every turn, so a switch applies to the next reply. */
  ttsProvider: z.enum(TTS_PROVIDERS),
  /** Send the sentences already waiting as one request so the voice keeps its cadence across them. Off = one request per sentence. */
  ttsBatchSentences: z.boolean(),
  /** ElevenLabs voice id, picked from the account's voice list in Settings. */
  elevenVoiceId: z.string().min(1),
  /** That voice's display name, kept with the id so status lines need no API call. */
  elevenVoiceName: z.string(),
  /** ElevenLabs model id. Flash v2.5 is the fastest (about 75 ms); v3 Conversational costs the same credits and is more expressive. */
  elevenModel: z.string().min(1),
  /** 0 to 1. Lower gives a broader emotional range; higher a steadier, flatter read. */
  elevenStability: z.number().min(0).max(1),
  /** 0.7 to 1.2. Speaking rate; 1 is the voice's natural pace. */
  elevenSpeed: z.number().min(0.7).max(1.2),
  /** Inworld voice id, picked from the workspace's voice list in Settings (system voices such as "Ashley", or a clone). */
  inworldVoiceId: z.string().min(1),
  /** That voice's display name, kept with the id so status lines need no API call. */
  inworldVoiceName: z.string(),
  /** Inworld model id: inworld-tts-2 (best quality) or inworld-tts-2-flash (fastest, cheapest). */
  inworldModel: z.string().min(1),
  /** 0.7 to 1.3. Speaking rate; 1 is the voice's natural pace (the API allows 0.5 to 1.5). */
  inworldSpeed: z.number().min(0.7).max(1.3),
  /** 0 to 1000 ms. Pause added after a sentence ending in a full stop; other punctuation scales from it. */
  inworldPauseMs: z.number().int().min(0).max(1000),
  /** Silence, in ms, before the transcriber decides the student has finished a thought (short pauses). */
  sttMinSilenceMs: z.number().int().min(100).max(5000),
  /** Silence, in ms, after which a turn ends regardless of how confident the transcriber is. */
  sttMaxSilenceMs: z.number().int().min(200).max(10000),
});
export type RuntimeSettings = z.infer<typeof RuntimeSettingsSchema>;

/** Values from the environment (or the code defaults). Never change while the process runs. */
export const envDefaults: RuntimeSettings = {
  model: normalizeModelId(env("CLAUDE_MODEL", DEFAULT_MODEL)!),
  tutorModel: normalizeModelId(env("CLAUDE_TUTOR_MODEL", DEFAULT_TUTOR_MODEL)!),
  reflectModel: normalizeModelId(env("CLAUDE_REFLECT_MODEL", "") ?? ""),
  assessorModel: normalizeModelId(env("CLAUDE_ASSESSOR_MODEL", "") ?? ""),
  tutorEffort: EffortSchema.catch("low").parse(env("CLAUDE_TUTOR_EFFORT", "low")),
  analysisEffort: EffortSchema.catch("high").parse(env("CLAUDE_ANALYSIS_EFFORT", "high")),
  reflectEffort: EffortSchema.catch("medium").parse(env("CLAUDE_REFLECT_EFFORT", "medium")),
  tutorThinking: env("CLAUDE_TUTOR_THINKING", "adaptive") === "disabled" ? "disabled" : "adaptive",
  prewarmCache: env("CLAUDE_PREWARM_CACHE", "true") !== "false",
  refusalFallbacks: env("CLAUDE_REFUSAL_FALLBACKS", "true") !== "false",
  outsideKnowledge: OutsideKnowledgeModeSchema.catch("check").parse(env("OUTSIDE_KNOWLEDGE", "check")),
  sessionMaxMinutes: Math.round(envNumber("SESSION_MAX_MINUTES", 3, 60, 30)),
  ttsProvider: (TTS_PROVIDERS as readonly string[]).includes(env("VOICE_TTS", "inworld")!) ? (env("VOICE_TTS", "inworld") as TtsProvider) : "inworld",
  ttsBatchSentences: env("VOICE_TTS_BATCH", "true") !== "false",
  // George, a premade voice used in ElevenLabs' own quickstart. Any voice from the account's list works.
  elevenVoiceId: env("ELEVENLABS_VOICE_ID", "JBFqnCBsd6RMkjVDRZzb")!,
  elevenVoiceName: env("ELEVENLABS_VOICE_NAME", env("ELEVENLABS_VOICE_ID") ? "" : "George")!,
  elevenModel: env("ELEVENLABS_MODEL", "eleven_flash_v2_5")!,
  elevenStability: envNumber("ELEVENLABS_STABILITY", 0, 1, 0.5),
  elevenSpeed: envNumber("ELEVENLABS_SPEED", 0.7, 1.2, 1),
  // Ashley is the system voice Inworld's own examples use. Any voice from the workspace's list works.
  inworldVoiceId: env("INWORLD_VOICE_ID", "Ashley")!,
  inworldVoiceName: env("INWORLD_VOICE_NAME", env("INWORLD_VOICE_ID") ? "" : "Ashley")!,
  inworldModel: env("INWORLD_MODEL", "inworld-tts-2")!,
  inworldSpeed: envNumber("INWORLD_SPEED", 0.7, 1.3, 1),
  // The same breath the other voices get between sentences (SENTENCE_GAP_MS.default in voice/pcm.ts).
  inworldPauseMs: Math.round(envNumber("INWORLD_PAUSE_MS", 0, 1000, 220)),
  sttMinSilenceMs: Number(env("ASSEMBLYAI_MIN_TURN_SILENCE", "400")),
  sttMaxSilenceMs: Number(env("ASSEMBLYAI_MAX_TURN_SILENCE", "1500")),
};

/** Models offered in the Settings tab (defined with their rules in llm/models.ts). Any model ID can still be typed in; the API checks it on save. */
export { MODEL_OPTIONS };

let settingsFile = path.join(dataDir, "settings.json");
let overrides: Partial<RuntimeSettings> = loadOverrides(settingsFile);

function loadOverrides(file: string): Partial<RuntimeSettings> {
  try {
    if (!fs.existsSync(file)) return {};
    const saved = JSON.parse(fs.readFileSync(file, "utf8")) as Record<string, unknown>;
    // Field by field: a setting that no longer exists, or no longer takes its saved value (a voice provider
    // that was removed), is dropped on its own, so the model choices saved beside it survive.
    const kept: Record<string, unknown> = {};
    const dropped: string[] = [];
    for (const [key, value] of Object.entries(saved)) {
      const field = (RuntimeSettingsSchema.shape as Record<string, z.ZodTypeAny | undefined>)[key];
      if (field?.safeParse(value).success) kept[key] = value;
      else dropped.push(key);
    }
    if (dropped.length) console.warn(`[config] ignoring saved settings that no longer apply (${file}): ${dropped.join(", ")}`);
    return RuntimeSettingsSchema.partial().parse(kept);
  } catch (err) {
    console.warn(`[config] ignoring unreadable ${file}:`, err instanceof Error ? err.message : err);
    return {};
  }
}

function effective(): RuntimeSettings {
  return { ...envDefaults, ...overrides };
}

export function getSettings(): { effective: RuntimeSettings; defaults: RuntimeSettings; overrides: Partial<RuntimeSettings> } {
  return { effective: effective(), defaults: envDefaults, overrides: { ...overrides } };
}

/** Validate and apply a partial change; persisted so it survives a restart. Returns the effective settings. */
export function updateSettings(patch: unknown): RuntimeSettings {
  const parsed = RuntimeSettingsSchema.partial().parse(patch);
  overrides = { ...overrides, ...parsed };
  // Drop overrides that merely restate the default, so the file only holds real changes.
  for (const k of Object.keys(overrides) as Array<keyof RuntimeSettings>) if (overrides[k] === envDefaults[k]) delete overrides[k];
  persist();
  return effective();
}

/** Forget every override; back to the environment values. */
export function resetSettings(): RuntimeSettings {
  overrides = {};
  persist();
  return effective();
}

function persist(): void {
  try {
    fs.mkdirSync(path.dirname(settingsFile), { recursive: true });
    if (Object.keys(overrides).length) fs.writeFileSync(settingsFile, JSON.stringify(overrides, null, 2));
    else if (fs.existsSync(settingsFile)) fs.unlinkSync(settingsFile);
  } catch (err) {
    console.warn("[config] could not persist settings:", err instanceof Error ? err.message : err);
  }
}

/** Tests only: point the overrides file somewhere disposable and start clean. */
export function useSettingsFile(file: string): void {
  settingsFile = file;
  overrides = loadOverrides(file);
}

// ---------------------------------------------------------------------------

export const config = {
  port: Number(env("PORT", "3001")),
  host: env("HOST", "0.0.0.0")!,
  dataDir,
  skillsDir: path.resolve(REPO_ROOT, env("SKILLS_DIR", "skills")!),

  // Live model settings (see RuntimeSettingsSchema). Getters, so runtime overrides apply immediately.
  get model(): string {
    return effective().model;
  },
  get tutorModel(): string {
    return effective().tutorModel;
  },
  /** The model that takes the tutor's notes: `reflectModel` when set, else the tutor's own. */
  get reflectModel(): string {
    return effective().reflectModel || effective().tutorModel;
  },
  /** The model that writes the report: `assessorModel` when set, else the offline model. */
  get assessorModel(): string {
    return effective().assessorModel || effective().model;
  },
  get tutorEffort(): Effort {
    return effective().tutorEffort;
  },
  get analysisEffort(): Effort {
    return effective().analysisEffort;
  },
  get reflectEffort(): Effort {
    return effective().reflectEffort;
  },
  get tutorThinking(): "adaptive" | "disabled" {
    return effective().tutorThinking;
  },
  get refusalFallbacks(): boolean {
    return effective().refusalFallbacks;
  },
  get prewarmCache(): boolean {
    return effective().prewarmCache;
  },
  get outsideKnowledge(): OutsideKnowledgeMode {
    return effective().outsideKnowledge;
  },
  get sessionMaxMinutes(): number {
    return effective().sessionMaxMinutes;
  },
  get ttsProvider(): TtsProvider {
    return effective().ttsProvider;
  },
  get elevenVoiceId(): string {
    return effective().elevenVoiceId;
  },
  get elevenVoiceName(): string {
    return effective().elevenVoiceName;
  },
  get elevenModel(): string {
    return effective().elevenModel;
  },
  get elevenStability(): number {
    return effective().elevenStability;
  },
  get elevenSpeed(): number {
    return effective().elevenSpeed;
  },
  get inworldVoiceId(): string {
    return effective().inworldVoiceId;
  },
  get inworldVoiceName(): string {
    return effective().inworldVoiceName;
  },
  get inworldModel(): string {
    return effective().inworldModel;
  },
  get inworldSpeed(): number {
    return effective().inworldSpeed;
  },
  get inworldPauseMs(): number {
    return effective().inworldPauseMs;
  },
  get ttsBatchSentences(): boolean {
    return effective().ttsBatchSentences;
  },
  get sttMinSilenceMs(): number {
    return effective().sttMinSilenceMs;
  },
  get sttMaxSilenceMs(): number {
    return effective().sttMaxSilenceMs;
  },

  /**
   * Browser voice: the student talks into the web app; the server streams the audio to a transcriber and
   * speaks the tutor's reply back.
   */
  voice: {
    /** Speech-to-text for the live student: assemblyai (streaming, end-of-turn detection) or none. */
    sttProvider: env("VOICE_STT", "assemblyai") as "assemblyai" | "none",
    assemblyAiKey: env("ASSEMBLYAI_API_KEY"),
    assemblyAiModel: env("ASSEMBLYAI_SPEECH_MODEL", "universal-3-5-pro")!,
    /** Sample rates: what the browser sends, and what we send back to it (every voice provider delivers 24 kHz). */
    micSampleRate: 16_000,
    playbackSampleRate: 24_000,
  },

  /** Speech-to-text for podcasts / videos without captions. */
  stt: {
    provider: env("STT_PROVIDER", "deepgram") as "deepgram" | "whisper-cli" | "none",
    deepgramApiKey: env("DEEPGRAM_API_KEY"),
    deepgramModel: env("DEEPGRAM_MODEL", "nova-3")!,
    /** Path to a local `whisper` / `whisper-cli` binary if STT_PROVIDER=whisper-cli. */
    whisperBin: env("WHISPER_BIN", "whisper")!,
  },
  /** yt-dlp binary used for YouTube / TED / other video and audio URLs. */
  ytDlpBin: env("YTDLP_BIN", "yt-dlp")!,

  /** ElevenLabs text-to-speech, one of the two voices for browser voice mode. */
  elevenlabs: {
    /** The key itself (starts with "sk_"), not the key ID that the dashboard lists beside it. */
    apiKey: env("ELEVENLABS_API_KEY"),
  },

  /** OpenAI, for the report only (Settings, Report model; llm/openai.ts). Everything else runs on the Claude API. */
  openai: {
    apiKey: env("OPENAI_API_KEY"),
  },

  /** Inworld text-to-speech, the other voice for browser voice mode, and the default. */
  inworld: {
    /** The Base64 credential copied from the Inworld Portal as-is (base64 of key_id:secret), without "Basic ". */
    apiKey: env("INWORLD_API_KEY"),
  },

  /** The reference check for facts from outside the material (reference/wikipedia.ts). */
  wikipedia: {
    /**
     * An email address or website Wikimedia can reach, sent in every request's User-Agent as its policy
     * requires. Without one the checks are off: an anonymous program is limited to 10 requests a minute.
     */
    contact: env("WIKIPEDIA_CONTACT"),
  },

  /** Origins allowed to call the HTTP API (the Vite dev server by default). */
  corsOrigins: (env("CORS_ORIGINS", "http://localhost:5173")!).split(",").map((s) => s.trim()),
} as const;

/**
 * Resolve a path typed on the command line. npm sets INIT_CWD to the directory the user ran `npm run`
 * from; workspace scripts themselves execute inside apps/server.
 */
export function resolveUserPath(p: string): string {
  return path.resolve(process.env.INIT_CWD ?? process.cwd(), p);
}

/** The provider browser voice will use right now: the one selected in Settings, if its key is present. */
export function activeTtsProvider(): TtsProvider | "none" {
  const provider = config.ttsProvider;
  return ttsKey(provider) ? provider : "none";
}

/** The key a provider needs, if it is set. */
export function ttsKey(provider: TtsProvider): string | undefined {
  return provider === "elevenlabs" ? config.elevenlabs.apiKey : config.inworld.apiKey;
}

/** The selected provider's voice, as a person would name it. */
export function ttsVoiceLabel(): string {
  if (config.ttsProvider === "elevenlabs") return config.elevenVoiceName || config.elevenVoiceId;
  return config.inworldVoiceName || config.inworldVoiceId;
}

/** The selected provider's model, as the status line shows it. */
export function ttsModelLabel(): string {
  if (config.ttsProvider === "elevenlabs") return config.elevenModel;
  return config.inworldModel;
}

export function requireAnthropicKey(): void {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    // The SDK also resolves `ant auth login` profiles; we only warn here.
    console.warn("[config] ANTHROPIC_API_KEY is not set; relying on SDK credential resolution.");
  }
}
