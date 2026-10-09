# Handoff

Last updated: 2026-10-08

Read this before anything else. It is written for a session that has seen nothing.

## Where the project stands

Homeschool-AI is a Socratic tutor for homeschool families: a parent loads one unit of the material they
already teach from, the student talks with a tutor that questions rather than lectures and asserts
nothing outside that material, and the parent gets a mastery report per session plus a running view
across sessions. Fastify server with four agents (curriculum, profiler, tutor, assessor) and a
deterministic orchestrator; Vite/React front end; file-backed JSON in `data/` (gitignored).

**State on 2026-10-06:** four branches are stacked on `main` (`807d069`), all pushed, none merged:
`feature/models-5-5` (`3ce1589`: Opus 5.5 and Sonnet 5.5, one table of what each model accepts),
`fix/told-not-recalled` (`beb4e35`: the tutor keeps track of what it has already said), `feature/intakes`
(`c9ec5fa`: the profile split into two records, the general intake, the course intake, scripted personas), and
`feature/ui-flow` on top (the tabs in the order a family meets them, the general intake held on the Students
tab when a student is added, a first lesson on a course opening with the course intake, and Hume removed: EVI
and Octave, which Hume is sunsetting). Merging `feature/ui-flow` into `main` brings all four as a fast-forward.
**The merge is the user's call**: they asked for the UI change and the Hume removal on 2026-10-06 ("before I
test") and have not said to merge. 242 unit tests; typecheck clean in both workspaces. On this machine the
runtime settings hold `claude-opus-5-5` / `claude-sonnet-5-5` and Inworld (`data/settings.json`, which wins
over `.env`; the user's `.env` still names the 5 models and Hume variables nothing reads any more). Saved
students: Test Student and Sam (profiled, four course records between them) and John (grade 9, added by the
user, no intake yet). The Rome unit (`data/courses/ancient-rome-muemem4s.json`, 31 lessons) has about fifteen
lesson sessions on it. Text mode works with an Anthropic key alone; browser voice works through Inworld (the
default) or ElevenLabs. On 2026-10-08 the runtime tutor model was switched to `claude-haiku-5-5` for the
user's trial (`data/settings.json`); the code default stays Sonnet 5.5, and Settings switches between them. **Next: the user tests the new flow themselves** (`docs/TESTING.md`): add a student on
the Students tab and hold the intake there, then start that student on a course from the Courses or Lesson tab,
in text and then by voice; the intake hand-over has not been heard aloud yet, and the user's own microphone
session in Chrome has still not happened. The user intends to pull the repo on a second laptop: git carries
neither `.env` nor `data/` (see the verification loop), and until the merge the work is on `feature/ui-flow`.

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
  Inworld (default) or ElevenLabs. Decisions below that mention Hume are kept as history.
- **The tutor turn is two calls** (speak fast with no bookkeeping and no thinking; reflect afterwards
  while the student listens), and the open thread rides with the phase guidance rather than outranking
  it. See CLAUDE.md; an earlier version that let the note outrank the phase was rejected by the user.
- **Sessions start in text mode**; voice is a deliberate choice from the dropdown.
- **The tutor's voice is switchable between providers** (user, 2026-09-24: they have
  ElevenLabs credits to use before they lapse, and want to hear the voice). The provider is the runtime
  setting `ttsProvider`, toggled at the top of Settings, Voice, with provider-specific fields below it.
  (Hume Octave was one of the choices until 2026-10-06.)
