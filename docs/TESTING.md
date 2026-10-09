# Testing plan

Four stages, each unlocking the next. Stage 0 needs nothing; stage 1 needs an Anthropic key; stage 2
adds media tooling; stage 3 adds voice (AssemblyAI to listen, Inworld or ElevenLabs to speak). `npm run doctor` tells you which stage you are ready for.

## Stage 0: does it build (no keys)

```bash
npm install
npm test            # unit tests, no network: chunking, retrieval, orchestrator rules, the intakes, voice parsing, media parsers
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

- **Settings** shows the readiness check (the same rows as `npm run doctor`, with an optional API ping),
  the model settings and the voice settings. Four model fields: the tutor (what the student talks to), the
  notes model (the reflect pass after each reply), the offline model (course builds, intake write-ups, the
  profile pass) and the report model (the assessor; the only one that may be an OpenAI model). Effort,
  thinking, cache pre-warm and refusal fallbacks sit beside them. All are live: a change applies to the next
  turn, no restart, and is saved to `data/settings.json` until you reset. This is where the model
  comparison below happens.
- **Courses > Bundled samples > Ingest** builds the course from `data/samples/photosynthesis-lesson.md`.
  Expand a lesson to see every concept with its key facts, misconceptions and the chunk ids that ground
  it; open "Source passages" to compare against the verbatim text.
- **Students** adds a student and holds the general intake right there ("Add and begin the intake", then
  Type or Talk and Begin; a card without a profile has "Start the intake"). A student with no record for a
  course gets the course intake at the start of their first lesson on it (Lesson tab); "Reset profile" and
  each course's "Forget" make them due again, and the Lesson tab's "Skip the questions this time" goes
  straight to the lesson. The page shows both records, the passage the intake reads, and a box
  for the parent's own notes.
- **Lesson** is the tutor. Under every tutor reply is the same line `npm run chat` prints (TTFT, total,
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
2. **The two intakes.** The general intake is held on the Students tab when a student is added ("Add and begin the intake"); their first lesson on a course (Lesson tab) then opens with the course intake and hands over to the lesson by itself; watch the phase pill change from `course intake` to `teach`. From the CLI, `npm run chat` still runs all three in one sitting.
   - *The general intake* (about eight exchanges): a warm-up about what you like doing, then the tutor reads a short passage ("Why ice floats", word for word, the same for everyone) and asks you to tell it back, one question that applies it, one harder one, and "how sure are you, 0 to 10?". The two questions come in three sets by grade: answer the first one well and the harder one comes from the next set up; answer it badly and it comes from the set below. It must not teach or hint before the hard question, and it gives the answer only after it. It never mentions your course.
   - *The course intake* (eight to twelve exchanges): "tell me everything you already know about" the course, then one first-step question per central idea with "how sure, 0 to 10?" in the same breath. It must not say whether you were right, must not teach, and must not put a date or a name from the material into a question. Ask "was that right?" once: it should tell you to hold the thought for the reading. It never asks about faith.
   - *The lesson* then starts in the same reply as the course intake's last words, and should open a concept you were asked about with what you said ("Before we started you told me...").
   - On the **Students** tab, within a minute or two: the profile (how they speak, what they did when stuck, depth, at most six guidance items, quoting things you actually said) and, under "by course", where you started on each idea with your own words and your number. The **Courses** tab shows the same in a line per student and can ask again; the **Reports** tab's progress table gains a "Before the course" column once a lesson has been assessed.
   - `npm run personas:intake` (server running) plays three scripted students through all of this and checks it; `-- --only quiet --keep` runs one and leaves the student on the Students tab. See the header of `apps/server/scripts/intake-personas.ts`.
3. **Teach phase.** It should open with a retrieval probe, then either teach briefly (if you play a novice) or question first. It must not lecture for more than three or four sentences. One question per turn.
4. **Answer-seeking.** Say "just tell me the answer." It should decline, give the smallest next step as a question, and the observation list (visible with `/state`) should record it.
5. **Advance rules.** It cannot move to the next concept without two recorded observations. Watch the `[phase=... obs=...]` line after each turn.
6. **Grounding.** Ask something the sample does not cover, for example "what is ATP?" It should say the material doesn't cover it.
7. **Latency line.** Every turn prints `ttft=... total=... cache=read/total`. After the first turn the cache read count should be most of the total. Note the p50 TTFT the summary prints at the end. A turn is two calls: the `ttft` is the speaking call, and the turn line also shows how long the tutor's notes took afterwards, while the student was listening. A slow first word now means the model itself is slow, not that it stopped to take notes; "thought N chars before speaking" on a turn line would mean thinking leaked back into the speaking call.
8. **Report.** Type `/end`. Read the parent summary, the per-concept levels with quoted evidence, the grounding audit, and the answer-seeking count. Check the report against what actually happened in the transcript.

Do this three times with different personas (novice who needs teaching first, confident but with a misconception, bored fast learner) and compare the reports. That is your first pedagogy eval.

**Model comparison.** Run the same persona with the tutor model set to `claude-haiku-5-5`, `claude-sonnet-5-5` and `claude-opus-5-5` (Settings tab, or `CLAUDE_TUTOR_MODEL` in `.env` for the CLI); the notes model can differ from the speaker (the 2026-10-08 numbers are in `docs/LATENCY.md`). For the report, `npm run assess:compare -- <sessionIdPrefix> label=model@effort ...` assesses one saved session with several models and prints the reports side by side without saving anything (`docs/COST.md` has two sessions compared). Reset the student's profile between runs so each starts from the same place. Compare TTFT p50 and how well each holds the Socratic line. This decides the voice model.

**One reply per turn.** The tutor's tools (`record_observation`, `advance`) run after it speaks. Once its reply contains a question, anything the model writes after the tools is dropped and counted ("chars dropped after tools" on the turn line); if it advanced before asking, it gets one more segment to ask. A turn line that shows dropped text is the model trying to talk twice; a rising count across a session is worth a skill edit.

## Stage 1b: a real unit (the Ancient Rome guide)

The bundled sample is two pages. A real unit is the Fords' *Ancient Rome* parent's guide from Saint
Emmelia Ministries: 49 scanned pages, twelve topical sections, no lessons or quizzes of its own. It is
not in the repo; ingest it from wherever it is:

```bash
npm run ingest -- --title "Ancient Rome" "C:\Users\<you>\Downloads\8 Ancient Rome.pdf"
```

1. **Two parts, in parallel.** The console shows `Extracting batch 1/2` and `2/2` at once (the unit is
   142k characters; a part is at most 100k so the course JSON it produces stays well inside the output ceiling), then
   progress lines every 20k characters of output. Expect ten to fifteen minutes at high effort. Open
   `data/courses/<id>.json`: a chunk under FOOD or CLOTHING reads as spaced prose (the scan's text layer
   fuses words; `ingest/pdf-text.ts` joins them by geometry); expect roughly one lesson per section,
   Activities as practice items, and key facts that appear verbatim in the chunks.
2. **Focus.** Courses tab: untick two sections (say Religion and Leisure). The card's count line drops,
   and the Lesson tab's lesson list no longer offers them.
3. **Narration first.** Lesson tab: a 7th-grade student, the Government lesson, tick "Already read
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
end of their turn the moment they stop; Inworld or ElevenLabs speaks the tutor's reply while the model is
still writing the next sentence (`apps/server/src/voice/stt-assemblyai.ts`, `tts-inworld.ts`,
`tts-elevenlabs.ts`). The tutor's voice is switched with the toggle at the top of Settings, Voice; **Test this voice** there speaks one line with the unsaved settings and reports the
first-audio time, which is the quickest way to compare voices and models before a session.

```bash
# .env: ASSEMBLYAI_API_KEY=...   INWORLD_API_KEY=... or ELEVENLABS_API_KEY=...   (VOICE_TTS picks the default)
npm run dev:server
npm run dev:web                            # Lesson tab, Mode: "Voice: talk to the tutor", Begin
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
   request together, so the voice keeps its pace and pitch across them (this is the ElevenLabs path;
   Inworld voices a whole reply as one stream). "Batch sentences per voice request" in Settings turns this off for comparison; the
   "last turn" line under the transcript shows how many voice requests the reply took.
