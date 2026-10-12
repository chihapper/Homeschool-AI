/**
 * HTTP API used by the web app and for scripting. All bodies/params are validated with Zod.
 */
import fs from "node:fs";
import path from "node:path";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z } from "zod";
import { ingestCourse } from "../agents/curriculum-agent.js";
import { documentFromUpload, documentsFromUrl, type SourceDocument } from "../ingest/media/sources.js";
import { annotateLastTurn, createSession, endSession, getSession, latencySummary, respond, retryIntakeRecord } from "../orchestrator/session.js";
import { BAND_ORDER, BANDS, PASSAGE, RETELL_PROMPT } from "../domain/intake.js";
import { studentNamed } from "../domain/students.js";
import { dismissCourseJob, listCourseJobs, startCourseJob } from "../ingest/jobs.js";
import { CourseFocusSchema } from "../domain/types.js";
import { sanitizeFocus } from "../domain/focus.js";
import { buildProgress } from "../domain/progress.js";
import { courseBuildCost, monthlyUsage, sessionCost } from "../domain/cost.js";
import { courseKnowledge, courses, knowledgeFor, knowledgeId, knowledgeOf, learners, putCourseNotes, reports, sessions } from "../store/index.js";
import { activeTtsProvider, config, getSettings, MODEL_OPTIONS, REPO_ROOT, resetSettings, RuntimeSettingsSchema, ttsModelLabel, ttsVoiceLabel, updateSettings } from "../config.js";
import { undoProfileUpdate } from "../domain/profile.js";
import { anthropic, normalizeModelId } from "../llm/client.js";
import { OPENAI_MODEL_OPTIONS, vendorOf } from "../llm/models.js";
import { openai, openaiKeyProblem } from "../llm/openai.js";
import { checkReadiness } from "../doctor.js";
import { pcm16ToWav } from "../voice/pcm.js";
import { ELEVEN_FALLBACK_MODELS, elevenKeyProblem, listElevenModels, listElevenVoices, speakElevenLabs } from "../voice/tts-elevenlabs.js";
import { INWORLD_MODELS, inworldKeyProblem, inworldVoicePreview, listInworldVoices, speakInworldHttp } from "../voice/tts-inworld.js";
import { inworldText } from "../voice/live.js";
import { SentenceChunker, type Segment } from "../voice/sentence-chunker.js";

const LearnerBody = z.object({ name: z.string().min(1), age: z.number().int().optional(), gradeLevel: z.string().optional(), parentNotes: z.string().max(4000).optional() });
const NotesBody = z.object({ parentNotes: z.string().max(4000) });
const SessionBody = z.object({
  learnerId: z.string(),
  courseId: z.string().optional(),
  lessonId: z.string().optional(),
  skipIntake: z.boolean().optional(),
  skipGeneralIntake: z.boolean().optional(),
  narrationFirst: z.boolean().optional(),
  /** Run one intake on its own, with nothing after it. */
  only: z.enum(["general-intake", "course-intake"]).optional(),
});
const IngestBody = z
  .object({
    urls: z.array(z.string().url()).optional(),
    /** File names under data/samples (bundled test material). */
    samples: z.array(z.string().min(1)).optional(),
    title: z.string().optional(),
    publisher: z.string().optional(),
    grades: z.string().optional(),
    episodes: z.number().int().min(1).max(20).optional(),
    lang: z.string().optional(),
  })
  .refine((b) => (b.urls?.length ?? 0) + (b.samples?.length ?? 0) > 0, { message: "Provide at least one url or sample." });