- **The voice is streamed one reply at a time, over a socket opened while the student talks** (user,
  2026-09-24, after hearing one reply voiced four ways: clip D, ElevenLabs v3 Conversational over its
  Text to Dialogue socket, "definitely sounds more natural and conversational"). Which vendor is decided
  by ear: Inworld is being trialled first (#17, cheaper and ranked higher by listeners); #16, the
  ElevenLabs socket, is on hold until clip E (Inworld) has been compared with D. No family session goes
  through Inworld until its data answers are in (#18).
- **Our own voice loop stays** (user, 2026-09-24): ElevenLabs Agents, which would run the conversation on
  ElevenLabs' side, is a roadmap item (#19), revisited only if echo or turn-taking fail in real sessions.
- **Commit to ElevenLabs over Hume** for anything Hume Octave did (cheaper per character and rated far
  higher, 2026-09-24). Overtaken on 2026-10-06: Hume was removed altogether.
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

248 tests as of 2026-10-05, all pure (no network, no binaries). For the two intakes there is a ready-made
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

Expect two balanced parts in parallel and ten to fifteen minutes at Opus 5 high effort.

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
the product (#13, #18, #23, #26). Ordering and blockers only here.

**User-side**

1. Test in the web app (both servers up, `http://localhost:5173`): add a student on the Students tab and hold
   the intake there; start them on a course from the Courses tab (the lesson opens with the course's
   questions); Focus ticks on the Courses tab; a lesson with "Already read this"; the Progress panel on the
   Reports tab.
2. Decide the hosting, copyright and children's-data line (issue #13) before anyone asks for a login page.
   Now: turn off AssemblyAI's model training in its dashboard, which needs a paid plan and also gives zero
   retention for streaming (#23), and send the two neutral vendor emails (#18 Inworld, #23 AssemblyAI).
3. Add a real ElevenLabs key to `.env` (`ELEVENLABS_API_KEY=sk_...`), restart the server, flip the
   toggle in Settings, Voice to ElevenLabs, pick a voice and model, press **Test this voice**, then run a
   voice session in Chrome at `http://localhost:5173` (the app's browser pane cannot use the microphone).
4. Read the README "What this is (and is not)" section and `docs/ROADMAP.md` in your own voice; they
   are the product statements a customer or an engineer will read.

**Claude-side, in order**

000001. Done 2026-10-08 on `feature/ui-flow` (the user: Haiku 5.5 "just came out", "significantly cheaper",
   "could be sufficient"): `claude-haiku-5-5` added to the model table and the Settings list, with its rules
   checked against the API the same day (effort low to max, default medium; `{type: "disabled"}` accepted at
   high or below and a 400 above; `between_tools` refused; the refusal-fallback beta accepted and ignored, so
   the client's own handling of `stop_reason: "refusal"` is what applies). Same tokenizer as Sonnet 5.5. A
   five-turn scripted lesson on each model, numbers in `docs/LATENCY.md`: the first word as fast (median 1.4 s
   on both), no reasoning leaking into the replies, the reflect pass blunter on Haiku (every answer "partial",
   no gap for a dodged question, no phase change in five turns, where Sonnet filed understanding and a gap and
   moved to inquire). The runtime tutor model is now Haiku 5.5 for the user's trial; the code default stays
   Sonnet 5.5. Seen in passing, on Sonnet: a reflect note said "he answered" about Test Student, whose records
   state no gender. The pronoun check covers the intake extractions (`agents/pronouns.ts`), not observation
   notes, which the assessor reads. Open.
000000. Done 2026-10-06 on `feature/ui-flow` (the user, before testing anything: "we need to change around the
   UI to make it more intuitive"; see the two standing decisions dated 2026-10-06). The tabs are Students,
   Courses, Lesson, Reports, Settings. Students: "Add and begin the intake" creates the student and opens an
   intake area under the form (Type or Talk, Begin, the passage and its questions; "Not now"; a card without a
   profile has "Start the intake"); the conversation runs inline (`apps/web/src/components/Conversation.tsx`,
   the one live view the intake and the lesson share) and, when it ends, the area says the profile is being
   written and offers Close. Lesson (was Session): student, course, lesson, mode, "Already read this", Begin; a
   student without a profile gets a notice and "Do the intake now (Students tab)", which opens the Students tab
   on their intake area; a first time on a course gets a notice that the lesson opens with the course's
   questions, with "Skip the questions this time"; every start passes `skipGeneralIntake` (new on
   `CreateSessionArgs`, `planSitting` and `POST /api/sessions`). Courses: "Start X on this course" /
   "Continue with X" open the Lesson tab preset; "Ask again" still runs the course intake alone. Hume removed:
   EVI mode, the Octave adapter, `setup:hume`, `/clm`, `/api/hume/token`, the `hume` and `@humeai/voice-react`
   packages, six files and their tests; `ttsProvider` is inworld (default) or elevenlabs; `ttsVoice`,
   `ttsVersion`, `ttsInstant` and the HUME_* variables are gone (`HUME_TTS_BATCH` is `VOICE_TTS_BATCH`); saved
   settings load field by field, so a provider that no longer exists is dropped alone and the model choices
   beside it survive. The web voice client gained `prepare()` (the audio context is created inside the click,
   where the browser allows audio) and an idempotent `connect()`, and the text opening is deferred a tick,
   because React mounts a component twice in development. Verified in the app's browser pane 2026-10-06, in
   text: the Lesson tab's two notices for John; "Do the intake now" landing on John's intake area ("Not now"
   closed it); a throwaway student added and taken through the whole general intake inline (the opening line
   once, no doubled turn; the passage read once; the hard question; "Thanks, that's everything for now";
   "This conversation is finished", the profile written within seconds); then started on Ancient Rome from the
   Lesson tab, where only the "First time on Ancient Rome" notice showed and Begin opened the course intake
   within the course ("course intake · UI Check · Ancient Rome"); then deleted with its sessions. The Courses
   tab read "Start John on this course" / "Continue with Sam", and Settings showed ElevenLabs and Inworld and
   no Hume. Not heard by
   voice (the pane has no microphone). 242 tests, typecheck clean in both workspaces. The user's own `.env`
   still carries the Hume variables, which nothing reads; they can delete them.
00000. Done 2026-09-30 on `feature/models-5-5`: Opus 5.5 and Sonnet 5.5. Per Anthropic's migration guides
   (`/claude-api migrate`): Sonnet 5.5 rejects `thinking: {type: "disabled"}` and takes `between_tools` at
   effort high or below; Opus 5.5 never turns thinking off (low effort is the control) and its own default
   effort is medium, so effort is always sent; `max_tokens` covers thinking (speak cap 700 to 1200, reflect
   700 to 2000, doctor ping 5 to 64); forced `tool_choice` is a 400 (never used here). `reasoningParams`
   reads `modelRules`; "disabled" now means the least thinking the model allows. Unknown IDs get the safe rules
   (effort on, thinking never off). The speak instruction no longer says "do not stop to weigh" (the guide:
   lines telling the model not to think make it leak internal tags). To adopt the next model: CLAUDE.md,
   conventions. Live 2026-09-30: a bad ID returns the API's "Did you mean" hint; dotted IDs save normalised;
   Sonnet 5.5 spoke three scripted turns with `between_tools` on the speak call and adaptive on the reflect
   call, TTFT 1.8 to 2.4 s (Sonnet 5 measured 1.3 to 1.5 s the same day; small samples), observations recorded.
   `thinkingChars` reads 0 on the 5.5 models (thinking text is omitted by default); `outputTokens` still counts it.
0000a. Done 2026-10-05 on `fix/told-not-recalled` (user approved the fix): told, not recalled. In the user's
   voice session of 2026-09-30 (`7e285a2c`) the tutor read out "merged around 753 B.C." (turn 8), later asked
   the learner for the date (turns 14, 16), filed "I don't remember" as a gap and "753 BC" as recall, and
   denied having said it when the learner objected (turns 20, 22). Nothing was lost: the model sees every
   turn. The first diagnosis (2026-09-30) blamed the notes and put the denial at one in three; a controlled
   replay corrected both. By the objection the tutor had already advanced to the next concept, so the
   founding notes were not in front of it; the speaking call simply misread its own transcript, taking its
   latest mention (the confirmation, after the learner) for its only one. Sixteen samples each, real prompt
   builder, `told-exp.mts` in the session scratchpad:

   | Turn replayed | Model | Before | After |
   |---|---|---|---|
   | Learner: "didn't you already tell me 753?" Tutor denies it | Sonnet 5 (the session's model) | 10 of 16 | 1 of 16 |
   | same | Sonnet 5.5 (the setting now) | 0 of 24 | 0 of 12 |
   | Tutor asks for the date it gave | Sonnet 5 | 7 of 12 | 4 of 12 |
   | same | Sonnet 5.5 | 5 of 22 | 1 of 22 |

   Those "after" figures were measured with the old session's notes. Measured again the same day with the
   note the fixed reflect pass files when the tutor reads the date out (what a session run on the fixed code
   holds): the tutor asked for the date in **0 of 80** replays of that turn on Sonnet 5.5, and every closing
   question was read by hand (they ask for "the second thing you'd tell your friend", and steer to how sure
   the story is, not to the date). It is still an instruction and a list, not a filter on what the tutor
   says: a hard stop would be a check on the closing question before it is spoken, at the cost of a short
   delay on those turns. Not built; the user asked on 2026-10-05 whether the issue persists and was told this.

   What was built: `domain/told.ts` (the key-fact figures the tutor was the first to say, across every
   concept of the walk, with its own words and how many replies ago); the speaking call gets them in its
   final instruction, the reflect call as an `<already_told>` block; observation kind `told` (the tutor's own
   words; never assessment evidence, `isEvidence`); the reflect pass records it and settles "you told me"
   in the thread as a fact; the Socratic skill has a section "What you have already told them" and the
   assessor's skill reads `told` as hinted evidence. Replayed, the reflect pass filed `told` in 13 of 13
   tries, stopped filing "recalled", and after the denial wrote "Sam is right that I gave 753 first; own it
   plainly" in 3 of 3, so a denial that slips through is corrected on the next turn. Two things it does not
   do: figures only (a prose fact the tutor gave away relies on the reflect pass), and a miss on a told
   fact is still filed as a gap, with a note that it had been told (the profile already lists that date as
   a gap, and failing to repeat something heard three minutes earlier is a weak signal, not none).
   Found on the way, not fixed: a reply that ends without a question mark followed by a late
   `lookup_source` call is spoken twice (`streamTurn` only ends the turn when the reply ends in "?"); late
   lookups happen at baseline on some turns (7 of 16 replies on the objection turn, either model). And a
   block of its own for the told figures set off late lookups in the speaking call (18 in 10 replies), which
   is why they ride in the final instruction there. Bash commands over about 8,000 characters are cut off by
   the shell wrapper on this machine: keep heredoc edits small or write a file.
0000. Done 2026-10-05 on `feature/intakes` (the user: "go with your proposed fix then move forward with
   intakes"): the two intakes, stages A to D of `docs/INTAKE.md` §8. What exists and where it differs from
   the proposal is `docs/INTAKE.md` §0; the conventions are in CLAUDE.md. In one breath: a student has two
   records (the learner profile, how to work with them; a course-knowledge record per course, what they know
   about it, with starting points from the course intake); a sitting is a chain of sessions (general intake on
   a built-in passage, course intake of one first-step question per central concept, lesson), each handing
   over inside one reply while its record is written in the background; the tutor opens a concept from the
   student's own answer, the assessor reports before and after, the profile pass revises both records, and
   undo puts both back. Verified live by three scripted students (`npm run personas:intake`): 59 of 63 checks,
   then 67 of 69, then 23 of 23 and 24 of 24 after the fixes those runs prompted (assigned pronouns, the
   passage read twice, a repeated hand-over line, a revision that only re-punctuated notes, the assessor
   not seeing the intake). The web pages were checked by reading the rendered text (the app's browser pane
   would not take screenshots that day), and the notes, undo, forget, ask-now and skip flows through the API.
   **Left open, in order of how much they matter:**
   (a) not heard by voice yet: the hand-over reply is two calls back to back (4 to 11 s in all, words from
   the first second), and the passage is about a minute of speech; listen for the join and for barge-in
   during the reading;
   (b) faith is never asked about in the course intake (`aboutFaith` on a concept's name and summary): my
   call from §5 of the design, told to the user, who may want it otherwise for their own curriculum;
   (c) a correct guess is filed as "some knowledge" with a low number, not "nothing yet";
   (d) the tutor sometimes drops "how sure?" on the question after an "I don't know";
   (e) Sam's Rome record carries a gap from the 2026-09-30 session that the told fix would no longer file
   ("could not produce the founding date": the tutor had told him); the next pass on that course can clear
   it, or the parent can Forget the record;
   (f) in a lesson the tutor asks for a line "word for word" although the student may not have the reading
   in front of them (a scripted student said so; the report repeated it to the parent);
   (g) read-aloud fluency, a periodic refresh of the general intake: not built, by decision.
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
   2026-09-25 to say nothing about the product: the user is keeping the idea close). Settings has Inworld
   selected since 2026-10-05. Added 2026-09-25 at the user's request: an Inworld pause slider (`inworldPauseMs`, default 220 ms
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
