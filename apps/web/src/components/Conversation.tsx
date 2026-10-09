import { useCallback, useEffect, useRef, useState } from "react";
import { api, fmtMs, fmtUsd, PROVIDER_NAME, summarizeLatency, type Course, type Health, type Learner, type Report, type Session, type SessionCost, type Turn } from "../api";
import type { ReadyMessage, VoiceClient, VoiceState } from "../voice";

/** How the person at the screen talks to the tutor. Text needs only an Anthropic key; voice needs the keys named in Settings. */
export type Mode = "voice" | "text";

export interface ConversationProps {
  /** The session on screen. After an intake's hand-over it is the session that took over. */
  session: Session;
  /** The voice connection for this session, created by the page inside a click (VoiceClient.prepare); null means text. */
  voice: VoiceClient | null;
  courses: Course[];
  learners: Learner[];
  health: Health | null;
  /** Every fresh copy of the session: after a reply, a hand-over, the tutor's notes. */
  onSession: (s: Session) => void;
  /** End was pressed and the server closed the session: a lesson comes back with its report, an intake without one. */
  onEnded: (r: { session: Session; report?: Report }) => void;
  /** Leave for now, or Close once finished: the page takes the conversation down. An unfinished session can be resumed. */
  onLeave: () => void;
  /** "intake": one intake on its own (the Students tab): no observation panel, and the buttons say so. */
  variant?: "lesson" | "intake";
}

/** Marks the dialogue's open thread, named by the tutor's reflect pass (see orchestrator/notes.ts). */
const THREAD_PREFIX = "Open thread in this dialogue: ";

const TALK_LABEL: Record<VoiceState, string> = {
  connecting: "Connecting…",
  idle: "🎙 Talk",
  listening: "■ I'm done",
  thinking: "Thinking…",
  speaking: "🎙 Interrupt and talk",
};

/** What to tell the person at the screen when an intake hands over, by what the sitting went on to. */
const HANDOVER_NOTE: Record<string, string> = {
  "course-intake": "The intake conversation is finished and the profile is being written. Next: a few questions about what they already know about the course.",
  lesson: "The questions are done and the answers are being written down. The lesson has started.",
};

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

/**
 * A live conversation with the tutor: the transcript, the microphone bar in voice mode, the composer, and (for a
 * lesson) the panel of observations and timings. The page owns the session and the voice connection; this
 * component runs the turns and follows an intake's hand-over to the session that took over.
 */
