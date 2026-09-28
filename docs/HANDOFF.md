# Handoff

Last updated: 2026-09-27

Read this before anything else. It is written for a session that has seen nothing.

## Where the project stands

Homeschool-AI is a Socratic tutor for homeschool families: a parent loads one unit of the material they
already teach from, the student talks with a tutor that questions rather than lectures and asserts
nothing outside that material, and the parent gets a mastery report per session plus a running view
across sessions. Fastify server with four agents (curriculum, profiler, tutor, assessor) and a
deterministic orchestrator; Vite/React front end; file-backed JSON in `data/` (gitignored).

**State on 2026-09-25:** `main` is at `18af54b`: the voice work from `feature/elevenlabs-voice` was
fast-forwarded onto it and pushed at the user's request (the stage-direction fix `4da593e`, the ElevenLabs
switch `82c8e5d`, Inworld with its pause slider `ecca428`, the lookup fix `18af54b`; 151 tests). The voice
branch stays for further voice work. `feature/outside-knowledge` (what the tutor does with facts a student
brings in from outside the material: answer and check against Wikipedia in the background, a report section,
and a parent setting) was fast-forwarded onto `main` and pushed on 2026-09-27 (`main` = `18e0bc2`, 184 tests).
Branch `feature/dynamic-profile` (uncommitted, off `main`) keeps the learner profile current: after every
report a profile pass revises it, slow fields need two sessions to agree, the parent sees every change on the
Students tab and can undo the latest; 194 tests. Typecheck is clean in both workspaces. The first real
unit, the Fords' *Ancient Rome* parent's guide from Saint Emmelia Ministries (49 scanned pages), is
ingested as a course in `data/courses/ancient-rome-muemem4s.json` (31 lessons, 110 concepts) and has
been taught in four sessions, three of them assessed. Text mode works with an Anthropic key alone.
Browser voice can now speak through **ElevenLabs, Inworld or Hume Octave** (a toggle at the top of Settings,
Voice, added 2026-09-24/25 on `feature/elevenlabs-voice`; the user has tried both and finds them hard to tell
apart). Inworld works
(verified 2026-09-25): a Standard key is in `.env` (Realtime-only keys cannot call text-to-speech). Hume's balance is
exhausted. ElevenLabs works: a real `sk_` key is in `.env` (Starter plan, 75,451 characters a month,
resetting 2026-09-25), and a scripted two-turn voice session over the app's WebSocket spoke both replies
with first audio at 1.6 to 1.8 s (numbers in `docs/LATENCY.md`). The user's own microphone session in
Chrome has not happened yet.

