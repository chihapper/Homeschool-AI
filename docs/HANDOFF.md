# Handoff

Last updated: 2026-11-07

Read this before anything else. It is written for a session that has seen nothing.

## Where the project stands

Homeschool-AI is a Socratic tutor for homeschool families: a parent loads a course of the material they
already teach from, the student talks with a tutor that questions rather than lectures and asserts
nothing outside that material, and the parent gets a mastery report per session plus a running view
across sessions. Fastify server with seven agents (curriculum, the two intakes, tutor, assessor, reference
checker, profile reviser) and a deterministic orchestrator; Vite/React front end; file-backed JSON in `data/`
(gitignored).

**State on 2026-11-07:** four branches are stacked on `main` (`807d069`, which still carries the state of
2026-09-28), all pushed, none merged: `feature/models-5-5` (`3ce1589`), `fix/told-not-recalled` (`beb4e35`),
`feature/intakes` (`c9ec5fa`) and `feature/ui-flow` on top at `b1e11c1` (the UI in the order a family meets it,
Hume removed, Haiku 5.5, the per-role model settings, the OpenAI adapter for the report, the session clock, the
meter, the Courses tab's background builds, the own-words fix, the reports' growth view). Merging
`feature/ui-flow` into `main` brings all four as a fast-forward; **the merge is the user's call**. Because
nothing is merged, the GitHub default branch — what anyone browsing the repo reads — is six weeks behind the
build. 285 unit tests in 33 files, green on 2026-11-07; typecheck clean in both workspaces. Runtime settings on
this machine (`data/settings.json`, which wins over `.env`):
Haiku 5.5 speaks, Sonnet 5.5 takes the notes, Sonnet 5.5 writes the report (the user's decision of 2026-10-09
after two sessions compared, `docs/COST.md`), Opus 5.5 does the rest; Inworld is the voice. The product
assumption is full voice (user, 2026-10-09): typing is for testing and may go. A lesson now runs on the
parent's clock (Settings, 3 to 60 minutes, default 30) and every call is metered (`docs/COST.md`, the meter). `.env` holds the
Anthropic, AssemblyAI, Inworld, ElevenLabs and OpenAI keys, and still names the 5 models and the old Hume
variables, which nothing reads. Saved students: Test Student and Sam (profiled, four course records between
them) and John (grade 9, no intake yet). The Rome unit (`data/courses/ancient-rome-muemem4s.json`, 31
lessons) has about fifteen lesson sessions on it. Text mode works with an Anthropic key alone; browser voice
works through Inworld (the default) or ElevenLabs. **Next: the user tests the new flow themselves**
(`docs/TESTING.md`): add a student on the Students tab and hold the intake there, then start that student on
a course, in text and then by voice; the intake hand-over has never been heard aloud, and the user's own
microphone session in Chrome has still not happened. The user intends to pull the repo on a second laptop:
git carries neither `.env` nor `data/` (see the verification loop), and until the merge the work is on
`feature/ui-flow`.

