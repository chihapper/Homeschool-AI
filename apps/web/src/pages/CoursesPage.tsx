import { useEffect, useState } from "react";
import { api, type Chunk, type Course } from "../api";

export function CoursesPage({ courses, onChange }: { courses: Course[]; onChange: () => Promise<void> }) {
  const [samples, setSamples] = useState<Array<{ name: string; size: number }>>([]);
  const [files, setFiles] = useState<File[]>([]);
  const [title, setTitle] = useState("");
  const [urls, setUrls] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);

  const ingestSample = async (name: string) => {
    setBusy(name);
    setMsg(`Building a course from ${name}. The Curriculum Agent runs at high effort; expect one to two minutes...`);
    try {
      const c = await api.ingestSamples([name], title);
      setMsg(`Created "${c.title}" with ${c.lessons.length} lessons and ${c.concepts.length} concepts.`);
      await onChange();
    } catch (e) {
      setMsg(`Ingest failed: ${(e as Error).message}`);
    } finally {
      setBusy(null);
    }
  };

  const upload = async () => {
    setBusy("upload");
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
      setBusy(null);
    }
  };

  const remove = async (c: Course) => {
    if (!confirm(`Delete the course "${c.title}"? Sessions that used it will no longer resolve their concept names.`)) return;
    await api.deleteCourse(c.id);
    await onChange();
  };

  return (
    <>
      <div className="card">
        <h2>Add course material</h2>
        <p className="muted">Upload lesson plans, chapters, worksheets, PowerPoint lectures, or recordings (PDF, DOCX, PPTX, Markdown, text, MP3, M4A, MP4), or paste links to YouTube or TED videos, a podcast feed, or a web page. The Curriculum Agent turns them into lessons and concepts the tutor teaches from, without adding outside content.</p>
        <div className="row">
          <label>Course title (optional)<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Life Science 7" /></label>
          <label>Files<input type="file" multiple accept=".pdf,.docx,.epub,.odt,.rtf,.html,.htm,.md,.txt,.csv,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip,.mp3,.m4a,.mp4,.wav,.webm" onChange={(e) => setFiles(Array.from(e.target.files ?? []))} /></label>
        </div>
        <div className="row" style={{ marginTop: 8 }}>
          <label style={{ flex: 1 }}>Links (one per line)<textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} placeholder={"https://www.youtube.com/watch?v=...\nhttps://www.ted.com/talks/...\nhttps://example.com/podcast/feed.xml"} /></label>
          <button className="primary" disabled={(!files.length && !urls.trim()) || busy !== null} onClick={upload}>{busy === "upload" ? "Working..." : "Build course"}</button>
        </div>
        {samples.length > 0 && (
          <>
            <h3>Bundled samples</h3>
            <p className="muted small">Test material shipped in <code>data/samples</code>. Stage 1 of the testing plan starts here.</p>
            <div className="row">
              {samples.map((s) => (
                <button key={s.name} className="ghost" disabled={busy !== null} onClick={() => ingestSample(s.name)}>
                  {busy === s.name ? "Building..." : `Ingest ${s.name}`} <span className="muted small">({(s.size / 1024).toFixed(1)} KB)</span>
                </button>
              ))}
            </div>
          </>
        )}
        {msg && <p className="muted">{msg}</p>}
      </div>
      {courses.map((c) => <CourseCard key={c.id} course={c} onDelete={() => remove(c)} />)}
      {!courses.length && <p className="muted">No courses yet.</p>}
    </>
  );
}

function CourseCard({ course: c, onDelete }: { course: Course; onDelete: () => void }) {
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const loadChunks = () => {
    if (!chunks) api.chunks(c.id).then(setChunks).catch(() => setChunks([]));
  };
  const concept = (id: string) => c.concepts.find((k) => k.id === id);
  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{c.title} <span className="pill">{c.subject}</span><span className="pill">{c.level}</span></h3>
        <button className="ghost small" onClick={onDelete}>Delete</button>
      </div>
      <p className="muted">{c.description}</p>
      <p className="muted small">{c.lessons.length} lessons · {c.concepts.length} concepts · {c.chunkCount} source passages · {c.sources?.map((s) => `${s.name} (${s.kind})`).join(", ")} · id <code>{c.id}</code></p>
      {c.lessons.map((l) => (
        <details key={l.id} className="lesson">
          <summary><strong>{l.title}</strong> <span className="muted small">· {l.conceptIds.length} concepts · id {l.id}</span></summary>
          <div className="indent">
            <h4>Objectives</h4>
            <ul className="small">{l.objectives.map((o, i) => <li key={i}>{o}</li>)}</ul>
            {l.guidingQuestions.length > 0 && <><h4>Guiding questions</h4><ul className="small">{l.guidingQuestions.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
            {l.practiceItems.length > 0 && <><h4>Practice items</h4><ul className="small">{l.practiceItems.map((q, i) => <li key={i}>{q}</li>)}</ul></>}
            <h4>Concepts, in teaching order</h4>
            {l.conceptIds.map((id, i) => {
              const k = concept(id);
              if (!k) return <p key={id} className="error small">Missing concept {id}</p>;
              return (
                <div key={id} className="concept">
                  <div><strong>{i + 1}. {k.name}</strong> <span className="muted small">· {k.id}{k.prerequisites.length ? ` · after ${k.prerequisites.join(", ")}` : ""}</span></div>
                  <p className="small">{k.summary}</p>
                  <div className="muted small">Key facts the student should be able to state:</div>
                  <ul className="small">{k.keyFacts.map((f, j) => <li key={j}>{f}</li>)}</ul>
                  {k.commonMisconceptions.length > 0 && <><div className="muted small">Misconceptions to listen for:</div><ul className="small">{k.commonMisconceptions.map((f, j) => <li key={j}>{f}</li>)}</ul></>}
                  <div className="muted small">Grounded in: {k.sourceChunkIds.map((s) => <code key={s}>{s}</code>)}</div>
                </div>
              );
            })}
          </div>
        </details>
      ))}
      <details onToggle={(e) => (e.target as HTMLDetailsElement).open && loadChunks()}>
        <summary className="muted">Source passages (verbatim, what the tutor is allowed to assert)</summary>
        {!chunks && <p className="muted small">Loading...</p>}
        {chunks?.map((ch) => (
          <div key={ch.id} className="chunk">
            <div className="muted small"><code>{ch.id}</code> · {ch.headingPath.join(" › ")}</div>
            <pre className="passage">{ch.text}</pre>
          </div>
        ))}
      </details>
    </div>
  );
}
