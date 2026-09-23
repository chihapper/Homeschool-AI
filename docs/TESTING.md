# Testing plan

Four stages, each unlocking the next. Stage 0 needs nothing; stage 1 needs an Anthropic key; stage 2
adds media tooling; stage 3 adds Hume. `npm run doctor` tells you which stage you are ready for.

## Stage 0: does it build (no keys)

```bash
npm install
npm test            # 28 unit tests: chunking, retrieval, CLM parsing, orchestrator rules, media parsers
npm run typecheck
npm run doctor
```

Pass condition: tests green, doctor shows no FAIL rows except the API key.

## Stage 1: text-mode tutor (Anthropic key only)

This is the stage that validates the pedagogy, and it needs no microphone.

**In the browser (the normal way):**

```bash
cp .env.example .env               # set ANTHROPIC_API_KEY
npm run dev:server                 # http://localhost:3001
npm run dev:web                    # http://localhost:5173
```

Then, in the web app:

- **Settings** shows the readiness check (the same rows as `npm run doctor`, with an optional API ping)
  and the model settings. Tutor model, effort and thinking, offline model and effort, cache pre-warm and
  refusal fallbacks are all live: a change applies to the next turn, no restart, and is saved to
  `data/settings.json` until you reset. This is where the model comparison below happens.
- **Courses > Bundled samples > Ingest** builds the course from `data/samples/photosynthesis-lesson.md`.
  Expand a lesson to see every concept with its key facts, misconceptions and the chunk ids that ground
  it; open "Source passages" to compare against the verbatim text.
- **Students** adds a persona. A student without a profile gets the intake first; "Reset profile" runs
  it again with the same student, "Skip intake" on the Session tab goes straight to the lesson.
- **Session** is the tutor. Under every tutor reply is the same line `npm run chat` prints (TTFT, total,
  round-trips, cache read/written, and any text the model wrote after its tools that was dropped). The
  right-hand panel is `/state`: phase, concept, every observation as it is recorded, what the
  orchestrator queued for the next turn, and the running latency summary. "Leave for now" keeps the
  session resumable; "End session & assess" runs the assessor (one to three minutes) and opens the report.
- **Reports** lists every report with the answer-seeking and giveaway counts, and shows the full report.

**In the terminal (same engine, no UI):**

```bash
npm run doctor -- --ping           # one tiny API call; prints the model's response time
npm run ingest -- data/samples/photosynthesis-lesson.md
npm run chat -- --learner "Test Student" --grade 7
```

What to look at, in order:

1. **Ingestion output.** Two lessons, a handful of concepts each, every concept citing chunk ids. Open `data/courses/<id>.json` and check the key facts are actually in the sample text and nothing was invented.
2. **Intake.** The first session runs the profiler. Play a real 12-year-old: answer some things well, some badly, ask for the answer once. It should close within about 8 to 12 exchanges and the profile in `data/learners/<id>.json` should quote things you actually said.
3. **Teach phase.** It should open with a retrieval probe, then either teach briefly (if you play a novice) or question first. It must not lecture for more than three or four sentences. One question per turn.
4. **Answer-seeking.** Say "just tell me the answer." It should decline, give the smallest next step as a question, and the observation list (visible with `/state`) should record it.
5. **Advance rules.** It cannot move to the next concept without two recorded observations. Watch the `[phase=... obs=...]` line after each turn.
6. **Grounding.** Ask something the sample does not cover, for example "what is ATP?" It should say the material doesn't cover it.
7. **Latency line.** Every turn prints `ttft=... total=... cache=read/total`. After the first turn the cache read count should be most of the total. Note the p50 TTFT the summary prints at the end. A turn is two calls: the `ttft` is the speaking call, and the turn line also shows how long the tutor's notes took afterwards, while the student was listening. A slow first word now means the model itself is slow, not that it stopped to take notes; "thought N chars before speaking" on a turn line would mean thinking leaked back into the speaking call.
8. **Report.** Type `/end`. Read the parent summary, the per-concept levels with quoted evidence, the grounding audit, and the answer-seeking count. Check the report against what actually happened in the transcript.

Do this three times with different personas (novice who needs teaching first, confident but with a misconception, bored fast learner) and compare the reports. That is your first pedagogy eval.

**Model comparison.** Run the same persona with the tutor model set to `claude-sonnet-5`, `claude-opus-5`, and `claude-haiku-4-5` (Settings tab, or `CLAUDE_TUTOR_MODEL` in `.env` for the CLI). Reset the student's profile between runs so each starts from the same place. Compare TTFT p50 and how well each holds the Socratic line. This decides the voice model.

**One reply per turn.** The tutor's tools (`record_observation`, `advance`) run after it speaks. Once its reply contains a question, anything the model writes after the tools is dropped and counted ("chars dropped after tools" on the turn line); if it advanced before asking, it gets one more segment to ask. A turn line that shows dropped text is the model trying to talk twice; a rising count across a session is worth a skill edit.

