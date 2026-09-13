/**
 * Runtime configuration, read once from the environment.
 *
 * Only ANTHROPIC_API_KEY is required to run the text-mode tutor, ingestion, and assessment.
 * Hume keys are needed only for the voice layer.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));

/** Repository root (apps/server/src -> ../../..). */
export const REPO_ROOT = path.resolve(here, "..", "..", "..");

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
  /** Route safety-classifier refusals to a fallback model automatically. */
  refusalFallbacks: env("CLAUDE_REFUSAL_FALLBACKS", "true") !== "false",

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
