import { useState } from "react";
import { api, type Course } from "../api";

export function CoursesPage({ courses, onChange }: { courses: Course[]; onChange: () => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async () => {
    setBusy(true);
    setMsg("Parsing material and building the course. This takes a minute or two for a full chapter...");
    try {
      const c = await api.uploadCourse(files, title);
      setMsg(`Created "${c.title}" with ${c.lessons.length} lessons and ${c.concepts.length} concepts.`);
      setFiles([]);
      setTitle("");
      await onChange();
    } catch (e) {
      setMsg(`Upload failed: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <div className="card">
        <h2>Add course material</h2>
        <p className="muted">Upload lesson plans, textbook chapters, worksheets (PDF, DOCX, Markdown, or text). The Curriculum Agent turns them into lessons and concepts the tutor teaches from, without adding outside content.</p>
        <div className="row">
          <label>Course title (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Life Science 7" /></label>
          <label>Files<input type="file" multiple accept=".pdf,.docx,.md,.txt" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
          <button className="primary" disabled={!files.length || busy} onClick={upload}>{busy ? "Working..." : "Build course"}</button>
        </div>
        {msg && <p className="muted">{msg}</p>}
      </div>
      {courses.map((c) => (
        <div className="card" key={c.id}>
          <h3>{c.title} <span className="pill">{c.subject}</span><span className="pill">{c.level}</span></h3>
          <p className="muted">{c.description}</p>
          <ul>
            {c.lessons.map((l) => (
              <li key={l.id}><strong>{l.title}</strong> · {l.conceptIds.length} concepts<br /><span className="muted">{l.objectives.slice(0, 2).join(" · ")}</span></li>
            ))}
          </ul>
          <span className="muted">{c.chunkCount} source passages · id {c.id}</span>
        </div>
      ))}
      {!courses.length && <p className="muted">No courses yet.</p>}
    </>
  );
}
