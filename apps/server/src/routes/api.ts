/**
 * HTTP API used by the web app and for scripting. All bodies/params are validated with Zod.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ingestCourse } from "../agents/curriculum-agent.js";
import { extractTextFromBuffer } from "../ingest/extract.js";
import { createSession, endSession, getSession, respond } from "../orchestrator/session.js";
import { courses, learners, reports } from "../store/index.js";
import { config } from "../config.js";
import { humeConfigured, mintAccessToken } from "../voice/hume.js";

const LearnerBody = z.object({ name: z.string().min(1), age: z.number().int().optional(), gradeLevel: z.string().optional() });
const SessionBody = z.object({ learnerId: z.string(), courseId: z.string().optional(), lessonId: z.string().optional(), skipIntake: z.boolean().optional() });
const MessageBody = z.object({ text: z.string().default(""), expressions: z.array(z.string()).optional() });

/** Strip bulky chunk text from course listings. */
function courseSummary(c: ReturnType<typeof courses.require>) {
  const { chunks, ...rest } = c;
  return { ...rest, chunkCount: chunks.length };
}

export function registerApiRoutes(app: FastifyInstance): void {
  app.get("/health", async () => ({ ok: true, model: config.model, tutorModel: config.tutorModel, hume: humeConfigured() }));

  // ---- Courses -------------------------------------------------------------
  app.get("/api/courses", async () => courses.list().map(courseSummary));
  app.get("/api/courses/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => courseSummary(courses.require(req.params.id)));

  app.post("/api/courses/upload", async (req, reply) => {
    const docs: Array<{ fileName: string; text: string }> = [];
    let title: string | undefined;
    for await (const part of req.parts()) {
      if (part.type === "file") {
        const buf = await part.toBuffer();
        docs.push(await extractTextFromBuffer(buf, part.filename));
      } else if (part.fieldname === "title" && typeof part.value === "string") {
        title = part.value;
      }
    }
    if (!docs.length) return reply.code(400).send({ error: "Upload at least one file (pdf, docx, md, txt)." });
    const course = await ingestCourse(docs, { titleHint: title, onProgress: (m) => req.log.info(m) });
    return courseSummary(course);
  });

  // ---- Learners ------------------------------------------------------------
  app.get("/api/learners", async () => learners.list());
  app.get("/api/learners/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => learners.require(req.params.id));
  app.post("/api/learners", async (req) => {
    const body = LearnerBody.parse(req.body);
    return learners.put({ id: learners.newId(), ...body, createdAt: new Date().toISOString() });
  });

  // ---- Sessions ------------------------------------------------------------
  app.post("/api/sessions", async (req) => createSession(SessionBody.parse(req.body)));
  app.get("/api/sessions/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => getSession(req.params.id));

  /** Text-mode turn. Streams the reply as SSE `data: {"delta": "..."}` events, then `data: {"done": true, ...}`. */
  app.post("/api/sessions/:id/message", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = MessageBody.parse(req.body ?? {});
    reply.raw.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-cache", Connection: "keep-alive", "Access-Control-Allow-Origin": originFor(req) });
    const abort = new AbortController();
    req.raw.on("close", () => abort.abort());
    try {
      const gen = respond(req.params.id, body.text, body.expressions, abort.signal);
      let r = await gen.next();
      while (!r.done) {
        reply.raw.write(`data: ${JSON.stringify({ delta: r.value })}\n\n`);
        r = await gen.next();
      }
      reply.raw.write(`data: ${JSON.stringify({ done: true, phase: r.value.session.phase, conceptIndex: r.value.session.conceptIndex })}\n\n`);
    } catch (err) {
      req.log.error({ err }, "turn failed");
      reply.raw.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    reply.raw.end();
    return reply;
  });

  app.post("/api/sessions/:id/end", async (req: FastifyRequest<{ Params: { id: string } }>) => endSession(req.params.id));

  // ---- Reports -------------------------------------------------------------
  app.get("/api/reports", async () => reports.list());
  app.get("/api/reports/:sessionId", async (req: FastifyRequest<{ Params: { sessionId: string } }>, reply) => {
    const r = reports.get(req.params.sessionId);
    return r ?? reply.code(404).send({ error: "No report for that session yet." });
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
