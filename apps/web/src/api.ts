/** Thin client for the server API. Types mirror apps/server/src/domain/types.ts. */

export interface Lesson { id: string; title: string; objectives: string[]; conceptIds: string[]; guidingQuestions: string[]; practiceItems: string[]; order: number }
export interface Concept { id: string; name: string; summary: string; keyFacts: string[]; commonMisconceptions: string[]; sourceChunkIds: string[]; prerequisites: string[] }
export interface Chunk { id: string; source: string; headingPath: string[]; text: string; order: number }
/** The parent's decision about how much of a course the tutor teaches. Absent means everything. */
export interface CourseFocus { skippedLessonIds: string[]; skippedConceptIds: string[]; lessonOrder?: string[] }
export interface Course { id: string; title: string; subject: string; level: string; description: string; lessons: Lesson[]; concepts: Concept[]; chunkCount: number; sources?: Array<{ name: string; kind: string; url?: string }>; focus?: CourseFocus; createdAt: string }
/** How much of an answer the student is ready for (mirrors DepthSchema); absent on older profiles means "simple". */
export type Depth = "simple" | "some-nuance" | "full";
export interface Profile {
  intakePreferences: string[]; demonstrationPreferences: string[]; challengeTolerance: string; pace: string; verbalLevel: string;
  interests: string[]; priorKnowledge: string[]; observedGaps: string[]; parentSummary: string; tutoringGuidance: string[]; depth?: Depth;
}
/** One difference the profile pass made (or held): a list field gets one entry per item added (from "") or removed (to ""). */
export interface ProfileChange { field: string; from: string; to: string; why: string }
/** One revision of the profile after a session (mirrors ProfileUpdateSchema). */
export interface ProfileUpdate { at: string; sessionId: string; courseId?: string; courseTitle?: string; summary: string; changes: ProfileChange[]; held: ProfileChange[]; previous: Profile }
export interface Learner { id: string; name: string; age?: number; gradeLevel?: string; profile?: Profile; profileHistory?: ProfileUpdate[]; profileReviewedAt?: string; createdAt: string }
export type Phase = "intake" | "teach" | "inquire" | "assess" | "wrap-up" | "complete";
export interface Latency { ttftMs: number; totalMs: number; iterations: number; cacheReadTokens: number; cacheWriteTokens: number; inputTokens: number; outputTokens: number; suppressedChars?: number; thinkingChars?: number; toolsBeforeSpeech?: boolean; reflectMs?: number; reflectThinkingChars?: number; firstAudioMs?: number; transcriptMs?: number; interrupted?: boolean }
export interface Turn { role: "user" | "assistant"; content: string; at: string; expressions?: string[]; latency?: Latency }
export interface Observation { at: string; conceptId: string; kind: "understanding" | "partial" | "misconception" | "gap" | "engagement"; evidence: string; note: string }
/** What the tutor does with facts from outside the family's material (mirrors OutsideKnowledgeModeSchema). */
export type OutsideKnowledgeMode = "check" | "answer" | "material-only";
/** A fact from outside the material that came up in a session, with the reference check's verdict (mirrors OutsideClaimSchema). */
export interface OutsideClaim {
  id: string; at: string; claim: string; raisedBy: "learner" | "tutor"; tutorStance: "confirmed" | "corrected" | "unsure" | "deferred";
  materialSays?: string; query: string; status: "pending" | "checked" | "not-checked" | "failed"; statusNote?: string;
  verdict?: "supported" | "contradicted" | "complicated" | "not-found"; explanation?: string; evidence?: string;
  source?: { title: string; url: string; revisionId?: number; quality?: string }; followUp?: string; checkedAt?: string;
}
export interface Session { id: string; learnerId: string; courseId?: string; lessonId?: string; conceptIndex: number; conceptIds?: string[]; narrationFirst?: boolean; outsideKnowledge?: OutsideKnowledgeMode; outsideClaims?: OutsideClaim[]; phase: Phase; transcript: Turn[]; observations: Observation[]; pendingDirectives: string[]; startedAt: string; endedAt?: string }
export interface SessionSummary { id: string; learnerId: string; courseId?: string; lessonId?: string; phase: Phase; conceptIndex: number; turns: number; observations: number; startedAt: string; endedAt?: string; hasReport: boolean }
export interface LatencySummary { turns: number; ttftP50Ms: number; ttftMaxMs: number; totalP50Ms: number; cacheHitRate: number; firstAudioP50Ms?: number }
export interface Report {
  sessionId: string; learnerId: string; courseId?: string; lessonId?: string; createdAt: string;
  concepts: Array<{ conceptId: string; level: number; evidence: string[]; misconceptions: string[]; nextStep: string }>;
  parentSummary: string; studentSummary: string; recommendedNext: string[]; ungroundedClaims: string[]; effectiveFormats: string[];
  answerSeekingTurns: number; tutorAnswerGiveaways: number; outsideClaims?: OutsideClaim[];
}
export interface ConceptProgress { conceptId: string; name: string; level: number; previousLevel?: number; asOf: string; misconceptions: string[] }
export interface ProgressCounts { ungroundedClaims: number; tutorAnswerGiveaways: number; answerSeekingTurns: number }
/** Where a student stands on a course, across every report so far (mirrors domain/progress.ts). */
export interface ProgressSummary {
  learnerId: string; courseId: string; sessionsAssessed: number; latestSessionAt: string; concepts: ConceptProgress[];
  misconceptionsAtLatestSession: Array<{ conceptId: string; name: string; misconceptions: string[] }>;
  latestRecommendedNext: string[]; latestParentSummary: string; totals: ProgressCounts; latest: ProgressCounts;
}
export type TtsProvider = "hume" | "elevenlabs" | "inworld";
/** How a person would name the provider in a sentence. */
export const PROVIDER_NAME: Record<TtsProvider, string> = { hume: "Hume", elevenlabs: "ElevenLabs", inworld: "Inworld" };
/** The .env key each provider needs. */
export const PROVIDER_KEY: Record<TtsProvider, string> = { hume: "HUME_API_KEY", elevenlabs: "ELEVENLABS_API_KEY", inworld: "INWORLD_API_KEY" };
export interface RuntimeSettings {
  model: string; tutorModel: string; tutorEffort: string; analysisEffort: string; reflectEffort: string; tutorThinking: "adaptive" | "disabled"; prewarmCache: boolean; refusalFallbacks: boolean;
  outsideKnowledge: OutsideKnowledgeMode;
  ttsProvider: TtsProvider;
  ttsVoice: string; ttsVersion: "1" | "2"; ttsInstant: boolean; ttsBatchSentences: boolean; sttMinSilenceMs: number; sttMaxSilenceMs: number;
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
export interface Health { ok: boolean; model: string; tutorModel: string; tutorEffort: string; tutorThinking: string; hume: boolean; voice: { stt: "assemblyai" | "none"; tts: TtsProvider | "none"; ttsProvider: TtsProvider; ttsVoice: string; ttsVersion: string; ttsModel: string } }

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
  undoProfileUpdate: (id: string) => fetch(`/api/learners/${id}/profile/undo`, { method: "POST" }).then(j<Learner>),
  deleteLearner: (id: string) => fetch(`/api/learners/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),

  sessions: () => fetch("/api/sessions").then(j<SessionSummary[]>),
  createSession: (body: { learnerId: string; courseId?: string; lessonId?: string; skipIntake?: boolean; narrationFirst?: boolean }) => fetch("/api/sessions", json("POST", body)).then(j<Session>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<Session>),
  deleteSession: (id: string) => fetch(`/api/sessions/${id}`, { method: "DELETE" }).then(j<{ ok: true }>),
  latency: (sessionId: string) => fetch(`/api/sessions/${sessionId}/latency`).then(j<LatencySummary>),
  endSession: (id: string) => fetch(`/api/sessions/${id}/end`, { method: "POST" }).then(j<{ session: Session; report?: Report }>),
  /** Attach browser-measured voice timings to the latest tutor turn (used by the Hume EVI path). */
  turnLatency: (id: string, body: { firstAudioMs?: number; transcriptMs?: number }) => fetch(`/api/sessions/${id}/turn-latency`, json("POST", body)).then(j<{ ok: true }>),

  reports: () => fetch("/api/reports").then(j<Report[]>),
  report: (sessionId: string) => fetch(`/api/reports/${sessionId}`).then(j<Report>),
  /** 404 (thrown as an Error with the server's message) until the student has a completed session on the course. */
  progress: (learnerId: string, courseId: string) => fetch(`/api/progress/${learnerId}/${courseId}`).then(j<ProgressSummary>),

  humeToken: () => fetch("/api/hume/token").then(j<{ accessToken: string; configId: string | null; clmSecret: string | null }>),

  /**
   * Text-mode turn: streams deltas via SSE. The reply ends at `done`; the tutor's notes and any phase
   * change arrive a few seconds later as `reflected`, which calls `onReflected` if given.
   */
  async *message(sessionId: string, text: string, onReflected?: () => void): AsyncGenerator<string, { phase: Phase; conceptIndex: number; latency: Latency | null }, void> {
    const res = await fetch(`/api/sessions/${sessionId}/message`, json("POST", { text }));
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = { phase: "teach" as Phase, conceptIndex: 0, latency: null as Latency | null };
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; reflected?: boolean; phase?: Phase; conceptIndex?: number; latency?: Latency | null; error?: string };
        if (ev.error) throw new Error(ev.error);
        if (ev.delta) yield ev.delta;
        if (ev.done) done = { phase: ev.phase ?? "teach", conceptIndex: ev.conceptIndex ?? 0, latency: ev.latency ?? null };
        if (ev.reflected) onReflected?.();
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
