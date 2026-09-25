import { useEffect, useRef, useState } from "react";
import { api, PROVIDER_NAME, type Readiness, type RuntimeSettings, type SettingsView, type TtsProvider, type VoiceModelOption, type VoiceOption, type VoicePreview } from "../api";

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
  ttsProvider: "Who voices the tutor in browser voice mode. A switch applies from the next reply, even in a session already running: every provider delivers the same audio format.",
  ttsVoice: "The tutor's voice, from Hume's Voice Library. Pick a warm, clear adult voice; the list is fetched live from your Hume account.",
  ttsVersion: "Octave 2 gets the first audio out in about 0.6 s; Octave 1 is slower but honours per-sentence acting notes (not used here yet).",
  ttsInstant: "Instant mode trades a little expressiveness for lower first-audio latency. Leave it on for the live tutor.",
  ttsBatchSentences: "Sentences the model has already written are sent to the voice together, so its pace and pitch carry across them instead of restarting at every sentence. The first sentence still goes alone so the reply starts fast. Turn off to hear the difference.",
  elevenVoiceId: "Every voice on your ElevenLabs account: premade, cloned, designed, and any saved from the Voice Library. The play button next to the list plays ElevenLabs' own sample of the voice, which costs no credits.",
  elevenVoiceName: "",
  elevenModel: "Flash v2.5 is the fastest (about 75 ms before audio starts) but reads numbers digit by digit. v3 Conversational is more expressive at about 280 ms and costs the same credits. Multilingual v2 is richer, slower, and costs double.",
  elevenStability: "Lower gives a livelier, more varied read; higher a steadier, flatter one. 0.5 is ElevenLabs' default.",
  elevenSpeed: "Speaking rate. 1 is the voice's natural pace; the range ElevenLabs allows is 0.7 to 1.2.",
  inworldVoiceId: "Inworld's English voices plus any your workspace has cloned or designed. The play button plays Inworld's own sample of the voice, which is free.",
  inworldVoiceName: "",
  inworldModel: "TTS-2 is the most natural and ranks highest with listeners; TTS-2 Flash starts faster and costs less. Either way a reply is voiced as one stream, so the voice does not reset between sentences.",
  inworldSpeed: "Speaking rate. 1 is the voice's natural pace.",
  inworldPauseMs: "A pause added at punctuation, on top of the voice's own, set here for a full stop. Punctuation scales it: about 0.6 of this after a comma, colon or semicolon, the same after a dash or a trailing ellipsis mid-sentence, 1.3 after a question or exclamation, and about twice this at a paragraph break. 0 leaves the voice's own pacing alone. Test this voice plays it.",
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
  // The voice list follows the provider shown in the toggle, saved or not.
  const [voices, setVoices] = useState<{ provider: TtsProvider; list: VoiceOption[]; error?: string } | null>(null);
  const [models, setModels] = useState<Partial<Record<TtsProvider, { list: VoiceModelOption[]; source: string; error?: string }>>>({});
  const [preview, setPreview] = useState<VoicePreview | null>(null);
  const [previewBusy, setPreviewBusy] = useState(false);
  const [previewErr, setPreviewErr] = useState<string | null>(null);
  const player = useRef<HTMLAudioElement | null>(null);

  const load = async () => {
    const v = await api.settings();
    setView(v);
    setDraft({ ...v.effective });
  };
  useEffect(() => {
    void load().catch((e) => setMsg((e as Error).message));
    void check(false);
  }, []);

  const provider = draft?.ttsProvider;
  useEffect(() => {
    if (!provider) return;
    let live = true;
    setVoices(null);
    api
      .voices(provider)
      .then((list) => live && setVoices({ provider, list }))
      .catch((e) => live && setVoices({ provider, list: [], error: (e as Error).message }));
    if (provider !== "hume" && !models[provider]) {
      api
        .voiceModels(provider)
        .then((m) => live && setModels((all) => ({ ...all, [provider]: { list: m.models, source: m.source, error: m.error } })))
        .catch((e) => live && setModels((all) => ({ ...all, [provider]: { list: [], source: "none", error: (e as Error).message } })));
    }
    return () => {
      live = false;
    };
  }, [provider]);

  // A new sample replaces the old one; free the old clip's memory.
  useEffect(() => () => {
    if (preview) URL.revokeObjectURL(preview.url);
  }, [preview]);

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

  const testVoice = async () => {
    if (!draft) return;
    setPreviewBusy(true);
    setPreviewErr(null);
    try {
      const p = await api.previewVoice(draft);
      setPreview(p);
      // The element renders with the new clip on the next paint; play it as soon as it exists.
      requestAnimationFrame(() => void player.current?.play().catch(() => {}));
    } catch (e) {
      setPreviewErr((e as Error).message);
    } finally {
      setPreviewBusy(false);
    }
  };

  if (!view || !draft) return <p className="muted">{msg ?? "Loading settings..."}</p>;
  const dirty = JSON.stringify(draft) !== JSON.stringify(view.effective);
  const set = <K extends keyof RuntimeSettings>(k: K, v: RuntimeSettings[K]) => setDraft({ ...draft, [k]: v });
  const changed = (k: keyof RuntimeSettings) => view.overrides[k] !== undefined;
  const providers = view.options.ttsProviders;
  const selected = providers.find((p) => p.id === draft.ttsProvider) ?? providers[0];
  const voiceList = voices?.provider === draft.ttsProvider ? voices : null;

  const saveBar = (
    <div className="row" style={{ marginTop: 12 }}>
      <button className="primary" disabled={!dirty || busy} onClick={save}>{busy ? "Saving..." : "Save"}</button>
      <button className="ghost" disabled={busy || !Object.keys(view.overrides).length} onClick={reset}>Reset to .env defaults</button>
      {dirty && <span className="warn small">Unsaved changes</span>}
      {msg && <span className="muted">{msg}</span>}
    </div>
  );

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

  // ---- Hume fields -------------------------------------------------------------
  const humeFields = (
    <div className="grid3">
      <label>
        Tutor voice {changed("ttsVoice") && <span className="pill">changed</span>}
        {voiceList?.list.length ? (
          <select value={voiceList.list.some((v) => v.name === draft.ttsVoice) ? draft.ttsVoice : "__custom"} onChange={(e) => { if (e.target.value !== "__custom") set("ttsVoice", e.target.value); }}>
            {!voiceList.list.some((v) => v.name === draft.ttsVoice) && <option value="__custom">{draft.ttsVoice} (custom)</option>}
            {voiceList.list.map((v) => <option key={v.id} value={v.name}>{v.name}</option>)}
          </select>
        ) : null}
        <input value={draft.ttsVoice} onChange={(e) => set("ttsVoice", e.target.value)} placeholder="or type: Ava Song, HUME_AI:<name>, CUSTOM_VOICE:<id>" />
        <span className="hint">.env: {view.defaults.ttsVoice}{!voiceList ? " · loading voices..." : voiceList.error ? ` · could not list voices: ${voiceList.error}` : ""}</span>
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
    </div>
  );

  // ---- ElevenLabs fields -------------------------------------------------------
  const currentVoice = voiceList?.list.find((v) => v.id === draft.elevenVoiceId);
  const elevenModels = models.elevenlabs;
  const modelList = elevenModels?.list ?? [];
  const currentModel = modelList.find((m) => m.id === draft.elevenModel);
  const playSample = (url?: string) => {
    if (url) void new Audio(url).play().catch(() => {});
  };
  const elevenFields = (
    <div className="grid3">
      <label>
        Tutor voice {(changed("elevenVoiceId") || changed("elevenVoiceName")) && <span className="pill">changed</span>}
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <select
            style={{ flex: 1, minWidth: 0 }}
            value={draft.elevenVoiceId}
            disabled={!voiceList?.list.length}
            onChange={(e) => {
              const v = voiceList?.list.find((x) => x.id === e.target.value);
              setDraft({ ...draft, elevenVoiceId: e.target.value, elevenVoiceName: v?.name ?? "" });
            }}
          >
            {!currentVoice && <option value={draft.elevenVoiceId}>{draft.elevenVoiceName || draft.elevenVoiceId}{voiceList?.list.length ? " (not in your account's list)" : ""}</option>}
            {voiceList?.list.map((v) => <option key={v.id} value={v.id}>{v.name}{v.description ? ` · ${v.description}` : ""}</option>)}
          </select>
          <button type="button" className="ghost small" disabled={!currentVoice?.previewUrl} onClick={() => playSample(currentVoice?.previewUrl)} title="Play ElevenLabs' sample of this voice (no credits)">▶ sample</button>
        </span>
        <input value={draft.elevenVoiceId} onChange={(e) => setDraft({ ...draft, elevenVoiceId: e.target.value.trim(), elevenVoiceName: voiceList?.list.find((x) => x.id === e.target.value.trim())?.name ?? "" })} placeholder="or paste a voice id" />
        <span className="hint">
          .env: {view.defaults.elevenVoiceName || view.defaults.elevenVoiceId}
          {!voiceList ? " · loading voices..." : voiceList.error ? ` · could not list voices: ${voiceList.error}` : ` · ${voiceList.list.length} voices on your account`}
        </span>
        <span className="hint">{HELP.elevenVoiceId}</span>
      </label>
      <label>
        Model {changed("elevenModel") && <span className="pill">changed</span>}
        <select value={draft.elevenModel} onChange={(e) => set("elevenModel", e.target.value)}>
          {!currentModel && <option value={draft.elevenModel}>{draft.elevenModel}</option>}
          {modelList.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {currentModel?.note && <span className="hint"><strong>{currentModel.id}</strong>: {currentModel.note}</span>}
        <span className="hint">.env: {view.defaults.elevenModel}{elevenModels?.source === "built-in" ? " · showing the documented real-time models until your account can be asked" : ""}</span>
        <span className="hint">{HELP.elevenModel}</span>
      </label>
      <label>
        Stability: {draft.elevenStability.toFixed(2)} {changed("elevenStability") && <span className="pill">changed</span>}
        <input type="range" min={0} max={1} step={0.05} value={draft.elevenStability} onChange={(e) => set("elevenStability", Number(e.target.value))} />
        <span className="hint">.env: {view.defaults.elevenStability}</span>
        <span className="hint">{HELP.elevenStability}</span>
      </label>
      <label>
        Speed: {draft.elevenSpeed.toFixed(2)}× {changed("elevenSpeed") && <span className="pill">changed</span>}
        <input type="range" min={0.7} max={1.2} step={0.05} value={draft.elevenSpeed} onChange={(e) => set("elevenSpeed", Number(e.target.value))} />
        <span className="hint">.env: {view.defaults.elevenSpeed}</span>
        <span className="hint">{HELP.elevenSpeed}</span>
      </label>
    </div>
  );

  // ---- Inworld fields ----------------------------------------------------------
  const currentInworldVoice = voiceList?.list.find((v) => v.id === draft.inworldVoiceId);
  const inworldModels = models.inworld?.list ?? [];
  const currentInworldModel = inworldModels.find((m) => m.id === draft.inworldModel);
  const inworldFields = (
    <div className="grid3">
      <label>
        Tutor voice {(changed("inworldVoiceId") || changed("inworldVoiceName")) && <span className="pill">changed</span>}
        <span className="row" style={{ gap: 6, flexWrap: "nowrap" }}>
          <select
            style={{ flex: 1, minWidth: 0 }}
            value={draft.inworldVoiceId}
            disabled={!voiceList?.list.length}
            onChange={(e) => {
              const v = voiceList?.list.find((x) => x.id === e.target.value);
              setDraft({ ...draft, inworldVoiceId: e.target.value, inworldVoiceName: v?.name ?? "" });
            }}
          >
            {!currentInworldVoice && <option value={draft.inworldVoiceId}>{draft.inworldVoiceName || draft.inworldVoiceId}{voiceList?.list.length ? " (not in your workspace's list)" : ""}</option>}
            {voiceList?.list.map((v) => <option key={v.id} value={v.id}>{v.name}{v.description ? ` · ${v.description}` : ""}</option>)}
          </select>
          <button type="button" className="ghost small" disabled={!currentInworldVoice?.previewUrl} onClick={() => playSample(currentInworldVoice?.previewUrl ? `${currentInworldVoice.previewUrl}&model=${encodeURIComponent(draft.inworldModel)}` : undefined)} title="Play Inworld's sample of this voice (free)">▶ sample</button>
        </span>
        <input value={draft.inworldVoiceId} onChange={(e) => setDraft({ ...draft, inworldVoiceId: e.target.value.trim(), inworldVoiceName: voiceList?.list.find((x) => x.id === e.target.value.trim())?.name ?? "" })} placeholder="or paste a voice id" />
        <span className="hint">
          .env: {view.defaults.inworldVoiceName || view.defaults.inworldVoiceId}
          {!voiceList ? " · loading voices..." : voiceList.error ? ` · could not list voices: ${voiceList.error}` : ` · ${voiceList.list.length} English voices`}
        </span>
        <span className="hint">{HELP.inworldVoiceId}</span>
      </label>
      <label>
        Model {changed("inworldModel") && <span className="pill">changed</span>}
        <select value={draft.inworldModel} onChange={(e) => set("inworldModel", e.target.value)}>
          {!currentInworldModel && <option value={draft.inworldModel}>{draft.inworldModel}</option>}
          {inworldModels.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
        </select>
        {currentInworldModel?.note && <span className="hint"><strong>{currentInworldModel.id}</strong>: {currentInworldModel.note}</span>}
        <span className="hint">.env: {view.defaults.inworldModel}</span>
        <span className="hint">{HELP.inworldModel}</span>
      </label>
      <label>
        Speed: {draft.inworldSpeed.toFixed(2)}× {changed("inworldSpeed") && <span className="pill">changed</span>}
        <input type="range" min={0.7} max={1.3} step={0.05} value={draft.inworldSpeed} onChange={(e) => set("inworldSpeed", Number(e.target.value))} />
        <span className="hint">.env: {view.defaults.inworldSpeed}</span>
        <span className="hint">{HELP.inworldSpeed}</span>
      </label>
      <label>
        Pause after a sentence: {(draft.inworldPauseMs / 1000).toFixed(2)} s {changed("inworldPauseMs") && <span className="pill">changed</span>}
        <input type="range" min={0} max={1000} step={20} value={draft.inworldPauseMs} onChange={(e) => set("inworldPauseMs", Number(e.target.value))} />
        <span className="hint">
          .env: {(view.defaults.inworldPauseMs / 1000).toFixed(2)} s · a question gets {((draft.inworldPauseMs * 280) / 220 / 1000).toFixed(2)} s, a comma {((draft.inworldPauseMs * 140) / 220 / 1000).toFixed(2)} s, a paragraph {((draft.inworldPauseMs * 450) / 220 / 1000).toFixed(2)} s
        </span>
        <span className="hint">{HELP.inworldPauseMs}</span>
      </label>
    </div>
  );

  return (
    <>
      <div className="card">
        <h2>Voice</h2>
        <p className="muted">Browser voice mode: the student talks, AssemblyAI turns it into text, and the provider chosen here speaks the tutor's reply. Hume EVI mode (on the Session tab) is separate and always uses Hume.</p>
        <div className="row" style={{ alignItems: "center" }}>
          <div className="segmented" role="radiogroup" aria-label="Voice provider">
            {providers.map((p) => (
              <button key={p.id} type="button" role="radio" aria-checked={draft.ttsProvider === p.id} className={draft.ttsProvider === p.id ? "on" : ""} onClick={() => set("ttsProvider", p.id)}>
                <span className={`dot ${p.ready ? "ok" : "warn"}`} aria-hidden="true" /> {p.label}
              </button>
            ))}
          </div>
          {changed("ttsProvider") && <span className="pill">changed</span>}
          {draft.ttsProvider !== view.effective.ttsProvider && <span className="warn small">Not saved yet: sessions still use {providers.find((p) => p.id === view.effective.ttsProvider)?.label}.</span>}
        </div>
        <p className="small" style={{ marginTop: 6 }}>
          {selected.ready ? (
            <span className="muted">{HELP.ttsProvider}</span>
          ) : (
            <span className="warn">{selected.problem} Add it to <code>.env</code> and restart the server. Until then, voice mode shows the tutor's reply as text only.</span>
          )}
        </p>
        <h3>{selected.label}</h3>
        {draft.ttsProvider === "elevenlabs" ? elevenFields : draft.ttsProvider === "inworld" ? inworldFields : humeFields}
        <div className="row" style={{ marginTop: 12, alignItems: "center" }}>
          <button type="button" className="ghost" disabled={previewBusy || !selected.ready} onClick={testVoice} title="Speaks one short tutor line with the settings above, saved or not">{previewBusy ? "Speaking..." : "▶ Test this voice"}</button>
          {preview && <audio ref={player} controls src={preview.url} style={{ height: 32 }} />}
          <span className="muted small">
            {preview
              ? `${PROVIDER_NAME[preview.provider as TtsProvider] ?? preview.provider}: first audio after ${preview.firstAudioMs} ms, done in ${preview.totalMs} ms · ${preview.characters} characters of credits`
              : "Speaks one tutor line with the settings above, saved or not. Uses about 100 characters of credits."}
          </span>
          {previewErr && <span className="error small">{previewErr}</span>}
        </div>
        <h3>Turn-taking (every provider)</h3>
        <div className="grid3">
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
        {saveBar}
      </div>

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
        {saveBar}
      </div>

      <div className="card">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h2 style={{ margin: 0 }}>Readiness</h2>
          <div className="row">
            <button className="ghost" disabled={checking} onClick={() => check(false)}>{checking ? "Checking..." : "Re-check"}</button>
            <button className="ghost" disabled={checking} onClick={() => check(true)} title="Makes one tiny Claude API call and, with an ElevenLabs key, reads the account's credits">Re-check with API ping</button>
          </div>
        </div>
        <p className="muted">The same checks as <code>npm run doctor</code>. FAIL rows block a stage; WARN rows are optional features. The ping also reads your ElevenLabs credits and when they reset.</p>
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
