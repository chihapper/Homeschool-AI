# Handoff

Last updated: 2026-09-24

Read this before anything else. It is written for a session that has seen nothing.

## Where the project stands

Homeschool-AI is a Socratic tutor for homeschool families: a parent loads one unit of the material they
already teach from, the student talks with a tutor that questions rather than lectures and asserts
nothing outside that material, and the parent gets a mastery report per session plus a running view
across sessions. Fastify server with four agents (curriculum, profiler, tutor, assessor) and a
deterministic orchestrator; Vite/React front end; file-backed JSON in `data/` (gitignored).

**State on 2026-09-24:** `main` is at the merge of pull request #15 ("Homeschool content and app
scoping"), commit `c8ef7db`. 107 unit tests pass, typecheck is clean in both workspaces. The first real
unit, the Fords' *Ancient Rome* parent's guide from Saint Emmelia Ministries (49 scanned pages), is
ingested as a course in `data/courses/ancient-rome-muemem4s.json` (31 lessons, 110 concepts) and has
been taught in four sessions, three of them assessed. Text mode works with an Anthropic key alone; all
voice output is blocked because the Hume balance is exhausted.

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
- **Workbook and activity pages are a roadmap item, not an accepted limitation** (user, 2026-09-23:
  "many homeschool materials likely include that"). Issue #1, sized on a real sample.
- **The tutor turn is two calls** (speak fast with no bookkeeping and no thinking; reflect afterwards
  while the student listens), and the open thread rides with the phase guidance rather than outranking
  it. See CLAUDE.md; an earlier version that let the note outrank the phase was rejected by the user.
- **Sessions start in text mode**; voice is a deliberate choice from the dropdown.
- **Reports and profiles use the learner's name** unless the transcript gives a pronoun. A report said
  "your son" from nothing; the user's records carry no gender.
- **Research and report-writing subagents run on Sonnet, not Fable** (user, 2026-09-23); the main
  session does the analysis.
- **Commits end with** `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; pull request
  descriptions end with the Claude Code attribution line. The repo has no configured git identity: the
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

107 tests as of 2026-09-24, all pure (no network, no binaries). The end-to-end check for tutoring
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
- **`data/samples/` is tracked by git.** Never copy a family's or a publisher's PDF there; ingest by
  absolute path.
- **The Good and the Beautiful sample** (43 MB) lived only in a session's temporary folder and may be
  gone; re-download from `files.thegoodandthebeautiful.com/History/Samples/` if issue #1 needs it.

## Work queue

The backlog is GitHub issues 1 to 14 on chihapper/Homeschool-AI; run `gh issue list`. Ordering and
blockers only here.

**User-side**

1. Test in the web app (both servers up, `http://localhost:5173`): Focus ticks on the Courses tab, a
   session with "Already read this", the Progress panel on the Reports tab.
2. Decide the hosting and copyright line (issue #13) before anyone asks for a login page.
3. Top up the Hume balance if voice matters this month; issue #8 and all voice checks are blocked on it.
4. Read the README "What this is (and is not)" section and `docs/ROADMAP.md` in your own voice; they
   are the product statements a customer or an engineer will read.

**Claude-side, in order**

1. Issue #6, the eval harness: port the persona script to `apps/server/scripts/`, add the three Stage 1
   personas with planted misconceptions, score transcripts, run across Sonnet 5, Opus 5, Haiku 4.5.
2. Issue #3, reflect-pass latency: measure, then lower `reflectEffort` or stop blocking the next turn.
3. Issue #2, narration evidence across concepts: let the walk skip a concept already evidenced.
4. Issue #5, when the tutor may hand over an answer: write the rule, measure with #6.
5. Issue #1, workbook pages as activities: blocked on a rasterization choice (no `pdftoppm` here).
6. Issue #12, cost: medium-effort ingest experiment; cache the course block for the assessor.
7. Issues #9, #10, #11: per-learner focus, the AmblesideOnline demo, next-week suggestions.

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
- **`lookup_source` searches the learner's latest words as well as the tutor's query.** Dropping that
  brings back the case where the tutor tells the learner the material does not mention a word that
  appears in one chunk.
