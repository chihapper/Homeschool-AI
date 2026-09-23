import { useEffect, useState } from "react";
import { api, type Chunk, type Course, type CourseFocus } from "../api";

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
        <p className="muted">Bring one unit at a time: a chapter, a week's readings, a topical booklet, not a whole textbook. Once the course is built, untick anything you are not teaching and the tutor will leave it alone.</p>
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
      {courses.map((c) => <CourseCard key={c.id} course={c} onDelete={() => remove(c)} onChange={onChange} />)}
      {!courses.length && <p className="muted">No courses yet.</p>}
    </>
  );
}

function CourseCard({ course: c, onDelete, onChange }: { course: Course; onDelete: () => void; onChange: () => Promise<void> }) {
  const [chunks, setChunks] = useState<Chunk[] | null>(null);
  const [saving, setSaving] = useState(false);
  const [focusErr, setFocusErr] = useState<string | null>(null);
  const loadChunks = () => {
    if (!chunks) api.chunks(c.id).then(setChunks).catch(() => setChunks([]));
  };
  const concept = (id: string) => c.concepts.find((k) => k.id === id);

  // Focus: the parent's decision about what the tutor teaches. Saved whole on every toggle; the refreshed
  // course is the only source of truth, so there is no unsaved state to lose.
  const focus: CourseFocus = c.focus ?? { skippedLessonIds: [], skippedConceptIds: [] };
  const lessonSkipped = (id: string) => focus.skippedLessonIds.includes(id);
  const conceptSkipped = (id: string) => focus.skippedConceptIds.includes(id);
  const saveFocus = async (next: CourseFocus) => {
    setSaving(true);
    setFocusErr(null);
    try {
      await api.setFocus(c.id, next);
      await onChange();
    } catch (e) {
      setFocusErr((e as Error).message);
    } finally {
      setSaving(false);
    }
  };
  const toggleLesson = (id: string) =>
    saveFocus({ ...focus, skippedLessonIds: lessonSkipped(id) ? focus.skippedLessonIds.filter((x) => x !== id) : [...focus.skippedLessonIds, id] });
  const toggleConcept = (id: string) =>
    saveFocus({ ...focus, skippedConceptIds: conceptSkipped(id) ? focus.skippedConceptIds.filter((x) => x !== id) : [...focus.skippedConceptIds, id] });
  const keptLessons = c.lessons.filter((l) => !lessonSkipped(l.id) && l.conceptIds.some((id) => !conceptSkipped(id)));
  const keptConcepts = c.lessons.filter((l) => !lessonSkipped(l.id)).flatMap((l) => l.conceptIds.filter((id) => !conceptSkipped(id)));

  return (
    <div className="card">
      <div className="row" style={{ justifyContent: "space-between" }}>
        <h3 style={{ margin: 0 }}>{c.title} <span className="pill">{c.subject}</span><span className="pill">{c.level}</span></h3>
        <button className="ghost small" onClick={onDelete}>Delete</button>
      </div>
      <p className="muted">{c.description}</p>
      <p className="muted small">{c.lessons.length} lessons · {c.concepts.length} concepts · {c.chunkCount} source passages · {c.sources?.map((s) => `${s.name} (${s.kind})`).join(", ")} · id <code>{c.id}</code></p>
      <p className="muted small">
        <strong>Focus:</strong> the tutor teaches {keptLessons.length} of {c.lessons.length} lessons and {keptConcepts.length} of {c.concepts.length} concepts. Untick what you are not teaching; a change applies to sessions started afterwards.
        {saving && " Saving..."}
      </p>
      {keptLessons.length === 0 && <p className="warn small">Every lesson is skipped. Keep at least one concept somewhere, or no session can start on this course.</p>}
      {focusErr && <p className="error small">Could not save focus: {focusErr}</p>}
      {c.lessons.map((l) => (
        <details key={l.id} className={`lesson${lessonSkipped(l.id) ? " skipped" : ""}`}>
          <summary>
            <label className="focus-toggle" onClick={(e) => e.stopPropagation()}>
              <input type="checkbox" checked={!lessonSkipped(l.id)} disabled={saving} onChange={() => toggleLesson(l.id)} title={lessonSkipped(l.id) ? "Skipped: tick to teach this lesson" : "Taught: untick to skip this lesson"} />
            </label>{" "}
            <strong>{l.title}</strong> <span className="muted small">· {l.conceptIds.length} concepts{lessonSkipped(l.id) ? " · skipped" : ""} · id {l.id}</span>
          </summary>
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
                <div key={id} className={`concept${conceptSkipped(id) ? " skipped" : ""}`}>
                  <div>
                    <label className="focus-toggle"><input type="checkbox" checked={!conceptSkipped(id)} disabled={saving || lessonSkipped(l.id)} onChange={() => toggleConcept(id)} title={conceptSkipped(id) ? "Skipped: tick to teach this concept" : "Taught: untick to skip this concept"} /></label>{" "}
                    <strong>{i + 1}. {k.name}</strong> <span className="muted small">· {k.id}{k.prerequisites.length ? ` · after ${k.prerequisites.join(", ")}` : ""}{conceptSkipped(id) ? " · skipped" : ""}</span>
                  </div>
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
