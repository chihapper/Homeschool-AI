/**
 * HTTP API used by the web app and for scripting. All bodies/params are validated with Zod.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ingestCourse } from "../agents/curriculum-agent.js";
import { documentFromUpload, documentsFromUrl, type SourceDocument } from "../ingest/media/sources.js";
import { UnsupportedFileError } from "../ingest/extract.js";
import { annotateLastTurn, createSession, endSession, getSession, latencySummary, respond } from "../orchestrator/session.js";
import { CourseFocusSchema } from "../domain/types.js";
import { sanitizeFocus } from "../domain/focus.js";
import { buildProgress } from "../domain/progress.js";
import { courses, learners, reports, sessions } from "../store/index.js";
import { config, getSettings, MODEL_OPTIONS, REPO_ROOT, resetSettings, RuntimeSettingsSchema, updateSettings } from "../config.js";
import { checkReadiness } from "../doctor.js";
import { humeConfigured, mintAccessToken } from "../voice/hume.js";
import { listHumeVoices } from "../voice/tts-hume.js";

const LearnerBody = z.object({ name: z.string().min(1), age: z.number().int().optional(), gradeLevel: z.string().optional() });
const SessionBody = z.object({ learnerId: z.string(), courseId: z.string().optional(), lessonId: z.string().optional(), skipIntake: z.boolean().optional(), narrationFirst: z.boolean().optional() });
const IngestBody = z
  .object({
    urls: z.array(z.string().url()).optional(),
    /** File names under data/samples (bundled test material). */
    samples: z.array(z.string().min(1)).optional(),
    title: z.string().optional(),
    episodes: z.number().int().min(1).max(20).optional(),
    lang: z.string().optional(),
  })
  .refine((b) => (b.urls?.length ?? 0) + (b.samples?.length ?? 0) > 0, { message: "Provide at least one url or sample." });
const MessageBody = z.object({ text: z.string().default(""), expressions: z.array(z.string()).optional() });
/** Voice timings the browser measured for the latest tutor turn (the Hume EVI path measures them client-side). */
const TurnLatencyBody = z.object({ firstAudioMs: z.number().int().min(0).max(120_000).optional(), transcriptMs: z.number().int().min(0).max(120_000).optional() });

/** Bundled sample material lives in the repo, independent of DATA_DIR. */
const SAMPLES_DIR = path.join(REPO_ROOT, "data", "samples");

/** Strip bulky chunk text from course listings. */
function courseSummary(c: ReturnType<typeof courses.require>) {
  const { chunks, ...rest } = c;
  return { ...rest, chunkCount: chunks.length };
}

function health() {
  const s = getSettings().effective;
  return {
    ok: true,
    model: s.model,
    tutorModel: s.tutorModel,
    tutorEffort: s.tutorEffort,
    tutorThinking: s.tutorThinking,
    hume: humeConfigured(),
    voice: {
      stt: config.voice.sttProvider === "assemblyai" && config.voice.assemblyAiKey ? "assemblyai" : "none",
      tts: config.voice.ttsProvider === "hume" && config.hume.apiKey ? "hume" : "none",
      ttsVoice: s.ttsVoice,
      ttsVersion: s.ttsVersion,
    },
  };
}

function settingsView() {
  return { ...getSettings(), options: { models: [...MODEL_OPTIONS], efforts: RuntimeSettingsSchema.shape.tutorEffort.options, thinking: RuntimeSettingsSchema.shape.tutorThinking.options } };
}

function sampleFile(name: string): string {
  const base = path.basename(name);
  const file = path.join(SAMPLES_DIR, base);
  if (base !== name || !fs.existsSync(file)) throw new Error(`Unknown sample: ${name}`);
  return file;
}

