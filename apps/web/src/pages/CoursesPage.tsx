import { useEffect, useRef, useState } from "react";
import { api, fmtDate, type Chunk, type Course, type CourseFocus, type CourseKnowledge, type Learner, type Session } from "../api";
import { ProgressRing, type CourseBuilds } from "../components/CourseBuilds";

/** What the course card needs to show where each student starts, and to start them. */
interface StartsProps {
  learners: Learner[];
  knowledge: CourseKnowledge[];
  /** "Start X on this course" / "Continue with X": open the Lesson tab with this student and course chosen. */
  onStartLesson: (courseId: string, learnerId: string) => void;
  /** "Ask again": a course intake on its own, started here and shown on the Lesson tab. */
  onStartSession: (s: Session) => void;
}

/** One student's starting point on a course, in a line. */
function startLine(k: CourseKnowledge | undefined): string {
  if (k?.pending) return k.pending.error ? `asked; writing the notes failed (${k.pending.error})` : "asked just now; the notes are being written";
  if (k?.starts.length) {
    const count = (e: string) => k.starts.filter((s) => s.estimate === e).length;
    const parts = [count("can-explain") && `could already explain ${count("can-explain")}`, count("some") && `some knowledge of ${count("some")}`, count("none") && `nothing yet on ${count("none")}`].filter(Boolean);
    return `asked ${k.intakeAt ? fmtDate(k.intakeAt) : ""}: ${parts.join(", ")} of the ${k.starts.length} ideas asked about`;
  }
  return k ? "not asked; there are notes from sessions" : "not asked yet; their first lesson on this course opens with it";
}

const ACCEPT = ".pdf,.docx,.epub,.odt,.rtf,.html,.htm,.md,.txt,.csv,.pptx,.png,.jpg,.jpeg,.gif,.webp,.zip,.mp3,.m4a,.mp4,.wav,.webm";

export function CoursesPage({ courses, onChange, builds, openCourse, ...starts }: { courses: Course[]; onChange: () => Promise<void>; builds: CourseBuilds; openCourse: { id: string; at: number } | null } & StartsProps) {
  const [adding, setAdding] = useState(false);
  /** Courses the parent has opened; every course starts folded to one line. */
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set(openCourse ? [openCourse.id] : []));
  const toggle = (id: string) => setExpanded((s) => {
    const next = new Set(s);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    return next;
  });
  // "Open course" on a ready notice: unfold it and bring it into view.
  useEffect(() => {
    if (!openCourse) return;
    setExpanded((s) => new Set(s).add(openCourse.id));
    requestAnimationFrame(() => document.getElementById(`course-${openCourse.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" }));
  }, [openCourse]);

  const remove = async (c: Course) => {
    if (!confirm(`Delete the course "${c.title}"? Sessions that used it will no longer resolve their concept names.`)) return;
    await api.deleteCourse(c.id);
    await onChange();
  };
  const building = builds.builds.filter((b) => b.status === "uploading" || b.status === "running");

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Courses</h2>
          <button className="primary" onClick={() => setAdding(true)}>Add a course</button>
        </div>
        <p className="muted" style={{ marginBottom: 0 }}>
          Each course is built from material you already own: a unit's lesson book, readings, worksheets or recordings. The tutor teaches only from it. Open a course to see its lessons, choose what is taught, and start a student on it.
        </p>
        {building.length > 0 && (
          <div className="building-list">
            {building.map((b) => (
              <div key={b.key} className="builds-row">
                <ProgressRing percent={b.percent} size={28} />
                <span><strong>{b.title}</strong> <span className="muted small">· {b.label.toLowerCase()} · about {b.percent}%</span></span>
                <button className="link" onClick={() => builds.cancel(b)}>Cancel</button>
              </div>
            ))}
          </div>
        )}
      </div>
      {courses.map((c) => (
        <CourseCard key={c.id} course={c} open={expanded.has(c.id)} onToggle={() => toggle(c.id)} onDelete={() => remove(c)} onChange={onChange} {...starts} />
      ))}
      {!courses.length && !building.length && <p className="muted">No courses yet. Add one to begin.</p>}
      {adding && <AddCourseDialog builds={builds} onClose={() => setAdding(false)} onOpenCourse={(id) => { setAdding(false); setExpanded((s) => new Set(s).add(id)); requestAnimationFrame(() => document.getElementById(`course-${id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })); }} />}
    </>
  );
}

/**
 * "Add a course": the form, then the build's progress in the same window. The window can be closed at any point;
 * the build goes on and its ring stays in the top-right corner until a notice says it is ready.
 */
