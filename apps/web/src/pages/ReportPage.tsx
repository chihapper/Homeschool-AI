import { useEffect, useState } from "react";
import { api, fmtDate, type ConceptProgress, type ConceptStart, type Course, type Learner, type OutsideClaim, type ProgressSummary, type Report } from "../api";

const LEVELS = ["No evidence", "Recalls", "Explains", "Applies", "Extends"];

/** A check's outcome in a parent's words, with the colour of the chip. */
function checkLabel(c: OutsideClaim): { label: string; tone: string } {
  if (c.status === "checked") {
    if (c.verdict === "supported") return { label: "Checked: right", tone: "good" };
    if (c.verdict === "contradicted") return { label: "Checked: not right", tone: "bad" };
    if (c.verdict === "complicated") return { label: "Checked: it's complicated", tone: "" };
    return { label: "Checked: couldn't confirm", tone: "" };
  }
  if (c.status === "pending") return { label: "Check still running when the session ended", tone: "" };
  if (c.status === "failed") return { label: "Check failed", tone: "" };
  return { label: "Not checked", tone: "" };
}

const STANCE: Record<OutsideClaim["tutorStance"], string> = { confirmed: "agreed", corrected: "corrected it", unsure: "said it wasn't sure", deferred: "pointed back to the reading" };

const START_LABEL: Record<ConceptStart["estimate"], string> = { none: "nothing yet", some: "some knowledge", "can-explain": "could already explain it" };

/** A starting point as a parent reads it: the estimate, the child's own words, and how sure they said they were. */
function startText(s: ConceptStart): string {
  return `${START_LABEL[s.estimate]}${s.said ? `: “${s.said}”` : ""}${s.confidence !== undefined ? ` (sure ${s.confidence}/10)` : ""}`;
}

/** What changed since the previous time this concept was assessed, in words a parent reads at a glance. */
function trend(c: ConceptProgress): string {
  if (c.previousLevel === undefined) return "new";
  if (c.level > c.previousLevel) return `up from ${c.previousLevel}`;
  if (c.level < c.previousLevel) return `down from ${c.previousLevel}`;
  return `same (${c.previousLevel})`;
}

