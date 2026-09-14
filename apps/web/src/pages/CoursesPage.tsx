import { useState } from "react";
import { api, type Course } from "../api";

export function CoursesPage({ courses, onChange }: { courses: Course[]; onChange: () => Promise<void> }) {
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  const upload = async () => {
    setBusy(true);
    setMsg("Parsing material and building the course. This takes a minute or two for a full chapter...");
    try {
      const c = await api.uploadCourse(files, title, urls.split(/\s+/).filter(Boolean));
      setMsg(`Created "${c.title}" with ${c.lessons.length} lessons and ${c.concepts.length} concepts.`);
      setFiles([]);
      setTitle("");
      setUrls("");
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
        <p className="muted">Upload lesson plans, chapters, worksheets, PowerPoint lectures, or recordings (PDF, DOCX, PPTX, Markdown, text, MP3, M4A, MP4), or paste links to YouTube or TED videos, a podcast feed, or a web page. The Curriculum Agent turns them into lessons and concepts the tutor teaches from, without adding outside content.</p>
        <div className="row">
          <label>Course title (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Life Science 7" /></label>
          <label>Files<input type="file" multiple accept=".pdf,.docx,.pptx,.md,.txt,.mp3,.m4a,.mp4,.wav,.webm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>Links (one per line)<textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={"https://www.youtube.com/watch?v=...\nhttps://www.ted.com/talks/...\nhttps://example.com/podcast/feed.xml"} style={{ font: "inherit", padding: 8, border: "1px solid #d8d2c4", borderRadius: 8 }} /></label>
          <button className="primary" disabled={(!files.length && !urls.trim()) || busy} onClick={upload}>{busy ? "Working..." : "Build course"}</button>
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
          <span className="muted">{c.chunkCount} source passages · {c.sources?.map((s) => `${s.name} (${s.kind})`).join(", ")} · id {c.id}</span>
        </div>
      ))}
      {!courses.length && <p className="muted">No courses yet.</p>}
    </>
  );
}
