import { useEffect, useState } from "react";
import { api, fmtDate, type Course, type Learner, type Report } from "../api";

const LEVELS = ["No evidence", "Recalls", "Explains", "Applies", "Extends"];

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

  const names = new Map(courses.flatMap((c) => c.concepts.map((k) => [k.id, k.name] as const)));
  const learnerName = (id: string) => learners.find((l) => l.id === id)?.name ?? id;
  const courseTitle = (id?: string) => courses.find((c) => c.id === id)?.title ?? id ?? "";

  const remove = async (r: Report) => {
    if (!confirm("Delete this session and its report?")) return;
    await api.deleteSession(r.sessionId);
    setAll((a) => a.filter((x) => x.sessionId !== r.sessionId));
    if (current?.sessionId === r.sessionId) setCurrent(null);
  };

  return (
    <>
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
