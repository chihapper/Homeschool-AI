import { useEffect, useRef, useState } from "react";
import { VoiceProvider, useVoice } from "@humeai/voice-react";
import { api, type Course, type Learner, type Report, type Session } from "../api";

interface Props {
  courses: Course[];
  learners: Learner[];
  session: Session | null;
  onSession: (s: Session | null) => void;
  onReport: (r: Report) => void;
}

export function SessionPage(props: Props) {
  return (
    <VoiceProvider>
      <SessionInner {...props} />
    </VoiceProvider>
  );
}

function SessionInner({ courses, learners, session, onSession, onReport }: Props) {
  const [learnerId, setLearnerId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [lessonId, setLessonId] = useState("");
  const [mode, setMode] = useState<"text" | "voice">("text");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [transcript, setTranscript] = useState<Array<{ role: "user" | "assistant"; content: string }>>([]);
  const [draft, setDraft] = useState("");
  const [phase, setPhase] = useState<Session["phase"]>("teach");
  const voice = useVoice();
  const bottom = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!learnerId && learners[0]) setLearnerId(learners[0].id);
    if (!courseId && courses[0]) setCourseId(courses[0].id);
  }, [learners, courses, learnerId, courseId]);
  useEffect(() => bottom.current?.scrollIntoView({ behavior: "smooth" }), [transcript]);

  // Mirror Hume's transcript into our view when in voice mode.
  useEffect(() => {
    if (mode !== "voice") return;
    const turns = voice.messages
      .filter((m): m is Extract<typeof m, { type: "user_message" | "assistant_message" }> => m.type === "user_message" || m.type === "assistant_message")
      .map((m) => ({ role: m.type === "user_message" ? ("user" as const) : ("assistant" as const), content: m.message.content ?? "" }));
    setTranscript(turns);
  }, [voice.messages, mode]);

  const course = courses.find((c) => c.id === courseId);
  const learner = learners.find((l) => l.id === learnerId);

  const runTurn = async (sid: string, text: string) => {
    setBusy(true);
    setErr(null);
    if (text) setTranscript((t) => [...t, { role: "user", content: text }]);
    setTranscript((t) => [...t, { role: "assistant", content: "" }]);
    try {
      const gen = api.message(sid, text);
      let r = await gen.next();
      while (!r.done) {
        const delta = r.value;
        setTranscript((t) => {
          const copy = t.slice();
          copy[copy.length - 1] = { role: "assistant", content: copy[copy.length - 1].content + delta };
          return copy;
        });
        r = await gen.next();
      }
      setPhase(r.value.phase);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const start = async () => {
    setErr(null);
    setBusy(true);
    try {
      const s = await api.createSession({ learnerId, courseId: courseId || undefined, lessonId: lessonId || undefined });
      onSession(s);
      setPhase(s.phase);
      setTranscript([]);
      if (mode === "voice") {
        const tok = await api.humeToken();
        if (!tok.configId) throw new Error("HUME_CONFIG_ID is not set on the server. Run `npm run setup:hume` first.");
        await voice.connect({
          auth: { type: "accessToken", value: tok.accessToken },
          configId: tok.configId,
          sessionSettings: {
            type: "session_settings",
            customSessionId: s.id,
            ...(tok.clmSecret ? { languageModelApiKey: tok.clmSecret } : {}),
          },
        });
      } else {
        await runTurn(s.id, "");
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const send = async () => {
    if (!session || !draft.trim() || busy) return;
    const text = draft.trim();
    setDraft("");
    await runTurn(session.id, text);
  };

  const end = async () => {
    if (!session) return;
    setBusy(true);
    try {
      if (mode === "voice") await voice.disconnect();
      const { report } = await api.endSession(session.id);
      onSession(null);
      if (report) onReport(report);
      else setErr("Session ended (no lesson was taught, so there is no mastery report).");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!session) {
    return (
      <div className="card">
        <h2>Start a session</h2>
        {!learners.length && <p className="muted">Add a student first.</p>}
        <div className="row">
          <label>Student<select value={learnerId} onChange={(e) => setLearnerId(e.target.value)}>{learners.map((l) => <option key={l.id} value={l.id}>{l.name}{l.profile ? "" : " (intake first)"}</option>)}</select></label>
          <label>Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setLessonId(""); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Lesson<select value={lessonId} onChange={(e) => setLessonId(e.target.value)}><option value="">First lesson</option>{course?.lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
          <label>Mode<select value={mode} onChange={(e) => setMode(e.target.value as "text" | "voice")}><option value="text">Text (no Hume needed)</option><option value="voice">Voice (Hume EVI)</option></select></label>
          <button className="primary" disabled={!learnerId || !courseId || busy} onClick={start}>{busy ? "Starting..." : "Begin"}</button>
        </div>
        {learner && !learner.profile && <p className="muted">{learner.name} has no profile yet, so the session opens with a short intake conversation before the lesson.</p>}
        {err && <p className="error">{err}</p>}
      </div>
    );
  }

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div>
            <span className="pill">{phase}</span>
            {mode === "voice" && <span className="pill">{voice.status.value}{voice.isPlaying ? " · speaking" : ""}</span>}
            <span className="muted">{learner?.name} · {course?.title}</span>
          </div>
          <div className="row">
            {mode === "voice" && voice.status.value === "connected" && (
              <button className="ghost" onClick={() => (voice.isMuted ? voice.unmute() : voice.mute())}>{voice.isMuted ? "Unmute" : "Mute"}</button>
            )}
            <button className="ghost" disabled={busy} onClick={end}>End session &amp; assess</button>
          </div>
        </div>
        {voice.error && mode === "voice" && <p className="error">{voice.error.message}</p>}
        {err && <p className="error">{err}</p>}
      </div>
      <div className="card">
        <div className="transcript">
          {transcript.map((t, i) => <div key={i} className={`turn ${t.role}`}>{t.content || "…"}</div>)}
          <div ref={bottom} />
        </div>
        {mode === "text" && (
          <div className="composer">
            <input value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder="Answer the tutor..." disabled={busy} />
            <button className="primary" onClick={send} disabled={busy || !draft.trim()}>Send</button>
          </div>
        )}
        {mode === "voice" && <p className="muted">Just talk. The tutor listens, thinks, and answers out loud.</p>}
      </div>
    </>
  );
}