**Goal and gate:** get the tool in front of homeschool families as an add-on study partner. The next
gate is a repeatable pedagogy evaluation (issue #6) so skill edits stop being judged by hand, then a
decision on hosting (issue #13) before any pilot. No deadline has been set.

## Standing decisions

- **A student has two records, and two intakes write them** (user, 2026-09-27 and 2026-09-28; built
  2026-10-05). The general intake runs once per student, on a passage built into the app, never on the
  family's course (the old intake taught lesson one before the lesson, twice). The course intake runs once
  per student per course, asks and never teaches. No learning-style field: the middle path the user chose is
  observed behaviour-when-confused in the guidance, the parent's own words in a notes box, and a sentence on
  the Students tab saying why. Questions come in three bands by grade and step up or down on the answer.
  "How sure, 0 to 10?" rides in the same turn as each course-intake question.
- **The course intake never asks about faith** (Claude's reading of `docs/INTAKE.md` §5, 2026-10-05; told
  to the user, not yet confirmed by them). Concepts about scripture or faith are left to the lesson, where
  the family's material speaks. If the user wants them asked on their own curriculum, it is one predicate
  (`notAskedAbout` in `orchestrator/session.ts`).
- **Scripted test students are deleted after a run** unless `--keep`; the user's two test students and their
  records are theirs.
- **Scope is an add-on, not a curriculum engine** (user, 2026-09-23). One course of the family's own
  material at a time — uploaded as they bought it, lesson book and student journal together, not unit by
  unit, and with no subject or course hierarchy above it (user, 2026-10-12) — Socratic sessions, a parent's
  progress view. No scheduling, no planning of
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
- **Learning styles: no field, no matching, no quiz** (user, 2026-09-28, choosing the middle path in
  `docs/INTAKE.md` §3). The tutor records what a student does when confused as guidance for the opening move
  only; the path (teach-first or question-first) follows prior knowledge; the parent's language lives in the
  parent's notes; the Students tab says in one sentence why children are not sorted into styles. The
  `intakePreferences` field goes in stage A. Also decided: "how sure are you, 0 to 10?" rides in the same
  turn as each course-intake probe; the general intake's questions come in three age bands, stepped up or
  down.
- **The product is not a Khanmigo duplicate** (checked 2026-09-28, `docs/COMPETITORS.md`): Khanmigo tutors
  only Khan's content (photo upload only), is turn-based in voice, and gives parents transcripts; the big-lab
  study modes take uploads but are not constrained and give parents nothing; only Gemini Notebook is
  constrained, and it is adults-first with no pedagogy. The moat is the combination (own material, constrained
  and audited, live voice, parent mastery report, worldview rules, family-held data) and the homeschool focus,
  not any one feature. The Khanmigo RCT (+0.06–0.08 SD a year, "resemble ... practice without AI") is the
  warning that engagement and real gains, not features, are the risk: #6.
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
- **The general intake is held where a student is added; the course intake where the course is taught**
  (user, 2026-10-06: "Student intake should exist in the students section as a separate area when adding a
  student so that when someone is added, the intake happens when they are added. Then, when a student first
  starts the course, then the intake for that course will occur within that course"). In the web app:
  Students tab, "Add and begin the intake" opens an intake area for the new student (Type or Talk, Begin;
  "Not now", and a card's "Start the intake" for later); the Lesson tab starts every sitting with
  `skipGeneralIntake`, so a first lesson on a course opens with the course intake and the general intake
  never runs from there (a student without one gets a notice and a button to the Students tab). The CLI and
  the API still run all three in one sitting.
- **Hume is gone** (user, 2026-10-06: Hume is sunsetting EVI and its text-to-speech). EVI mode, the Octave
  adapter, `setup:hume`, the `/clm` endpoint and the `hume` packages were removed; the tutor's voice is
  Inworld (default) or ElevenLabs.
- **A cheap speaker, a careful note-taker** (user, 2026-10-08: "I think we'll keep Sonnet for the notes as Haiku
  could miss a lot"). The reflect pass runs on its own model, `reflectModel` (Settings "Notes model", empty means
  the tutor's); the live setting is Haiku 5.5 speaking, Sonnet 5.5 taking notes. Each model keeps its own prompt
  cache, one extra write per session, off the clock.
- **Cost is a product constraint** (user, 2026-10-08: "this is increasingly getting pricey"; thinking about
  other vendors and open models, gut says only Gemini, GPT or Anthropic would do). `docs/COST.md` holds the
  measurements and the levers. Harness runs are quoted before they run.
- **The report runs on Sonnet 5.5; OpenAI stays wired in for the report only** (user, 2026-10-09: "Let's just
  stick with Sonnet", after asking on 2026-10-08 to try GPT-6.1 Sol). Two sessions compared, `docs/COST.md`:
  Sonnet matched Opus 5.5 level for level at half the cost; Sol gave its own levels, slower at high effort,
  terser until the skill was made explicit. `llm/openai.ts` is the adapter behind `streamParsed`, and the
  settings route lets only `assessorModel` be an OpenAI ID; the live tutor and the other offline agents stay
  on the Claude API. OpenAI's terms as read 2026-10-08: API traffic not used for training, abuse-monitoring
  logs up to 30 days, `store: false` keeps responses out of application state; nothing about children's data.
- **The tutor turn is two calls** (speak fast with no bookkeeping and no thinking; reflect afterwards
  while the student listens), and the open thread rides with the phase guidance rather than outranking
  it. See CLAUDE.md; an earlier version that let the note outrank the phase was rejected by the user.
- **Sessions start in text mode**; voice is a deliberate choice from the dropdown.
- **The tutor's voice is switchable between providers** (user, 2026-09-24: they have
  ElevenLabs credits to use before they lapse, and want to hear the voice). The provider is the runtime
  setting `ttsProvider`, toggled at the top of Settings, Voice, with provider-specific fields below it.
- **The voice is streamed one reply at a time, over a socket opened while the student talks** (user,
  2026-09-24, after hearing one reply voiced four ways: clip D, ElevenLabs v3 Conversational over its
  Text to Dialogue socket, "definitely sounds more natural and conversational"). Inworld (#17, cheaper and
  ranked higher by listeners) has been the default since 2026-10-05; #16, the ElevenLabs socket, stays on
  hold unless the user prefers ElevenLabs by ear. No family session goes through Inworld until its data
  answers are in (#18).
- **Our own voice loop stays** (user, 2026-09-24): ElevenLabs Agents, which would run the conversation on
  ElevenLabs' side, is a roadmap item (#19), revisited only if echo or turn-taking fail in real sessions.
- **Reports and profiles use the learner's name** unless the transcript gives a pronoun. A report said
  "your son" from nothing; the user's records carry no gender.
- **Research subagents run on Opus 5.5** for research the user will build on (user, 2026-09-27, for the
  intake research; the 2026-09-23 decision was Sonnet); the main session does the analysis.
- **Commits end with the `Co-Authored-By` line the harness gives for the model in use** (it changed from
  Fable 5.1 to Opus 5.5 on 2026-09-24); pull request descriptions end with the Claude Code attribution
  line. Commit when a piece of work is done and pushes are authorized (the user pulls the repo on a second
  laptop); merge only when the user says so. The repo has no configured git identity: the existing commits
  are by "Claude <noreply@anthropic.com>", so commit with
  `git -c user.name=Claude -c user.email=noreply@anthropic.com commit ...`. The GitHub CLI holds two logins;
  `chihapper` must be the active one to push (`gh auth switch --user chihapper`).
- **Explain at the user's level.** They are a technical consulting partner, not a career engineer:
  define terms inline, lead with what happened and why it matters, give real tradeoffs and one
  recommendation (global instructions, `explain-on-my-level` skill).

## The verification loop

Before any commit:

```bash
npm test && npm run typecheck
```

285 tests in 33 files as of 2026-11-07, all pure (no network, no binaries). For the two intakes there is a ready-made
end-to-end check: `npm run personas:intake`, with the server running, plays three scripted students
(confident, quiet, a bluffer) through the general intake, the course intake and the start of the lesson,
waits for both records, and prints the transcripts and about twenty checks each (`--only quiet`, `--keep`,
`--report`; real model calls, about three minutes). The end-to-end check for other tutoring
changes is a scripted session through the HTTP API: create a session, post persona lines to
`/api/sessions/:id/message` reading the SSE stream until `reflected`, then `POST /end` and read the
report and `GET /api/progress/:learnerId/:courseId`. The Python prototype is pasted into issue #6;
the pattern is also in `docs/TESTING.md` Stage 1b.

To rebuild the Rome course (the PDF is outside the repo, in the user's Downloads):

```bash
npm run ingest -- --title "Ancient Rome" "C:\Users\Alejandro\Downloads\8 Ancient Rome.pdf"
```

Expect two balanced parts in parallel and ten to fifteen minutes at Opus 5.5 high effort. For the report:
`npm run assess:compare -- <sessionIdPrefix> label=model@effort ...` assesses one saved session with several
models, saves nothing to the app, and writes the reports to `data/experiments/assessor/` (real calls, $0.10
to $0.40 a run).

The user intends to pull the repo on a second laptop and host it there (2026-09-28). What git does **not**
carry: `.env` (every key, and `WIKIPEDIA_CONTACT`), and `data/` (the Rome course, learners, sessions,
reports, `settings.json`). Copy `data/` across or re-ingest the Rome PDF; copy `.env` by hand, never through
git or chat. Node 20+ and `npm install` at the root.

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
the product (#13, #18, #23, #26). Ordering and blockers only here; the detail of finished work is in git
history and in the docs each entry names.

**The issue tracker is behind the build** (checked 2026-11-07): #17 (Inworld TTS) was built 2026-09-25,
#20 (usage per turn) was built 2026-10-09 as the meter, and #7 and #28 are the only issues closed since
September besides #4. Only #28 of the finished work is closed. Nothing depends on this, but `gh issue list`
reads as a longer backlog than there is; closing #17 and #20 is the user's call.

**User-side**

1. Decide the profile pass's model: replayed on the same two sessions (`npm run profile:compare`), Sonnet 5.5
   proposed nearly the same revisions as Opus 5.5 at half the cost (`docs/COST.md`); the setting would be a
   `profileModel` beside the others, one small change. Both models wrote "he" for Sam there (Claude-side 2).
2. Test in the web app (both servers up, `http://localhost:5173`): add a student on the Students tab and hold
   the intake there; start them on a course from the Courses tab (the lesson opens with the course's
   questions); Focus ticks on the Courses tab; a lesson with "Already read this"; the Progress panel on the
   Reports tab. Then the same by voice in Chrome (the app's browser pane has no microphone): the intake
   hand-over and the passage have never been heard aloud.
3. Merge when satisfied: `feature/ui-flow` into `main` brings the four stacked branches as a fast-forward.
   `b1e11c1` (the reports' growth view) is committed locally but **not pushed**: `origin/feature/ui-flow` is
   one commit behind, so a pull on the second laptop would miss it.
4. Decide the hosting, copyright and children's-data line (issue #13) before anyone asks for a login page.
   Now: turn off AssemblyAI's model training in its dashboard, which needs a paid plan and also gives zero
   retention for streaming (#23), and send the two neutral vendor emails (#18 Inworld, #23 AssemblyAI).
5. Read the README "What this is (and is not)" section and `docs/ROADMAP.md` in your own voice; they
   are the product statements a customer or an engineer will read.

**Claude-side, open, in order**

1. Issue #6, the eval harness: port the persona script to `apps/server/scripts/`, add the three Stage 1
   personas with planted misconceptions, score transcripts, run across Haiku 5.5, Sonnet 5.5 and Opus 5.5.
   `scripts/assess-compare.ts` is the report half of it already.
2. Pronouns in session notes and reports: a reflect note said "he answered" about Test Student (2026-10-08,
   Sonnet) and a Luna report wrote "he" for Sam (2026-10-09); neither record states a gender.
   `agents/pronouns.ts` checks the intake extractions only; observation notes and the report's prose need the
   same check in code, since the rule in the skills does not hold on its own.
3. Issue #3, reflect-pass latency: measure, then lower `reflectEffort` or stop blocking the next turn.
4. Issue #2, narration evidence across concepts: let the walk skip a concept already evidenced.
5. Issue #5, when the tutor may hand over an answer: write the rule, measure with #6.
6. Issue #1, workbook pages as activities: blocked on a rasterization choice (no `pdftoppm` here).
7. Issue #12, cost: medium-effort ingest experiment; cache the course block for the assessor.
8. Issues #9, #10, #11: per-learner focus, the AmblesideOnline demo, next-week suggestions.
9. Left open from the intakes (2026-10-05), in order of how much they matter: (a) the hand-over and the
   passage not yet heard by voice; (b) faith is never asked about in the course intake (`aboutFaith`),
   Claude's call, not yet confirmed by the user; (c) a correct guess is filed as "some knowledge" with a low
   number, not "nothing yet"; (d) the tutor sometimes drops "how sure?" after an "I don't know"; (e) Sam's
   Rome record carries a stale gap ("could not produce the founding date": the tutor had told him), cleared
   by the next pass or by Forget; (f) in a lesson the tutor asks for a line "word for word" though the student
   may not have the reading in front of them; (g) read-aloud fluency and a periodic refresh of the general
   intake: not built, by decision.
10. Seen, not fixed: a reply that ends without a question mark followed by a late `lookup_source` call is
    spoken twice (`streamTurn` ends the turn only on "?"); after a missed retrieval question the tutor moves
    on without giving the answer; one opening came out all lowercase; when a thread runs long the
    simplest-form question can hand over the answer (#5).

**Done, newest first** (one line each; the commit and the doc carry the detail)

- 2026-11-07: the documentation sweep in this file's "Where the project stands" — README, ARCHITECTURE,
  LATENCY, ROADMAP, TESTING, RESEARCH and COMPETITORS brought up to the build as of `b1e11c1` (no Hume as a
  live component anywhere, the supported file formats, the background course build, the clock, the meter, the
  growth view, "one course" not "one unit"). No code changed.

- 2026-11-03 (`b1e11c1`): the reports say where each concept started against where it is now.
  `domain/progress.ts` gained a pure growth read-model (`buildGrowth`, `START_LEVEL`) over the reports and the
  course intake's starting points that already exist — nothing new is stored. Each concept is classified
  gained / held / below / untested / no-baseline; coverage counts only concepts the parent still teaches
  (`isConceptKept`), and a concept skipped after it was assessed keeps its history marked `dropped`. The
  Reports tab shows "N of M concepts taught", the biggest move, and a Move column beside "Before the course".
  The point a parent needs: a concept the child could already explain has to reach "applies to a new case"
  before it counts as learning — on Andy's Marine Biology session that turned two reassuring level 2s into
  "2 of 48 concepts taught" and "1 concept where they started". A starting point is a self-report, not an
  assessed level, and the view says so.

- 2026-10-12: the tutor no longer argues over wording (Andy's first Marine Biology lesson: a right answer pressed
  for "less dense" instead of "lighter", a contradiction claimed that was not there, four minutes on density,
  which Andy knew, instead of the current topic). Own words count (socratic-method skill, the speaking and reflect
  instructions, the report skill); "I already said that" is checked and conceded; the speaking call sees the notes
  on the previous answer (`notesOnPreviousAnswer`); a lesson opens on its current concept and a concept the student
  could already explain gets a new case, not teaching; the reflect pass reads each reply once (`withReply`, and
  `toldFigures` counts it once); notes say "they". Measured with `npm run replay:lesson` on the real turns: opening
  on the current topic 0/4 before, 4/4 after; pressing "lighter" 3/3 before, 0/2 after the last change; conceding
  "I already said that" 0/3 before, 3/3 after. Copy: upload the course as you have it; no unit hierarchy (user).

- 2026-10-12: a course build can be cancelled (popup, corner list, Courses page; the model call is dropped and
  nothing is saved; POST /api/jobs/:id/cancel); the ring shows a percent sign.

- 2026-10-12: Courses tab reworked at the user's request: "Add a course" is a popup; a build is a background job
  with an estimated percentage, a ring in the top-right corner and a notice when it is ready or has failed;
  course cards start folded; publisher and grades are fields (read from the material, editable). The user's
  Good and the Beautiful build "missed lesson 3": the Student Journal has no Lesson 3 page (its own contents
  go 1, 2, 4); the lesson-title rule now keeps the material's labels verbatim ("Lesson 6–7"). The course book
  (147 MB, all twelve lessons) had been refused by the 50 MB upload cap; the cap is now 500 MB per file, and
  the user is to rebuild from the course book.

- 2026-10-12: the user's first intake on the new flow (Andy) exposed three gaps, all fixed and checked live: a tab
  switch closed the intake area, the parent added Andy again and the profile landed on the second record (the open
  area and an intake in progress now live in `App`; one name per student, 409 from `POST /api/learners`; the empty
  duplicate is in `data/backups/`); the card did not fill in when the profile landed (the tab now looks again every
  four seconds while one is being written); and the tutor said "the passage" out loud (now "what I read you", in
  the fixed questions, the skill and the agent's instructions; one scripted intake confirmed it, 7 cents).

- 2026-10-09: the session clock (`domain/clock.ts`, `sessionMaxMinutes` 3 to 60, a warning with two minutes
  left, the closing reply at the limit, the browser ends the session once it is heard; lessons only; the stage, read back through `clockStage`, replaces the phase-and-thread block in the closing reply, leads the final instruction and closes the last user message, because as an `<orchestrator>` directive and then as a final instruction alone it was ignored, 2026-10-09) and the
  meter (`domain/cost.ts`, `llm/prices.ts`: usage recorded on every turn, report, profile update, intake record,
  check and course build; `GET /api/sessions/:id/cost`, `GET /api/usage`; cost lines on the lesson panel, the
  report and each student's card). `scripts/profile-compare.ts` (`npm run profile:compare`) and the Opus-versus-
  Sonnet replay of the profile pass. Full voice is the product assumption.
- 2026-10-09: the report model set to Sonnet 5.5 after two sessions compared; the mastery-assessment skill's
  Summaries section made explicit; `scripts/assess-compare.ts` (`npm run assess:compare`); time-to-first-word
  and reasoning tokens on `usage` from both vendor paths; the documentation sweep (`docs/COST.md`).
- 2026-10-08: `llm/openai.ts`, the OpenAI adapter behind `streamParsed` (report only); GPT-6.1 Sol and GPT-6
  Luna assessed on the Rome session (`82fe020`, `533ab9d`).
- 2026-10-08: `assessorModel` and `reflectModel` runtime settings (Settings "Report model", "Notes model");
  `assessSession` gained `onUsage`; `docs/COST.md` begun (`0ff6a16`, `d9eb5d8`).
- 2026-10-08: `claude-haiku-5-5` in the model table, rules checked against the API, measured against Sonnet 5.5
  on a scripted lesson (`docs/LATENCY.md`) (`e547117`).
- 2026-10-06: tabs in the order a family meets them; the general intake held on the Students tab when a student
  is added; a first lesson opens with the course intake; `components/Conversation.tsx` shared by both;
  `skipGeneralIntake`; Hume removed (EVI, Octave, `setup:hume`, `/clm`, the packages); saved settings load
  field by field; `VoiceClient.prepare()` and an idempotent `connect()` for React's double mount (`a4d02b8`).
- 2026-10-05: the two intakes (`docs/INTAKE.md` §0): two records with a migration, the general intake on a
  built-in passage, the course intake, the sitting as a chain with the hand-over inside one reply, records
  written in the background, a pronoun check in code, three scripted personas (`13f7b82`).
- 2026-10-05: told, not recalled: `domain/told.ts`, observation kind `told`, the `<already_told>` block; the
  tutor asked for a date it had given in 0 of 80 replays afterwards (`beb4e35`).
- 2026-09-30: Opus 5.5 and Sonnet 5.5, with one table of what each model accepts (`llm/models.ts`) (`3ce1589`).
- 2026-09-27: the dynamic profile (#28): a profile pass after every report, slow fields held until two sessions
  agree, undo; facts from outside the material: `flag_outside_claim`, the Wikipedia check as a background job,
  "Outside the reading" in the report, faith never checked (`a91f2e4`).
- 2026-09-25: Inworld as a voice (#17), one context per reply over a socket opened at `mic_start`, the pause
  slider; the lookup narrated aloud fixed (`passagesForLatestReply`).
- 2026-09-24: ElevenLabs as a voice and the Settings voice card; the stage-direction leak fixed (`4da593e`).

## Landmines

- **A key removed from a record's schema is dropped silently the next time the record is saved** (the store
  parses with Zod, which strips unknown keys). Moving or removing a persisted field needs a migration that
  runs before anything writes: `store/migrate.ts`, called when a server or CLI starts, never on import (tests
  import the store).
- **An intake's record is written in the background, never before the reply.** The hand-over line and the next
  session's opening are one reply (`respondTurn` continues into the next session); the profile or the course's
  starting points land a minute later (`writeIntakeRecord`). Awaiting the extraction before answering brings
  back thirty seconds of silence and "wait are we done already?" (2026-09-15).
- **Editing a server source file restarts the dev server** (`tsx watch`) and kills whatever it was writing in
  the background: an intake's record, a profile pass, a reference check. The pending marks
  (`Learner.profilePending`, `CourseKnowledge.pending`) are how the next `createSession` picks an intake's
  record up again; a profile pass that dies is simply lost. Do not edit `apps/server/src` while a scripted run
  is in flight.
- **The passage is spoken by the orchestrator and read once.** The model asks with `read_passage`; once the
  transcript holds the passage the tool is no longer offered. Never let the model read or paraphrase it.
- **No learning-style field, and no question about how a child "learns best"**, however it is renamed. The
  entry point of a concept follows what the student knows about it. `intakePreferences` was removed on purpose.
- **A record must not give a child a gender nobody stated.** The intake extractions are checked in code
  (`agents/pronouns.ts`); anything new that writes prose about a student needs the same check, because the
  rule in a skill does not hold on its own.
- **Bash commands over about 8,000 characters are cut off by the shell wrapper on this machine**, which shows
  up as "unexpected EOF while looking for matching quote". Keep heredoc edits small, or write the text to a
  file and apply it with a script.
- **Never read `lesson.conceptIds` live inside a running session.** Every read goes through
  `walkedConceptIds` in `apps/server/src/domain/focus.ts` (the frozen `Session.conceptIds`). Reading
  the lesson directly reintroduces the bug where a mid-session Focus edit changes the walk and
  invalidates the tutor's cached prompt prefix.
- **The speaking call gets the least thinking its model allows and never gets bookkeeping tools.**
  `tutorTurn` has only `lookup_source` and asks `reasoningParams` for thinking "disabled", which the model
  table turns into `{type: "disabled"}` (Opus 5, Sonnet 5), `{type: "between_tools"}` (Sonnet 5.5) or plain
  adaptive at low effort (Opus 5.5, Fable: never send "disabled" to them, it is a 400); `reflectTurn` has the rest. Moving anything back puts 5 to
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
- **The general intake's prompt cache turns over once, after the passage.** `read_passage` is dropped from the
  tool list once the transcript holds the passage, and the tools are part of the cached prefix, so the next turn
  is a cache write (seen 2026-10-06: 0% hit on the turn after the reading, hits again from then on). One write
  per intake; do not "fix" it by offering the tool again.
- **React mounts every component twice in development** (StrictMode in `apps/web/src/main.tsx`). Anything a
  conversation does on mount must survive that: the text opening is deferred a tick and cancelled by the first
  run's cleanup (`components/Conversation.tsx`), and `VoiceClient.connect()` joins an earlier call instead of
  opening a second socket. The server opens a fresh session the moment a voice socket connects, so a second
  socket would mean a second opening line.
- **The browser allows audio only after a click.** The page creates the `VoiceClient` and calls `prepare()`
  inside the button handler; `Conversation` attaches its listeners and calls `connect()` when it mounts. A
  connection made from an effect alone starts with a suspended audio context and the tutor is never heard.
- **Only the report may leave the Claude API.** `streamParsed` routes a `gpt-` ID to `llm/openai.ts`; the tutor
  loop (`agents/base.ts`), the doctor ping and OCR call the Claude API directly, and the settings route refuses
  an OpenAI ID anywhere but `assessorModel`. Routing another setting to OpenAI means checking its caller first.
