/** Thin client for the server API. Types mirror apps/server/src/domain/types.ts. */

export interface Lesson { id: string; title: string; objectives: string[]; conceptIds: string[]; guidingQuestions: string[]; practiceItems: string[]; order: number }
export interface Concept { id: string; name: string; summary: string; keyFacts: string[]; commonMisconceptions: string[]; sourceChunkIds: string[]; prerequisites: string[] }
export interface Chunk { id: string; source: string; headingPath: string[]; text: string; order: number }
/** The parent's decision about how much of a course the tutor teaches. Absent means everything. */
export interface CourseFocus { skippedLessonIds: string[]; skippedConceptIds: string[]; lessonOrder?: string[] }
export interface Course { id: string; title: string; subject: string; level: string; description: string; lessons: Lesson[]; concepts: Concept[]; chunkCount: number; sources?: Array<{ name: string; kind: string; url?: string }>; focus?: CourseFocus; createdAt: string }
/** How much of an answer the student is ready for (mirrors DepthSchema); absent on older profiles means "simple". */
export type Depth = "simple" | "some-nuance" | "full";
/** How to work with a student, whatever the course (mirrors LearnerProfileSchema). What they know about a course is a CourseKnowledge record. */
export interface Profile {
  demonstrationPreferences: string[]; challengeTolerance: string; pace: string; verbalLevel: string;
  interests: string[]; parentSummary: string; tutoringGuidance: string[]; depth?: Depth;
}
export type StartingEstimate = "none" | "some" | "can-explain";
/** Where a student started on one concept, in their own words, from the course intake. */
export interface ConceptStart { conceptId: string; estimate: StartingEstimate; said: string; confidence?: number; materialSays?: string; from: "probe" | "narration" }
/** What one student knows about one course (mirrors CourseKnowledgeSchema). */
export interface CourseKnowledge {
  id: string; learnerId: string; courseId: string; starts: ConceptStart[]; priorKnowledge: string[]; observedGaps: string[]; guidance: string[];
  baselineSummary?: string; intakeSessionId?: string; intakeAt?: string; createdAt: string; updatedAt: string;
  /** A course intake is done and its starting points are being written (or that failed, with the reason). */
  pending?: { sessionId: string; since: string; error?: string };
}
/** The passage the general intake reads to every student, and its two questions in three sets by grade. */
export interface IntakePassage { title: string; text: string; retell: string; bands: Array<{ id: "A" | "B" | "C"; grades: string; apply: string; hard: string }> }
/** An intake finished inside a reply and the sitting went straight on in another session. */
export interface Handover { from: string; to: string; kind: SessionKind }
/** How a turn ended. `sessionId` is the session that answered: after a hand-over, the one that took over. */
export interface TurnDone { sessionId: string; handover: Handover | null; phase: Phase; conceptIndex: number; latency: Latency | null }
/** What a session is for. A sitting can chain them: the general intake, then the course intake, then the lesson. */
export type SessionKind = "general-intake" | "course-intake" | "lesson";
/** One difference the profile pass made (or held): a list field gets one entry per item added (from "") or removed (to ""). */
export interface ProfileChange { field: string; from: string; to: string; why: string }
/** One revision of the profile after a session (mirrors ProfileUpdateSchema). */
export interface ProfileUpdate { at: string; sessionId: string; courseId?: string; courseTitle?: string; summary: string; changes: ProfileChange[]; held: ProfileChange[]; previous: Profile }
export interface Learner {
  id: string; name: string; age?: number; gradeLevel?: string; parentNotes?: string; profile?: Profile; profileHistory?: ProfileUpdate[]; profileReviewedAt?: string;
  /** The general intake is done and its profile is being written (or that failed, with the reason). */
  profilePending?: { sessionId: string; since: string; error?: string };
  createdAt: string;
}
export type Phase = "intake" | "teach" | "inquire" | "assess" | "wrap-up" | "complete";
export interface Latency { ttftMs: number; totalMs: number; iterations: number; cacheReadTokens: number; cacheWriteTokens: number; inputTokens: number; outputTokens: number; suppressedChars?: number; thinkingChars?: number; toolsBeforeSpeech?: boolean; reflectMs?: number; reflectThinkingChars?: number; firstAudioMs?: number; transcriptMs?: number; interrupted?: boolean }
export interface Turn { role: "user" | "assistant"; content: string; at: string; expressions?: string[]; latency?: Latency }
export interface Observation { at: string; conceptId: string; kind: "understanding" | "partial" | "misconception" | "gap" | "engagement" | "told"; evidence: string; note: string }
/** What the tutor does with facts from outside the family's material (mirrors OutsideKnowledgeModeSchema). */
export type OutsideKnowledgeMode = "check" | "answer" | "material-only";
/** A fact from outside the material that came up in a session, with the reference check's verdict (mirrors OutsideClaimSchema). */
export interface OutsideClaim {
  id: string; at: string; claim: string; raisedBy: "learner" | "tutor"; tutorStance: "confirmed" | "corrected" | "unsure" | "deferred";
  materialSays?: string; query: string; status: "pending" | "checked" | "not-checked" | "failed"; statusNote?: string;
  verdict?: "supported" | "contradicted" | "complicated" | "not-found"; explanation?: string; evidence?: string;
  source?: { title: string; url: string; revisionId?: number; quality?: string }; followUp?: string; checkedAt?: string;
}
export interface Session { id: string; learnerId: string; kind?: SessionKind; continuedIn?: string; continuedFrom?: string; probeConceptIds?: string[]; courseId?: string; lessonId?: string; conceptIndex: number; conceptIds?: string[]; narrationFirst?: boolean; outsideKnowledge?: OutsideKnowledgeMode; outsideClaims?: OutsideClaim[]; phase: Phase; transcript: Turn[]; observations: Observation[]; pendingDirectives: string[]; startedAt: string; endedAt?: string }
export interface SessionSummary { id: string; learnerId: string; kind?: SessionKind; continuedIn?: string; continuedFrom?: string; courseId?: string; lessonId?: string; phase: Phase; conceptIndex: number; turns: number; observations: number; startedAt: string; endedAt?: string; hasReport: boolean }
export interface LatencySummary { turns: number; ttftP50Ms: number; ttftMaxMs: number; totalP50Ms: number; cacheHitRate: number; firstAudioP50Ms?: number }
export interface Report {
  sessionId: string; learnerId: string; courseId?: string; lessonId?: string; createdAt: string;
  concepts: Array<{ conceptId: string; level: number; evidence: string[]; misconceptions: string[]; nextStep: string }>;
  parentSummary: string; studentSummary: string; recommendedNext: string[]; ungroundedClaims: string[]; effectiveFormats: string[];
  answerSeekingTurns: number; tutorAnswerGiveaways: number; outsideClaims?: OutsideClaim[];
}
export interface ConceptProgress { conceptId: string; name: string; level: number; previousLevel?: number; asOf: string; misconceptions: string[]; start?: ConceptStart }
export interface ProgressCounts { ungroundedClaims: number; tutorAnswerGiveaways: number; answerSeekingTurns: number }
/** Where a student stands on a course, across every report so far (mirrors domain/progress.ts). */
export interface ProgressSummary {
  learnerId: string; courseId: string; sessionsAssessed: number; latestSessionAt: string; concepts: ConceptProgress[];
  misconceptionsAtLatestSession: Array<{ conceptId: string; name: string; misconceptions: string[] }>;
  latestRecommendedNext: string[]; latestParentSummary: string; totals: ProgressCounts; latest: ProgressCounts;
  /** Concepts the course intake asked about that no session has assessed yet. */
  startsNotYetTaught: Array<ConceptStart & { name: string }>;
  baselineSummary?: string;
}
export type TtsProvider = "elevenlabs" | "inworld";
/** How a person would name the provider in a sentence. */
export const PROVIDER_NAME: Record<TtsProvider, string> = { elevenlabs: "ElevenLabs", inworld: "Inworld" };
/** The .env key each provider needs. */
export const PROVIDER_KEY: Record<TtsProvider, string> = { elevenlabs: "ELEVENLABS_API_KEY", inworld: "INWORLD_API_KEY" };
export interface RuntimeSettings {
  model: string; tutorModel: string; reflectModel: string; tutorEffort: string; analysisEffort: string; reflectEffort: string; tutorThinking: "adaptive" | "disabled"; prewarmCache: boolean; refusalFallbacks: boolean;
  outsideKnowledge: OutsideKnowledgeMode;
  ttsProvider: TtsProvider;
  ttsBatchSentences: boolean; sttMinSilenceMs: number; sttMaxSilenceMs: number;
  elevenVoiceId: string; elevenVoiceName: string; elevenModel: string; elevenStability: number; elevenSpeed: number;
  inworldVoiceId: string; inworldVoiceName: string; inworldModel: string; inworldSpeed: number; inworldPauseMs: number;
}
/** A text-to-speech provider as Settings offers it: whether its key is in .env, and what is wrong if not. */
export interface TtsProviderOption { id: TtsProvider; label: string; ready: boolean; problem?: string }
export interface SettingsView { effective: RuntimeSettings; defaults: RuntimeSettings; overrides: Partial<RuntimeSettings>; options: { models: string[]; efforts: string[]; thinking: string[]; ttsProviders: TtsProviderOption[] } }
export interface VoiceOption { id: string; name: string; description?: string; previewUrl?: string; category?: string }
export interface VoiceModelOption { id: string; name: string; note?: string }
/** A spoken sample of the draft voice settings, ready to play, and how fast the first audio came back. */
export interface VoicePreview { url: string; provider: string; firstAudioMs: number; totalMs: number; characters: number }
export interface Readiness { rows: Array<{ status: "ok" | "warn" | "fail"; item: string; note: string; stage: 0 | 1 | 2 | 3 }>; blocking: number; optional: number; checkedAt: string }
export interface Health { ok: boolean; model: string; tutorModel: string; reflectModel: string; tutorEffort: string; tutorThinking: string; voice: { stt: "assemblyai" | "none"; tts: TtsProvider | "none"; ttsProvider: TtsProvider; ttsVoice: string; ttsModel: string } }

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}
const json = (method: string, body?: unknown): RequestInit => ({ method, headers: { "content-type": "application/json" }, body: JSON.stringify(body ?? {}) });

