/**
 * Runtime configuration, read once from the environment.
 *
 * Only ANTHROPIC_API_KEY is required to run the text-mode tutor, ingestion, and assessment.
 * Hume keys are needed only for the voice layer.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

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

export const config = {
  port: Number(env("PORT", "3001")),
  host: env("HOST", "0.0.0.0")!,
  dataDir: path.resolve(env("DATA_DIR", path.join(REPO_ROOT, "data"))!),
  skillsDir: path.resolve(env("SKILLS_DIR", path.join(REPO_ROOT, "skills"))!),

  /** Model used by every agent unless overridden per agent. */
  model: env("CLAUDE_MODEL", "claude-opus-5")!,
  /** The live voice tutor is latency-sensitive; allow a separate model. */
  tutorModel: env("CLAUDE_TUTOR_MODEL", env("CLAUDE_MODEL", "claude-opus-5"))!,
  /** Effort for the live tutor. Lower effort = faster first token. */
  tutorEffort: (env("CLAUDE_TUTOR_EFFORT", "low") as "low" | "medium" | "high" | "xhigh" | "max"),
  /** Effort for offline agents (curriculum, profiler summary, assessor). */
  analysisEffort: (env("CLAUDE_ANALYSIS_EFFORT", "high") as "low" | "medium" | "high" | "xhigh" | "max"),
  /**
   * Thinking for the live tutor. "adaptive" (default) lets the model decide; at low effort it rarely thinks.
   * "disabled" shaves first-token latency further but Opus 5 has known failure modes with it (see docs/LATENCY.md).
   */
  tutorThinking: (env("CLAUDE_TUTOR_THINKING", "adaptive") as "adaptive" | "disabled"),
  /** Route safety-classifier refusals to a fallback model automatically. */
  refusalFallbacks: env("CLAUDE_REFUSAL_FALLBACKS", "true") !== "false",
  /** Pre-warm the tutor's prompt cache when a session is created, so the first spoken turn hits the cache. */
  prewarmCache: env("CLAUDE_PREWARM_CACHE", "true") !== "false",

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

  hume: {
    apiKey: env("HUME_API_KEY"),
    secretKey: env("HUME_SECRET_KEY"),
    configId: env("HUME_CONFIG_ID"),
    /** Public base URL of this server, as reachable by Hume (e.g. an ngrok URL). */
    publicUrl: env("PUBLIC_URL"),
    /** Bearer token Hume must present when calling the CLM endpoint. */
    clmSecret: env("CLM_SECRET"),
  },

  /** Origins allowed to call the HTTP API (the Vite dev server by default). */
  corsOrigins: (env("CORS_ORIGINS", "http://localhost:5173")!).split(",").map((s) => s.trim()),
} as const;

export function requireAnthropicKey(): void {
  if (!process.env.ANTHROPIC_API_KEY && !process.env.ANTHROPIC_AUTH_TOKEN) {
    // The SDK also resolves `ant auth login` profiles; we only warn here.
    console.warn("[config] ANTHROPIC_API_KEY is not set; relying on SDK credential resolution.");
  }
}
