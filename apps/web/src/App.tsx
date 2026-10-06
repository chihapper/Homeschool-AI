import { useCallback, useEffect, useState } from "react";
import { api, PROVIDER_NAME, type Course, type CourseKnowledge, type Health, type Learner, type Report, type Session } from "./api";
import { CoursesPage } from "./pages/CoursesPage";
import { LearnersPage } from "./pages/LearnersPage";
import { LessonPage, type LessonPreset } from "./pages/LessonPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "students" | "courses" | "lesson" | "reports" | "settings";
/** In the order a family meets them: add the children, bring the material, teach, read the reports. */
const TABS: Array<[Tab, string]> = [
  ["students", "Students"],
  ["courses", "Courses"],
  ["lesson", "Lesson"],
  ["reports", "Reports"],
  ["settings", "Settings"],
];

export function App() {
  const [tab, setTab] = useState<Tab>("lesson");
  const [courses, setCourses] = useState<Course[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [knowledge, setKnowledge] = useState<CourseKnowledge[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  /** The lesson conversation on screen (the Lesson tab), kept here so it survives a visit to another tab. */
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  /** Who and what the Lesson tab should show when it opens from the Courses tab. */
  const [preset, setPreset] = useState<LessonPreset | null>(null);
  /** The student whose intake the Students tab should open on, when sent there from the Lesson tab. */
  const [intakeFor, setIntakeFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, l, h, k] = await Promise.all([api.courses(), api.learners(), api.health(), api.knowledge()]);
      setCourses(c);
      setLearners(l);
      setKnowledge(k);
      setHealth(h);
      setError(null);
    } catch (e) {
      setError(`Cannot reach the server: ${(e as Error).message}. Is \`npm run dev:server\` running on port 3001?`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  const go = (t: Tab) => {
    setTab(t);
    if (t !== "students") setIntakeFor(null);
    if (t === "students" || t === "courses" || t === "lesson") void refresh();
  };

  return (
    <>
      <header>
        <h1>Homeschool AI</h1>
        <nav>
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => go(t)} title={t === "students" ? "Profiles and course records are revised in the background after each report; open the tab again to see the latest." : undefined}>
              {label}
              {t === "lesson" && session && session.phase !== "complete" ? <span className="dot" title="A session is open" /> : null}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {health && (
          <span className="muted small" title="Live tutor model. Change it in Settings.">
            tutor <code>{health.tutorModel}</code> @ {health.tutorEffort} · {health.tutorThinking} thinking · offline <code>{health.model}</code>
            {health.voice.tts !== "none" ? ` · voice ${PROVIDER_NAME[health.voice.tts]}` : " · text only"}
          </span>
        )}
      </header>
      <main>
        {error && <div className="card error">{error}</div>}
        {tab === "students" && <LearnersPage learners={learners} courses={courses} knowledge={knowledge} health={health} onChange={refresh} openIntakeFor={intakeFor} />}
        {tab === "courses" && (
          <CoursesPage
            courses={courses}
            onChange={refresh}
            learners={learners}
            knowledge={knowledge}
            onStartLesson={(courseId, learnerId) => {
              setPreset({ courseId, learnerId, at: Date.now() });
              go("lesson");
            }}
            onStartSession={(s) => {
              setSession(s);
              go("lesson");
            }}
          />
        )}
        {tab === "lesson" && (
          <LessonPage
            courses={courses}
            learners={learners}
            knowledge={knowledge}
            health={health}
            session={session}
            onOpen={setSession}
            onSession={setSession}
            onReport={(r) => {
              setReport(r);
              go("reports");
              void refresh();
            }}
            preset={preset}
            onIntakeOnStudents={(id) => {
              setIntakeFor(id);
              go("students");
            }}
          />
        )}
        {tab === "reports" && <ReportPage report={report} courses={courses} learners={learners} />}
        {tab === "settings" && <SettingsPage onChange={refresh} />}
      </main>
    </>
  );
}