**Goal and gate:** get the tool in front of homeschool families as an add-on study partner. The next
gate is a repeatable pedagogy evaluation (issue #6) so skill edits stop being judged by hand, then a
decision on hosting (issue #13) before any pilot. No deadline has been set.

## Standing decisions

- **Scope is an add-on, not a curriculum engine** (user, 2026-09-23). One unit of the family's own
  material at a time, Socratic sessions, a parent's progress view. No scheduling, no planning of
  coursework, no grading of publisher tests, no records. Reason: the three curricula the user chose
  are three different shapes (open prose guide, 60 scripted lessons with workbooks, a weekly booklist),
  families skip and substitute by design, and nothing in the community's literature shows a parent
  where a child stands. "Suggest next week's focus" is issue #11, not scope.
- **Focus is the parent's decision, never an agent's.** `Course.focus` holds what the parent unticked;
  a session freezes the kept walk into `Session.conceptIds` at creation. Reason: a curriculum engine
  that decides fights the parent's authority; the tool serves it.
- **Grounding is a product requirement.** The tutor asserts nothing outside the course; the assessor
  audits it against the whole course. Reason: this community vets curricula for worldview assumptions;
  "the tutor stayed inside your material, and here is the proof" is the product's strongest claim.
- **Facts a student brings in from outside the material get an answer and a check** (user, 2026-09-25,
  after "Aphrodite saved Aeneas" got only "not in the material"). Three kinds of reply: confirm, correct, or
  "I'm not sure; I'll look into it", always labelled as outside the reading and brought back to it. The
  check is Wikipedia first (user's choice), through its free API, never a parent-curated source list
  ("parents may not know which sources matter"). Plain facts only: the tutor never rules on faith, values
  or interpretation, and the family's material wins where it differs. The parent setting (Settings,
  Outside the reading) is answer and check, answer only, or material only. Before launch: Wikimedia
  Enterprise (#26). Later: other sources where the checks show gaps (#27), and depth pitched to the
  student from a profile kept current across sessions (#28).
- **An outside fact is labelled "I don't see that in your reading", never "that's not in your reading"**
  (user, 2026-09-25): the tutor sees the passages that match the topic, not the whole book, and a parent reads
  "not in your reading" as a fact about their book (the same rule as the coinage incident). It names the source
  when it knows it ("That's from Homer's Iliad"). The tutor never raises outside facts itself.
- **Scholarly questions about scripture** ("historians doubt Matthew wrote Matthew") are handed to the parent
  for now and never checked against Wikipedia; whether the tutor may say more (the family's tradition, or the
  views described without a verdict) is the user's open question, #29.
- **The learner profile is dynamic, applied with undo** (user, 2026-09-27: "a dynamic profile on the student vs
  a stagnant snapshot when the student started"). After every report the profile pass revises the profile;
  changes land automatically, every one is shown to the parent with its reason, and the latest can be undone.
  The user may later switch to propose-and-approve (changes wait for the parent's yes), so landing and
  recording stay separate in `domain/profile.ts`. One profile per student, with the subject-specific entries
  tagged by course ("Rome: ..."), rather than a profile per course.
- **Workbook and activity pages are a roadmap item, not an accepted limitation** (user, 2026-09-23:
  "many homeschool materials likely include that"). Issue #1, sized on a real sample.
- **The tutor turn is two calls** (speak fast with no bookkeeping and no thinking; reflect afterwards
  while the student listens), and the open thread rides with the phase guidance rather than outranking
  it. See CLAUDE.md; an earlier version that let the note outrank the phase was rejected by the user.
- **Sessions start in text mode**; voice is a deliberate choice from the dropdown.
- **The tutor's voice is switchable between Hume Octave and ElevenLabs** (user, 2026-09-24: they have
  ElevenLabs credits to use before they lapse, and want to hear the voice). The provider is the runtime
  setting `ttsProvider`, toggled at the top of Settings, Voice, with provider-specific fields below it.
  Hume EVI mode stays Hume-only.
- **The voice is streamed one reply at a time, over a socket opened while the student talks** (user,
  2026-09-24, after hearing one reply voiced four ways: clip D, ElevenLabs v3 Conversational over its
  Text to Dialogue socket, "definitely sounds more natural and conversational"). Which vendor is decided
  by ear: Inworld is being trialled first (#17, cheaper and ranked higher by listeners); #16, the
  ElevenLabs socket, is on hold until clip E (Inworld) has been compared with D. No family session goes
  through Inworld until its data answers are in (#18).
- **Our own voice loop stays** (user, 2026-09-24): ElevenLabs Agents, which would run the conversation on
  ElevenLabs' side, is a roadmap item (#19), revisited only if echo or turn-taking fail in real sessions.
- **Commit to ElevenLabs over Hume** for anything Hume Octave did (cheaper per character and rated far
  higher, 2026-09-24). The Hume adapter stays in the code, unused; Hume EVI mode stays as it is.
- **Reports and profiles use the learner's name** unless the transcript gives a pronoun. A report said
  "your son" from nothing; the user's records carry no gender.
- **Research subagents run on Opus 5.5** for research the user will build on (user, 2026-09-27, for the
  intake research; the 2026-09-23 decision was Sonnet); the main session does the analysis.
- **Git has no author identity on this machine**: commit with `git -c user.name="Claude" -c user.email="noreply@anthropic.com"`,
  as the earlier history does, rather than changing the user's git config.
- **Commits end with the `Co-Authored-By` line the harness gives for the model in use** (it changed from
  Fable 5.1 to Opus 5.5 on 2026-09-24); pull request descriptions end with the Claude Code attribution
  line. Commit or merge when the user asks; they have been merging branches themselves via "merge into
  main". The repo has no configured git identity: the
  existing commits are by "Claude <noreply@anthropic.com>", so commit with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit ...`.
- **Explain at the user's level.** They are a technical consulting partner, not a career engineer:
  define terms inline, lead with what happened and why it matters, give real tradeoffs and one
  recommendation (global instructions, `explain-on-my-level` skill).

## The verification loop

Before any commit:

```bash
npm test && npm run typecheck
```

184 tests as of 2026-09-25, all pure (no network, no binaries). The end-to-end check for tutoring
changes is a scripted session through the HTTP API: create a session, post persona lines to
`/api/sessions/:id/message` reading the SSE stream until `reflected`, then `POST /end` and read the
report and `GET /api/progress/:learnerId/:courseId`. The Python prototype is pasted into issue #6;
the pattern is also in `docs/TESTING.md` Stage 1b.

To rebuild the Rome course (the PDF is outside the repo, in the user's Downloads):

```bash
npm run ingest -- --title "Ancient Rome" "C:\Users\Alejandro\Downloads\8 Ancient Rome.pdf"
```

Expect two balanced parts in parallel and ten to fifteen minutes at Opus 5 high effort.

Gotchas that cost real time this week:

- **The dev servers.** `.claude/launch.json` defines `server` (3001) and `web` (5173); `tsx watch`
  restarts the server on every source edit, so a running session's in-flight reflect pass dies with
  an edit. Another Claude session's dev server in this folder holds the same ports.
- **Ingest is output-bound, not input-bound.** The model writes 0.6 to 1.4 characters of course JSON
  per character of source. A 142k-character unit in one call hit the 32k-token output ceiling; parts
  are now at most 100k characters with a 64k-token ceiling (`curriculum-agent.ts`). A non-streaming
  call of that size times out; every offline extraction goes through `streamParsed` in `llm/client.ts`.
- **Reading the session too early.** The reflect pass takes 10 to 19 s at medium effort. An API read a
  few seconds after a reply shows zero observations and no `reflectMs`; that is not a bug (issue #3).
- **PDFs on this machine.** The Read tool cannot rasterize PDFs (no `pdftoppm`); `pdftotext -layout`
  and Python `pymupdf` work, and `pdftotext` prints Windows-1252, not UTF-8.
- **ElevenLabs keys start with `sk_`.** The dashboard also shows a key ID (64 hex characters); used as a
  key it returns HTTP 400 "API key ID used as API key". It has been pasted by mistake twice: the character
  engine's `.env` holds one ID, and the first value put in this project's `.env` was another. The secret
  is shown once, in the dialog when a key is created or rotated. The readiness check flags a key that does not start with `sk_`, and its API ping reads the
  account's remaining characters and reset date.
- **`data/samples/` is tracked by git.** Never copy a family's or a publisher's PDF there; ingest by
  absolute path.
- **The Good and the Beautiful sample** (43 MB) lived only in a session's temporary folder and may be
  gone; re-download from `files.thegoodandthebeautiful.com/History/Samples/` if issue #1 needs it.

## Work queue

The backlog is GitHub issues 1 to 14 and 16 to 29 on chihapper/Homeschool-AI (15 was the merged pull
request); run `gh issue list`. The `pre-launch` label marks what must be settled before any family uses
the product (#13, #18, #23, #26). Ordering and blockers only here.

**User-side**

1. Test in the web app (both servers up, `http://localhost:5173`): Focus ticks on the Courses tab, a
   session with "Already read this", the Progress panel on the Reports tab.
2. Decide the hosting, copyright and children's-data line (issue #13) before anyone asks for a login page.
   Now: turn off AssemblyAI's model training in its dashboard, which needs a paid plan and also gives zero
   retention for streaming (#23), and send the two neutral vendor emails (#18 Inworld, #23 AssemblyAI).
3. Add a real ElevenLabs key to `.env` (`ELEVENLABS_API_KEY=sk_...`), restart the server, flip the
   toggle in Settings, Voice to ElevenLabs, pick a voice and model, press **Test this voice**, then run a
   voice session in Chrome at `http://localhost:5173` (the app's browser pane cannot use the microphone).
   Hume stays unusable until its balance is topped up.
4. Read the README "What this is (and is not)" section and `docs/ROADMAP.md` in your own voice; they
   are the product statements a customer or an engineer will read.

**Claude-side, in order**

0000. Next, once the user reacts to `docs/INTAKE.md` (written 2026-09-27, research plus design, three Opus 5.5
   research reports appended): the two intakes. The user's structure: a general intake once per student
   (the learner profile, "how they learn") and a course intake once per student per course (the
   course-knowledge record, "where they start on this content"); build order A the record split, B the
   general intake, C the course intake, D scripted personas. The design's main moves and their evidence are in
   the doc: drop `intakePreferences` (learning-style matching has no evidence), move prior knowledge and gaps
   to the course record, add the parent's notes, probe prior knowledge with first-step questions plus
   "how sure are you?", never teach during an intake, use a built-in neutral passage for the general intake
   (never the parent's course), hand over instead of saying goodbye, write records in the background. Waiting
   on the user: the field changes, the passage, whether to ask confidence after every probe, and the merge of
   `feature/dynamic-profile` (`cc200af`).
000. In progress 2026-09-27 on `feature/dynamic-profile` (uncommitted): the dynamic profile (#28). Built:
   `agents/profile-agent.ts` (skill `profile-update`) proposes the whole revised profile with a reason per field;
   `domain/profile.ts` lands fast fields, holds slow ones (pace, challenge tolerance, verbal level, depth, intake
   preferences) until the next session proposes the same, records each update with `previous`, undoes the latest;
   `endSession` runs the pass in the background after the report, one at a time per learner; the Students tab
   shows "Changes to the profile" with Undo; `depth` (simple / some-nuance / full) is new on the profile, filled by
   the intake, read by the tutor's cached block and by the reference checker's level. First live run hit the
   8,000-token output ceiling (thinking counts), now 32,000. Live 2026-09-27 (three sessions through the API):
   the pass landed 112 to 130 s after the report, in the background; changes came with quoted reasons; the
   11-item intake guidance was trimmed to 6; undo restored the profile twice. Two things it showed and were
   fixed the same day: a rewritten verbal level was held through two consecutive sessions because the hold
   needed the identical paragraph (now a free-text slow field lands on the second consecutive revision, in
   whatever words), and the change list repeated one reason eleven times (now grouped by field in the UI).
   Replay of the nine earlier Rome reports in memory (old intake profile from the plants course): 74 to 133 s a
   pass; 35, 28, 18, 11 changes on the first four passes as the profile caught up with Rome, then settling
   (3, 13, 13, 15, 21 on the last five; 860 s for nine passes; verbal level held on six passes by the exact-match rule since fixed; depth proposed once and never confirmed, so it stayed simple. The lists grew without merging (prior knowledge 40, gaps 27, interests 16 after nine sessions), so the lists now have ceilings in code (15, 12, 10) and the skill says merge, don't pile; the replay ran on the skill as it was before that). Re-checked on the first four
   passes with the rules in place: 25, 28, 16, 20 changes; lists 15 / 9 / 6 / 6 (one merged Rome interest instead of a
   question each); the verbal-level rewrite held once and landed on the next pass; depth held once, not confirmed;
   417 s. Test Student's record now carries one live revision (session `d587b53d`) for the Students tab.
   Not built: the parent editing profile fields by hand, and a profile written from a session for a learner
   who skipped the intake.
00. Merged 2026-09-27 (`a91f2e4` on `main`): facts from outside the material.
   The reflect pass flags them (`flag_outside_claim`), `orchestrator/outside.ts` runs the Reference Checker
   (`agents/reference-agent.ts`, `reference/wikipedia.ts`) as a background job and merges the verdict at the
   next turn, which follows up if the tutor was unsure or wrong; the report gets "Outside the reading", and
   the assessor stops calling a correct one a misconception. `WIKIPEDIA_CONTACT` is in `.env` (the user's own
   address for now, #26). Live-tested 2026-09-25 on the Aeneas lesson and on "The Role of the Empire in God's
   Plan" (the user asked for that lesson: faith claims must be left alone, and its dates differ from
   Wikipedia's: Judea 64 B.C. in the reading vs 63 B.C., Constantine from 312 vs 306). What the live runs
   found and fixed: (1) a student's "historians don't think the census in Luke happened" was reworded as a
   plain fact, checked, and came back "Luke is in error" in the report; now `aboutFaith` keeps scripture and
   faith away from Wikipedia whatever the wording, the tool and skills say so, and the tutor no longer lays out
   the debate ("not mine to settle... talk it over with your parent"); (2) every fact was flagged twice on
   consecutive turns; now the reflect pass sees what is flagged and `sameClaim` matches rewordings; (3) "the
   material doesn't mention it" was stored as a different version, silencing follow-ups; now dropped by
   `materialDiffers`; (4) search found Constantine XI for "Constantine the Great reign start date"; now the
   subject's own article is read first; (5) the follow-up reached the tutor but was skipped in most live tries,
   whatever the wording or placement; now the checker writes the sentence and the orchestrator speaks it first
   ("I looked that up and couldn't find a clear answer about exactly how long Aeneas stayed with Dido", then the
   tutor carries on): 3 of 3 live. Checks take 3 to 7 s after the flag and never touched the speaking call's
   first-word time (1 to 2 s, as before). Kept for the user to read in the Reports tab: `eeafaa71` (Aeneas
   lesson), `729d8f33` (God's Plan lesson), `2f2bafdf` (the Aeneid follow-up); the superseded test runs were
   deleted. Seen, not fixed: the tutor once explained a date difference away ("your reading just rounds it"),
   caught by the grounding audit and now named in the skill; when the thread runs long the tutor's
   simplest-form question can hand over the answer ("Just yes or no: did Romulus kill Remus?"), which is #5.

0a. Done 2026-09-25 (the fourth commit on the branch): the tutor narrated a lookup aloud ("I want to check that against the
   material before I answer you straight", asked about Aeneas). It now gets the passages matching the learner's
   latest words before it speaks (`passagesForLatestReply`, top 2, skipped for replies under 3 content words) and
   is told never to announce a lookup. Live: the Aeneas question answered in one pass, 2.7 s instead of 6.7 s; a
   Twelve Tables question from another lesson answered from the fetched passage, recorded for the grounding audit.
0. Done 2026-09-24 (commit `4da593e` on `feature/elevenlabs-voice`): the stage-direction leak. The tutor
   asked its question, called `lookup_source`, and the pass after the lookup narrated itself aloud,
   because the spaced-retrieval directive told the speaking call to record an observation it has no tool
   for. Fixed three ways: once a reply ends in its question any tool call ends the turn (`streamTurn`);
   the directive only asks, and keeps the answer out of the question; the reflect pass files the answer
   under `Session.retrievalConceptId` (it was never filed before). Live check, three sessions: clean
   openings, answer filed under the earlier concept each time. Two things seen in passing, not fixed:
   after a missed retrieval question the tutor moves on without saying the answer (retrieval works best
   with feedback), and one opening came out all lowercase. Issue #8 (narration end-of-turn silence) is
   now testable.
1. Issue #17, Inworld: code-complete 2026-09-25 (`voice/tts-inworld.ts`, one context per reply fed batch by
   batch, socket opened at `mic_start`, HTTP fallback mid-reply, Settings fields, readiness row, 17 tests).
   Verified 2026-09-25: the key is accepted (170 English voices); clip E recorded (TTS-2 first sound 282 ms
   from the tutor's first word, Flash 223 ms, no gaps; voice Duncan); a live two-turn session through the
   app spoke both turns; `speaking_rate` accepted; numbers in `docs/LATENCY.md`. Next: the user compares E
   with D by ear and picks the vendor, model and voice; the user sends the #18 email to Inworld (rewritten
   2026-09-25 to say nothing about the product: the user is keeping the idea close). Settings still has Hume
   selected. Added 2026-09-25 at the user's request: an Inworld pause slider (`inworldPauseMs`, default 220 ms
   after a full stop) that inserts SSML `<break>` tags scaled by punctuation, between sentences and at a
   sentence's own commas, dashes and colons; verified live (a 500 ms setting added about 0.5 s after a full
   stop, more after a question, less at a comma). Model trials (#22) will get their own branch.
   After the listen test, build #16 on the same path only if ElevenLabs wins. #20 (cost per session) and
   #21 (retrieval results for the parent) are the other new items from this session; #13 now covers
   children's data.
2. Issue #6, the eval harness: port the persona script to `apps/server/scripts/`, add the three Stage 1
   personas with planted misconceptions, score transcripts, run across Sonnet 5, Opus 5, Haiku 4.5.
3. Issue #3, reflect-pass latency: measure, then lower `reflectEffort` or stop blocking the next turn.
4. Issue #2, narration evidence across concepts: let the walk skip a concept already evidenced.
5. Issue #5, when the tutor may hand over an answer: write the rule, measure with #6.
6. Issue #1, workbook pages as activities: blocked on a rasterization choice (no `pdftoppm` here).
7. Issue #12, cost: medium-effort ingest experiment; cache the course block for the assessor.
8. Issues #9, #10, #11: per-learner focus, the AmblesideOnline demo, next-week suggestions.

## Landmines

- **Never read `lesson.conceptIds` live inside a running session.** Every read goes through
  `walkedConceptIds` in `apps/server/src/domain/focus.ts` (the frozen `Session.conceptIds`). Reading
  the lesson directly reintroduces the bug where a mid-session Focus edit changes the walk and
  invalidates the tutor's cached prompt prefix.
- **The speaking call never thinks and never gets bookkeeping tools.** `tutorTurn` has only
  `lookup_source` with thinking disabled; `reflectTurn` has the rest. Moving anything back puts 5 to
  15 s of silence before the first word (measured 2026-09-22).
- **The stable prefix must stay byte-identical across turns.** Blocks 0 and 1 of the tutor prompt
  (course+lesson, learner) are cached; anything per-turn goes after them.
- **`LessonSchema` and `ConceptSchema` are reused inside `CurriculumExtractionSchema`,** which goes
  through structured outputs. No `.default()`, no numeric bounds on them; new persisted fields go on
  `Course` or `Session` as `.optional()`.
- **`endSession` must `await settleReflection` first.** Without it the reflect pass saves an older copy
  over the closed session and a reported session reappears as resumable.
- **One turn in flight per session** (`respond` guards it). Two overlapping requests each read the
  session and the second to finish overwrites the first.
- **`advance` to `assess` needs a recorded observation on the concept; `next-concept` needs two.**
  Relaxing either lets an untaught concept be assessed or a concept pass on nothing.
- **The assessor must see the whole course** (`assessmentMaterial`: lesson passages, the tutor's
  retrieved passages, the rest of the course under 200k characters). With the lesson alone it told a
  parent to correct facts that were in the book.
- **`pdf-parse`'s default renderer fuses the words of an OCR text layer.** `ingest/pdf-text.ts` joins
  by glyph geometry; do not go back to the default (7,889 words instead of 24,632 on the Rome scan).
- **Observations are validated before they are stored** (`ObservationSchema.safeParse` in the
  orchestrator). The reflect pass sometimes sends `{}`; storing it makes the session unsaveable.
- **Speech from the network arrives in arbitrary byte chunks.** ElevenLabs PCM goes through
  `Pcm16Stream` (`voice/pcm.ts`), which holds back an odd trailing byte; sending half a sample to the
  browser, which reads every frame as 16-bit, turns the rest of the reply into noise.
- **The provider is read once per turn** (`activeTtsProvider()` in `live.ts`), so a reply is never voiced
  by two providers. Both must keep delivering 24 kHz, or a switch mid-session needs a reconnect.
- **ElevenLabs stitching ids** are kept per voice and model, recorded only after a request's audio played
  to the end, and never sent to `eleven_v3*` models; a refused stitched request is retried once without.
- **The reference check never runs inside the reflect pass, and its verdict is merged only at the start
  of a turn** (`mergeFinishedChecks` in `respondTurn`, and in `endSession` after the phase is set to
  complete). The next turn waits on the reflect pass, and the store reads a fresh copy of the session on
  every call, so a background job that saved the session itself would overwrite a turn's changes or be
  overwritten by them.
- **A follow-up from a check never goes against the material** (`followUpFor` returns nothing when
  `materialSays` is set). The difference goes to the parent's report instead.
- **Faith and scripture never go to Wikipedia** (`aboutFaith` in `orchestrator/outside.ts`, applied before any
  check, whatever the model decided). Narrowing that list reopens the report that told a parent, from Wikipedia,
  that "the Gospel of Luke is erroneous".
- **The profile pass lands nothing on a slow field that the previous update did not hold** (`applyRevision`).
  Relaxing it lets one odd session change how a child is taught. The pass is queued per learner and re-reads the
  record before saving; a session that is running while the pass lands sees the new profile on its next turn (the
  cached block changes once), which is accepted for now.
- **Structured outputs at high effort need a large `max_tokens`**: the model's thinking counts against it. The
  profile pass was cut off at 8,000 on its first live run; every offline pass now uses 32,000, streamed.
- **`lookup_source` searches the learner's latest words as well as the tutor's query.** Dropping that
  brings back the case where the tutor tells the learner the material does not mention a word that
  appears in one chunk.