function AddCourseDialog({ builds, onClose, onOpenCourse }: { builds: CourseBuilds; onClose: () => void; onOpenCourse: (courseId: string) => void }) {
  const [title, setTitle] = useState("");
  const [publisher, setPublisher] = useState("");
  const [grades, setGrades] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [urls, setUrls] = useState("");
  const [dragging, setDragging] = useState(false);
  const [samples, setSamples] = useState<Array<{ name: string; size: number }>>([]);
  /** The build this window started and now follows. */
  const [tracking, setTracking] = useState<string | null>(null);
  const fileInput = useRef<HTMLInputElement>(null);
  useEffect(() => {
    api.samples().then(setSamples).catch(() => setSamples([]));
  }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  const build = tracking ? builds.find(tracking) : undefined;
  const linkList = urls.split(/\s+/).filter(Boolean);
  const ready = files.length > 0 || linkList.length > 0;
  const start = () => setTracking(builds.start({ title, publisher, grades, files, urls: linkList }));
  const addFiles = (list: FileList | null) => setFiles((f) => [...f, ...Array.from(list ?? [])]);

  return (
    <div className="overlay" onMouseDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="dialog" role="dialog" aria-modal="true" aria-labelledby="add-course-title">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 id="add-course-title" style={{ margin: 0 }}>{tracking ? "Building the course" : "Add a course"}</h2>
          <button className="ghost small" onClick={onClose}>{tracking ? "Close" : "Cancel"}</button>
        </div>

        {!tracking && (
          <>
            <p className="muted small">One unit at a time works best: a unit's lesson book, a chapter, a week's readings. For a curriculum with a separate student workbook, add the parent's lesson book too: a workbook is mostly activity pages, and the teaching is in the book.</p>
            <div
              className={`dropzone${dragging ? " over" : ""}`}
              onClick={() => fileInput.current?.click()}
              onDragOver={(e) => {
                e.preventDefault();
                setDragging(true);
              }}
              onDragLeave={() => setDragging(false)}
              onDrop={(e) => {
                e.preventDefault();
                setDragging(false);
                addFiles(e.dataTransfer.files);
              }}
            >
              <strong>Drop files here, or click to choose</strong>
              <div className="muted small">PDF, Word, EPUB, PowerPoint, text, images of pages, audio or video, up to 500 MB each</div>
              <input ref={fileInput} type="file" multiple accept={ACCEPT} hidden onChange={(e) => addFiles(e.target.files)} />
            </div>
            {files.length > 0 && (
              <ul className="file-list small">
                {files.map((f, i) => (
                  <li key={`${f.name}-${i}`}>
                    {f.name} <span className="muted">({(f.size / 1024 / 1024).toFixed(1)} MB)</span>{" "}
                    <button className="link" onClick={() => setFiles((all) => all.filter((_, j) => j !== i))}>remove</button>
                  </li>
                ))}
              </ul>
            )}
            <div className="form-grid">
              <label>Course title<input value={title} onChange={(e) => setTitle(e.target.value)} placeholder="Marine Biology" /><span className="hint">Leave blank to use the material's own title.</span></label>
              <label>Publisher<input value={publisher} onChange={(e) => setPublisher(e.target.value)} placeholder="The Good and the Beautiful" /><span className="hint">Blank: read from the material when it names one.</span></label>
              <label>Grade(s)<input value={grades} onChange={(e) => setGrades(e.target.value)} placeholder="3-8" /><span className="hint">Blank: read from the material when it states them.</span></label>
            </div>
            <details style={{ marginTop: 10 }}>
              <summary className="small">Add links instead (video, podcast, web page)</summary>
              <textarea value={urls} onChange={(e) => setUrls(e.target.value)} rows={3} style={{ width: "100%", marginTop: 6 }} placeholder={"https://www.youtube.com/watch?v=...\nhttps://example.com/podcast/feed.xml"} />
            </details>
            <div className="row" style={{ justifyContent: "flex-end", marginTop: 14 }}>
              <button className="primary" disabled={!ready} onClick={start}>Build course</button>
            </div>
            {samples.length > 0 && (
              <p className="muted small">
                Test material:{" "}
                {samples.map((s) => (
                  <button key={s.name} className="link" onClick={() => setTracking(builds.startSamples([s.name], title))}>{s.name}</button>
                ))}
              </p>
            )}
          </>
        )}

        {tracking && build && (
          <div className="build-progress">
            <ProgressRing percent={build.percent} size={96} stroke={8} />
            <div>
              <div><strong>{build.title}</strong></div>
              {build.status === "done" ? (
                <p>Ready: {build.lessons} lessons and {build.concepts} concepts.</p>
              ) : build.status === "failed" ? (
                <p className="error">{build.error}</p>
              ) : (
                <p className="muted">{build.label}, about {build.percent}%.</p>
              )}
              {(build.status === "uploading" || build.status === "running") && (
                <p className="muted small">You can close this window and keep using the app. The progress stays in the top-right corner, and a notice appears when the course is ready. A full unit can take several minutes.</p>
              )}
              <div className="row">
                {(build.status === "uploading" || build.status === "running") && (
                  <button
                    className="ghost"
                    onClick={() => {
                      // Back to the form once the parent has confirmed: the build is gone.
                      if (builds.cancel(build)) setTracking(null);
                    }}
                  >
                    Cancel build
                  </button>
                )}
                {build.status === "done" && build.courseId && (
                  <button
                    className="primary"
                    onClick={() => {
                      builds.dismiss(build);
                      onOpenCourse(build.courseId!);
                    }}
                  >
                    Open course
                  </button>
                )}
                {build.status === "failed" && (
                  <button
                    className="ghost"
                    onClick={() => {
                      builds.dismiss(build);
                      setTracking(null);
                    }}
                  >
                    Back to the form
                  </button>
                )}
              </div>
            </div>
          </div>
        )}
        {/* The build was cancelled from the corner list or another window. */}
        {tracking && !build && (
          <p className="muted">
            This build was stopped. <button className="link" onClick={() => setTracking(null)}>Back to the form</button>
          </p>
        )}
      </div>
    </div>
  );
}

/** Title, publisher and grades, editable in place. */
function CourseDetails({ course: c, onChange }: { course: Course; onChange: () => Promise<void> }) {
  const [title, setTitle] = useState(c.title);
  const [publisher, setPublisher] = useState(c.publisher ?? "");
  const [grades, setGrades] = useState(c.grades ?? "");
  const [err, setErr] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);
  const dirty = title !== c.title || publisher !== (c.publisher ?? "") || grades !== (c.grades ?? "");
  const save = async () => {
    setErr(null);
    try {
      await api.updateCourseDetails(c.id, { title, publisher, grades });
      await onChange();
      setSaved(true);
    } catch (e) {
      setErr((e as Error).message);
    }
  };
  return (
    <div className="form-grid details-grid">
      <label>Course title<input value={title} onChange={(e) => { setTitle(e.target.value); setSaved(false); }} /></label>
      <label>Publisher<input value={publisher} onChange={(e) => { setPublisher(e.target.value); setSaved(false); }} placeholder="Not set" /></label>
      <label>Grade(s)<input value={grades} onChange={(e) => { setGrades(e.target.value); setSaved(false); }} placeholder={c.level || "Not set"} /></label>
      <div className="row" style={{ alignSelf: "end" }}>
        <button className="ghost small" disabled={!dirty} onClick={save}>Save details</button>
        {saved && !dirty && <span className="muted small">Saved.</span>}
        {err && <span className="error small">{err}</span>}
      </div>
    </div>
  );
}