export const api = {
  health: () => fetch("/api/health").then(j<Health>),

  settings: () => fetch("/api/settings").then(j<SettingsView>),
  saveSettings: (patch: Partial<RuntimeSettings>) => fetch("/api/settings", json("PUT", patch)).then(j<SettingsView>),
  resetSettings: () => fetch("/api/settings", { method: "DELETE" }).then(j<SettingsView>),
  doctor: (ping: boolean) => fetch(`/api/doctor?ping=${ping}`).then(j<Readiness>),
  voices: (provider: TtsProvider) => fetch(`/api/voice/voices?provider=${provider}`).then(j<VoiceOption[]>),
  /** A provider's models. ElevenLabs: the account's list, or the documented real-time ones ("built-in") when the account cannot be asked. */
  voiceModels: (provider: TtsProvider = "elevenlabs") => fetch(`/api/voice/models?provider=${provider}`).then(j<{ models: VoiceModelOption[]; source: "account" | "built-in"; error?: string }>),
  /** Speak a sample line with unsaved settings. Spends that line's characters of the provider's credits. */
  previewVoice: async (settings: Partial<RuntimeSettings>, text?: string): Promise<VoicePreview> => {
    const res = await fetch("/api/voice/preview", json("POST", { settings, text }));
    if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `${res.status} ${res.statusText}`);
    const n = (h: string) => Number(res.headers.get(h) ?? 0);
    return { url: URL.createObjectURL(await res.blob()), provider: res.headers.get("x-provider") ?? "", firstAudioMs: n("x-first-audio-ms"), totalMs: n("x-total-ms"), characters: n("x-characters") };
  },

  courses: () => fetch("/api/courses").then(j<Course[]>),
  chunks: (courseId: string) => fetch(`/api/courses/${courseId}/chunks`).then(j<Chunk[]>),
  deleteCourse: (id: string) => fetch(`/api/courses/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),
  /** Save the parent's focus for a course. Applies to sessions started afterwards. */
  setFocus: (courseId: string, focus: CourseFocus) => fetch(`/api/courses/${courseId}/focus`, json("PUT", focus)).then(j<Course>),
  samples: () => fetch("/api/samples").then(j<Array<{ name: string; size: number }>>),
  ingestSamples: (samples: string[], title?: string) => fetch("/api/courses/ingest", json("POST", { samples, title: title || undefined })).then(j<Course>),
  uploadCourse: (files: File[], title: string, urls: string[] = []) => {
    const fd = new FormData();
    if (title) fd.append("title", title);
    if (urls.length) fd.append("urls", urls.join("\n"));
    for (const f of files) fd.append("files", f, f.name);
    return fetch("/api/courses/upload", { method: "POST", body: fd }).then(j<Course>);
  },

  learners: () => fetch("/api/learners").then(j<Learner[]>),
  createLearner: (body: { name: string; age?: number; gradeLevel?: string }) => fetch("/api/learners", json("POST", body)).then(j<Learner>),
  resetProfile: (id: string) => fetch(`/api/learners/${id}/profile`, { method: "DELETE" }).then(j<Learner>),
  /** The parent's own words about their child. An empty text removes them. */
  saveNotes: (id: string, parentNotes: string) => fetch(`/api/learners/${id}/notes`, json("PUT", { parentNotes })).then(j<Learner>),
  /** Write the profile again from an intake whose write failed. */
  retryProfile: (id: string) => fetch(`/api/learners/${id}/profile/retry`, { method: "POST" }).then(j<Learner>),
  /** Write a course's starting points again from a course intake whose write failed. */
  retryKnowledge: (learnerId: string, courseId: string) => fetch(`/api/knowledge/${learnerId}/${courseId}/retry`, { method: "POST" }).then(j<CourseKnowledge>),
  intakePassage: () => fetch("/api/intake/passage").then(j<IntakePassage>),
  /** Every course record: what each student knows about each course. */
  knowledge: () => fetch("/api/knowledge").then(j<CourseKnowledge[]>),
  /** Forget what a student knows about a course; their next session on it opens with the course intake again. */
  forgetKnowledge: (learnerId: string, courseId: string) => fetch(`/api/knowledge/${learnerId}/${courseId}`, { method: "DELETE" }).then(j<{ ok: true }>),
  undoProfileUpdate: (id: string) => fetch(`/api/learners/${id}/profile/undo`, { method: "POST" }).then(j<Learner>),
  deleteLearner: (id: string) => fetch(`/api/learners/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),

  sessions: () => fetch("/api/sessions").then(j<SessionSummary[]>),
  /**
   * Starts a sitting and returns its first session: an intake when one is due, else the lesson. `skipGeneralIntake`
   * leaves the general intake to the Students tab; `skipIntake` skips both; `only` runs one intake by itself.
   */
  createSession: (body: { learnerId: string; courseId?: string; lessonId?: string; skipIntake?: boolean; skipGeneralIntake?: boolean; narrationFirst?: boolean; only?: "general-intake" | "course-intake" }) => fetch("/api/sessions", json("POST", body)).then(j<Session>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<Session>),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),
  latency: (sessionId: string) => fetch(`/api/sessions/${sessionId}/latency`).then(j<LatencySummary>),
  endSession: (id: string) => fetch(`/api/sessions/${id}/end`, { method: "POST" }).then(j<{ session: Session; report?: Report }>),
  /** Attach browser-measured voice timings to the latest tutor turn. */
  turnLatency: (id: string, body: { firstAudioMs?: number; transcriptMs?: number }) => fetch(`/api/sessions/${id}/turn-latency`, json("POST", body)).then(j<{ ok: true }>),

  reports: () => fetch("/api/reports").then(j<Report[]>),
  report: (sessionId: string) => fetch(`/api/reports/${sessionId}`).then(j<Report>),
  /** 404 (thrown as an Error with the server's message) until the student has a completed session on the course. */
  progress: (learnerId: string, courseId: string) => fetch(`/api/progress/${learnerId}/${courseId}`).then(j<ProgressSummary>),

  /**
   * Text-mode turn: streams deltas via SSE. The reply ends at `done`; the tutor's notes and any phase
   * change arrive a few seconds later as `reflected`, which calls `onReflected` if given.
   */
  async *message(sessionId: string, text: string, onReflected?: (sessionId: string) => void): AsyncGenerator<string, TurnDone, void> {
    const res = await fetch(`/api/sessions/${sessionId}/message`, json("POST", { text }));
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done: TurnDone = { sessionId, handover: null, phase: "teach", conceptIndex: 0, latency: null };
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; reflected?: boolean; sessionId?: string; handover?: Handover | null; phase?: Phase; conceptIndex?: number; latency?: Latency | null; error?: string };
        if (ev.error) throw new Error(ev.error);
        if (ev.delta) yield ev.delta;
        if (ev.done) done = { sessionId: ev.sessionId ?? sessionId, handover: ev.handover ?? null, phase: ev.phase ?? "teach", conceptIndex: ev.conceptIndex ?? 0, latency: ev.latency ?? null };
        if (ev.reflected) onReflected?.(ev.sessionId ?? done.sessionId);
      }
    }
    return done;
  },
};

