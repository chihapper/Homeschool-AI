/**
 * Course builds the parent can walk away from. A build runs on the server as a job (GET /api/jobs); this file
 * keeps the browser's view of every build, from the upload of the files to the finished course, and draws it
 * three ways: the progress in the "Add a course" window, a ring in the top-right corner of the app while anything
 * is building, and a notification when a build is done or has failed. The notification stays until the parent
 * closes it, which also tells the server to forget the job.
 */
import { useCallback, useEffect, useRef, useState } from "react";
import { api, type CourseForm, type CourseJob } from "../api";

/** One build as the page shows it, whether its files are still uploading or the server is building it. */
export interface Build {
  key: string;
  jobId?: string;
  title: string;
  status: "uploading" | "running" | "done" | "failed";
  /** 0 to 100. The upload is the first 5. */
  percent: number;
  label: string;
  courseId?: string;
  lessons?: number;
  concepts?: number;
  error?: string;
}

interface Upload {
  key: string;
  title: string;
  percent: number;
  error?: string;
  /** Set once the server has the files and a job is building the course. */
  jobId?: string;
}

function fromJob(j: CourseJob): Build {
  return { key: j.id, jobId: j.id, title: j.title, status: j.status, percent: j.percent, label: j.label, courseId: j.courseId, lessons: j.lessons, concepts: j.concepts, error: j.error };
}

export interface CourseBuilds {
  builds: Build[];
  /** Upload files and start a build; returns the key to follow it by. */
  start: (form: CourseForm) => string;
  /** Build from bundled sample files (no upload step). */
  startSamples: (samples: string[], title: string) => string;
  /** The build a key started, followed from its upload to its job. */
  find: (key: string) => Build | undefined;
  dismiss: (b: Build) => void;
  /** Stop a build that is uploading or running, after asking. Nothing is saved. True when the parent confirmed. */
  cancel: (b: Build) => boolean;
}