function CourseCard({ course: c, open, onToggle, onDelete, onChange, learners, knowledge, onStartLesson, onStartSession }: { course: Course; open: boolean; onToggle: () => void; onDelete: () => void; onChange: () => Promise<void> } & StartsProps) {
  const [askErr, setAskErr] = useState<string | null>(null);
  const [asking, setAsking] = useState(false);
  // Ask one student what they already know about this course, now, as a session of its own.
  const ask = async (l: Learner) => {
    setAskErr(null);
    setAsking(true);
    try {
      onStartSession(await api.createSession({ learnerId: l.id, courseId: c.id, only: "course-intake" }));
    } catch (e) {
      setAskErr((e as Error).message);
    } finally {
      setAsking(false);
    }
  };
  const retry = async (l: Learner) => {
    setAskErr(null);
    try {
      await api.retryKnowledge(l.id, c.id);
      await onChange();
    } catch (e) {
      setAskErr((e as Error).message);
    }
  };
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
  // Distinct: a concept taught in two lessons is one concept.
  const keptConcepts = new Set(c.lessons.filter((l) => !lessonSkipped(l.id)).flatMap((l) => l.conceptIds.filter((id) => !conceptSkipped(id))));

  return (
    <div className={`card course-card${open ? " open" : ""}`} id={`course-${c.id}`}>
      <button className="course-head" onClick={onToggle} aria-expanded={open}>
        <span className="chevron" aria-hidden="true">{open ? "▾" : "▸"}</span>
        <span className="course-title">{c.title}</span>
        <span className="course-meta">
          <span className="pill" title={c.publisher}>{c.publisher ? c.publisher : "Publisher not set"}</span>
          {/* The model's own level is often a sentence; the folded line shows grades only when the parent or the material gave them. */}
          <span className="pill" title={c.grades ? undefined : c.level}>{c.grades ? `Grades ${c.grades}` : "Grades not set"}</span>
          <span className="pill" title={c.subject}>{c.subject}</span>
          <span className="muted small">{c.lessons.length} lessons · built {fmtDate(c.createdAt)}</span>
        </span>
      </button>
      {open && (
        <div className="course-body">
          <CourseDetails key={`${c.title}|${c.publisher ?? ""}|${c.grades ?? ""}`} course={c} onChange={onChange} />
          <p className="muted">{c.description}</p>
          <p className="muted small">{c.lessons.length} lessons · {c.concepts.length} concepts · {c.chunkCount} source passages · {c.sources?.map((s) => `${s.name} (${s.kind})`).join(", ")}</p>
          <p className="muted small">
            <strong>Focus:</strong> the tutor teaches {keptLessons.length} of {c.lessons.length} lessons and {keptConcepts.size} of {c.concepts.length} concepts. Untick what you are not teaching; a change applies to sessions started afterwards.
            {saving && " Saving..."}
          </p>
          {keptLessons.length === 0 && <p className="warn small">Every lesson is skipped. Keep at least one concept somewhere, or no session can start on this course.</p>}
          {learners.length > 0 && (
            <div className="concept-row">
              <strong>Where each student starts</strong>
              <p className="muted small" style={{ margin: "4px 0" }}>
                A student's first lesson on this course opens with a few questions about what they already know: one per central idea, how sure they are, and no teaching. Ideas you unticked are never asked about, and neither is anything about faith. The answers are on the Students tab.
              </p>
              {learners.map((l) => {
                const k = knowledge.find((x) => x.learnerId === l.id && x.courseId === c.id);
                return (
                  <div key={l.id} className="row small" style={{ justifyContent: "space-between" }}>
                    <span><strong>{l.name}</strong>: {startLine(k)}</span>
                    <span className="row">
                      {k?.pending?.error && <button className="ghost small" onClick={() => retry(l)}>Write the notes again</button>}
                      {k ? (
                        <>
                          <button className="ghost small" disabled={keptLessons.length === 0} onClick={() => onStartLesson(c.id, l.id)}>Continue with {l.name}</button>
                          <button className="ghost small" disabled={asking || keptLessons.length === 0} onClick={() => ask(l)} title="Ask what they know about this course, as a conversation of its own with no lesson after it">{k.starts.length ? "Ask again" : "Ask now"}</button>
                        </>
                      ) : (
                        <button className="primary small" disabled={keptLessons.length === 0} onClick={() => onStartLesson(c.id, l.id)}>Start {l.name} on this course</button>
                      )}
                    </span>
                  </div>
                );
              })}
              {askErr && <p className="error small">{askErr}</p>}
            </div>
          )}
          {focusErr && <p className="error small">Could not save focus: {focusErr}</p>}
          <h4>Lessons</h4>
          {c.lessons.map((l) => (
            // The tick sits beside the expandable header, not inside it, so ticking never opens or closes the lesson.
            <div key={l.id} className={`lesson-row${lessonSkipped(l.id) ? " skipped" : ""}`}>
              <label className="focus-toggle">
                <input type="checkbox" checked={!lessonSkipped(l.id)} disabled={saving} onChange={() => toggleLesson(l.id)} title={lessonSkipped(l.id) ? "Skipped: tick to teach this lesson" : "Taught: untick to skip this lesson"} />
              </label>
              <details className="lesson">
                <summary>
                  <strong>{l.title}</strong> <span className="muted small">· {l.conceptIds.length} concepts{lessonSkipped(l.id) ? " · skipped" : ""}</span>
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
                          <strong>{i + 1}. {k.name}</strong> <span className="muted small">{k.prerequisites.length ? `· after ${k.prerequisites.join(", ")}` : ""}{conceptSkipped(id) ? " · skipped" : ""}</span>
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
            </div>
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
          <div className="row" style={{ justifyContent: "flex-end", marginTop: 12 }}>
            <button className="ghost small" onClick={onDelete}>Delete course</button>
          </div>
        </div>
      )}
    </div>
  );
}
