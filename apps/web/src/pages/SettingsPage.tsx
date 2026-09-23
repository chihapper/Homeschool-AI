import { useEffect, useState } from "react";
import { api, type Readiness, type RuntimeSettings, type SettingsView } from "../api";

/** Plain-language notes shown next to each setting. */
const HELP: Record<keyof RuntimeSettings, string> = {
  tutorModel: "The live tutor and the intake conversation. This is what the student talks to, so it sets time-to-first-token. Sonnet 5 is the recommended voice tier; Opus 5 is slower but stronger; Haiku 4.5 is fastest and runs without effort/thinking parameters.",
  tutorEffort: "How hard the tutor thinks before speaking. Lower = faster first word. The plan compares low and medium.",
  tutorThinking: "Adaptive lets the model decide whether to think; at low effort it rarely does. Disabled shaves a little more latency but Opus 5 has known failure modes with it (tool calls emitted as text).",
  model: "The offline agents: curriculum extraction at ingest, profile extraction after intake, and the assessor that writes the mastery report. Quality matters more than speed here.",
  analysisEffort: "Effort for those offline agents. High is the default; the assessor takes about two minutes at high on Opus.",
  reflectEffort: "The tutor takes its notes and decides whether to move on in a second pass that runs while the student is listening to the reply, so this costs the student no waiting. Raise it if the tutor's observations or phase changes look careless.",
  prewarmCache: "Write the tutor's prompt cache when a session starts, so the first turn is a cache hit instead of a cold write.",
  refusalFallbacks: "If the safety classifier refuses a turn, retry it on a fallback model automatically instead of showing the canned fallback line.",
  ttsVoice: "The tutor's voice, from Hume's Voice Library. Pick a warm, clear adult voice; the list is fetched live from your Hume account.",
  ttsVersion: "Octave 2 gets the first audio out in about 0.6 s; Octave 1 is slower but honours per-sentence acting notes (not used here yet).",
  ttsInstant: "Instant mode trades a little expressiveness for lower first-audio latency. Leave it on for the live tutor.",
  ttsBatchSentences: "Sentences the model has already written are sent to the voice together, so its pace and pitch carry across them instead of restarting at every sentence. The first sentence still goes alone so the reply starts fast. Turn off to hear the difference.",
  sttMinSilenceMs: "How long the student can pause mid-thought before the transcriber decides they are done, when it is confident the sentence is complete. Raise it if the tutor keeps cutting the student off.",
  sttMaxSilenceMs: "The longest pause before a turn ends no matter what. Lower it if the tutor feels slow to respond.",
};

const STAGE_LABEL = ["Build", "Stage 1 · text tutor", "Stage 2 · media", "Stage 3 · voice"];