/** Same p50 / hit-rate math as the server's latencySummary, so the panel updates without an extra request. */
export function summarizeLatency(transcript: Turn[]): LatencySummary {
  const ls = transcript.map((t) => t.latency).filter((l): l is Latency => Boolean(l) && !l?.interrupted);
  const p50 = (xs: number[]): number => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : 0);
  const read = ls.reduce((a, l) => a + l.cacheReadTokens, 0);
  const all = ls.reduce((a, l) => a + l.cacheReadTokens + l.cacheWriteTokens + l.inputTokens, 0);
  const audio = ls.map((l) => l.firstAudioMs).filter((x): x is number => typeof x === "number");
  return {
    turns: ls.length,
    ttftP50Ms: p50(ls.map((l) => l.ttftMs)),
    ttftMaxMs: Math.max(0, ...ls.map((l) => l.ttftMs)),
    totalP50Ms: p50(ls.map((l) => l.totalMs)),
    cacheHitRate: all ? Math.round((100 * read) / all) / 100 : 0,
    ...(audio.length ? { firstAudioP50Ms: p50(audio) } : {}),
  };
}

export const fmtMs = (ms: number): string => (ms >= 1000 ? `${(ms / 1000).toFixed(1)} s` : `${ms} ms`);
export const fmtDate = (iso: string): string => new Date(iso).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" });
