import { useCallback, useEffect, useRef, useState } from "react";
import { VoiceProvider, useVoice } from "@humeai/voice-react";
import { api, fmtDate, fmtMs, summarizeLatency, type Course, type Health, type Learner, type Report, type Session, type SessionSummary, type Turn } from "../api";
import { VoiceClient, type ReadyMessage, type VoiceState } from "../voice";

interface Props {
  courses: Course[];
  learners: Learner[];
  health: Health | null;
  session: Session | null;
  onSession: (s: Session | null) => void;
  onReport: (r: Report) => void;
}

type Mode = "voice" | "text" | "evi";

/** Marks the dialogue's open thread, named by the tutor's reflect pass (see orchestrator/notes.ts). */
const THREAD_PREFIX = "Open thread in this dialogue: ";

export function SessionPage(props: Props) {
  // Hume reports problems (an exhausted EVI balance, a bad config) as an error message and then closes the
  // socket. The library hands that to this callback and clears its message list on close, so the text is
  // captured here and passed down; otherwise the only sign in the UI is a status of "disconnected".
  const [humeError, setHumeError] = useState<string | null>(null);
  return (
    <VoiceProvider
      onError={(e) => setHumeError(e.message)}
      onClose={(ev) => {
        if (ev.reason) setHumeError((cur) => cur ?? ev.reason);
      }}
    >
      <SessionInner {...props} humeError={humeError} clearHumeError={() => setHumeError(null)} />
    </VoiceProvider>
  );
}

/** The per-turn line under each tutor reply: the same numbers `npm run chat` prints, plus voice timings. */
function TurnMeta({ turn }: { turn: Turn }) {
  const l = turn.latency;
  if (!l) return null;
  if (l.interrupted) return <div className="meta warn">interrupted by the student</div>;
  const total = l.cacheReadTokens + l.cacheWriteTokens + l.inputTokens;
  const hit = total ? Math.round((100 * l.cacheReadTokens) / total) : 0;
  return (
    <div className="meta">
      {typeof l.firstAudioMs === "number" && <span className="ok">first audio {fmtMs(l.firstAudioMs)} after the student stopped · </span>}
      ttft {fmtMs(l.ttftMs)} · total {fmtMs(l.totalMs)} · {l.iterations} round-trip{l.iterations === 1 ? "" : "s"} · cache {l.cacheReadTokens.toLocaleString()} read
      {l.cacheWriteTokens > 0 && <>, {l.cacheWriteTokens.toLocaleString()} written</>} / {total.toLocaleString()} ({hit}% hit) · {l.outputTokens} out
      {(l.suppressedChars ?? 0) > 0 && <span className="warn"> · {l.suppressedChars} chars dropped after tools</span>}
      {(l.thinkingChars ?? 0) > 0 && <span className="warn"> · thought {l.thinkingChars} chars before speaking</span>}
      {l.toolsBeforeSpeech && <span className="warn"> · bookkeeping before speech</span>}
      {typeof l.reflectMs === "number" && <span> · notes took {fmtMs(l.reflectMs)} while you listened</span>}
    </div>
  );
}

const TALK_LABEL: Record<VoiceState, string> = {
  connecting: "Connecting…",
  idle: "🎙 Talk",
  listening: "■ I'm done",
  thinking: "Thinking…",
  speaking: "🎙 Interrupt and talk",
};

