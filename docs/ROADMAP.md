# Roadmap

What is deliberately not built yet, each with the trigger that would start it and the first concrete
step. The scope this sits on is in [ARCHITECTURE.md](ARCHITECTURE.md): one unit of the family's own
material at a time, a Socratic session, a report to the parent; not a curriculum, a scheduler, or a grader.

## 1. Workbook and activity pages (first)

Much homeschool material is activity pages, not prose: matching, cut-and-paste, fill-in-the-blank, map
labelling, timelines, diagrams, math worksheets. The Good and the Beautiful's Student Explorers, Christian
Light's LightUnits and Homeschool Journey's portfolios are all of this kind. Today the text layer of such
a page is fragments or nothing, so the curriculum agent gets little to build from.

**Direction:** read those pages *as activities* rather than as text. `ingest/ocr.ts` already sends page
images to the model for verbatim transcription; a second reading mode would ask the model what the page
asks the student to do, the labels on any map or diagram, and any answer key, and return that as typed
activity items linked to concepts. The parked Canvas design (branch `canvas-qti-import`) already argued
for a typed `AssessmentItem` instead of flattening into `practiceItems: string[]`; reuse that thinking.
Two decisions come with it: how to rasterize PDF pages (this machine has no `pdftoppm`; a JavaScript
renderer, or asking for image export as the scan path does today), and how the tutor uses an activity in
dialogue (ask the student to explain their answer, not to redo the worksheet).

**Sized on real material (2026-09-23):** The Good and the Beautiful's History Year 1 Student Explorer
sample for grades 7-8, 41 pages. 17 pages are prose "lesson extension" articles of about 690 words each
(Imhotep, the Sistine Chapel, Marconi), which the tool can teach from today. 20 pages are activities,
and their loss comes in three tiers: vector-drawn tasks (a picture cipher, Morse code, a sixty-name
family tree, art references) leave no text at all; maps and diagrams keep their labels but lose the
spatial task; two-column pages come out with the columns interleaved line by line. All five map
activities also send the student to the separate course book for the instructions, so reading the page
perfectly would still not ground the tutor in what the child was asked to do. The sample has no answer
key. By text volume the file looks 63% prose; by page count it is half activities, which is where the
graded work lives.

**Next step:** a reading mode that returns typed activity items from page images, tested on those 20
pages, plus column-aware text for the mostly-textual ones.
**Trigger:** any family whose unit is mostly workbook pages.

## 2. What the first Ancient Rome sessions showed (2026-09-23/24)

- **Fixed:** the grounding audit saw only the lesson's own passages and told a parent to correct facts
  that were in the book. The assessor now audits against the lesson's passages, the passages the tutor
  looked up (`Session.retrievedChunkIds`), and the rest of the course when it fits 200k characters;
  above that it is told it does not have everything and must not claim the book is silent.
- **A narration produces evidence for several concepts at once**, but the phase machine walks one
  concept at a time: the reflect pass filed the student's consul evidence under concept 2 while the
  session was still on concept 1, and the tutor had to come back for concept 1's two observations before
  it could advance. Worth letting the reflect pass credit any walked concept the narration covered, so
  the walk can skip what the narration already proved.

## 3. Voice narration

When "Already read this" is on, the first student turn needs a longer end-of-turn silence so a narration
is not cut off at a pause (`sttMaxSilenceMs` in `voice/live.ts`). Untestable until the Hume balance is
topped up.

## 4. Per-learner focus

Siblings sharing one unit at different levels. `Course.focus` is per family today; a per-learner override
merged at `createSession` is additive and needs no migration.

## 5. A Charlotte Mason week as a second demo

One chapter of an AmblesideOnline Year 7 book (Churchill's *Birth of Britain* ch. 1 plus Asser's *Life
of King Alfred*, both free), to prove narration-first on the reading it was designed for. Needs "one
chapter of a Gutenberg book" ingest: the URL path today takes a whole page.

## 6. "Suggest next week's focus"

From the Progress panel, without becoming a scheduler: the report's `recommendedNext` already exists;
this would rank kept concepts by latest level and staleness.

## 7. Pedagogy evals

The Stage 4 simulated-student harness in [TESTING.md](TESTING.md), and the Sonnet/Opus/Haiku comparison,
both better run against the Ancient Rome course than the photosynthesis sample.
