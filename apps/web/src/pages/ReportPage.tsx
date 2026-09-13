import type { Course, Report } from "../api";

const LEVELS = ["No evidence", "Recalls", "Explains", "Applies", "Extends"];

export function ReportPage({ report, courses }: { report: Report | null; courses: Course[] }) {
  if (!report) return <p className="muted">End a session to see its mastery report.</p>;
  const names = new Map(courses.flatMap((c) => c.concepts.map((k) => [k.id, k.name] as const)));
  return (
    <>
      <div className="card">
        <h2>For the parent</h2>
        <p>{report.parentSummary}</p>
        <h3>Next time</h3>
        <ul>{report.recommendedNext.map((r, i) => <li key={i}>{r}</li>)}</ul>
        {report.effectiveFormats.length > 0 && <p className="muted">Formats that showed understanding best: {report.effectiveFormats.join(", ")}</p>}
      </div>
      <div className="card">
        <h2>For the student</h2>
        <p>{report.studentSummary}</p>
      </div>
      <div className="card">
        <h2>Mastery by concept</h2>
        {report.concepts.map((c) => (
          <div key={c.conceptId} style={{ marginBottom: 12 }}>
            <div><span className="level">{c.level}/4 · {LEVELS[c.level]}</span> &nbsp; <strong>{names.get(c.conceptId) ?? c.conceptId}</strong></div>
            {c.evidence.length > 0 && <ul>{c.evidence.map((e, i) => <li key={i} className="muted">{e}</li>)}</ul>}
            {c.misconceptions.length > 0 && <div className="muted">Misconceptions: {c.misconceptions.join("; ")}</div>}
            <div className="muted">Next: {c.nextStep}</div>
          </div>
        ))}
      </div>
      <div className="card">
        <h2>Grounding audit</h2>
        {report.ungroundedClaims.length ? (
          <ul>{report.ungroundedClaims.map((u, i) => <li key={i} className="error">{u}</li>)}</ul>
        ) : (
          <p style={{ color: "var(--ok)" }}>Every factual claim the tutor made was traceable to the course material.</p>
        )}
      </div>
    </>
  );
}