const MessageBody = z.object({ text: z.string().default(""), expressions: z.array(z.string()).optional() });
/** "Test this voice" in Settings: the draft settings, unsaved, so a parent hears a choice before keeping it. */
const PreviewBody = z.object({ settings: RuntimeSettingsSchema.partial().optional(), text: z.string().trim().min(1).max(400).optional() });
const PREVIEW_TEXT = "Hi! I'm your tutor. Before I tell you anything, what do you already remember about how Rome began?";
/** Voice timings the browser measured for the latest tutor turn. */
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
    /** The model that takes the tutor's notes, resolved: the tutor's own unless Settings names another. */
    reflectModel: config.reflectModel,
    /** The model that writes the report, resolved: the offline model unless Settings names another. */
    assessorModel: config.assessorModel,
    tutorEffort: s.tutorEffort,
    tutorThinking: s.tutorThinking,
    voice: {
      stt: config.voice.sttProvider === "assemblyai" && config.voice.assemblyAiKey ? "assemblyai" : "none",
      /** The provider that will actually speak: the selected one if its key is present, else none (text only). */
      tts: activeTtsProvider(),
      /** The provider selected in Settings, whether or not its key is present. */
      ttsProvider: s.ttsProvider,
      ttsVoice: ttsVoiceLabel(),
      ttsModel: ttsModelLabel(),
    },
  };
}

function settingsView() {
  const elevenProblem = elevenKeyProblem(config.elevenlabs.apiKey);
  const inworldProblem = inworldKeyProblem(config.inworld.apiKey);
  return {
    ...getSettings(),
    options: {
      models: [...MODEL_OPTIONS],
      /** The report may also run on an OpenAI model. */
      reportModels: [...MODEL_OPTIONS, ...OPENAI_MODEL_OPTIONS],
      efforts: RuntimeSettingsSchema.shape.tutorEffort.options,
      thinking: RuntimeSettingsSchema.shape.tutorThinking.options,
      ttsProviders: [
        { id: "elevenlabs", label: "ElevenLabs", ready: !elevenProblem, problem: elevenProblem },
        { id: "inworld", label: "Inworld", ready: !inworldProblem, problem: inworldProblem },
      ],
    },
  };
}

/** What the parent typed about a course, trimmed; a blank field is no answer. */
function courseDetails(fields: { title?: string; publisher?: string; grades?: string }): { title?: string; publisher?: string; grades?: string } {
  const clean = (v?: string) => (v && v.trim() ? v.trim() : undefined);
  return { title: clean(fields.title), publisher: clean(fields.publisher), grades: clean(fields.grades) };
}
const CourseDetailsBody = z.object({ title: z.string().max(200).optional(), publisher: z.string().max(200).optional(), grades: z.string().max(100).optional() });

function sampleFile(name: string): string {
  const base = path.basename(name);
  const file = path.join(SAMPLES_DIR, base);
  if (base !== name || !fs.existsSync(file)) throw new Error(`Unknown sample: ${name}`);
  return file;
}

/**
 * A model ID typed into Settings is checked with the API before it is saved, so a typo fails here with the
 * API message ("model: claude-sonnet-5.5 was not found. Did you mean claude-sonnet-5-5?") rather than at the
 * first tutor turn. IDs are normalised first (dots to hyphens, lower case), so the common slip is accepted
 * as what was meant. The patch is edited in place so the normalised ID is what gets saved.
 */
async function checkModelIds(body: unknown): Promise<void> {
  if (!body || typeof body !== "object") return;
  const patch = body as Record<string, unknown>;
  const label: Record<string, string> = { model: "Offline model", tutorModel: "Tutor model", reflectModel: "Notes model", assessorModel: "Report model" };
  for (const key of ["model", "tutorModel", "reflectModel", "assessorModel"] as const) {
    const raw = patch[key];
    if (typeof raw !== "string") continue;
    const id = normalizeModelId(raw);
    patch[key] = id;
    if ((key === "reflectModel" || key === "assessorModel") && !id) continue; // empty: follow the model above it
    if (vendorOf(id) === "openai") {
      // Only the report has the OpenAI adapter behind it (llm/openai.ts); the tutor and the other offline agents are the Claude API's.
      if (key !== "assessorModel") throw new Error(`${label[key]} "${raw}": only the report can run on an OpenAI model; the rest runs on the Claude API.`);
      const problem = openaiKeyProblem();
      if (problem) throw new Error(`${label[key]} "${raw}": ${problem}`);
      try {
        await openai().models.retrieve(id);
      } catch (err) {
        throw new Error(`${label[key]} "${raw}": ${err instanceof Error ? err.message : String(err)}`);
      }
      continue;
    }
    try {
      await anthropic.models.retrieve(id);
    } catch (err) {
      const e = err as { error?: { error?: { message?: string } }; message?: string };
      const detail = e.error?.error?.message ?? e.message ?? String(err);
      throw new Error(`${label[key]} "${raw}": ${detail}`);
    }
  }
}