## Stage 1b: a real unit (the Ancient Rome guide)

The bundled sample is two pages. A real unit is the Fords' *Ancient Rome* parent's guide from Saint
Emmelia Ministries: 49 scanned pages, twelve topical sections, no lessons or quizzes of its own. It is
not in the repo; ingest it from wherever it is:

```bash
npm run ingest -- --title "Ancient Rome" "C:\Users\<you>\Downloads\8 Ancient Rome.pdf"
```

1. **One extraction call.** The console shows `Extracting batch 1/1`. Open `data/courses/<id>.json`: a
   chunk under FOOD or CLOTHING reads as spaced prose (the scan's text layer fuses words; `ingest/pdf-text.ts`
   joins them by geometry); expect roughly one lesson per section, Activities as practice items, and key
   facts that appear verbatim in the chunks.
2. **Focus.** Courses tab: untick two sections (say Religion and Leisure). The card's count line drops,
   and the Session tab's lesson list no longer offers them.
3. **Narration first.** Session tab: a 7th-grade student, the Government lesson, tick "Already read
   this", Begin. The opening turn asks for a narration, not a question; after the narration it probes
   from what was said and what was left out. "Concept X of Y kept" shows the reduced count.
4. **Stage 1 script**, items 4 to 7: answer-seeking, the advance gate, an off-material question ("who
   was Hannibal?").
5. **Report.** Only kept concepts appear; the grounding audit is clean or names the exact claim.
6. **Progress.** Reports tab, Progress panel: every concept reads "first time". A second short session on
   the same lesson turns the column into "up from", "down from" or "same as before".

## Stage 2: media ingestion

**File formats.** Read directly: `.pdf`, `.docx`, `.epub`, `.odt`, `.rtf`, `.html`, `.md`, `.txt` and
anything else text-like. Read by the model: `.png`, `.jpg`, `.gif`, `.webp` — scans and photographs of
pages, transcribed verbatim with `[illegible]` where the scan is unreadable, so check a scanned course
in "Source passages" before teaching from it. Unpacked: `.zip`, whose readable members are read in name
order, each under a heading of its own filename. Slides and audio/video are handled separately, below.

Anything else is refused by name with the conversion to run (`.doc` -> save as `.docx`, `.pages` ->
export to PDF, `.mobi` -> convert to EPUB, `.tif` -> save as `.png`). A PDF with no text layer is a
scan: it is refused with a pointer to exporting its pages as images. An unrecognised binary is refused
rather than read as text.


```bash
pip install yt-dlp                         # or brew install yt-dlp
npm run ingest -- --title "Deck" ./some-lecture.pptx
npm run ingest -- --title "Talk" https://www.ted.com/talks/<slug>
npm run ingest -- --title "Podcast" --episodes 1 https://<feed>.xml     # needs DEEPGRAM_API_KEY unless the feed ships transcripts
npm run ingest -- https://www.youtube.com/watch?v=<your own video>     # yt-dlp; own or licensed content only
```

Check `data/courses/<id>.json`: transcript chunks carry `[mm:ss]` markers in their text, slide chunks
carry `Slide N` headings, and concepts from spoken sources quote the speaker rather than paraphrasing
into textbook prose.

## Stage 3: voice in the browser (the student talks, the tutor talks back)

Two keys and no tunnel: AssemblyAI streams the student's speech to text as they talk and signals the
end of their turn the moment they stop; Hume Octave speaks the tutor's reply sentence by sentence while
the model is still writing the next one. Both were the winners of the character engine's bake-off and
the adapters are ported from there (`apps/server/src/voice/stt-assemblyai.ts`, `tts-hume.ts`).

```bash
# .env: ASSEMBLYAI_API_KEY=...   HUME_API_KEY=...   (HUME_TTS_VOICE defaults to "Ava Song")
npm run dev:server
npm run dev:web                            # Session tab, Mode: "Voice: talk to the tutor", Begin
```

The browser asks for the microphone once. The tutor speaks first; when it finishes, the mic opens by
itself (untick "Listen automatically" to use the Talk button instead). Speak, pause, and the turn ends
on its own; "I'm done" ends it early. Clicking Talk while the tutor is speaking is a barge-in: the audio
stops at once, the server cancels the rest of the reply, and what was already said stays in the
transcript marked as interrupted.

What to look at:

1. **Live transcript.** Your words appear in italics as you speak and settle into a bubble when the turn
   ends. If it cuts you off mid-thought, raise "End of turn: short pause" in Settings (default 400 ms); if
   it waits too long after you stop, lower "longest pause" (default 1500 ms). Lesson vocabulary
   (concept names, long words from the key facts) is sent to the transcriber as hints.
2. **Cadence.** The tutor's reply is spoken in as few voice requests as possible: the first sentence goes
   alone so the reply starts fast, then every sentence the model has already written rides in the next
   request together, so Octave keeps its pace and pitch across them and performs the pause after each
   sentence itself. "Batch sentences per voice request" in Settings turns this off for comparison; the
   "last turn" line under the transcript shows how many voice requests the reply took.
3. **First audio.** The line under each tutor reply shows first audio N s after the student stopped;
   the panel shows the p50. Measured on 2026-09-21 with Sonnet 5 at low effort: transcript ready
   0.8-1.0 s after end of speech, first audio 2.4-3.3 s after end of speech (first token 1.3-2.1 s, then
   about 1 s for Octave 2 to start the first sentence). The Settings tab is where the model, effort,
   thinking, Octave version and instant mode get compared against that number.
4. **Round trip.** `npx tsx scripts/transcribe-wav.ts clip.wav` (in `apps/server`) streams a 16-bit mono
   WAV through the same transcriber the browser uses. A saved tutor clip transcribes back word for word.
5. **Typed fallback.** "Or type instead" sends text over the same socket; the tutor still answers aloud.
6. **No mic in the app's own Browser pane.** It blocks microphone access, so test voice in a normal
   browser at http://localhost:5173.

A full-loop test without a microphone (synthesizes a student line, streams it in as mic audio in real
time, checks transcript, reply, barge-in and typed fallback) is what the server was verified with; the
script lives with the session notes, not in the repo.

## Stage 3b: voice via Hume EVI (Hume runs the conversation loop)

Same engine, different division of labour: Hume listens, decides when the student has finished, calls
our server for the tutor's words, and speaks them as one continuous performance (no per-sentence
seams). Hume's servers must be able to reach this machine, so development needs a tunnel.

