import { useEffect, useRef, useState } from "react";
import { api, fmtDate, PROVIDER_KEY, PROVIDER_NAME, type Course, type CourseKnowledge, type Health, type Learner, type Report, type Session, type SessionSummary } from "../api";
import { Conversation, type Mode } from "../components/Conversation";
import { VoiceClient } from "../voice";

/** "Start X on this course" on the Courses tab: who and what the form should show. `at` makes a repeat click count. */
export interface LessonPreset { learnerId: string; courseId: string; at: number }

interface Props {
  courses: Course[];
  learners: Learner[];
  /** What each student knows about each course: a student with no record for a course is asked first. */
  knowledge: CourseKnowledge[];
  health: Health | null;
  /** The conversation on screen, kept by the app so it survives a visit to another tab. */
  session: Session | null;
  /** A session begins here (start or resume): shown from its first word. */
  onOpen: (s: Session) => void;
  /** A fresh copy of the open session, or null when it is left or ended. */
  onSession: (s: Session | null) => void;
  onReport: (r: Report) => void;
  preset: LessonPreset | null;
  /** The student still needs the intake conversation: open the Students tab on it. */
  onIntakeOnStudents: (learnerId: string) => void;
}

/**
 * The Lesson tab: pick a student, a course and a lesson, and begin. A student's first lesson on a course opens
 * with the course's own questions (what do they already know about it?); the general intake conversation is
 * never run from here: it belongs to the Students tab, where a student is added.
 */