export function registerApiRoutes(app: FastifyInstance): void {
  app.get("/health", async () => health());
  app.get("/api/health", async () => health());

  // ---- Settings & readiness -------------------------------------------------
  app.get("/api/settings", async () => settingsView());
  app.put("/api/settings", async (req, reply) => {
    try {
      await checkModelIds(req.body);
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
  /** The voices a provider offers, for the voice picker in Settings (?provider=elevenlabs|inworld; default the selected one). */
  app.get("/api/voice/voices", async (req: FastifyRequest<{ Querystring: { provider?: string } }>, reply) => {
    const provider = req.query.provider === "elevenlabs" || req.query.provider === "inworld" ? req.query.provider : config.ttsProvider;
    try {
      if (provider === "elevenlabs") {
        if (!config.elevenlabs.apiKey) return reply.code(400).send({ error: elevenKeyProblem(undefined) });
        return await listElevenVoices();
      }
      const problem = inworldKeyProblem(config.inworld.apiKey);
      if (problem) return reply.code(400).send({ error: problem });
      return await listInworldVoices();
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  /**
   * Models for the picker. ElevenLabs: the account's list, or the documented real-time ones when the account
   * cannot be asked. Inworld: its two current models (?provider=inworld).
   */
  app.get("/api/voice/models", async (req: FastifyRequest<{ Querystring: { provider?: string } }>) => {
    if (req.query.provider === "inworld") return { models: INWORLD_MODELS, source: "built-in" };
    if (!config.elevenlabs.apiKey) return { models: ELEVEN_FALLBACK_MODELS, source: "built-in", error: elevenKeyProblem(undefined) };
    try {
      return { models: await listElevenModels(), source: "account" };
    } catch (err) {
      return { models: ELEVEN_FALLBACK_MODELS, source: "built-in", error: err instanceof Error ? err.message : String(err) };
    }
  });
  /**
   * Speak one line with the given (unsaved) settings and return it as a WAV the browser can play. Spends
   * that line's characters of the provider's credits. Headers carry the first-audio time and the provider.
   */
  app.post("/api/voice/preview", async (req, reply) => {
    let body: z.infer<typeof PreviewBody>;
    try {
      body = PreviewBody.parse(req.body ?? {});
    } catch (err) {
      return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
    }
    const s = { ...getSettings().effective, ...(body.settings ?? {}) };
    const text = body.text ?? PREVIEW_TEXT;
    const t0 = performance.now();
    let firstMs: number | undefined;
    const parts: Buffer[] = [];
    try {
      const chunks: AsyncIterable<{ pcm: Buffer }> =
        s.ttsProvider === "elevenlabs"
          ? speakElevenLabs(text, { voiceId: s.elevenVoiceId, model: s.elevenModel, stability: s.elevenStability, speed: s.elevenSpeed })
          : (async function* () {
              // Sentence by sentence as the live tutor sends it, so the sample carries the pause setting.
              const chunker = new SentenceChunker();
              const segments = [...chunker.push(text), chunker.flush()].filter((x): x is Segment => Boolean(x));
              const spoken = inworldText(segments, undefined, s.inworldPauseMs);
              for await (const pcm of speakInworldHttp(spoken, { voiceId: s.inworldVoiceId, model: s.inworldModel, speed: s.inworldSpeed })) yield { pcm };
            })();
      for await (const c of chunks) {
        firstMs ??= Math.round(performance.now() - t0);
        parts.push(c.pcm);
      }
    } catch (err) {
      return reply.code(502).send({ error: err instanceof Error ? err.message : String(err) });
    }
    return reply
      .header("content-type", "audio/wav")
      .header("x-provider", s.ttsProvider)
      .header("x-first-audio-ms", String(firstMs ?? 0))
      .header("x-total-ms", String(Math.round(performance.now() - t0)))
      .header("x-characters", String(text.length))
      .send(pcm16ToWav(Buffer.concat(parts), config.voice.playbackSampleRate));
  });

  /**
   * A provider's own sample of a voice, for the play button in the voice picker. Inworld serves these free but
   * rate-limits them, so each voice and model is fetched once per server run.
   */
  const voicePreviews = new Map<string, Buffer>();
  app.get("/api/voice/voice-preview", async (req: FastifyRequest<{ Querystring: { provider?: string; voiceId?: string; model?: string } }>, reply) => {
    const { provider, voiceId } = req.query;
    if (provider !== "inworld" || !voiceId) return reply.code(400).send({ error: "Give provider=inworld and a voiceId." });
    const model = req.query.model || config.inworldModel;
    const key = `${voiceId}|${model}`;
    try {
      let mp3 = voicePreviews.get(key);
      if (!mp3) {
        mp3 = await inworldVoicePreview(voiceId, model);
        voicePreviews.set(key, mp3);
      }
      return reply.header("content-type", "audio/mpeg").header("cache-control", "private, max-age=86400").send(mp3);
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
  /** The parent's own details for a course: title, publisher, grades. A blank publisher or grades clears it. */
  app.put("/api/courses/:id/details", async (req: FastifyRequest<{ Params: { id: string } }>, reply: FastifyReply) => {
    const body = CourseDetailsBody.parse(req.body);
    const next = { ...courses.require(req.params.id) };
    if (body.title !== undefined) {
      if (!body.title.trim()) return reply.code(400).send({ error: "A course needs a title." });
      next.title = body.title.trim();
    }
    for (const k of ["publisher", "grades"] as const) {
      const v = body[k];
      if (v === undefined) continue;
      if (v.trim()) next[k] = v.trim();
      else delete next[k];
    }
    return courseSummary(courses.put(next));
  });

  // ---- Course builds (background jobs; the corner ring and the notification read these) ----------------------
  app.get("/api/jobs", async () => listCourseJobs());
  app.delete("/api/jobs/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => ({ ok: dismissCourseJob(req.params.id) }));

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

  /**
   * Multipart: files (documents, slides, scans, audio, video) plus optional title, publisher, grades and urls
   * (newline-separated). Answers at once with a build job (202); the browser follows it on GET /api/jobs. Reading
   * the files happens inside the job too, so a large scan does not hold the request open; a file the app cannot
   * read fails the job with the conversion to run, which the parent sees in the notification.
   */
  app.post("/api/courses/upload", async (req, reply) => {
    const files: Array<{ buf: Buffer; name: string }> = [];
    const fields: Record<string, string> = {};
    for await (const part of req.parts()) {
      if (part.type === "file") files.push({ buf: await part.toBuffer(), name: part.filename });
      else if (typeof part.value === "string") fields[part.fieldname] = part.value;
    }
    const urls = (fields.urls ?? "").split(/\s+/).filter(Boolean);
    if (!files.length && !urls.length) return reply.code(400).send({ error: "Provide at least one file or URL." });
    const details = courseDetails(fields);
    const log = (m: string) => req.log.info(m);
    const job = startCourseJob(details.title ?? files[0]?.name ?? urls[0], async (tracker) => {
      const docs: SourceDocument[] = [];
      for (const f of files) docs.push(await documentFromUpload(f.buf, f.name, { onProgress: log }));
      for (const u of urls) docs.push(...(await documentsFromUrl(u, { onProgress: log })));
      return ingestCourse(docs, { titleHint: details.title, publisher: details.publisher, grades: details.grades, onProgress: log, tracker });
    }, log);
    return reply.code(202).send(job);
  });

  /** JSON alternative: { urls?: string[], samples?: string[], title?: string, episodes?: number }. */
  app.post("/api/courses/ingest", async (req, reply) => {
    const parsed = IngestBody.safeParse(req.body);
    if (!parsed.success) return reply.code(400).send({ error: parsed.error.issues.map((i) => i.message).join("; ") });
    const body = parsed.data;
    const files: Array<{ buf: Buffer; name: string }> = [];
    for (const s of body.samples ?? []) {
      try {
        const file = sampleFile(s);
        files.push({ buf: fs.readFileSync(file), name: path.basename(file) });
      } catch (err) {
        return reply.code(400).send({ error: err instanceof Error ? err.message : String(err) });
      }
    }
    const details = courseDetails(body);
    const log = (m: string) => req.log.info(m);
    // A build job like an upload's: answered at once, followed on GET /api/jobs.
    const job = startCourseJob(details.title ?? files[0]?.name ?? body.urls?.[0] ?? "Course", async (tracker) => {
      const docs: SourceDocument[] = [];
      for (const f of files) docs.push(await documentFromUpload(f.buf, f.name, { onProgress: log }));
      for (const u of body.urls ?? []) docs.push(...(await documentsFromUrl(u, { episodes: body.episodes, lang: body.lang, onProgress: log })));
      return ingestCourse(docs, { titleHint: details.title, publisher: details.publisher, grades: details.grades, onProgress: log, tracker });
    }, log);
    return reply.code(202).send(job);
  });

  // ---- Learners ------------------------------------------------------------
  app.get("/api/learners", async () => learners.list());
  app.get("/api/learners/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => learners.require(req.params.id));
  app.post("/api/learners", async (req, reply: FastifyReply) => {
    const body = LearnerBody.parse(req.body);
    // One record per child: the same name again is the same child added twice (domain/students.ts).
    const existing = studentNamed(learners.list(), body.name);
    if (existing) return reply.code(409).send({ error: `There is already a student named ${existing.name}.`, learnerId: existing.id });
    return learners.put({ id: learners.newId(), ...body, name: body.name.trim(), createdAt: new Date().toISOString() });
  });
  /** Forget the profile, and its revisions, so the next session runs the intake again (re-test a persona). */
  app.delete("/api/learners/:id/profile", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const { profile, profileHistory, profileReviewedAt, profilePending, ...rest } = learners.require(req.params.id);
    return learners.put(rest);
  });
  /** Undo the latest revision of the profile: back to what it was before that session. */
  app.post("/api/learners/:id/profile/undo", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    try {
      // Both records go back: the profile, and the course notes when that revision changed them.
      const { learner, course } = undoProfileUpdate(learners.require(req.params.id));
      if (course) putCourseNotes(learner.id, course.courseId, course.notes);
      return learners.put(learner);
    } catch (err) {
      return reply.code(409).send({ error: err instanceof Error ? err.message : String(err) });
    }
  });
  app.delete("/api/learners/:id", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    learners.require(req.params.id);
    learners.delete(req.params.id);
    // Their course records are keyed by the learner and mean nothing without them.
    for (const k of knowledgeOf(req.params.id)) courseKnowledge.delete(k.id);
    return { ok: true };
  });
  /** The parent's own words about their child. The tutor follows them as written and no pass rewrites them; an empty text removes them. */
  app.put("/api/learners/:id/notes", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const text = NotesBody.parse(req.body ?? {}).parentNotes.trim();
    const { parentNotes: _previous, ...rest } = learners.require(req.params.id);
    return learners.put(text ? { ...rest, parentNotes: text } : rest);
  });

  /** The intake conversation happened but its profile was not written (the write failed, or the server stopped): write it again from the transcript. */
  app.post("/api/learners/:id/profile/retry", async (req: FastifyRequest<{ Params: { id: string } }>, reply) => {
    const learner = learners.require(req.params.id);
    if (!learner.profilePending) return reply.code(409).send({ error: `${learner.name} has no intake waiting to be written up.` });
    retryIntakeRecord(learner.profilePending.sessionId);
    return learners.require(req.params.id);
  });
  /** What the general intake reads to every student, and its questions, for the parent to see. */
  app.get("/api/intake/passage", async () => ({
    title: PASSAGE.title,
    text: PASSAGE.text,
    retell: RETELL_PROMPT,
    bands: BAND_ORDER.map((id) => ({ id, grades: BANDS[id].grades, apply: BANDS[id].apply, hard: BANDS[id].hard })),
  }));

  // ---- Course knowledge: what one student knows about one course ---------------
  app.get("/api/knowledge", async () => courseKnowledge.list());
  app.get("/api/knowledge/:learnerId/:courseId", async (req: FastifyRequest<{ Params: { learnerId: string; courseId: string } }>, reply) => {
    return knowledgeFor(req.params.learnerId, req.params.courseId) ?? reply.code(404).send({ error: "No record for this student on this course yet." });
  });
  /** A course intake happened but its starting points were not written: write them again from the transcript. */
  app.post("/api/knowledge/:learnerId/:courseId/retry", async (req: FastifyRequest<{ Params: { learnerId: string; courseId: string } }>, reply) => {
    const k = knowledgeFor(req.params.learnerId, req.params.courseId);
    if (!k?.pending) return reply.code(409).send({ error: "No course intake is waiting to be written up for this student and course." });
    retryIntakeRecord(k.pending.sessionId);
    return knowledgeFor(req.params.learnerId, req.params.courseId);
  });
  /** Forget what a student knows about a course, so their next session on it opens with the course intake again. */
  app.delete("/api/knowledge/:learnerId/:courseId", async (req: FastifyRequest<{ Params: { learnerId: string; courseId: string } }>) => {
    courseKnowledge.delete(knowledgeId(req.params.learnerId, req.params.courseId));
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
        kind: s.kind ?? (s.phase === "intake" ? "general-intake" : "lesson"),
        continuedIn: s.continuedIn,
        continuedFrom: s.continuedFrom,
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
  /** What one session has cost so far, with its report and profile pass once they exist (domain/cost.ts). */
  app.get("/api/sessions/:id/cost", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    const session = getSession(req.params.id);
    const learner = learners.get(session.learnerId);
    return sessionCost(session, { report: reports.get(session.id), update: learner?.profileHistory?.find((u) => u.sessionId === session.id) });
  });
  /** One month's use per student (?month=YYYY-MM, default this month), and what each course build cost. */
  app.get("/api/usage", async (req: FastifyRequest<{ Querystring: { month?: string } }>) => {
    const asked = req.query.month ?? "";
    const month = /^\d{4}-\d{2}$/.test(asked) ? asked : new Date().toISOString().slice(0, 7);
    const use = monthlyUsage(month, sessions.list(), reports.list(), learners.list());
    return { ...use, courses: courses.list().map((c) => ({ courseId: c.id, title: c.title, ...courseBuildCost(c) })) };
  });
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
      // `sessionId` is the session that answered: after an intake's hand-over it is the one that took over, and the browser follows it.
      reply.raw.write(`data: ${JSON.stringify({ done: true, timeUp: r.value.timeUp ?? false, sessionId: r.value.session.id, handover: r.value.handover ?? null, phase: r.value.session.phase, conceptIndex: r.value.session.conceptIndex, latency: spoken?.latency ?? null })}\n\n`);
      const settled = await r.value.reflection?.catch(() => undefined);
      if (settled) {
        const last = [...settled.transcript].reverse().find((t) => t.role === "assistant");
        reply.raw.write(`data: ${JSON.stringify({ reflected: true, sessionId: settled.id, phase: settled.phase, conceptIndex: settled.conceptIndex, latency: last?.latency ?? null })}\n\n`);
      }
    } catch (err) {
      req.log.error({ err }, "turn failed");
      reply.raw.write(`data: ${JSON.stringify({ error: err instanceof Error ? err.message : String(err) })}\n\n`);
    }
    reply.raw.end();
    return reply;
  });

  app.post("/api/sessions/:id/end", async (req: FastifyRequest<{ Params: { id: string } }>) => {
    // The profile pass keeps running after the report is returned; the Students tab shows it when it lands.
    const { profileUpdate: _background, ...result } = await endSession(req.params.id);
    return result;
  });
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
    const progress = buildProgress(reports.list(), course, req.params.learnerId, req.params.courseId, knowledgeFor(req.params.learnerId, req.params.courseId));
    return progress ?? reply.code(404).send({ error: "No completed sessions yet for this student and course." });
  });
}

function originFor(req: FastifyRequest): string {
  const origin = req.headers.origin;
  return origin && config.corsOrigins.includes(origin) ? origin : config.corsOrigins[0];
}