export function useCourseBuilds(onFinished: (job: CourseJob) => void): CourseBuilds {
  const [jobs, setJobs] = useState<CourseJob[]>([]);
  const [uploads, setUploads] = useState<Upload[]>([]);
  /** The last status seen per job, so a finish is noticed once. */
  const seen = useRef(new Map<string, CourseJob["status"]>());
  /** One per upload still on its way, so a cancel can stop it. */
  const aborts = useRef(new Map<string, AbortController>());
  const finished = useRef(onFinished);
  finished.current = onFinished;

  const poll = useCallback(async () => {
    try {
      const list = await api.jobs();
      for (const j of list) {
        if (seen.current.get(j.id) === "running" && j.status !== "running") finished.current(j);
        seen.current.set(j.id, j.status);
      }
      setJobs(list);
    } catch {
      // The server is restarting or unreachable: the next poll tries again.
    }
  }, []);
  useEffect(() => {
    void poll();
  }, [poll]);
  const active = jobs.some((j) => j.status === "running") || uploads.some((u) => !u.jobId && !u.error);
  useEffect(() => {
    if (!active) return;
    const t = setInterval(() => void poll(), 1500);
    return () => clearInterval(t);
  }, [active, poll]);

  const follow = (key: string, title: string, run: (onUpload: (fraction: number) => void, signal: AbortSignal) => Promise<CourseJob>): string => {
    setUploads((u) => [...u, { key, title, percent: 0 }]);
    const abort = new AbortController();
    aborts.current.set(key, abort);
    run((fraction) => setUploads((u) => u.map((x) => (x.key === key ? { ...x, percent: Math.round(5 * fraction) } : x))), abort.signal)
      .then((job) => {
        // Cancelled while the files were still on their way and the server answered anyway: stop that job too.
        if (abort.signal.aborted) {
          void api.cancelJob(job.id).catch(() => undefined);
          return;
        }
        seen.current.set(job.id, job.status);
        setJobs((js) => [...js.filter((j) => j.id !== job.id), job]);
        setUploads((u) => u.map((x) => (x.key === key ? { ...x, jobId: job.id } : x)));
      })
      .catch((e: Error) => {
        if (!abort.signal.aborted) setUploads((u) => u.map((x) => (x.key === key ? { ...x, error: e.message } : x)));
      })
      .finally(() => aborts.current.delete(key));
    return key;
  };
  const newKey = () => `build-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

  const start = (form: CourseForm) => follow(newKey(), form.title || form.files[0]?.name || form.urls[0] || "New course", (onUpload, signal) => api.uploadCourse(form, onUpload, signal));
  const startSamples = (samples: string[], title: string) => follow(newKey(), title || samples[0], () => api.ingestSamples(samples, title));

  const builds: Build[] = [
    ...uploads
      .filter((u) => !u.jobId)
      .map((u): Build => ({ key: u.key, title: u.title, status: u.error ? "failed" : "uploading", percent: u.percent, label: u.error ? "Upload failed" : "Uploading the files", error: u.error })),
    ...jobs.map(fromJob),
  ];
  const find = (key: string) => {
    const jobId = uploads.find((u) => u.key === key)?.jobId;
    return builds.find((b) => b.key === key || (jobId !== undefined && b.jobId === jobId));
  };
  const dismiss = (b: Build) => {
    if (b.jobId) {
      setJobs((js) => js.filter((j) => j.id !== b.jobId));
      void api.dismissJob(b.jobId).catch(() => undefined);
    }
    setUploads((u) => u.filter((x) => x.key !== b.key && (!b.jobId || x.jobId !== b.jobId)));
  };
  const cancel = (b: Build) => {
    if (!confirm(`Stop building "${b.title}"? Nothing from it is saved.`)) return false;
    if (b.jobId) {
      setJobs((js) => js.filter((j) => j.id !== b.jobId));
      void api.cancelJob(b.jobId).catch(() => undefined);
    } else {
      aborts.current.get(b.key)?.abort();
    }
    setUploads((u) => u.filter((x) => x.key !== b.key && (!b.jobId || x.jobId !== b.jobId)));
    return true;
  };
  return { builds, start, startSamples, find, dismiss, cancel };
}

/** A circle that fills clockwise from the top, with the percentage in the middle. */
export function ProgressRing({ percent, size = 32, stroke = 4, label = true }: { percent: number; size?: number; stroke?: number; label?: boolean }) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const p = Math.max(0, Math.min(100, percent));
  return (
    <svg className="ring" width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`${Math.round(p)} percent`}>
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--line)" strokeWidth={stroke} />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="var(--accent)"
        strokeWidth={stroke}
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={c * (1 - p / 100)}
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        style={{ transition: "stroke-dashoffset .6s ease" }}
      />
      {label && (
        <text x="50%" y="50%" dominantBaseline="central" textAnchor="middle" fontSize={size * 0.26} fill="var(--ink)">
          {Math.round(p)}%
        </text>
      )}
    </svg>
  );
}

/** The ring in the top-right corner while anything is building; a click lists each build. */
export function BuildsCorner({ builds, onCancel }: { builds: Build[]; onCancel: (b: Build) => void }) {
  const [open, setOpen] = useState(false);
  const running = builds.filter((b) => b.status === "uploading" || b.status === "running");
  if (!running.length) return null;
  const average = running.reduce((n, b) => n + b.percent, 0) / running.length;
  const title = running.length === 1 ? `Building "${running[0].title}": ${running[0].label.toLowerCase()}, about ${running[0].percent}%` : `${running.length} courses building`;
  return (
    <div className="builds-corner">
      <button className="builds-button" onClick={() => setOpen((o) => !o)} title={title} aria-expanded={open}>
        <ProgressRing percent={average} size={34} />
        {running.length > 1 && <span className="builds-count">{running.length}</span>}
      </button>
      {open && (
        <div className="builds-pop" role="dialog" aria-label="Courses being built">
          {running.map((b) => (
            <div key={b.key} className="builds-row">
              <ProgressRing percent={b.percent} size={28} />
              <div style={{ flex: 1 }}>
                <div><strong>{b.title}</strong></div>
                <div className="muted small">{b.label} · about {b.percent}%</div>
              </div>
              <button className="link" onClick={() => onCancel(b)}>Cancel</button>
            </div>
          ))}
          <p className="muted small" style={{ margin: "6px 0 0" }}>You can keep using the app. A notice appears here when each course is ready.</p>
        </div>
      )}
    </div>
  );
}

/** "Course ready" and "Build failed" notices, top right, until closed. */
export function BuildNotices({ builds, onOpen, onDismiss }: { builds: Build[]; onOpen: (courseId: string) => void; onDismiss: (b: Build) => void }) {
  const finished = builds.filter((b) => b.status === "done" || b.status === "failed");
  if (!finished.length) return null;
  return (
    <div className="notices" aria-live="polite">
      {finished.map((b) => (
        <div key={b.key} className={`notice-toast ${b.status}`}>
          {b.status === "done" ? (
            <>
              <div>
                <strong>"{b.title}" is ready.</strong>
                <div className="small">{b.lessons} lessons and {b.concepts} concepts, built from your material.</div>
              </div>
              <div className="row">
                {b.courseId && (
                  <button
                    className="primary small"
                    onClick={() => {
                      onOpen(b.courseId!);
                      onDismiss(b);
                    }}
                  >
                    Open course
                  </button>
                )}
                <button className="ghost small" onClick={() => onDismiss(b)} aria-label="Close">Close</button>
              </div>
            </>
          ) : (
            <>
              <div>
                <strong>"{b.title}" could not be built.</strong>
                <div className="small">{b.error}</div>
              </div>
              <div className="row">
                <button className="ghost small" onClick={() => onDismiss(b)} aria-label="Close">Close</button>
              </div>
            </>
          )}
        </div>
      ))}
    </div>
  );
}