export function LessonPage({ courses, learners, knowledge, health, session, onOpen, onSession, onReport, preset, onIntakeOnStudents }: Props) {
  const voiceReady = Boolean(health?.voice.stt === "assemblyai" && health?.voice.tts && health.voice.tts !== "none");
  // Which provider speaks, in words: "ElevenLabs eleven_flash_v2_5" or "Inworld inworld-tts-2".
  const ttsLabel = health ? `${PROVIDER_NAME[health.voice.ttsProvider]} ${health.voice.ttsModel}` : "";
  const [learnerId, setLearnerId] = useState(preset?.learnerId ?? "");
  const [courseId, setCourseId] = useState(preset?.courseId ?? "");
  const [lessonId, setLessonId] = useState("");
  // Text is the default: it needs only an Anthropic key, so it always works. Voice is a deliberate choice.
  const [mode, setMode] = useState<Mode>("text");
  const [skipCourseIntake, setSkipCourseIntake] = useState(false);
  // The student read the material beforehand: the tutor opens by asking them to tell it back, then questions from that.
  const [narrationFirst, setNarrationFirst] = useState(false);
  const [open, setOpen] = useState<SessionSummary[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  /** The voice connection of the conversation on screen. Created here, inside the click, so the browser allows audio. */
  const [voice, setVoice] = useState<VoiceClient | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  // Leaving the tab closes the microphone and the speaker; the session itself stays open and shows again as text.
  useEffect(() => () => voiceRef.current?.close(), []);

  useEffect(() => {
    if (!preset) return;
    setLearnerId(preset.learnerId);
    setCourseId(preset.courseId);
    setLessonId("");
    setSkipCourseIntake(false);
  }, [preset]);
  useEffect(() => {
    if (!learnerId && learners[0]) setLearnerId(learners[0].id);
    if (!courseId && courses[0]) setCourseId(courses[0].id);
  }, [learners, courses, learnerId, courseId]);

  // Sessions that can be resumed (left without assessing, or a browser refresh).
  useEffect(() => {
    if (session) return;
    // A session with a report is finished whatever its phase says (older records predate the fix that closes them).
    api.sessions().then((list) => setOpen(list.filter((s) => s.phase !== "complete" && !s.hasReport))).catch(() => setOpen([]));
  }, [session]);

  const course = courses.find((c) => c.id === courseId);
  const learner = learners.find((l) => l.id === learnerId);
  // Lessons the parent still teaches (mirrors domain/focus.ts on the server, which is the real guard).
  const focus = course?.focus;
  const startable = course?.lessons.filter((l) => !focus?.skippedLessonIds.includes(l.id) && l.conceptIds.some((id) => !focus?.skippedConceptIds.includes(id))) ?? [];
  // What this student's sitting will open with (mirrors planSitting on the server, which decides).
  const needsGeneral = Boolean(learner && !learner.profile && !learner.profilePending);
  const needsCourse = Boolean(learner && course && !knowledge.some((k) => k.learnerId === learner.id && k.courseId === course.id));

  const takeDown = () => {
    voiceRef.current?.close();
    setVoice(null);
  };
  const show = (s: Session, withVoice: boolean) => {
    takeDown();
    if (withVoice) {
      const c = new VoiceClient(s.id);
      c.prepare();
      setVoice(c);
    }
    onOpen(s);
  };

  const start = async () => {
    setErr(null);
    setNotice(null);
    setBusy(true);
    try {
      // The general intake is the Students tab's; from here the lesson begins with or without a profile.
      const s = await api.createSession({ learnerId, courseId, lessonId: lessonId || undefined, skipGeneralIntake: true, skipIntake: skipCourseIntake || undefined, narrationFirst: narrationFirst || undefined });
      show(s, mode === "voice");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!resumeId) return;
    setErr(null);
    setNotice(null);
    try {
      show(await api.session(resumeId), mode === "voice");
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const discard = async () => {
    if (!resumeId || !confirm("Delete this unfinished session? It will not be assessed.")) return;
    await api.deleteSession(resumeId);
    setResumeId("");
    setOpen((o) => o.filter((s) => s.id !== resumeId));
  };

  // ---------------------------------------------------------------------------
  if (session) {
    return (
      <Conversation
        session={session}
        voice={voice}
        courses={courses}
        learners={learners}
        health={health}
        onSession={onSession}
        onEnded={({ report }) => {
          takeDown();
          onSession(null);
          if (report) onReport(report);
          else setNotice("Session ended. No lesson was taught, so there is no mastery report.");
        }}
        onLeave={() => {
          takeDown();
          onSession(null);
        }}
      />
    );
  }

  return (
    <>
      <div className="card">
        <h2>Start a lesson</h2>
        {!learners.length && <p className="muted">Add a student first (Students tab).</p>}
        {!courses.length && <p className="muted">Build a course first (Courses tab).</p>}
        <div className="row">
          <label>Student<select value={learnerId} onChange={(e) => setLearnerId(e.target.value)}>{learners.map((l) => <option key={l.id} value={l.id}>{l.name}{l.profile || l.profilePending ? "" : " (no intake yet)"}</option>)}</select></label>
          <label>Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setLessonId(""); setSkipCourseIntake(false); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
          <label>Lesson<select value={lessonId} onChange={(e) => setLessonId(e.target.value)}><option value="">First kept lesson</option>{startable.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
          <label>
            Mode
            <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
              <option value="text">Text</option>
              <option value="voice">{voiceReady ? `Voice: talk to the tutor (${PROVIDER_NAME[health?.voice.ttsProvider ?? "inworld"]})` : "Voice (not configured)"}</option>
            </select>
          </label>
          <label className="check"><span><input type="checkbox" checked={narrationFirst} onChange={(e) => setNarrationFirst(e.target.checked)} /> Already read this</span><span className="hint">Opens by asking the student to tell it back before any questions.</span></label>
          <button className="primary" disabled={!learnerId || !courseId || busy || (mode === "voice" && !voiceReady) || (course !== undefined && startable.length === 0)} onClick={start}>{busy ? "Starting..." : "Begin"}</button>
        </div>
        {learner && needsGeneral && (
          <div className="notice">
            <strong>{learner.name} has not had the intake conversation yet.</strong> It lives on the Students tab: about eight exchanges on a short passage built into the app, so the tutor learns how to work with {learner.name} before any course. You can begin the lesson without it; until it is done the tutor works from the course and your notes alone.
            <div className="row"><button className="ghost small" onClick={() => onIntakeOnStudents(learner.id)}>Do the intake now (Students tab)</button></div>
          </div>
        )}
        {learner && course && needsCourse && (
          <div className="notice">
            <strong>First time on {course.title}.</strong> The lesson opens with a few quick questions about what {learner.name} already knows about it: one per central idea, each with “how sure are you?”, and no teaching. Then the lesson itself begins. The answers go on {learner.name}'s record for this course (Students tab) and into the reports as where they started.
            <div className="row"><label className="check inline"><span><input type="checkbox" checked={skipCourseIntake} onChange={(e) => setSkipCourseIntake(e.target.checked)} /> Skip the questions this time</span></label></div>
          </div>
        )}
        {course && startable.length === 0 && <p className="warn small">Every lesson in this course is skipped in its Focus (Courses tab). Keep at least one concept to start a lesson.</p>}
        {mode === "voice" && !voiceReady && <p className="warn small">Voice needs ASSEMBLYAI_API_KEY (speech-to-text) and {PROVIDER_KEY[health?.voice.ttsProvider ?? "inworld"]} (text-to-speech for the provider selected in Settings, Voice). Settings shows what is missing.</p>}
        {mode === "voice" && voiceReady && <p className="muted small">The tutor speaks first. Click Talk (or just wait for it to listen), speak, and pause when you are done. Speech-to-text: AssemblyAI · voice: {health?.voice.ttsVoice} ({ttsLabel}). Switch providers in Settings; it applies from the next reply.</p>}
        {health && <p className="muted small">Tutor: <code>{health.tutorModel}</code> @ {health.tutorEffort}, {health.tutorThinking} thinking. Change in Settings before starting.</p>}
        {err && <p className="error">{err}</p>}
        {notice && <p className="muted">{notice}</p>}
      </div>
      {open.length > 0 && (
        <div className="card">
          <h3>Resume an unfinished session</h3>
          <div className="row">
            <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} style={{ minWidth: 360 }}>
              <option value="">Choose...</option>
              {open.map((s) => (
                <option key={s.id} value={s.id}>
                  {learners.find((l) => l.id === s.learnerId)?.name ?? s.learnerId} · {courses.find((c) => c.id === s.courseId)?.title ?? "intake only"} · {s.phase} · {s.turns} turns · {fmtDate(s.startedAt)}
                </option>
              ))}
            </select>
            <button className="ghost" disabled={!resumeId} onClick={resume}>Resume ({mode === "voice" ? "voice" : "text"})</button>
            <button className="ghost" disabled={!resumeId} onClick={discard}>Delete</button>
          </div>
        </div>
      )}
    </>
  );
}