```bash
ngrok http 3001                            # copy the https URL into PUBLIC_URL in .env
# .env: CLM_SECRET=<any long random string>   (Hume sends it back as Authorization: Bearer ...)
npm run setup:hume -- --silence 800 --interrupt 300   # creates the EVI config; paste the id into HUME_CONFIG_ID
npm run dev:server                         # restart after changing .env
npm run dev:web                            # Session tab, Mode: "Voice via Hume EVI"
```

Run `setup:hume` again whenever the tunnel URL, the voice, or the silence settings change; each run
makes a new config on Hume's side. The config is created with a direct API call because the Hume SDK
refuses the endpoint URL in `model_resource` (its validator only knows Hume's hosted model names).

Verified on 2026-09-21 with a headless session (`npx tsx scripts/evi-smoke.ts <learnerId> <courseId>`
in `apps/server`, which needs the tunnel up): Hume calls `POST /clm/chat/completions?custom_session_id=<ours>`,
forwards `language_model_api_key` as `Authorization: Bearer ...` (a wrong secret is refused with 401),
and attaches `models.prosody.scores` to the user message, which land on the transcript as `expressions`.
The tutor's opening line is produced by our orchestrator and handed to EVI with `assistant_input`,
since Hume only calls the language model once the student has spoken.

What to look at:

1. **Flow between sentences.** This is the reason to try this path. Hume synthesizes the streamed reply
   as one piece, so there should be no cadence change at sentence boundaries.
2. **Turn-taking.** EVI ends the turn after `end_of_turn_silence_ms` of silence (500-3000; set with
   `--silence`). Interruptions are Hume's: talk over the tutor for `--interrupt` ms and it stops.
3. **Latency.** In the one headless run, first audio came 6.3 s after the student stopped: about 2 s
   for Hume's silence window and transcription, 1.6 s to our first token, then Hume waited for the
   whole first sentence (a long one) before speaking. The browser path measured 2.4-3.3 s on the same
   lesson. The per-turn line still shows our TTFT; Hume's share is not visible from here.
4. **Emotion labels.** The words under each of the student's lines are what Hume heard in their voice;
   the tutor prompt receives them as expression labels.
5. **Server log.** `POST /clm/chat/completions?custom_session_id=...` per turn. A 401 means the
   `CLM_SECRET` in `.env` differs from what the browser sent (it is fetched from `/api/hume/token`).

## Stage 4: pedagogy evals (next build step)

Manual personas do not scale. The next piece of work is a simulated-student harness: a second Claude
agent plays a learner with a fixed profile and planted misconceptions, runs a full session against the
tutor automatically, and a rubric scores the transcript on questions-per-turn, hint-ladder adherence,
answer giveaways (must be zero), grounding violations, and whether the assessor's levels match the
planted state. Run it across the three personas and all three models before every skill edit, and you
have a regression suite for teaching quality. See `docs/RESEARCH.md`, "What to measure in pilots."