export function registerApiRoutes(app: FastifyInstance): void {
  app.get("/health", async () => health());
  app.get("/api/health", async () => health());

  // ---- Settings & readiness -------------------------------------------------
  app.get("/api/settings", async () => settingsView());
  app.put("/api/settings", async (req, reply) => {
    try {
      updateSettings(req.body ?? {});
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return settingsView();
  });
  app.delete("/api/settings", async () => {
    resetSettings();
    return settingsView();
  });
  app.get("/api/doctor", async (req: FastifyRequest<{ Querystring: { ping?: string } }>) => checkReadiness({ ping: req.query.ping === "true" || req.query.ping === "1" }));
  /** Hume Voice Library, for the voice picker in Settings. */
  app.get("/api/voice/voices", async (_req, reply) => {
    try {
      return await listHumeVoices();
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });

  // ---- Courses -------------------------------------------------------------
  app.get("/api/courses", async () => courses.list().map(courseSummary));
  app.get("/api/courses/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => courseSummary(courses.require(req.params.id)));
  /** The verbatim source passages, for checking that nothing in the course was invented. */
  app.get("/api/courses/:id/chunks", async (req: FastifyRequest<{ Params: { id: string } }>) => courses.require(req.params.id).chunks);
  app.delete("/api/courses/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    courses.require(req.params.id);
    courses.delete(req.params.id);
    return { ok: true };
  });
  /** The parent's focus: which lessons and concepts the tutor teaches. A session reads it once, when it starts. */
  app.put("/api/courses/:id/focus", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const course = courses.require(req.params.id);
    const focus = sanitizeFocus(course, CourseFocusSchema.parse(req.body));
    return courseSummary(courses.put({ ...course, focus }));
  });
  app.get("/api/samples", async () => {
    if (!fs.existsSync(SAMPLES_DIR)) return [];
    return fs
      .readdirSync(SAMPLES_DIR)
      .filter((n) => !n.startsWith("."))
      .map((n) => ({ name: n, size: fs.statSync(path.join(SAMPLES_DIR, n)).size }));
  });

  /** Multipart: files (documents, slides, scans, audio, video) plus optional `title` and `urls` (newline-separated). */
  app.post("/api/courses/upload", async (req, reply) => {
    const docs: SourceDocument[] = [];
    let title: string | undefined;
    const urls: string[] = [];
    // A file we cannot read is the parent's problem to fix, not a server error: remember the first one
    // and answer with it, but keep consuming the multipart stream so the request finishes cleanly.
    let unreadable: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        try {
          docs.push(await documentFromUpload(buf, part.filename, { onProgress: (m) => req.log.info(m) }));
        } catch (err) {
          if (!(err instanceof UnsupportedFileError)) throw err;
          unreadable ??= err.message;
        }
      } else if (part.fieldname === "title" && typeof part.value === "string") {
        title = part.value;
      } else if (part.fieldname === "urls" && typeof part.value === "string") {
        urls.push(...part.value.split(/\s+/).filter(Boolean));
      }
    }
    if (unreadable) return reply.code(415).send({ error: unreadable });
    for (const u of urls) docs.push(...(await documentsFromUrl(u, { onProgress: (m) => req.log.info(m) })));
    if (!docs.length) return reply.code(400).send({ error: "Provide at least one file or URL." });
    const course = await ingestCourse(docs, { titleHint: title, onProgress: (m) => req.log.info(m) });
    return courseSummary(course);
  });

  /** JSON alternative: { urls?: string[], samples?: string[], title?: string, episodes?: number }. */
  app.post("/api/courses/ingest", async (req, reply) => {
    const parsed = IngestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    const body = parsed.data;
    const docs: SourceDocument[] = [];
    for (const s of body.samples ?? []) {
      let file: string;
      try {
        file = sampleFile(s);
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
      try {
        docs.push(await documentFromUpload(fs.readFileSync(file), path.basename(file), { onProgress: (m) => req.log.info(m) }));
      } catch (err) {
        if (!(err instanceof UnsupportedFileError)) throw err;
        return reply.code(415).send({ error: err.message });
      }
    }
    for (const u of body.urls ?? []) docs.push(...(await documentsFromUrl(u, { episodes: body.episodes, lang: body.lang, onProgress: (m) => req.log.info(m) })));
    const course = await ingestCourse(docs, { titleHint: body.title, onProgress: (m) => req.log.info(m) });
    return courseSummary(course);
  });

  // ---- Learners ------------------------------------------------------------
  app.get("/api/learners", async () => learners.list());
  app.get("/api/learners/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => learners.require(req.params.id));
  app.post("/api/learners", async (req) => {
    const body = LearnerBody.parse(req.body);
    return learners.put({ id: learners.newId(), ...body, createdAt: new Date().toISOString() });
  });
  /** Forget the profile so the next session runs the intake again (re-test a persona). */
  app.delete("/api/learners/:id/profile", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const { profile, ...rest } = learners.require(req.params.id);
    return learners.put(rest);
  });
  app.delete("/api/learners/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    learners.require(req.params.id);
    learners.delete(req.params.id);
    return { ok: true };
  });

  // ---- Sessions ------------------------------------------------------------
  app.get("/api/sessions", async () =>
    sessions
      .list()
      .map((s) => ({
        id: s.id,
        learnerId: s.learnerId,
        courseId: s.courseId,
        lessonId: s.lessonId,
        phase: s.phase,
        conceptIndex: s.conceptIndex,
        turns: s.transcript.length,
        observations: s.observations.length,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        hasReport: Boolean(reports.get(s.id)),
      }))
      .sort((a, b) => b.startedAt.localeCompare(a.startedAt)),
  );
  app.post("/api/sessions", async (req) => createSession(SessionBody.parse(req.body)));
  app.get("/api/sessions/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => getSession(req.params.id));
  app.get("/api/sessions/:id/latency", async (req: FastifyRequest<{ Params: { id: string } }>) => latencySummary(getSession(req.params.id)));
  app.delete("/api/sessions/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    sessions.require(req.params.id);
    sessions.delete(req.params.id);
    reports.delete(req.params.id);
    return { ok: true };
  });

  /** Text-mode turn. Streams the reply as SSE `data: {"delta": "..."}` events, then `data: {"done": true, ...}`. */
  app.post("/api/sessions/:id/message", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = MessageBody.parse(req.body ?? {});
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": originFor(req) });
    const abort = new AbortController();
    reply.raw.on("close", () => abort.abort()); // response close = client went away (req "close" fires as soon as the body is read on Node 16+)
    try {
      const gen = respond(req.params.id, body.text, body.expressions, abort.signal);
      let r = await gen.next();
      while (!r.done) {
        reply.raw.write(`data: ${JSON.stringify({ delta: r.value })}\n\n`);
        r = await gen.next();
      }
      // "done" goes out as soon as the reply is complete, so the student can answer immediately. The
      // tutor's notes and any phase change land a few seconds later, in a second event on the same
      // stream; the next turn waits for them anyway (settleReflection).
      const spoken = [...r.value.session.transcript].reverse().find((t) => t.role === "assistant");
      reply.raw.write(`data: ${JSON.stringify({ done: true, phase: r.value.session.phase, conceptIndex: r.value.session.conceptIndex, latency: spoken?.latency ?? null })}\n\n`);
      const settled = await r.value.reflection?.catch(() => undefined);
      if (settled) {
        const last = [...settled.transcript].reverse().find((t) => t.role === "assistant");
        reply.raw.write(`data: ${JSON.stringify({ reflected: true, phase: settled.phase, conceptIndex: settled.conceptIndex, latency: last?.latency ?? null })}\n\n`);
      }
    } catch (err) {
      req.log.error({ err }, "turn failed");
      reply.raw.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    reply.raw.end();
    return reply;
  });

  app.post("/api/sessions/:id/end", async (req: FastifyRequest<{ Params: { id: string } }>) => endSession(req.params.id));
  app.post("/api/sessions/:id/turn-latency", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    annotateLastTurn(req.params.id, TurnLatencyBody.parse(req.body ?? {}));
    return { ok: true };
  });

  // ---- Reports -------------------------------------------------------------
  app.get("/api/reports", async () => reports.list().sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
  app.get("/api/reports/:sessionId", async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    const r = reports.get(req.params.sessionId);
    return r ?? reply.code(404).send({ error: "No report for that session yet." });
  });

  // ---- Progress ------------------------------------------------------------
  /** Where a learner stands on a course, read across every report so far. */
  app.get("/api/progress/:learnerId/:courseId", async (req: FastifyRequest<{ Params: { learnerId: string; courseId: string } }>, reply) => {
    const course = courses.require(req.params.courseId);
    learners.require(req.params.learnerId);
    const progress = buildProgress(reports.list(), course, req.params.learnerId, req.params.courseId);
    return progress ?? reply.code(404).send({ error: "No completed sessions yet for this student and course." });
  });

  // ---- Hume ----------------------------------------------------------------
  /** Browser calls this to get a short-lived EVI token plus the config id and CLM secret to pass as session settings. */
  app.get("/api/hume/token", async (_req, reply) => {
    if (!humeConfigured()) return reply.code(503).send({ error: "Hume is not configured on the server (HUME_API_KEY / HUME_SECRET_KEY)." });
    const accessToken = await mintAccessToken();
    return { accessToken, configId: config.hume.configId ?? null, clmSecret: config.hume.clmSecret ?? null };
  });
}

function originFor(req: FastifyRequest): string {
  const origin = req.headers.origin;
  return origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0];
}
