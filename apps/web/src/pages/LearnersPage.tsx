import { useState } from "react";
import { api, fmtDate, type Depth, type Learner, type ProfileChange } from "../api";

const FIELD_LABEL: Record<string, string> = {
  intakePreferences: "How they take ideas in",
  demonstrationPreferences: "How they show understanding",
  challengeTolerance: "Challenge tolerance",
  pace: "Pace",
  verbalLevel: "Verbal level",
  depth: "Depth",
  interests: "Interests",
  priorKnowledge: "Prior knowledge",
  observedGaps: "Observed gaps",
  tutoringGuidance: "Tutoring guidance",
};
const DEPTH_LABEL: Record<Depth, string> = { simple: "the plain version", "some-nuance": "some nuance", full: "the full picture" };

/** A value short enough to read in a line; a rewritten paragraph (verbal level) is shown on its own instead. */
const SHORT = 60;

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

export function LearnersPage({ learners, onChange }: { learners: Learner[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [age, setAge] = useState("");
  const [err, setErr] = useState<string | null>(null);

  const add = async () => {
    try {
      await api.createLearner({ name: name.trim(), gradeLevel: grade || undefined, age: age ? Number(age) : undefined });
      setName("");
      setGrade("");
      setAge("");
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  const resetProfile = async (l: Learner) => {
    if (!confirm(`Forget ${l.name}'s profile? The next session will run the intake conversation again.`)) return;
    await api.resetProfile(l.id);
    await onChange();
  };
  const remove = async (l: Learner) => {
    if (!confirm(`Delete ${l.name}? Their sessions and reports stay on disk but will show an id instead of a name.`)) return;
    await api.deleteLearner(l.id);
    await onChange();
  };
  const undo = async (l: Learner) => {
    const history = l.profileHistory ?? [];
    const last = history[history.length - 1];
    if (!last || !confirm(`Undo the profile changes from ${fmtDate(last.at)}? ${l.name}'s profile goes back to what it was before that session.`)) return;
    try {
      await api.undoProfileUpdate(l.id);
      await onChange();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Students</h2>
        <p className="muted small">One entry per persona you want to test. The first session for a student without a profile runs the intake conversation; reset the profile to run it again.</p>
        <div className="row">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} placeholder="Maya" /></label>
          <label>Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="7" /></label>
          <label>Age<input value={age} onChange={(e) => setAge(e.target.value)} placeholder="12" /></label>
          <button className="primary" disabled={!name.trim()} onClick={add}>Add</button>
        </div>
        {err && <p className="error">{err}</p>}
      </div>
      {learners.map((l) => (
        <div className="card" key={l.id}>
          <div className="row" style={{ justifyContent: "space-between" }}>
            <h3 style={{ margin: 0 }}>
              {l.name} {l.gradeLevel && <span className="pill">Grade {l.gradeLevel}</span>} {l.age && <span className="pill">Age {l.age}</span>} {l.profile ? <span className="pill">profiled</span> : <span className="pill">needs intake</span>}
            </h3>
            <div className="row">
              {l.profile && <button className="ghost small" onClick={() => resetProfile(l)}>Reset profile</button>}
              <button className="ghost small" onClick={() => remove(l)}>Delete</button>
            </div>
          </div>
          {l.profile ? (
            <div className="profile">
              <p>{l.profile.parentSummary}</p>
              <div className="grid3">
                <div>
                  <h4>How they take ideas in</h4>
                  <div>{l.profile.intakePreferences.map((p) => <span key={p} className="pill">{p}</span>)}</div>
                  <h4>How they show understanding</h4>
                  <div>{l.profile.demonstrationPreferences.map((p) => <span key={p} className="pill">{p}</span>)}</div>
                  <h4>Pace and challenge</h4>
                  <p className="small">Challenge tolerance <strong>{l.profile.challengeTolerance}</strong> · pace <strong>{l.profile.pace}</strong> · depth <strong>{l.profile.depth ?? "simple"}</strong> ({DEPTH_LABEL[l.profile.depth ?? "simple"]})</p>
                  <p className="small">{l.profile.verbalLevel}</p>
                  <h4>Interests</h4>
                  <p className="small">{l.profile.interests.join(", ")}</p>
                </div>
                <div>
                  <h4>Prior knowledge (quoted from intake)</h4>
                  <ul className="small">{l.profile.priorKnowledge.map((p, i) => <li key={i}>{p}</li>)}</ul>
                  <h4>Observed gaps</h4>
                  <ul className="small">{l.profile.observedGaps.map((p, i) => <li key={i}>{p}</li>)}</ul>
                </div>
                <div>
                  <h4>Tutoring guidance (the tutor follows these literally)</h4>
                  <ul className="small">{l.profile.tutoringGuidance.map((g, i) => <li key={i}>{g}</li>)}</ul>
                </div>
              </div>
              <h4>Changes to the profile</h4>
              <p className="muted small">
                The profile is reviewed after every session's report. Prior knowledge, gaps, interests and guidance change when the evidence does; pace, challenge tolerance, verbal level, depth and how they take ideas in change only when two sessions in a row agree. Undo puts the profile back the way it was before that session.
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
            </div>
          ) : (
            <p className="muted">The first session runs a short intake conversation to learn how {l.name} learns best. Tick “Skip intake” on the Session tab to go straight to a lesson.</p>
          )}
        </div>
      ))}
      {!learners.length && <p className="muted">No students yet.</p>}
    </>
  );
}
