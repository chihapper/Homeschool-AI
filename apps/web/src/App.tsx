import { useCallback, useEffect, useState } from "react";
import { api, type Course, type Health, type Learner, type Report, type Session } from "./api";
import { CoursesPage } from "./pages/CoursesPage";
import { LearnersPage } from "./pages/LearnersPage";
import { SessionPage } from "./pages/SessionPage";
import { ReportPage } from "./pages/ReportPage";
import { SettingsPage } from "./pages/SettingsPage";

type Tab = "courses" | "students" | "session" | "reports" | "settings";
const TABS: Array<[Tab, string]> = [
  ["courses", "Courses"],
  ["students", "Students"],
  ["session", "Session"],
  ["reports", "Reports"],
  ["settings", "Settings"],
];

export function App() {
  const [tab, setTab] = useState<Tab>("session");
  const [courses, setCourses] = useState<Course[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [health, setHealth] = useState<Health | null>(null);
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    try {
      const [c, l, h] = await Promise.all([api.courses(), api.learners(), api.health()]);
      setCourses(c);
      setLearners(l);
      setHealth(h);
      setError(null);
    } catch (e) {
      setError(`Cannot reach the server: ${(e as Error).message}. Is \`npm run dev:server\` running on port 3001?`);
    }
  }, []);
  useEffect(() => {
    void refresh();
  }, [refresh]);

  return (
    <>
      <header>
        <h1>Homeschool AI</h1>
        <nav>
          {TABS.map(([t, label]) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {label}
              {t === "session" && session && session.phase !== "complete" ? <span className="dot" title="A session is open" /> : null}
            </button>
          ))}
        </nav>
        <span className="spacer" />
        {health && (
          <span className="muted small" title="Live tutor model. Change it in Settings.">
            tutor <code>{health.tutorModel}</code> @ {health.tutorEffort} · {health.tutorThinking} thinking · offline <code>{health.model}</code>
            {health.hume ? " · Hume configured" : " · text only"}
          </span>
        )}
      </header>
      <main>
        {error && <div className="card error">{error}</div>}
        {tab === "courses" && <CoursesPage courses={courses} onChange={refresh} />}
        {tab === "students" && <LearnersPage learners={learners} onChange={refresh} />}
        {tab === "session" && (
          <SessionPage
            courses={courses}
            learners={learners}
            health={health}
            session={session}
            onSession={setSession}
            onReport={(r) => {
              setReport(r);
              setTab("reports");
              void refresh();
            }}
          />
        )}
        {tab === "reports" && <ReportPage report={report} courses={courses} learners={learners} />}
        {tab === "settings" && <SettingsPage onChange={refresh} />}
      </main>
    </>
  );
}
