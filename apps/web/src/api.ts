/** Thin client for the server API. Types mirror apps/server/src/domain/types.ts. */

export interface Lesson { id: string; title: string; objectives: string[]; conceptIds: string[]; order: number }
export interface Concept { id: string; name: string; summary: string; keyFacts: string[] }
export interface Course { id: string; title: string; subject: string; level: string; description: string; lessons: Lesson[]; concepts: Concept[]; chunkCount: number }
export interface Learner { id: string; name: string; age?: number; gradeLevel?: string; profile?: { parentSummary: string; tutoringGuidance: string[] } }
export type Phase = "intake" | "teach" | "inquire" | "assess" | "wrap-up" | "complete";
export interface Session { id: string; learnerId: string; courseId?: string; lessonId?: string; conceptIndex: number; phase: Phase; transcript: Array<{ role: "user" | "assistant"; content: string; at: string }>; observations: Array<{ conceptId: string; kind: string; evidence: string; note: string }> }
export interface Report { sessionId: string; concepts: Array<{ conceptId: string; level: number; evidence: string[]; misconceptions: string[]; nextStep: string }>; parentSummary: string; studentSummary: string; recommendedNext: string[]; ungroundedClaims: string[]; effectiveFormats: string[] }

async function j<T>(res: Response): Promise<T> {
  if (!res.ok) throw new Error((await res.json().catch(() => ({})))?.error ?? `${res.status} ${res.statusText}`);
  return res.json() as Promise<T>;
}

export const api = {
  health: () => fetch("/api/../health").then(j<{ ok: boolean; hume: boolean; tutorModel: string }>),
  courses: () => fetch("/api/courses").then(j<Course[]>),
  uploadCourse: (files: File[], title: string) => {
    const fd = new FormData();
    if (title) fd.append("title", title);
    for (const f of files) fd.append("files", f, f.name);
    return fetch("/api/courses/upload", { method: "POST", body: fd }).then(j<Course>);
  },
  learners: () => fetch("/api/learners").then(j<Learner[]>),
  createLearner: (body: { name: string; age?: number; gradeLevel?: string }) =>
    fetch("/api/learners", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(j<Learner>),
  createSession: (body: { learnerId: string; courseId?: string; lessonId?: string; skipIntake?: boolean }) =>
    fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(j<Session>),
  session: (id: string) => fetch(`/api/sessions/${id}`).then(j<Session>),
  endSession: (id: string) => fetch(`/api/sessions/${id}/end`, { method: "POST" }).then(j<{ session: Session; report?: Report }>),
  humeToken: () => fetch("/api/hume/token").then(j<{ accessToken: string; configId: string | null; clmSecret: string | null }>),

  /** Text-mode turn: streams deltas via SSE. */
  async *message(sessionId: string, text: string): AsyncGenerator<string, { phase: Phase; conceptIndex: number }, void> {
    const res = await fetch(`/api/sessions/${sessionId}/message`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ text }) });
    if (!res.ok || !res.body) throw new Error(`${res.status} ${res.statusText}`);
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    let done = { phase: "teach" as Phase, conceptIndex: 0 };
    for (;;) {
      const { value, done: end } = await reader.read();
      if (end) break;
      buf += dec.decode(value, { stream: true });
      let i: number;
      while ((i = buf.indexOf("\n\n")) >= 0) {
        const line = buf.slice(0, i).trim();
        buf = buf.slice(i + 2);
        if (!line.startsWith("data: ")) continue;
        const ev = JSON.parse(line.slice(6)) as { delta?: string; done?: boolean; phase?: Phase; conceptIndex?: number; error?: string };
        if (ev.error) throw new Error(ev.error);
        if (ev.delta) yield ev.delta;
        if (ev.done) done = { phase: ev.phase ?? "teach", conceptIndex: ev.conceptIndex ?? 0 };
      }
    }
    return done;
  },
};
