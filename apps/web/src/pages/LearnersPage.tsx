import { useState } from "react";
import { api, type Learner } from "../api";

export function LearnersPage({ learners, onChange }: { learners: Learner[]; onChange: () => Promise<void> }) {
  const [name, setName] = useState("");
  const [grade, setGrade] = useState("");
  const [age, setAge] = useState("");
  const add = async () => {
    await api.createLearner({ name, gradeLevel: grade || undefined, age: age ? Number(age) : undefined });
    setName(""); setGrade(""); setAge("");
    await onChange();
  };
  return (
    <>
      <div className="card">
        <h2>Students</h2>
        <div className="row">
          <label>Name<input value={name} onChange={(e) => setName(e.target.value)} /></label>
          <label>Grade<input value={grade} onChange={(e) => setGrade(e.target.value)} placeholder="7" /></label>
          <label>Age<input value={age} onChange={(e) => setAge(e.target.value)} placeholder="12" /></label>
          <button className="primary" disabled={!name.trim()} onClick={add}>Add</button>
        </div>
      </div>
      {learners.map((l) => (
        <div className="card" key={l.id}>
          <h3>{l.name} {l.gradeLevel && <span className="pill">Grade {l.gradeLevel}</span>} {l.profile ? <span className="pill">profiled</span> : <span className="pill">needs intake</span>}</h3>
          {l.profile ? (
            <>
              <p>{l.profile.parentSummary}</p>
              <p className="muted">Tutoring guidance:</p>
              <ul>{l.profile.tutoringGuidance.map((g, i) => <li key={i}>{g}</li>)}</ul>
            </>
          ) : (
            <p className="muted">The first session runs a short intake conversation to learn how {l.name} learns best.</p>
          )}
        </div>
      ))}
    </>
  );
}
