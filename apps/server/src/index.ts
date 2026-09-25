/**
 * Homeschool-AI server: HTTP API for the web app + Hume EVI custom-language-model endpoint.
 */
import Fastify from "fastify";
import cors from "@fastify/cors";
import multipart from "@fastify/multipart";
import websocket from "@fastify/websocket";
import { config, requireAnthropicKey, activeTtsProvider, ttsVoiceLabel } from "./config.js";
import { registerApiRoutes } from "./routes/api.js";
import { registerClmRoutes } from "./voice/clm.js";
import { registerLiveVoiceRoutes } from "./voice/live.js";

export async function buildServer() {
  const app = Fastify({ logger: { level: process.env.LOG_LEVEL ?? "info" } });
  await app.register(cors, { origin: config.corsOrigins });
  await app.register(multipart, { limits: { fileSize: 50 * 1024 * 1024, files: 20 } });
  await app.register(websocket, { options: { maxPayload: 1024 * 1024 } });
  registerApiRoutes(app);
  registerClmRoutes(app);
  registerLiveVoiceRoutes(app);
  return app;
}

async function main(): Promise<void> {
  requireAnthropicKey();
  const app = await buildServer();
  await app.listen({ port: config.port, host: config.host });
  app.log.info(`Model: ${config.model} (tutor: ${config.tutorModel} @ ${config.tutorEffort})`);
  app.log.info(`Browser voice: speech-to-text ${config.voice.sttProvider === "assemblyai" && config.voice.assemblyAiKey ? "AssemblyAI" : "off"}, text-to-speech ${activeTtsProvider() === "none" ? `off (${config.ttsProvider} selected, key missing)` : config.ttsProvider === "elevenlabs" ? `ElevenLabs ${config.elevenModel} (${ttsVoiceLabel()})` : `Hume Octave ${config.ttsVersion} (${config.ttsVoice})`}`);
  app.log.info(config.hume.apiKey ? `Hume EVI: CLM at ${config.hume.publicUrl ?? "(set PUBLIC_URL)"}/clm/chat/completions` : "Hume EVI not configured");
}

// Run when executed directly (tsx src/index.ts or node dist/index.js), not when imported by tests.
if (process.argv[1] && /index\.(ts|js)$/.test(process.argv[1])) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
