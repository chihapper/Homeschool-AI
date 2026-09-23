import { useState } from "react";
import { api, type Learner } from "../api";

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
                  <p className="small">Challenge tolerance <strong>{l.profile.challengeTolerance}</strong> · pace <strong>{l.profile.pace}</strong></p>
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