export function ReportPage({ report, courses, learners }: { report: Report | null; courses: Course[]; learners: Learner[] }) {
  const [all, setAll] = useState<Report[]>([]);
  const [current, setCurrent] = useState<Report | null>(report);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    api.reports().then(setAll).catch((e) => setErr((e as Error).message));
  }, [report]);
  useEffect(() => {
    if (report) setCurrent(report);
  }, [report]);
  useEffect(() => {
    if (!current && all[0]) setCurrent(all[0]);
  }, [all, current]);

  // Progress: where one student stands on one course, across every report. Follows the selected report
  // until the parent picks a different pair.
  const [pLearner, setPLearner] = useState("");
  const [pCourse, setPCourse] = useState("");
  const [progress, setProgress] = useState<ProgressSummary | null>(null);
  const [pNote, setPNote] = useState<string | null>(null);
  useEffect(() => {
    if (current) {
      setPLearner(current.learnerId);
      setPCourse(current.courseId ?? "");
    }
  }, [current]);
  useEffect(() => {
    if (!pLearner || !pCourse) {
      setProgress(null);
      return;
    }
    let live = true;
    setPNote("Loading...");
    api
      .progress(pLearner, pCourse)
      .then((p) => { if (live) { setProgress(p); setPNote(null); } })
      .catch((e) => { if (live) { setProgress(null); setPNote((e as Error).message); } });
    return () => { live = false; };
  }, [pLearner, pCourse, all]);

  const names = new Map(courses.flatMap((c) => c.concepts.map((k) => [k.id, k.name] as const)));
  const learnerName = (id: string) => learners.find((l) => l.id === id)?.name ?? id;
  const courseTitle = (id?: string) => courses.find((c) => c.id === id)?.title ?? id ?? "";

  const remove = async (r: Report) => {
    if (!confirm("Delete this session and its report?")) return;
    await api.deleteSession(r.sessionId);
    setAll((a) => a.filter((x) => x.sessionId !== r.sessionId));
    if (current?.sessionId === r.sessionId) setCurrent(null);
  };

  const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;
  return (
    <>
      <div className="card">
        <h2>Progress</h2>
        <p className="muted small">Where a student stands on a course across every session so far: the latest level per concept, whether it moved since the previous time, and what they still get wrong.</p>
        <div className="row">
          <label>Student<select value={pLearner} onChange={(e) => setPLearner(e.target.value)}><option value="">Choose...</option>{learners.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}</select></label>
          <label>Course<select value={pCourse} onChange={(e) => setPCourse(e.target.value)}><option value="">Choose...</option>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        </div>
        {pLearner && pCourse && !progress && <p className="muted">{pNote}</p>}
        {progress && (
          <>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="stat"><strong>{plural(progress.sessionsAssessed, "session")}</strong> assessed · latest {fmtDate(progress.latestSessionAt)}</span>
              <span className={`stat ${progress.latest.ungroundedClaims ? "bad" : "good"}`}><strong>{plural(progress.latest.ungroundedClaims, "ungrounded claim")}</strong> last session · {progress.totals.ungroundedClaims} in all</span>
              <span className={`stat ${progress.latest.tutorAnswerGiveaways ? "bad" : "good"}`}><strong>{plural(progress.latest.tutorAnswerGiveaways, "answer giveaway")}</strong> last session · {progress.totals.tutorAnswerGiveaways} in all</span>
              <span className="stat"><strong>{plural(progress.latest.answerSeekingTurns, "turn")}</strong> asking for the answer last session · {progress.totals.answerSeekingTurns} in all</span>
            </div>
            <h3>Mastery by concept</h3>
            <p className="muted small">Levels: 1 recalls · 2 explains · 3 applies to a new case · 4 extends or teaches back. "Since last time" compares with the previous session that assessed that concept; "new" means this is the first. "Before the course" is what they said when asked before any teaching. Concepts a session did not reach are not listed.</p>
            <table className="table">
              <thead><tr><th>Concept</th><th>Before the course</th><th>Level</th><th>Since last time</th><th>Still confuses</th><th>Assessed</th></tr></thead>
              <tbody>
                {progress.concepts.map((c) => (
                  <tr key={c.conceptId}>
                    <td><strong>{c.name}</strong></td>
                    <td className="small">{c.start ? startText(c.start) : <span className="muted">not asked</span>}</td>
                    <td><span className={`level l${c.level}`}>{c.level}/4 · {LEVELS[c.level]}</span></td>
                    <td>{trend(c)}</td>
                    <td className={c.misconceptions.length ? "warn" : "muted"}>{c.misconceptions.join(" · ") || "nothing listed"}</td>
                    <td className="muted small">{fmtDate(c.asOf)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {progress.baselineSummary && <p className="small"><strong>Before the course:</strong> {progress.baselineSummary}</p>}
            {progress.startsNotYetTaught.length > 0 && (
              <>
                <h3>Asked before the course, not taught yet</h3>
                <ul className="small">{progress.startsNotYetTaught.map((s) => <li key={s.conceptId}><strong>{s.name}</strong>: {startText(s)}</li>)}</ul>
              </>
            )}
            {progress.misconceptionsAtLatestSession.length > 0 && (
              <>
                <h3>Worth revisiting this week</h3>
                <ul>{progress.misconceptionsAtLatestSession.map((m) => <li key={m.conceptId}><strong>{m.name}</strong>: {m.misconceptions.join(" · ")}</li>)}</ul>
              </>
            )}
            <h3>Recommended next</h3>
            <ol>{progress.latestRecommendedNext.map((r, i) => <li key={i}>{r}</li>)}</ol>
          </>
        )}
      </div>

      <div className="card">
        <h2>Reports</h2>
        {err && <p className="error">{err}</p>}
        {!all.length && <p className="muted">End a session to produce its mastery report.</p>}
        {all.length > 0 && (
          <table className="table">
            <thead><tr><th>When</th><th>Student</th><th>Course</th><th>Levels</th><th>Asked for answer</th><th>Giveaways</th><th>Ungrounded</th><th /></tr></thead>
            <tbody>
              {all.map((r) => (
                <tr key={r.sessionId} className={current?.sessionId === r.sessionId ? "selected" : ""} onClick={() => setCurrent(r)} style={{ cursor: "pointer" }}>
                  <td>{fmtDate(r.createdAt)}</td>
                  <td>{learnerName(r.learnerId)}</td>
                  <td>{courseTitle(r.courseId)}</td>
                  <td className="mono">{r.concepts.map((c) => c.level).join(" ")}</td>
                  <td>{r.answerSeekingTurns}</td>
                  <td className={r.tutorAnswerGiveaways ? "error" : ""}>{r.tutorAnswerGiveaways}</td>
                  <td>{r.ungroundedClaims.length}</td>
                  <td><button className="ghost small" onClick={(e) => { e.stopPropagation(); void remove(r); }}>Delete</button></td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {current && (
        <>
          <div className="card">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <h2 style={{ margin: 0 }}>{learnerName(current.learnerId)} · {courseTitle(current.courseId)}</h2>
              <span className="muted small">{fmtDate(current.createdAt)} · session {current.sessionId.slice(0, 8)}</span>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <span className="stat"><strong>{current.answerSeekingTurns}</strong> turn{current.answerSeekingTurns === 1 ? "" : "s"} asking for the answer</span>
              <span className={`stat ${current.tutorAnswerGiveaways ? "bad" : "good"}`}><strong>{current.tutorAnswerGiveaways}</strong> tutor answer giveaway{current.tutorAnswerGiveaways === 1 ? "" : "s"}</span>
              <span className={`stat ${current.ungroundedClaims.length ? "bad" : "good"}`}><strong>{current.ungroundedClaims.length}</strong> ungrounded claim{current.ungroundedClaims.length === 1 ? "" : "s"}</span>
            </div>
          </div>
          <div className="card">
            <h3>For the parent</h3>
            <p>{current.parentSummary}</p>
            <h3>Next time</h3>
            <ol>{current.recommendedNext.map((r, i) => <li key={i}>{r}</li>)}</ol>
            {current.effectiveFormats.length > 0 && <p className="muted">Formats that showed understanding best: {current.effectiveFormats.join("; ")}</p>}
          </div>
          <div className="card">
            <h3>For the student</h3>
            <p>{current.studentSummary}</p>
          </div>
          <div className="card">
            <h3>Mastery by concept</h3>
            <p className="muted small">Levels: 0 no evidence · 1 recalls · 2 explains · 3 applies to a new case · 4 extends or teaches back. An answer produced after a tutor hint scores one level lower than the same answer produced independently.</p>
            {current.concepts.map((c) => (
              <div key={c.conceptId} className="concept-row">
                <div><span className={`level l${c.level}`}>{c.level}/4 · {LEVELS[c.level]}</span> &nbsp; <strong>{names.get(c.conceptId) ?? c.conceptId}</strong></div>
                {c.evidence.length > 0 && <ul>{c.evidence.map((e, i) => <li key={i} className="muted">{e}</li>)}</ul>}
                {c.misconceptions.length > 0 && <div className="warn small">Misconceptions: {c.misconceptions.join(" · ")}</div>}
                <div className="muted small">Next: {c.nextStep}</div>
              </div>
            ))}
          </div>
          {(current.outsideClaims?.length ?? 0) > 0 && (
            <div className="card">
              <h3>Outside the reading</h3>
              <p className="muted small">Facts that came up in the session that are not in your material, or that your material tells differently. The tutor teaches from your material; these are here so you can see what was said and, where a check ran, what Wikipedia says.</p>
              {current.outsideClaims!.map((c) => {
                const s = checkLabel(c);
                return (
                  <div key={c.id} className="concept-row">
                    <div><span className={`stat ${s.tone}`}>{s.label}</span> &nbsp; <strong>“{c.claim}”</strong></div>
                    <div className="muted small">Raised by {c.raisedBy === "learner" ? learnerName(current.learnerId) : "the tutor"}; the tutor {STANCE[c.tutorStance]}.</div>
                    {c.materialSays && <div className="small">Your material says: {c.materialSays}</div>}
                    {c.explanation && <p style={{ margin: "6px 0" }}>{c.explanation}</p>}
                    {c.evidence && <blockquote className="small" style={{ margin: "4px 0 4px 12px" }}>“{c.evidence}”</blockquote>}
                    {c.source && (
                      <div className="small"><a href={c.source.url} target="_blank" rel="noreferrer">Wikipedia: {c.source.title}</a> <span className="muted">(the version that was read; text under CC BY-SA 4.0)</span></div>
                    )}
                    {c.statusNote && c.status !== "checked" && <div className="muted small">{c.statusNote}</div>}
                    {c.followUp && <div className="muted small">The tutor came back to it with the student on the next turn.</div>}
                  </div>
                );
              })}
            </div>
          )}
          <div className="card">
            <h3>Grounding audit</h3>
            {current.ungroundedClaims.length ? (
              <ul>{current.ungroundedClaims.map((u, i) => <li key={i} className="error">{u}</li>)}</ul>
            ) : (
              <p style={{ color: "var(--ok)" }}>Every factual claim the tutor made was traceable to the course material.</p>
            )}
          </div>
        </>
      )}
    </>
  );
}
