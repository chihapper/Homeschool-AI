import { useEffect, useRef, useState } from "react";
import { api, fmtDate, fmtUsd, PROVIDER_NAME, type Course, type CourseKnowledge, type Depth, type Health, type IntakePassage, type Learner, type ProfileChange, type Session, type StartingEstimate, type UsageMonth } from "../api";
import { Conversation, type Mode } from "../components/Conversation";
import { VoiceClient } from "../voice";

const FIELD_LABEL: Record<string, string> = {
  demonstrationPreferences: "How they show understanding",
  challengeTolerance: "When stuck",
  pace: "Pace",
  verbalLevel: "How they speak",
  depth: "Depth",
  interests: "Interests",
  tutoringGuidance: "Tutoring guidance",
  // The course record's notes, which a revision can change alongside the profile.
  priorKnowledge: "What they know about the course",
  observedGaps: "Gaps seen on the course",
  courseGuidance: "Guidance for the course",
  // Revisions made before 2026-10-05 can still name this one.
  intakePreferences: "How they take ideas in (no longer kept)",
};
const DEPTH_LABEL: Record<Depth, string> = { simple: "the plain version", "some-nuance": "some nuance", full: "the full picture" };
const STUCK_LABEL: Record<string, string> = { low: "goes quiet or guesses, so the tutor supports early", medium: "tries, then needs a nudge", high: "reasons aloud and stays with a hard question" };
const ESTIMATE_LABEL: Record<StartingEstimate, string> = { none: "nothing yet", some: "some knowledge", "can-explain": "could already explain it" };

/** A value short enough to read in a line; a rewritten paragraph (how they speak) is shown on its own instead. */
const SHORT = 60;

/** Case and spacing do not make a different child (the server applies the same rule, domain/students.ts). */
function sameName(a: string, b: string): boolean {
  const key = (s: string) => s.split(" ").filter(Boolean).join(" ").toLowerCase();
  return key(a) !== "" && key(a) === key(b);
}

/** One change as the parent reads it, without the field name. */
function describe(c: ProfileChange): string {
  if (c.from && c.to) return c.from.length + c.to.length <= SHORT * 2 ? `${c.from} → ${c.to}` : `revised: “${c.to}”`;
  return c.to ? `added “${c.to}”` : `removed “${c.from}”`;
}

/** The same field's changes together, with their one reason, so eleven guidance lines do not carry eleven copies of it. */
function byField(changes: ProfileChange[]): Array<{ field: string; label: string; why: string; items: ProfileChange[] }> {
  const groups = new Map<string, ProfileChange[]>();
  for (const c of changes) groups.set(c.field, [...(groups.get(c.field) ?? []), c]);
  return [...groups].map(([field, items]) => ({ field, label: FIELD_LABEL[field] ?? field, why: items.find((c) => c.why)?.why ?? "", items }));
}

/** The parent's own words about their child. The tutor follows them as written; nothing rewrites them. */
function ParentNotes({ learner, onChange }: { learner: Learner; onChange: () => Promise<void> }) {
  const [text, setText] = useState(learner.parentNotes ?? "");
  const [saved, setSaved] = useState(false);
  const dirty = text.trim() !== (learner.parentNotes ?? "");
  const save = async () => {
    await api.saveNotes(learner.id, text);
    setSaved(true);
    await onChange();
  };
  return (
    <div>
      <h4>Your notes for the tutor</h4>
      <textarea
        rows={3}
        style={{ width: "100%" }}
        value={text}
        placeholder={`Anything the tutor should know about ${learner.name}? In your own words: "needs an example before a new word", "shuts down if rushed".`}
        onChange={(e) => { setText(e.target.value); setSaved(false); }}
      />
      <div className="row">
        <button className="ghost small" disabled={!dirty} onClick={save}>Save notes</button>
        <span className="muted small">{saved && !dirty ? "Saved. " : ""}The tutor follows these as written, from the next session. They are yours: no pass rewrites them.</span>
      </div>
    </div>
  );
}