3. **First audio.** The line under each tutor reply shows first audio N s after the student stopped;
   the panel shows the p50. Measured on 2026-09-21 with Sonnet 5 at low effort: transcript ready
   0.8-1.0 s after end of speech, first audio 2.4-3.3 s after end of speech (first token 1.3-2.1 s, then
   about 1 s for the voice of that day to start the first sentence; Inworld now starts 0.2 to 0.3 s after
   the first word, see `docs/LATENCY.md`). The Settings tab is where the model, effort and thinking get
   compared against that number.
4. **Round trip.** `npx tsx scripts/transcribe-wav.ts clip.wav` (in `apps/server`) streams a 16-bit mono
   WAV through the same transcriber the browser uses. A saved tutor clip transcribes back word for word.
5. **Typed fallback.** "Or type instead" sends text over the same socket; the tutor still answers aloud.
6. **No mic in the app's own Browser pane.** It blocks microphone access, so test voice in a normal
   browser at http://localhost:5173.

A full-loop test without a microphone (synthesizes a student line, streams it in as mic audio in real
time, checks transcript, reply, barge-in and typed fallback) is what the server was verified with; the
script lives with the session notes, not in the repo.

## Stage 4: pedagogy evals (next build step)

Manual personas do not scale. The next piece of work is a simulated-student harness: a second Claude
agent plays a learner with a fixed profile and planted misconceptions, runs a full session against the
tutor automatically, and a rubric scores the transcript on questions-per-turn, hint-ladder adherence,
answer giveaways (must be zero), grounding violations, and whether the assessor's levels match the
planted state. Run it across the three personas and the current models before every skill edit, and you
have a regression suite for teaching quality. See `docs/RESEARCH.md`, "What to measure in pilots." The
report side of this exists already: `npm run assess:compare` replays one saved session through several
assessor models, which is how the report model was chosen (`docs/COST.md`).