export function SettingsPage({ onChange }: { onChange: () => Promise<void> }) {
  const [view, setView] = useState<SettingsView | null>(null);
  const [draft, setDraft] = useState<RuntimeSettings | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [readiness, setReadiness] = useState<Readiness | null>(null);
  const [checking, setChecking] = useState(false);
  const [voices, setVoices] = useState<Array<{ id: string; name: string }>>([]);
  const [voicesErr, setVoicesErr] = useState<string | null>(null);

  const load = async () => {
    const v = await api.settings();
    setView(v);
    setDraft({ ...v.effective });
  };
  useEffect(() => {
    void load().catch((e) => setMsg((e as Error).message));
    void check(false);
    api.voices().then(setVoices).catch((e) => setVoicesErr((e as Error).message));
  }, []);

  const check = async (ping: boolean) => {
    setChecking(true);
    try {
      setReadiness(await api.doctor(ping));
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setChecking(false);
    }
  };

  const save = async () => {
    if (!draft) return;
    setBusy(true);
    setMsg(null);
    try {
      const v = await api.saveSettings(draft);
      setView(v);
      setDraft({ ...v.effective });
      setMsg("Saved. Applies from the next turn; a model or effort change also means one prompt-cache write on that turn.");
      await onChange();
    } catch (e) {
      setMsg(`Not saved: ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  };

  const reset = async () => {
    setBusy(true);
    try {
      const v = await api.resetSettings();
      setView(v);
      setDraft({ ...v.effective });
      setMsg("Back to the values in .env.");
      await onChange();
    } finally {
      setBusy(false);
    }
  };

  if (!view || !draft) return <p className="muted">{msg ?? "Loading settings..."}</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.effective);
  const set = <K extends keyof RuntimeSettings>(k: K, v: RuntimeSettings[K]) => setDraft({ ...draft, [k]: v });
  const changed = (k: keyof RuntimeSettings) => view.overrides[k] !== undefined;

  const modelField = (k: "tutorModel" | "model") => (
    <label>
      {k === "tutorModel" ? "Tutor model" : "Offline model"} {changed(k) && <span className="pill">changed</span>}
      <input list="model-options" value={draft[k]} onChange={(e) => set(k, e.target.value)} />
      <span className="hint">.env: {view.defaults[k]}</span>
      <span className="hint">{HELP[k]}</span>
    </label>
  );
  const EFFORT_LABEL: Record<string, string> = { tutorEffort: "Tutor effort", analysisEffort: "Offline effort", reflectEffort: "Reflect effort" };
  const effortField = (k: "tutorEffort" | "analysisEffort" | "reflectEffort") => (
    <label>
      {EFFORT_LABEL[k]} {changed(k) && <span className="pill">changed</span>}
      <select value={draft[k]} onChange={(e) => set(k, e.target.value)}>
        {view.options.efforts.map((o) => <option key={o} value={o}>{o}</option>)}
      </select>
      <span className="hint">.env: {view.defaults[k]}</span>
      <span className="hint">{HELP[k]}</span>
    </label>
  );

  return (
    <>
      <div className="card">
        <h2>Model settings</h2>
        <p className="muted">Runtime overrides, saved to <code>data/settings.json</code>. They win over <code>.env</code> until you reset. Every agent reads them on each call, so no restart is needed.</p>
        <datalist id="model-options">{view.options.models.map((m) => <option key={m} value={m} />)}</datalist>
        <h3>Live tutor (latency-sensitive)</h3>
        <p className="muted small">A tutor turn is two calls. The <strong>speak</strong> call answers the student and never thinks or takes notes, so these settings decide how fast the first word arrives. The <strong>reflect</strong> call below records the observations and phase changes afterwards, while the student is listening.</p>
        <div className="grid3">
          {modelField("tutorModel")}
          {effortField("tutorEffort")}
          <label>
            Tutor thinking {changed("tutorThinking") && <span className="pill">changed</span>}
            <select value={draft.tutorThinking} onChange={(e) => set("tutorThinking", e.target.value as RuntimeSettings["tutorThinking"])}>
              {view.options.thinking.map((o) => <option key={o} value={o}>{o}</option>)}
            </select>
            <span className="hint">.env: {view.defaults.tutorThinking}</span>
            <span className="hint">{HELP.tutorThinking}</span>
          </label>
        </div>
        <h3>Reflect pass (notes and phase changes, off the student's clock)</h3>
        <div className="grid3">{effortField("reflectEffort")}</div>
        <h3>Offline agents (curriculum, profile, assessor)</h3>
        <div className="grid3">
          {modelField("model")}
          {effortField("analysisEffort")}
        </div>
        <h3>Caching and fallbacks</h3>
        <div className="grid3">
          <label className="check">
            <span><input type="checkbox" checked={draft.prewarmCache} onChange={(e) => set("prewarmCache", e.target.checked)} /> Pre-warm the prompt cache {changed("prewarmCache") && <span className="pill">changed</span>}</span>
            <span className="hint">{HELP.prewarmCache}</span>
          </label>
          <label className="check">
            <span><input type="checkbox" checked={draft.refusalFallbacks} onChange={(e) => set("refusalFallbacks", e.target.checked)} /> Refusal fallbacks {changed("refusalFallbacks") && <span className="pill">changed</span>}</span>
            <span className="hint">{HELP.refusalFallbacks}</span>
          </label>
        </div>
        <h3>Voice (browser mode: AssemblyAI in, Hume Octave out)</h3>
        <div className="grid3">
          <label>
            Tutor voice {changed("ttsVoice") && <span className="pill">changed</span>}
            {voices.length ? (
              <select value={voices.some((v) => v.name === draft.ttsVoice) ? draft.ttsVoice : "__custom"} onChange={(e) => { if (e.target.value !== "__custom") set("ttsVoice", e.target.value); }}>
                {!voices.some((v) => v.name === draft.ttsVoice) && <option value="__custom">{draft.ttsVoice} (custom)</option>}
                {voices.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
              </select>
            ) : (
              <input value={draft.ttsVoice} onChange={(e) => set("ttsVoice", e.target.value)} />
            )}
            <input value={draft.ttsVoice} onChange={(e) => set("ttsVoice", e.target.value)} placeholder="or type: Ava Song, HUME_AI:<name>, CUSTOM_VOICE:<id>" />
            <span className="hint">.env: {view.defaults.ttsVoice}{voicesErr ? ` · could not list voices: ${voicesErr}` : ""}</span>
            <span className="hint">{HELP.ttsVoice}</span>
          </label>
          <label>
            Octave version {changed("ttsVersion") && <span className="pill">changed</span>}
            <select value={draft.ttsVersion} onChange={(e) => set("ttsVersion", e.target.value as RuntimeSettings["ttsVersion"])}>
              <option value="2">2 (fastest)</option>
              <option value="1">1</option>
            </select>
            <span className="hint">.env: {view.defaults.ttsVersion}</span>
            <span className="hint">{HELP.ttsVersion}</span>
          </label>
          <label className="check">
            <span><input type="checkbox" checked={draft.ttsInstant} onChange={(e) => set("ttsInstant", e.target.checked)} /> Instant mode {changed("ttsInstant") && <span className="pill">changed</span>}</span>
            <span className="hint">{HELP.ttsInstant}</span>
          </label>
          <label className="check">
            <span><input type="checkbox" checked={draft.ttsBatchSentences} onChange={(e) => set("ttsBatchSentences", e.target.checked)} /> Batch sentences per voice request {changed("ttsBatchSentences") && <span className="pill">changed</span>}</span>
            <span className="hint">{HELP.ttsBatchSentences}</span>
          </label>
          <label>
            End of turn: short pause (ms) {changed("sttMinSilenceMs") && <span className="pill">changed</span>}
            <input type="number" min={100} max={5000} step={50} value={draft.sttMinSilenceMs} onChange={(e) => set("sttMinSilenceMs", Number(e.target.value))} />
            <span className="hint">.env: {view.defaults.sttMinSilenceMs}</span>
            <span className="hint">{HELP.sttMinSilenceMs}</span>
          </label>
          <label>
            End of turn: longest pause (ms) {changed("sttMaxSilenceMs") && <span className="pill">changed</span>}
            <input type="number" min={200} max={10000} step={50} value={draft.sttMaxSilenceMs} onChange={(e) => set("sttMaxSilenceMs", Number(e.target.value))} />
            <span className="hint">.env: {view.defaults.sttMaxSilenceMs}</span>
            <span className="hint">{HELP.sttMaxSilenceMs}</span>
          </label>
        </div>
        <div className="row" style={{ marginTop: 12 }}>
          <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
          <button className="ghost" disabled={busy || !Object.keys(view.overrides).length} onClick={reset}>Reset to .env defaults</button>
          {msg && <span className="muted">{msg}</span>}
        </div>
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Readiness</h2>
          <div className="row">
            <button className="ghost" disabled={checking} onClick={() => check(false)}>{checking ? "Checking..." : "Re-check"}</button>
            <button className="ghost" disabled={checking} onClick={() => check(true)} title="Makes one tiny API call with the tutor model and reports its response time">Re-check with API ping</button>
          </div>
        </div>
        <p className="muted">The same checks as <code>npm run doctor</code>. FAIL rows block a stage; WARN rows are optional features.</p>
        {readiness ? (
          <>
            <table className="table">
              <tbody>
                {readiness.rows.map((r, i) => (
                  <tr key={i}>
                    <td><span className={`status ${r.status}`}>{r.status.toUpperCase()}</span></td>
                    <td className="muted small">{STAGE_LABEL[r.stage]}</td>
                    <td>{r.item}{r.note && <div className="muted small">{r.note}</div>}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="muted small">{readiness.blocking} blocking, {readiness.optional} optional · checked {new Date(readiness.checkedAt).toLocaleTimeString()}</p>
          </>
        ) : (
          <p className="muted">Checking...</p>
        )}
      </div>
    </>
  );
}