/** What one student knows about one course: where they started, and what has been seen since. */
function CourseRecord({ k, course, learner, onChange }: { k: CourseKnowledge; course?: Course; learner: Learner; onChange: () => Promise<void> }) {
  const name = (id: string): string => course?.concepts.find((c) => c.id === id)?.name ?? id;
  const forget = async () => {
    if (!confirm(`Forget what ${learner.name} knows about ${course?.title ?? "this course"}? Their next lesson on it will open with the questions about what they already know.`)) return;
    await api.forgetKnowledge(k.learnerId, k.courseId);
    await onChange();
  };
  return (
    <div className="concept-row">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <strong>{course?.title ?? k.courseId}</strong>
        <span className="row">
          <span className="muted small">{k.intakeAt ? `asked what they knew on ${fmtDate(k.intakeAt)}` : "no questions asked before the course; these are notes from sessions"}</span>
          <button className="ghost small" onClick={forget}>Forget</button>
        </span>
      </div>
      {k.baselineSummary && <p className="small" style={{ margin: "4px 0" }}>{k.baselineSummary}</p>}
      {k.starts.length > 0 && (
        <>
          <h4>Where they started</h4>
          <ul className="small">
            {k.starts.map((s) => (
              <li key={s.conceptId}>
                <strong>{name(s.conceptId)}</strong>: {ESTIMATE_LABEL[s.estimate]}
                {s.said ? <> — “{s.said}”</> : <> — said they did not know</>}
                {s.confidence !== undefined && <span className="muted"> (sure {s.confidence} out of 10)</span>}
                {s.materialSays && <span className="muted"> · your material says: {s.materialSays}</span>}
              </li>
            ))}
          </ul>
        </>
      )}
      <div className="grid3">
        <div>
          <h4>What they have shown they know</h4>
          {k.priorKnowledge.length ? <ul className="small">{k.priorKnowledge.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="muted small">Nothing noted yet.</p>}
        </div>
        <div>
          <h4>Gaps and mix-ups seen</h4>
          {k.observedGaps.length ? <ul className="small">{k.observedGaps.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="muted small">None noted.</p>}
        </div>
        <div>
          <h4>Guidance for this course</h4>
          {k.guidance.length ? <ul className="small">{k.guidance.map((p, i) => <li key={i}>{p}</li>)}</ul> : <p className="muted small">None.</p>}
        </div>
      </div>
    </div>
  );
}

/**
 * The intake conversation, held right here when a student is added (or later, from their card): about eight
 * exchanges on a passage built into the app, so the tutor learns how to work with the child before any course.
 * It is a session of its own; the profile is written from it in the background once it ends.
 */
function IntakeArea({ learner, passage, courses, learners, health, session, onSession, onChange, onClose }: {
  learner: Learner;
  passage: IntakePassage | null;
  courses: Course[];
  learners: Learner[];
  health: Health | null;
  /** The intake conversation, held by the app so a visit to another tab keeps it; null until Begin. */
  session: Session | null;
  onSession: (s: Session | null) => void;
  onChange: () => Promise<void>;
  onClose: () => void;
}) {
  const voiceReady = Boolean(health?.voice.stt === "assemblyai" && health?.voice.tts && health.voice.tts !== "none");
  const [mode, setMode] = useState<Mode>("text");
  /** The voice connection, created inside the click so the browser allows audio; null while typing. */
  const [voice, setVoice] = useState<VoiceClient | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const voiceRef = useRef(voice);
  voiceRef.current = voice;
  useEffect(() => () => voiceRef.current?.close(), []);
  const finished = session?.phase === "complete";

  const begin = async () => {
    setBusy(true);
    setErr(null);
    try {
      const s = await api.createSession({ learnerId: learner.id, only: "general-intake" });
      if (mode === "voice") {
        const c = new VoiceClient(s.id);
        c.prepare();
        setVoice(c);
      }
      onSession(s);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };
  const close = async () => {
    voiceRef.current?.close();
    setVoice(null);
    onSession(null);
    await onChange();
    onClose();
  };

  return (
    <div className="intake-area">
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h3 style={{ margin: 0 }}>Intake conversation: {learner.name}</h3>
          {!session && <button className="ghost small" onClick={onClose}>Not now</button>}
        </div>
        {!session && (
          <>
            <p className="muted">
              About eight exchanges, with {learner.name}. The tutor asks what they like doing, reads a short passage (“{passage?.title ?? "Why ice floats"}”) and asks them to tell it back, asks one question that applies it and one harder one, and asks how sure they are. Nothing from your courses is used, so it is the same for every child. Hand {learner.name} the keyboard or the microphone and press Begin.
            </p>
            <div className="row">
              <div className="segmented" role="radiogroup" aria-label="How the student answers">
                <button type="button" role="radio" aria-checked={mode === "text"} className={mode === "text" ? "on" : ""} onClick={() => setMode("text")}>Type</button>
                <button type="button" role="radio" aria-checked={mode === "voice"} className={mode === "voice" ? "on" : ""} disabled={!voiceReady} onClick={() => setMode("voice")} title={voiceReady ? "" : "Voice needs the keys named in Settings, Voice"}>
                  Talk{voiceReady && health ? ` (${PROVIDER_NAME[health.voice.ttsProvider]})` : ""}
                </button>
              </div>
              <button className="primary" disabled={busy} onClick={begin}>{busy ? "Starting..." : "Begin"}</button>
              {!voiceReady && <span className="muted small">Voice is not set up (Settings, Voice), so the intake is typed.</span>}
            </div>
            {passage && (
              <details style={{ marginTop: 8 }}>
                <summary className="small">The passage, and the two questions in three sets by grade</summary>
                <p className="small"><strong>{passage.title}.</strong> {passage.text}</p>
                <ul className="small">
                  {passage.bands.map((b) => <li key={b.id}><strong>Grades {b.grades}:</strong> {b.apply} <span className="muted">Then:</span> {b.hard}</li>)}
                </ul>
                <p className="muted small">A strong, sure answer earns the next set's question, a shaky one the set below.</p>
              </details>
            )}
            {err && <p className="error">{err}</p>}
          </>
        )}
        {session && !finished && <p className="muted small">The conversation is {learner.name}'s. You can read every word afterwards on this card; the profile is written from it once it ends.</p>}
        {session && finished && (
          <p className="muted">The intake is finished. {learner.name}'s profile is being written from it in the background, usually within a minute or two, and appears on their card below. Lessons can start meanwhile.</p>
        )}
      </div>
      {session && (
        <Conversation
          variant="intake"
          session={session}
          voice={voice}
          courses={courses}
          learners={learners}
          health={health}
          onSession={onSession}
          onEnded={() => void close()}
          onLeave={() => void close()}
        />
      )}
    </div>
  );
}

export function LearnersPage({ learners, courses, knowledge, health, onChange, intakeFor, onIntakeFor, intakeSession, onIntakeSession }: {
  learners: Learner[];
  courses: Course[];
  knowledge: CourseKnowledge[];
  health: Health | null;
  onChange: () => Promise<void>;
  /** The student whose intake area is open: adding a student opens it, and so does the Lesson tab's button. Held by the app, so a visit to another tab keeps it. */
  intakeFor: string | null;
  onIntakeFor: (id: string | null) => void;
  /** The intake conversation once it has begun, held by the app for the same reason. */
  intakeSession: Session | null;
  onIntakeSession: (s: Session | null) => void;
}) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [age, setAge] = useState("");
  const [err, setErr] = useState<string | null>(null);
  const [passage, setPassage] = useState<IntakePassage | null>(null);
  /** This month's use per student, from the meter. */
  const [usage, setUsage] = useState<UsageMonth | null>(null);
  useEffect(() => {
    api.usage().then(setUsage).catch(() => setUsage(null));
  }, [learners]);
  const area = useRef<HTMLDivElement>(null);
  /** What to tell the parent when adding opened a student already on the list instead of making a second one. */
  const [note, setNote] = useState<string | null>(null);
  /** An intake in progress: no other student's intake starts until it ends. */
  const intakeRunning = Boolean(intakeSession && intakeSession.phase !== "complete");
  // While a profile is being written from an intake (about half a minute), look again every few seconds so the card
  // fills in by itself. Before, it said "being written" until the page was reloaded, which read as unsaved.
  const writing = learners.some((l) => !l.profile && l.profilePending && !l.profilePending.error);
  useEffect(() => {
    if (!writing) return;
    const t = setInterval(() => void onChange(), 4000);
    return () => clearInterval(t);
  }, [writing, onChange]);
  useEffect(() => {
    api.intakePassage().then(setPassage).catch(() => setPassage(null));
  }, []);
  useEffect(() => {
    if (intakeFor) area.current?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [intakeFor]);

  const add = async () => {
    setErr(null);
    setNote(null);
    // One record per child: the same name again is the same child added twice, most likely because the intake area
    // was closed. Open the intake of the student already on the list instead of adding a second record.
    const same = learners.find((l) => sameName(l.name, name));
    if (same) {
      if (!same.profile && !same.profilePending) {
        setName("");
        setGrade("");
        setAge("");
        onIntakeFor(same.id);
        setNote(same.name + " is already on the list and has not had the intake yet, so it is open below. Nothing new was added.");
      } else {
        setErr("There is already a student named " + same.name + ". To hold the intake again, use Reset profile on that card; for a different child with the same name, add an initial (" + same.name + " B.).");
      }
      return;
    }
    try {
      const l = await api.createLearner({ name: name.trim(), gradeLevel: grade || undefined, age: age ? Number(age) : undefined });
      setName("");
      setGrade("");
      setAge("");
      await onChange();
      onIntakeFor(l.id);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const resetProfile = async (l: Learner) => {
    if (!confirm(`Forget ${l.name}'s profile? You can then hold the intake conversation again from this tab. What they know about each course is kept.`)) return;
    await api.resetProfile(l.id);
    await onChange();
  };
  const retryProfile = async (l: Learner) => {
    try {
      await api.retryProfile(l.id);
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const remove = async (l: Learner) => {
    if (!confirm(`Delete ${l.name}? Their sessions and reports stay on disk but will show an id instead of a name.`)) return;
    if (intakeFor === l.id) onIntakeFor(null);
    if (intakeSession?.learnerId === l.id) onIntakeSession(null);
    await api.deleteLearner(l.id);
    await onChange();
  };
  const undo = async (l: Learner) => {
    const history = l.profileHistory ?? [];
    const last = history[history.length - 1];
    if (!last || !confirm(`Undo the changes from ${fmtDate(last.at)}? ${l.name}'s profile, and the course notes that update touched, go back to what they were before that session.`)) return;
    try {
      await api.undoProfileUpdate(l.id);
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const intakeLearner = learners.find((l) => l.id === intakeFor);

  return (
    <>
      <div className="card">
        <h2>Students</h2>
        <p className="muted small">
          Adding a student starts with the intake conversation, about eight exchanges, so the tutor learns how to work with them before any course. Their first lesson on each course then opens with a few questions about what they already know about it (on the Lesson tab, within the course). Both are ordinary sessions: you can read every word afterwards.
        </p>
        <div className="row">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya" onKeyDown={(e) => e.key === "Enter" && name.trim() && add()} /></label>
          <label>Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="7" /></label>
          <label>Age<input value={age} onChange={(e) => setAge(e.target.value)} placeholder="12" /></label>
          <button className="primary" disabled={!name.trim()} onClick={add}>Add and begin the intake</button>
        </div>
        {err && <p className="error">{err}</p>}
        {note && <p className="muted small">{note}</p>}
        {passage && !intakeLearner && (
          <details style={{ marginTop: 8 }}>
            <summary className="small">What the intake reads to every student: “{passage.title}”</summary>
            <p className="small"><strong>{passage.title}.</strong> {passage.text}</p>
            <p className="muted small">
              The intake never uses your course. It asks what your child likes doing, reads this passage and asks them to tell it back, asks one question that applies it and one harder one, and asks how sure they are. The two questions come in three sets by grade ({passage.bands.map((b) => b.grades).join(", ")}); a strong, sure answer earns the next set's question, a shaky one the set below.
            </p>
          </details>
        )}
        <p className="muted small" style={{ marginTop: 8 }}>
          You will not find a learning style here. Matching teaching to a style has been tested for decades without adequate evidence that it helps (
          <a href="https://doi.org/10.1111/j.1539-6053.2009.01038.x" target="_blank" rel="noreferrer">Pashler and colleagues, 2008</a>;{" "}
          <a href="https://pmc.ncbi.nlm.nih.gov/articles/PMC11270031/" target="_blank" rel="noreferrer">a 2024 review of 21 studies</a> found the pattern the idea needs in about a quarter of results). The tutor starts each idea from what your child already knows about it, and keeps what it sees them do when they are stuck. If your child needs something particular, put it in your notes: the tutor follows them as written.
        </p>
      </div>
      <div ref={area}>
        {intakeLearner && (
          <IntakeArea
            key={intakeLearner.id}
            learner={intakeLearner}
            passage={passage}
            courses={courses}
            learners={learners}
            health={health}
            session={intakeSession?.learnerId === intakeLearner.id ? intakeSession : null}
            onSession={onIntakeSession}
            onChange={onChange}
            onClose={() => onIntakeFor(null)}
          />
        )}
      </div>
      {learners.map((l) => {
        const records = knowledge.filter((k) => k.learnerId === l.id);
        const pending = !l.profile && l.profilePending;
        const needsIntake = !l.profile && !pending;
        return (
          <div className="card" key={l.id}>
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h3 style={{ margin: 0 }}>
                {l.name} {l.gradeLevel && <span className="pill">Grade {l.gradeLevel}</span>} {l.age && <span className="pill">Age {l.age}</span>}{" "}
                {l.profile ? <span className="pill">profiled</span> : pending ? <span className="pill">{pending.error ? "profile not written" : "intake done · profile being written"}</span> : <span className="pill">needs the intake</span>}
              </h3>
              <div className="row">
                {needsIntake && <button className="primary small" disabled={intakeFor === l.id || intakeRunning} onClick={() => onIntakeFor(l.id)}>Start the intake</button>}
                {(l.profile || pending) && <button className="ghost small" onClick={() => resetProfile(l)}>Reset profile</button>}
                <button className="ghost small" onClick={() => remove(l)}>Delete</button>
              </div>
            </div>
            {pending && (
              <p className={pending.error ? "warn small" : "muted small"}>
                {pending.error
                  ? `The intake conversation is saved, but writing the profile from it failed: ${pending.error} `
                  : `The intake finished ${fmtDate(pending.since)}. The profile is being written from it in the background, usually within a minute or two; lessons can go on meanwhile. `}
                {pending.error && <button className="ghost small" onClick={() => retryProfile(l)}>Try again</button>}
              </p>
            )}
            {l.profile ? (
              <div className="profile">
                <p>{l.profile.parentSummary}</p>
                <div className="grid3">
                  <div>
                    <h4>How they show understanding</h4>
                    <div>{l.profile.demonstrationPreferences.map((p) => <span key={p} className="pill">{p}</span>)}</div>
                    <h4>When stuck</h4>
                    <p className="small"><strong>{l.profile.challengeTolerance}</strong>: {STUCK_LABEL[l.profile.challengeTolerance] ?? ""}</p>
                    <h4>Pace and depth</h4>
                    <p className="small">Pace <strong>{l.profile.pace}</strong> · depth <strong>{l.profile.depth ?? "simple"}</strong> ({DEPTH_LABEL[l.profile.depth ?? "simple"]})</p>
                  </div>
                  <div>
                    <h4>How they speak</h4>
                    <p className="small">{l.profile.verbalLevel}</p>
                    <h4>Interests</h4>
                    <p className="small">{l.profile.interests.join(", ") || "None noted yet."}</p>
                  </div>
                  <div>
                    <h4>Tutoring guidance (the tutor follows these literally)</h4>
                    <ul className="small">{l.profile.tutoringGuidance.map((g, i) => <li key={i}>{g}</li>)}</ul>
                  </div>
                </div>
              </div>
            ) : (
              needsIntake && <p className="muted">{l.name} has not had the intake conversation yet, so the tutor does not know how they like to work. Start it here when {l.name} is with you. Lessons can begin without it; until then the tutor works from the course and your notes alone.</p>
            )}
            {(() => {
              const m = usage?.learners.find((u) => u.learnerId === l.id);
              return m ? (
                <p className="muted small" title="Every model and voice call this month at list prices (docs/COST.md)">
                  This month: {m.lessons} lesson{m.lessons === 1 ? "" : "s"}{m.sessions > m.lessons ? ` and ${m.sessions - m.lessons} intake${m.sessions - m.lessons === 1 ? "" : "s"}` : ""}, {m.minutes} minutes{m.listenedMinutes ? ` (${m.listenedMinutes} spoken)` : ""}, about {fmtUsd(m.usd)} in model and voice calls{m.unpriced.length ? ` (no price on file for ${m.unpriced.join(", ")})` : ""}.
                </p>
              ) : null;
            })()}
            <ParentNotes key={`${l.id}-${l.parentNotes ?? ""}`} learner={l} onChange={onChange} />
            <h4>What {l.name} knows, by course</h4>
            {records.length === 0 && <p className="muted small">Nothing yet. A course appears here after {l.name}'s first lesson on it.</p>}
            {records.map((k) => <CourseRecord key={k.id} k={k} course={courses.find((c) => c.id === k.courseId)} learner={l} onChange={onChange} />)}
            {l.profile && (
              <>
                <h4>Changes after sessions</h4>
                <p className="muted small">
                  Both records are reviewed after every session's report. What they know about a course, interests and guidance change when the evidence does; pace, what they do when stuck, how they speak and depth change only when two sessions in a row agree. Undo puts everything back the way it was before that session.
                  {l.profileReviewedAt ? ` Last reviewed ${fmtDate(l.profileReviewedAt)}.` : ""}
                </p>
                {!l.profileHistory?.length && <p className="muted small">No changes since the intake.</p>}
                {[...(l.profileHistory ?? [])].reverse().slice(0, 3).map((u, i) => (
                  <div key={u.at} className="concept-row">
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <strong>{fmtDate(u.at)}{u.courseTitle ? ` · after a session on ${u.courseTitle}` : ""}</strong>
                      {i === 0 && <button className="ghost small" onClick={() => undo(l)}>Undo this update</button>}
                    </div>
                    <p className="small" style={{ margin: "4px 0" }}>{u.summary}</p>
                    {byField(u.changes).map((g) => (
                      <div key={g.field} className="small" style={{ margin: "4px 0" }}>
                        <strong>{g.label}</strong>{g.why && <span className="muted"> — {g.why}</span>}
                        <ul style={{ margin: "2px 0" }}>{g.items.map((c, j) => <li key={j}>{describe(c)}</li>)}</ul>
                      </div>
                    ))}
                    {u.held.length > 0 && (
                      <div className="muted small" style={{ margin: "4px 0" }}>
                        Held until another session agrees:
                        <ul style={{ margin: "2px 0" }}>{byField(u.held).map((g) => g.items.map((c, j) => <li key={`${g.field}-${j}`}>{g.label}: {describe(c)}</li>))}</ul>
                      </div>
                    )}
                  </div>
                ))}
                {(l.profileHistory?.length ?? 0) > 3 && <p className="muted small">and {(l.profileHistory?.length ?? 0) - 3} earlier</p>}
              </>
            )}
          </div>
        );
      })}
      {!learners.length && <p className="muted">No students yet.</p>}
    </>
  );
}
