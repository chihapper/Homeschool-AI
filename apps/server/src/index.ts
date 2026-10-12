/**
 * Homeschool-AI server: the HTTP API for the web app and the browser voice socket.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { config, requireAnthropicKey, activeTtsProvider, ttsModelLabel, ttsVoiceLabel } from "./config.js";
import { MAX_UPLOAD_MB, registerApiRoutes } from "./routes/api.js";
import { registerLiveVoiceRoutes } from "./voice/live.js";
import { ensureMigrated } from "./store/migrate.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: config.corsOrigins });
  // Publishers' PDFs are large: The Good and the Beautiful's Marine Biology course book is 147 MB, mostly artwork,
  // and the old 50 MB cap refused it while its 36 MB student journal went through (2026-10-12).
  await app.register(multipart, { limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024, files: 20 } });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  registerApiRoutes(app);
  registerLiveVoiceRoutes(app);
  return app;
}

async function main(): Promise<void> {
  requireAnthropicKey();
  // Before anything reads or writes a learner: records from before the profile split are converted once.
  ensureMigrated(config.dataDir);
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Model: ${config.model} (tutor: ${config.tutorModel} @ ${config.tutorEffort})`);
  app.log.info(`Browser voice: speech-to-text ${config.voice.sttProvider === "assemblyai" && config.voice.assemblyAiKey ? "AssemblyAI" : "off"}, text-to-speech ${activeTtsProvider() === "none" ? `off (${config.ttsProvider} selected, key missing)` : `${{ elevenlabs: "ElevenLabs", inworld: "Inworld" }[config.ttsProvider]} ${ttsModelLabel()} (${ttsVoiceLabel()})`}`);
}

// Run when executed directly (tsx src/index.ts or node dist/index.js), not when imported by tests.
if (process.argv[1] && /index\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