export function Conversation({ session, voice, courses, learners, health, onSession, onEnded, onLeave, variant = "lesson" }: ConversationProps) {
  const mode: Mode = voice ? "voice" : "text";
  const [busy, setBusy] = useState(false);
  const [ending, setEnding] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);
  /** The turn in flight: the student's words (if any) and the tutor's reply as it streams. */
  const [pending, setPending] = useState<{ user?: string; assistant: string } | null>(null);
  const [draft, setDraft] = useState("");
  const [vstate, setVstate] = useState<VoiceState>(voice?.state ?? "connecting");
  const [partial, setPartial] = useState("");
  const [level, setLevel] = useState(0);
  const [autoListen, setAutoListen] = useState(true);
  const autoListenRef = useRef(true);
  const [lastMarks, setLastMarks] = useState<Record<string, number> | null>(null);
  const [voiceInfo, setVoiceInfo] = useState<ReadyMessage | null>(voice?.ready ?? null);
  /** The parent's clock ran out and the tutor gave its closing reply: the session ends once the words are out. */
  const [timeUp, setTimeUp] = useState(false);
  /** The meter's running total for this session, refreshed after every turn. */
  const [cost, setCost] = useState<SessionCost | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const bottom = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  // The page may pass a new callback on every render; the voice handlers are attached once and read the latest.
  const onSessionRef = useRef(onSession);
  onSessionRef.current = onSession;

  const finished = session.phase === "complete";
  const inIntake = session.phase === "intake";
  const course = courses.find((c) => c.id === session.courseId);
  const learner = learners.find((l) => l.id === session.learnerId);
  const lesson = course?.lessons.find((l) => l.id === session.lessonId);
  const conceptName = (id: string): string => course?.concepts.find((c) => c.id === id)?.name ?? id;
  // A running session walks its own frozen list, which may be shorter than the lesson's.
  const walk = session.conceptIds ?? lesson?.conceptIds ?? [];
  const currentConceptId = walk[session.conceptIndex];

  useEffect(() => {
    autoListenRef.current = autoListen;
  }, [autoListen]);
  useEffect(() => {
    bottom.current?.scrollIntoView({ behavior: "smooth" });
  }, [session.transcript.length, pending?.assistant, partial]);
  useEffect(() => {
    if (!busy && mode === "text" && !finished) input.current?.focus();
  }, [busy, mode, finished]);

  useEffect(() => {
    if (variant !== "lesson") return;
    api.sessionCost(session.id).then(setCost).catch(() => {});
  }, [session.id, session.transcript.length, variant]);

  // The clock on screen, one tick a second while the session runs on a limit.
  useEffect(() => {
    if (!session.limitMinutes || finished) return;
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [session.limitMinutes, finished]);
  const secondsLeft = session.limitMinutes ? Math.max(0, Math.round(session.limitMinutes * 60 - (now - new Date(session.startedAt).getTime()) / 1000)) : undefined;
  const clockLabel = secondsLeft === undefined ? null : `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, "0")} left`;

  const refreshSession = useCallback(async (id: string): Promise<Session> => {
    const s = await api.session(id);
    onSessionRef.current(s);
    return s;
  }, []);

  // ---- voice: listen to the connection the page created, and open it (once) ----------------------------
  useEffect(() => {
    if (!voice) return;
    let prev: VoiceState = voice.state;
    // After an intake's hand-over the connection speaks for the session that took over; the panel follows it.
    let active = voice.sessionId;
    const offs = [
      voice.on("state", (s) => {
        setVstate(s);
        if (s !== "listening") setLevel(0);
        // The tutor finished speaking: listen for the reply unless the student turned that off.
        if (s === "idle" && prev === "speaking" && autoListenRef.current) void voice.startMic();
        prev = s;
      }),
      voice.on("ready", (r) => setVoiceInfo(r)),
      voice.on("partial", (t) => setPartial(t)),
      voice.on("transcript", (t) => {
        setPartial("");
        setPending({ user: t, assistant: "" });
      }),
      voice.on("delta", (d) => setPending((p) => ({ user: p?.user, assistant: (p?.assistant ?? "") + d }))),
      voice.on("session", (s) => {
        if (!s.sessionId) return;
        active = s.sessionId;
        setInfo(HANDOVER_NOTE[s.kind] ?? null);
      }),
      voice.on("done", (m) => {
        if (m.sessionId) active = m.sessionId;
        if (m.timeUp) setTimeUp(true);
        refreshSession(active)
          .catch((e) => setErr((e as Error).message))
          .finally(() => setPending(null));
      }),
      voice.on("latency", (m) => setLastMarks(m)),
      voice.on("level", (v) => setLevel(v)),
      voice.on("info", (m) => setInfo(m)),
      voice.on("error", (m) => setErr(m)),
      voice.on("closed", () => setVstate("connecting")),
    ];
    setVstate(voice.state);
    setPartial("");
    // The server speaks first on a fresh session the moment the socket opens.
    voice.connect().catch((e) => setErr((e as Error).message));
    return () => offs.forEach((off) => off());
  }, [voice, refreshSession]);

  const talk = async () => {
    if (!voice) return;
    setInfo(null);
    switch (voice.state) {
      case "idle":
      case "speaking":
        await voice.startMic();
        break;
      case "listening":
        voice.forceEnd();
        break;
      case "thinking":
        voice.interrupt();
        break;
      default:
        break;
    }
  };

  // ---- text mode ---------------------------------------------------------------------------------------
  const runTurn = async (sid: string, text: string) => {
    setBusy(true);
    setErr(null);
    setPending({ user: text || undefined, assistant: "" });
    try {
      // The reply streams first; the tutor's notes and phase change arrive a few seconds later and refresh
      // the panel on their own, so the student is never blocked waiting for bookkeeping.
      const gen = api.message(sid, text, (id) => void refreshSession(id).catch(() => {}));
      let r = await gen.next();
      while (!r.done) {
        const delta = r.value;
        setPending((p) => ({ user: p?.user, assistant: (p?.assistant ?? "") + delta }));
        r = await gen.next();
      }
      // An intake finished in this reply and the sitting went straight on: show the session that took over.
      if (r.value.handover) setInfo(HANDOVER_NOTE[r.value.handover.kind] ?? null);
      if (r.value.timeUp) setTimeUp(true);
      sid = r.value.sessionId;
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      await refreshSession(sid).catch((e) => setErr((e as Error).message));
      setPending(null);
      setBusy(false);
    }
  };

  // The tutor speaks first on a fresh session. Deferred a tick: React mounts a component twice in development,
  // and the first run is cancelled here before it asks the server anything.
  const openedFor = useRef<string | null>(null);
  useEffect(() => {
    if (mode !== "text" || finished || session.transcript.length || openedFor.current === session.id) return;
    const t = setTimeout(() => {
      openedFor.current = session.id;
      void runTurn(session.id, "");
    }, 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.id, mode]);

  const send = async () => {
    if (!draft.trim() || busy || finished) return;
    const text = draft.trim();
    setDraft("");
    if (voice) {
      voice.sendText(text);
      return;
    }
    await runTurn(session.id, text);
  };

  const end = async () => {
    if (variant === "intake" && !confirm(`Stop ${learner?.name ?? "the student"}'s intake here? Nothing is written from an unfinished intake; it can be started again later.`)) return;
    setEnding(true);
    setErr(null);
    try {
      onEnded(await api.endSession(session.id));
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setEnding(false);
    }
  };

  const leave = () => {
    setPending(null);
    setPartial("");
    onLeave();
  };

  // Time is up: the tutor has said goodbye. In text the session ends at once; in voice, once the goodbye has been heard.
  const endedByClock = useRef(false);
  useEffect(() => {
    if (!timeUp || endedByClock.current || variant !== "lesson") return;
    if (mode === "voice" && vstate !== "idle") return;
    endedByClock.current = true;
    setInfo("Time is up. The tutor has closed the session; the report is on its way.");
    void end();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [timeUp, vstate, mode]);

  // ---------------------------------------------------------------------------------------------------------
  const lat = summarizeLatency(session.transcript);
  const talkDisabled = vstate === "connecting" || ending;
  const phaseLabel = inIntake ? (session.kind === "course-intake" ? "course intake" : "intake") : finished ? "finished" : session.phase;
  const endLabel = variant === "lesson" ? (ending ? "Assessing..." : "End session & assess") : ending ? "Closing..." : "Stop here";

  const main = (
    <div className="card">
      <div className="transcript">
        {session.transcript.map((t, i) => (
          <div key={i} className={`turn-wrap ${t.role}`}>
            <div className={`turn ${t.role}`}>{t.content}</div>
            {t.role === "assistant" && <TurnMeta turn={t} />}
          </div>
        ))}
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

      {mode === "voice" && !finished && (
        <div className="voicebar">
          <button className={`talk ${vstate}`} disabled={talkDisabled} onClick={talk}>{TALK_LABEL[vstate]}</button>
          {vstate === "listening" && <button className="ghost small" onClick={() => voice?.stopMic()}>Cancel</button>}
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
      {!finished && (
        <div className="composer">
          <input
            ref={input}
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && send()}
            placeholder={mode === "voice" ? "Or type instead..." : inIntake ? "Answer as the student..." : "Answer the tutor..."}
          />
          <button className="primary" onClick={send} disabled={busy || ending || !draft.trim()}>Send</button>
        </div>
      )}
      {finished && <p className="muted small">This conversation is finished.</p>}
    </div>
  );

  return (
    <>
      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <div className="row">
            <span className="pill">{phaseLabel}</span>
            {session.continuedFrom && session.transcript.length <= 2 && <span className="muted small">carried straight on from the part before</span>}
            {lesson && currentConceptId && !inIntake && !finished && (
              <span className="muted">Concept {session.conceptIndex + 1} of {walk.length}{walk.length < lesson.conceptIds.length ? ` kept (of ${lesson.conceptIds.length})` : ""}: <strong>{conceptName(currentConceptId)}</strong></span>
            )}
            {mode === "voice" && !finished && <span className={`pill vs-${vstate}`}>{vstate}</span>}
            {clockLabel && !finished && <span className={`pill${timeUp ? " vs-listening" : secondsLeft !== undefined && secondsLeft <= 120 ? " vs-thinking" : ""}`} title="The session length set in Settings">{timeUp ? "time is up" : clockLabel}</span>}
            <span className="muted">{learner?.name}{course ? ` · ${course.title}` : ""}</span>
          </div>
          <div className="row">
            {finished ? (
              <button className="primary" onClick={leave}>Close</button>
            ) : (
              <>
                <button className="ghost" disabled={busy || ending} onClick={leave} title="Keep the session open on the server; resume it later from the Lesson tab">Leave for now</button>
                <button className="primary" disabled={busy || ending} onClick={end}>{endLabel}</button>
              </>
            )}
          </div>
        </div>
        {ending && variant === "lesson" && <p className="muted">The assessor is reading the whole transcript{health?.model ? <> with <code>{health.model}</code></> : null}. This takes one to three minutes at high effort.</p>}
        {err && <p className="error">{err}</p>}
        {info && <p className="muted">{info}</p>}
      </div>

      {variant === "intake" ? (
        main
      ) : (
        <div className="split">
          {main}
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
                      <li key={i} className="note"><strong>Open thread:</strong> {d.slice(THREAD_PREFIX.length).replace(/^\[turn (\d+)\] /, "(turn $1) ")}</li>
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
            {cost && (
              <p className="muted small" title="List prices for the model and voice calls this session has made so far (docs/COST.md)">
                Cost so far about <strong>{fmtUsd(cost.total)}</strong>: tutor {fmtUsd(cost.speak)}, notes {fmtUsd(cost.reflect)}{cost.voice ? `, voice ${fmtUsd(cost.voice)}` : ""}{cost.checks ? `, checks ${fmtUsd(cost.checks)}` : ""}
                {cost.unpriced.length ? ` (no price on file for ${cost.unpriced.join(", ")})` : ""}
              </p>
            )}
            {health && <p className="muted small">Tutor <code>{health.tutorModel}</code> @ {health.tutorEffort} · {health.tutorThinking}</p>}
            {mode === "voice" && voiceInfo && (
              <p className="muted small">
                Speech-to-text {voiceInfo.stt} · voice {voiceInfo.voice}{voiceInfo.tts !== "none" ? ` (${PROVIDER_NAME[voiceInfo.tts]}${voiceInfo.ttsModel ? ` ${voiceInfo.ttsModel}` : ""})` : " (text only)"}
              </p>
            )}
            <details>
              <summary className="muted small">Raw session state</summary>
              <pre className="raw">{JSON.stringify({ ...session, transcript: `(${session.transcript.length} turns)` }, null, 2)}</pre>
            </details>
          </aside>
        </div>
      )}
    </>
  );
}
