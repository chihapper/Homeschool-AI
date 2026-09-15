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

```bash
cp .env.example .env               # set ANTHROPIC_API_KEY
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
7. **Latency line.** Every turn prints `ttft=... total=... cache=read/total`. After the first turn the cache read count should be most of the total. Note the p50 TTFT the summary prints at the end.
8. **Report.** Type `/end`. Read the parent summary, the per-concept levels with quoted evidence, the grounding audit, and the answer-seeking count. Check the report against what actually happened in the transcript.

Do this three times with different personas (novice who needs teaching first, confident but with a misconception, bored fast learner) and compare the reports. That is your first pedagogy eval.

**Model comparison.** Run the same persona with `CLAUDE_TUTOR_MODEL=claude-sonnet-5`, `claude-opus-5`, and `claude-haiku-4-5`. Compare TTFT p50 and how well each holds the Socratic line. This decides the voice model.

## Stage 2: media ingestion

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

## Stage 3: voice (Hume EVI)

```bash
ngrok http 3001                            # copy the https URL into PUBLIC_URL in .env
npm run setup:hume                         # prints HUME_CONFIG_ID; paste into .env
npm run dev:server
npm run dev:web                            # http://localhost:5173, Session tab, Mode: Voice
```

First things to verify, because they are the unverified assumptions in the build:

1. The server log shows `POST /clm/chat/completions?custom_session_id=...` when you speak. If the session id is missing, the tutor will say so out loud.
2. Whether Hume sends the CLM secret as a bearer header. If every request comes back 401, unset `CLM_SECRET` for now and open an issue to confirm Hume's header name.
3. Log the raw request body once (`LOG_LEVEL=debug`) and confirm the shape of the prosody scores. `voice/clm.ts` reads `models.prosody.scores`; adjust `lastUserTurn` if Hume's shape differs.
4. Interrupt the tutor mid-sentence. The server should log an aborted stream, not a completed one.
5. Latency: `GET /api/sessions/<id>/latency` after a few turns. Target p50 TTFT under 1 s. If it is over, try the model ladder in `docs/LATENCY.md`.

## Stage 4: pedagogy evals (next build step)

Manual personas do not scale. The next piece of work is a simulated-student harness: a second Claude
agent plays a learner with a fixed profile and planted misconceptions, runs a full session against the
tutor automatically, and a rubric scores the transcript on questions-per-turn, hint-ladder adherence,
answer giveaways (must be zero), grounding violations, and whether the assessor's levels match the
planted state. Run it across the three personas and all three models before every skill edit, and you
have a regression suite for teaching quality. See `docs/RESEARCH.md`, "What to measure in pilots."