function SessionInner({ courses, learners, health, session, onSession, onReport, humeError, clearHumeError }: Props & { humeError: string | null; clearHumeError: () => void }) {
  const voiceReady = Boolean(health?.voice.stt === "assemblyai" && health?.voice.tts === "hume");
  const [learnerId, setLearnerId] = useState("");
  const [courseId, setCourseId] = useState("");
  const [lessonId, setLessonId] = useState("");
  // Text is the default. It needs only an Anthropic key, so it always works; voice is a deliberate
  // choice from the dropdown, because a spent Hume balance only shows up as a failed reply mid-session.
  const [mode, setMode] = useState<Mode>("text");
  const [skipIntake, setSkipIntake] = useState(false);
  const [open, setOpen] = useState<SessionSummary[]>([]);
  const [resumeId, setResumeId] = useState("");
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** The turn in flight: the student's text (if any) and the tutor's reply as it streams. */
  const [pending, setPending] = useState<{ user?: string; assistant: string } | null>(null);
  const [draft, setDraft] = useState("");
  // browser voice
  const client = useRef<VoiceClient | null>(null);
  const [vstate, setVstate] = useState<VoiceState>("connecting");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [autoListen, setAutoListen] = useState(true);
  const autoListenRef = useRef(true);
  const [lastMarks, setLastMarks] = useState<Record<string, number> | null>(null);
  const [voiceInfo, setVoiceInfo] = useState<ReadyMessage | null>(null);
  // Hume EVI (alternative path). The hook's send functions are rebuilt on every render and check the
  // socket state captured at that render, so a copy held in a click handler from before the socket opened
  // silently drops messages. Always go through the latest copy, and queue the opening line until open.
  const evi = useVoice();
  const eviRef = useRef(evi);
  eviRef.current = evi;
  const [eviOpening, setEviOpening] = useState<string | null>(null);
  useEffect(() => {
    if (eviOpening && evi.readyState === "open") {
      evi.sendAssistantInput(eviOpening);
      setEviOpening(null);
    }
  }, [eviOpening, evi.readyState, evi]);
  // EVI latency, measured here since Hume runs the loop: from Hume's transcript of the student (its end of
  // turn) to the moment audio starts playing. Stored on the turn so the panel's p50 covers this path too.
  const eviTurnStart = useRef<number | null>(null);
  const eviSeen = useRef(0);
  const [eviMarks, setEviMarks] = useState<{ firstAudioMs: number } | null>(null);
  useEffect(() => {
    if (mode !== "evi") return;
    for (const m of evi.messages.slice(eviSeen.current)) {
      if (m.type === "user_message") eviTurnStart.current = m.receivedAt.getTime();
    }
    eviSeen.current = evi.messages.length;
  }, [evi.messages, mode]);
  useEffect(() => {
    if (mode !== "evi" || !evi.isPlaying || eviTurnStart.current === null || !session) return;
    const firstAudioMs = Date.now() - eviTurnStart.current;
    eviTurnStart.current = null;
    setEviMarks({ firstAudioMs });
    api.turnLatency(session.id, { firstAudioMs }).then(() => refreshSession(session.id)).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evi.isPlaying]);
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!learnerId && learners[0]) setLearnerId(learners[0].id);
    if (!courseId && courses[0]) setCourseId(courses[0].id);
  }, [learners, courses, learnerId, courseId]);
  useEffect(() => {
    autoListenRef.current = autoListen;
  }, [autoListen]);

  // Sessions that can be resumed (left without assessing, or a browser refresh).
  useEffect(() => {
    if (session) return;
    api.sessions().then((list) => setOpen(list.filter((s) => s.phase !== "complete"))).catch(() => setOpen([]));
  }, [session]);

  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [session?.transcript.length, pending?.assistant, partial]);
  useEffect(() => {
    if (!busy && mode === "text") input.current?.focus();
  }, [busy, mode]);

  // EVI mode: Hume owns the audio transcript; refresh our copy of the session so the state panel keeps up.
  useEffect(() => {
    if (mode !== "evi" || !session) return;
    api.session(session.id).then(onSession).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [evi.messages.length]);

  useEffect(() => () => client.current?.close(), []);

  const course = courses.find((c) => c.id === (session?.courseId ?? courseId));
  const learner = learners.find((l) => l.id === (session?.learnerId ?? learnerId));
  const lesson = course?.lessons.find((l) => l.id === (session?.lessonId ?? lessonId)) ?? course?.lessons[0];
  const conceptName = (id: string) => course?.concepts.find((c) => c.id === id)?.name ?? id;
  const currentConceptId = lesson?.conceptIds[session?.conceptIndex ?? 0];

  const refreshSession = useCallback(
    async (id: string) => {
      const s = await api.session(id);
      onSession(s);
      return s;
    },
    [onSession],
  );

  // ---- browser voice ---------------------------------------------------------
  const connectVoice = useCallback(
    async (sid: string) => {
      client.current?.close();
      const c = new VoiceClient(sid);
      client.current = c;
      setVstate("connecting");
      setPartial("");
      setLastMarks(null);
      let prev: VoiceState = "connecting";
      c.on("state", (s) => {
        setVstate(s);
        if (s !== "listening") setLevel(0);
        // The tutor finished speaking: listen for the reply unless the student turned that off.
        if (s === "idle" && prev === "speaking" && autoListenRef.current) void c.startMic();
        prev = s;
      });
      c.on("ready", (r) => setVoiceInfo(r));
      c.on("partial", (t) => setPartial(t));
      c.on("transcript", (t) => {
        setPartial("");
        setPending({ user: t, assistant: "" });
      });
      c.on("delta", (d) => setPending((p) => ({ user: p?.user, assistant: (p?.assistant ?? "") + d })));
      c.on("done", () => {
        refreshSession(sid)
          .catch((e) => setErr((e as Error).message))
          .finally(() => setPending(null));
      });
      c.on("latency", (m) => setLastMarks(m));
      c.on("level", (v) => setLevel(v));
      c.on("info", (m) => setInfo(m));
      c.on("error", (m) => setErr(m));
      c.on("closed", () => setVstate("connecting"));
      await c.connect();
    },
    [refreshSession],
  );

  const talk = async () => {
    const c = client.current;
    if (!c) return;
    setInfo(null);
    switch (c.state) {
      case "idle":
      case "speaking":
        await c.startMic();
        break;
      case "listening":
        c.forceEnd();
        break;
      case "thinking":
        c.interrupt();
        break;
      default:
        break;
    }
  };

  /**
   * Hume EVI only calls our tutor once the student has said something, and its canned greeting is off.
   * So the opening line comes from our orchestrator (recorded in the transcript as usual) and is handed
   * to EVI to speak.
   */
  const openWithEvi = async (sid: string) => {
    setPending({ assistant: "" });
    let text = "";
    try {
      const gen = api.message(sid, "");
      let r = await gen.next();
      while (!r.done) {
        text += r.value;
        setPending((p) => ({ user: p?.user, assistant: (p?.assistant ?? "") + r.value }));
        r = await gen.next();
      }
      if (text.trim()) setEviOpening(text.trim()); // sent by the effect above once the socket is open
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      await refreshSession(sid).catch(() => {});
      setPending(null);
    }
  };

  // ---- text mode ---------------------------------------------------------------
  const runTurn = async (sid: string, text: string) => {
    setBusy(true);
    setErr(null);
    setPending({ user: text || undefined, assistant: "" });
    try {
      // The reply streams first; the tutor's notes and phase change arrive a few seconds later and refresh
      // the state panel on their own, so the student is never blocked waiting for bookkeeping.
      const gen = api.message(sid, text, () => void refreshSession(sid).catch(() => {}));
      let r = await gen.next();
      while (!r.done) {
        const delta = r.value;
        setPending((p) => ({ user: p?.user, assistant: (p?.assistant ?? "") + delta }));
        r = await gen.next();
      }
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      await refreshSession(sid).catch((e) => setErr((e as Error).message));
      setPending(null);
      setBusy(false);
    }
  };

  const start = async () => {
    setErr(null);
    setInfo(null);
    clearHumeError();
    setBusy(true);
    try {
      const s = await api.createSession({ learnerId, courseId: courseId || undefined, lessonId: lessonId || undefined, skipIntake });
      onSession(s);
      if (mode === "voice") {
        await connectVoice(s.id);
        setBusy(false);
      } else if (mode === "evi") {
        const tok = await api.humeToken();
        if (!tok.configId) throw new Error("HUME_CONFIG_ID is not set on the server. Run `npm run setup:hume` first.");
        await evi.connect({
          auth: { type: "accessToken", value: tok.accessToken },
          configId: tok.configId,
          sessionSettings: {
            type: "session_settings",
            customSessionId: s.id,
            ...(tok.clmSecret ? { languageModelApiKey: tok.clmSecret } : {}),
          },
        });
        await openWithEvi(s.id);
        setBusy(false);
      } else {
        await runTurn(s.id, "");
      }
    } catch (e) {
      setErr((e as Error).message);
      setBusy(false);
    }
  };

  const resume = async () => {
    if (!resumeId) return;
    setErr(null);
    clearHumeError();
    try {
      const s = await refreshSession(resumeId);
      if (mode === "voice") await connectVoice(s.id);
      else if (mode === "evi") {
        const tok = await api.humeToken();
        if (!tok.configId) throw new Error("HUME_CONFIG_ID is not set on the server. Run `npm run setup:hume` first.");
        await evi.connect({
          auth: { type: "accessToken", value: tok.accessToken },
          configId: tok.configId,
          sessionSettings: { type: "session_settings", customSessionId: s.id, ...(tok.clmSecret ? { languageModelApiKey: tok.clmSecret } : {}) },
        });
        if (!s.transcript.length) await openWithEvi(s.id);
      } else {
        setMode("text");
        if (!s.transcript.length) await runTurn(s.id, "");
      }
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const discard = async () => {
    if (!resumeId || !confirm("Delete this unfinished session? It will not be assessed.")) return;
    await api.deleteSession(resumeId);
    setResumeId("");
    setOpen((o) => o.filter((s) => s.id !== resumeId));
  };

  const send = async () => {
    if (!session || !draft.trim() || busy) return;
    const text = draft.trim();
    setDraft("");
    if (mode === "voice") {
      client.current?.sendText(text);
      return;
    }
    if (mode === "evi") {
      eviRef.current.sendUserInput(text); // Hume treats it like speech: calls our tutor and speaks the reply
      return;
    }
    await runTurn(session.id, text);
  };

  const end = async () => {
    if (!session) return;
    setEnding(true);
    setErr(null);
    try {
      client.current?.close();
      client.current = null;
      if (mode === "evi") await eviRef.current.disconnect();
      const { report } = await api.endSession(session.id);
      onSession(null);
      if (report) onReport(report);
      else setErr("Session ended. No lesson was taught (intake only), so there is no mastery report.");
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEnding(false);
    }
  };

  const leave = async () => {
    client.current?.close();
    client.current = null;
    if (mode === "evi") await eviRef.current.disconnect().catch(() => {});
    onSession(null);
    setPending(null);
    setPartial("");
  };

  // ---------------------------------------------------------------------------
  if (!session) {
    return (
      <>
        <div className="card">
          <h2>Start a session</h2>
          {!learners.length && <p className="muted">Add a student first (Students tab).</p>}
          {!courses.length && <p className="muted">Ingest some material first (Courses tab).</p>}
          <div className="row">
            <label>Student<select value={learnerId} onChange={(e) => setLearnerId(e.target.value)}>{learners.map((l) => <option key={l.id} value={l.id}>{l.name}{l.profile ? "" : " (intake first)"}</option>)}</select></label>
            <label>Course<select value={courseId} onChange={(e) => { setCourseId(e.target.value); setLessonId(""); }}>{courses.map((c) => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
            <label>Lesson<select value={lessonId} onChange={(e) => setLessonId(e.target.value)}><option value="">First lesson</option>{course?.lessons.map((l) => <option key={l.id} value={l.id}>{l.title}</option>)}</select></label>
            <label>
              Mode
              <select value={mode} onChange={(e) => setMode(e.target.value as Mode)}>
                <option value="voice">{voiceReady ? "Voice: talk to the tutor" : "Voice (not configured)"}</option>
                <option value="text">Text</option>
                <option value="evi">Voice via Hume EVI (needs a public URL)</option>
              </select>
            </label>
            {learner && !learner.profile && (
              <label className="check"><span><input type="checkbox" checked={skipIntake} onChange={(e) => setSkipIntake(e.target.checked)} /> Skip intake</span><span className="hint">Go straight to the lesson with no profile.</span></label>
            )}
            <button className="primary" disabled={!learnerId || !courseId || busy || (mode === "voice" && !voiceReady)} onClick={start}>{busy ? "Starting..." : "Begin"}</button>
          </div>
          {mode === "voice" && !voiceReady && <p className="warn small">Browser voice needs ASSEMBLYAI_API_KEY (speech-to-text) and HUME_API_KEY (text-to-speech). See Settings › Readiness.</p>}
          {mode === "voice" && voiceReady && <p className="muted small">The tutor speaks first. Click Talk (or just wait for it to listen), speak, and pause when you are done. Speech-to-text: AssemblyAI · voice: {health?.voice.ttsVoice} (Hume Octave {health?.voice.ttsVersion}).</p>}
          {learner && !learner.profile && !skipIntake && <p className="muted">{learner.name} has no profile yet, so the session opens with a short intake conversation before the lesson. Reset a profile from the Students tab to run intake again.</p>}
          {health && <p className="muted small">Tutor: <code>{health.tutorModel}</code> @ {health.tutorEffort}, {health.tutorThinking} thinking. Change in Settings before starting.</p>}
          {err && <p className="error">{err}</p>}
        </div>
        {open.length > 0 && (
          <div className="card">
            <h3>Resume an unfinished session</h3>
            <div className="row">
              <select value={resumeId} onChange={(e) => setResumeId(e.target.value)} style={{ minWidth: 360 }}>
                <option value="">Choose...</option>
                {open.map((s) => (
                  <option key={s.id} value={s.id}>
                    {learners.find((l) => l.id === s.learnerId)?.name ?? s.learnerId} · {courses.find((c) => c.id === s.courseId)?.title ?? "intake only"} · {s.phase} · {s.turns} turns · {fmtDate(s.startedAt)}
                  </option>
                ))}
              </select>
              <button className="ghost" disabled={!resumeId} onClick={resume}>Resume ({mode === "voice" ? "voice" : "text"})</button>
              <button className="ghost" disabled={!resumeId} onClick={discard}>Delete</button>
            </div>
          </div>
        )}
      </>
    );
  }

  // ---------------------------------------------------------------------------
  const lat = summarizeLatency(session.transcript);
  // EVI mode: our transcript is the record; Hume's latest line is shown live until our copy catches up.
  const eviLast = [...evi.messages].reverse().find((m): m is Extract<typeof m, { type: "user_message" | "assistant_message" }> => m.type === "user_message" || m.type === "assistant_message");
  const eviLive = eviLast && !session.transcript.some((t) => t.content.includes((eviLast.message.content ?? "").slice(0, 40))) ? { role: eviLast.type === "user_message" ? ("user" as const) : ("assistant" as const), content: eviLast.message.content ?? "" } : null;
  const talkDisabled = vstate === "connecting" || ending;

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <span className="pill">{session.phase}</span>
            {lesson && currentConceptId && session.phase !== "intake" && (
              <span className="muted">Concept {session.conceptIndex + 1} of {lesson.conceptIds.length}: <strong>{conceptName(currentConceptId)}</strong></span>
            )}
            {mode === "evi" && <span className="pill">{evi.status.value}{evi.isPlaying ? " · speaking" : ""}</span>}
            {mode === "voice" && <span className={`pill vs-${vstate}`}>{vstate}</span>}
            <span className="muted">{learner?.name} · {course?.title}</span>
          </div>
          <div className="row">
            {mode === "evi" && evi.status.value === "connected" && (
              <button className="ghost" onClick={() => (evi.isMuted ? evi.unmute() : evi.mute())}>{evi.isMuted ? "Unmute" : "Mute"}</button>
            )}
            <button className="ghost" disabled={busy || ending} onClick={leave} title="Keep the session open on the server; resume it later from this tab">Leave for now</button>
            <button className="primary" disabled={busy || ending} onClick={end}>{ending ? "Assessing..." : "End session & assess"}</button>
          </div>
        </div>
        {ending && <p className="muted">The assessor is reading the whole transcript with <code>{health?.model}</code>. This takes one to three minutes at high effort.</p>}
        {evi.error && mode === "evi" && <p className="error">{evi.error.message}</p>}
        {mode === "evi" && humeError && <p className="error">Hume: {humeError}</p>}
        {mode === "evi" && evi.status.value === "disconnected" && !humeError && !evi.error && <p className="warn small">Hume closed the voice connection. Leave and begin again, or switch to the browser voice mode.</p>}
        {err && <p className="error">{err}</p>}
        {info && <p className="muted">{info}</p>}
      </div>

      <div className="split">
        <div className="card">
          <div className="transcript">
            {session.transcript.map((t, i) => (
              <div key={i} className={`turn-wrap ${t.role}`}>
                <div className={`turn ${t.role}`}>{t.content}</div>
                {t.role === "assistant" && <TurnMeta turn={t} />}
                {t.role === "user" && t.expressions?.length ? <div className="meta">voice: {t.expressions.join(" · ").toLowerCase()}</div> : null}
              </div>
            ))}
            {mode === "evi" && eviLive && !pending && <div className={`turn-wrap ${eviLive.role}`}><div className={`turn ${eviLive.role} live`}>{eviLive.content}</div></div>}
            {pending && (
              <>
                {pending.user && <div className="turn-wrap user"><div className="turn user">{pending.user}</div></div>}
                <div className="turn-wrap assistant"><div className="turn assistant">{pending.assistant || <span className="muted">thinking…</span>}</div></div>
              </>
            )}
            {mode === "voice" && vstate === "listening" && (
              <div className="turn-wrap user"><div className="turn user live">{partial || <span className="muted">listening…</span>}</div></div>
            )}
            <div ref={bottom} />
          </div>

          {mode === "voice" && (
            <div className="voicebar">
              <button className={`talk ${vstate}`} disabled={talkDisabled} onClick={talk}>{TALK_LABEL[vstate]}</button>
              {vstate === "listening" && <button className="ghost small" onClick={() => client.current?.stopMic()}>Cancel</button>}
              <div className="meter" title="Microphone level"><div className="meter-fill" style={{ width: `${Math.min(100, Math.round(level * 140))}%` }} /></div>
              <label className="check inline"><span><input type="checkbox" checked={autoListen} onChange={(e) => setAutoListen(e.target.checked)} /> Listen automatically after the tutor speaks</span></label>
            </div>
          )}
          {mode === "voice" && lastMarks && (
            <div className="meta">
              last turn: {typeof lastMarks.llm_first_token === "number" && <>first token {fmtMs(lastMarks.llm_first_token)} · </>}
              {typeof lastMarks.first_audio === "number" ? <>first audio <strong>{fmtMs(lastMarks.first_audio)}</strong> · </> : <>no audio · </>}
              done {fmtMs(lastMarks.turn_complete ?? 0)} after the student stopped talking
              {typeof lastMarks.tts_requests === "number" && <> · {lastMarks.tts_requests} voice request{lastMarks.tts_requests === 1 ? "" : "s"}</>}
            </div>
          )}
          <div className="composer">
            <input ref={input} value={draft} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === "Enter" && send()} placeholder={mode !== "text" ? "Or type instead..." : session.phase === "intake" ? "Answer as the student..." : "Answer the tutor..."} disabled={busy || ending || (mode === "evi" && evi.readyState !== "open")} />
            <button className="primary" onClick={send} disabled={busy || ending || !draft.trim() || (mode === "evi" && evi.readyState !== "open")}>Send</button>
          </div>
          {mode === "evi" && eviMarks && <div className="meta">last turn: first audio <strong>{fmtMs(eviMarks.firstAudioMs)}</strong> after Hume heard you finish</div>}
          {mode === "evi" && <p className="muted">Just talk. Hume listens and decides when you have finished ({"800 ms"} of silence); the tutor answers out loud. The words under each of your lines are the emotions Hume heard in your voice.{evi.isPlaying ? " Playing now: if you hear nothing, check the tab is not muted and the output device." : ""}</p>}
        </div>

        <aside className="card panel">
          <h4>Observations <span className="muted">({session.observations.length})</span></h4>
          {session.observations.length === 0 && <p className="muted small">None yet. The tutor records evidence with a tool call; the orchestrator needs two per concept before it will advance.</p>}
          <ul className="obs">
            {session.observations.map((o, i) => (
              <li key={i} className={o.conceptId === currentConceptId ? "" : "dim"}>
                <span className={`tag ${o.kind}`}>{o.kind}</span> <span className="quote">“{o.evidence}”</span>
                <div className="muted small">{o.note}</div>
                <div className="muted small">{conceptName(o.conceptId)}</div>
              </li>
            ))}
          </ul>
          {session.pendingDirectives.length > 0 && (
            <>
              <h4>Queued for the tutor's next turn</h4>
              <ul className="small">
                {session.pendingDirectives.map((d, i) =>
                  d.startsWith(THREAD_PREFIX) ? (
                    <li key={i} className="note"><strong>Open thread:</strong> {d.slice(THREAD_PREFIX.length).replace(/^[turn (d+)] /, "(turn $1) ")}</li>
                  ) : (
                    <li key={i}>{d}</li>
                  ),
                )}
              </ul>
            </>
          )}
          <h4>Latency</h4>
          <table className="kv">
            <tbody>
              <tr><td>tutor turns</td><td>{lat.turns}</td></tr>
              {typeof lat.firstAudioP50Ms === "number" && <tr><td>first audio p50</td><td>{fmtMs(lat.firstAudioP50Ms)}</td></tr>}
              <tr><td>TTFT p50</td><td>{fmtMs(lat.ttftP50Ms)}</td></tr>
              <tr><td>TTFT max</td><td>{fmtMs(lat.ttftMaxMs)}</td></tr>
              <tr><td>total p50</td><td>{fmtMs(lat.totalP50Ms)}</td></tr>
              <tr><td>cache hit rate</td><td>{Math.round(lat.cacheHitRate * 100)}%</td></tr>
            </tbody>
          </table>
          {health && <p className="muted small">Tutor <code>{health.tutorModel}</code> @ {health.tutorEffort} · {health.tutorThinking}</p>}
          {mode === "voice" && voiceInfo && <p className="muted small">Speech-to-text {voiceInfo.stt} · voice {voiceInfo.voice} · {voiceInfo.playbackSampleRate / 1000} kHz playback</p>}
          <details>
            <summary className="muted small">Raw session state</summary>
            <pre className="raw">{JSON.stringify({ ...session, transcript: `(${session.transcript.length} turns)` }, null, 2)}</pre>
          </details>
        </aside>
      </div>
    </>
  );
}
