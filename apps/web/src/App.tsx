import { useEffect, useState } from "react";
import { api, type Course, type Learner, type Report, type Session } from "./api";
import { CoursesPage } from "./pages/CoursesPage";
import { LearnersPage } from "./pages/LearnersPage";
import { SessionPage } from "./pages/SessionPage";
import { ReportPage } from "./pages/ReportPage";

type Tab = "courses" | "learners" | "session" | "report";

export function App() {
  const [tab, setTab] = useState<Tab>("courses");
  const [courses, setCourses] = useState<Course[]>([]);
  const [learners, setLearners] = useState<Learner[]>([]);
  const [session, setSession] = useState<Session | null>(null);
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string | null>(null);

  const refresh = async () => {
    try {
      const [c, l] = await Promise.all([api.courses(), api.learners()]);
      setCourses(c);
      setLearners(l);
      setError(null);
    } catch (e) {
      setError(`Cannot reach the server: ${(e as Error).message}. Is \`npm run dev:server\` running?`);
    }
  };
  useEffect(() => {
    void refresh();
  }, []);

  return (
    <>
      <header>
        <h1>Homeschool AI</h1>
        <nav>
          {(["courses", "learners", "session", "report"] as Tab[]).map((t) => (
            <button key={t} className={tab === t ? "active" : ""} onClick={() => setTab(t)}>
              {t[0].toUpperCase() + t.slice(1)}
            </button>
          ))}
        </nav>
      </header>
      <main>
        {error && <div className="card error">{error}</div>}
        {tab === "courses" && <CoursesPage courses={courses} onChange={refresh} />}
        {tab === "learners" && <LearnersPage learners={learners} onChange={refresh} />}
        {tab === "session" && (
          <SessionPage
            courses={courses}
            learners={learners}
            session={session}
            onSession={setSession}
            onReport={(r) => {
              setReport(r);
              setTab("report");
              void refresh();
            }}
          />
        )}
        {tab === "report" && <ReportPage report={report} courses={courses} />}
      </main>
    </>
  );
}
