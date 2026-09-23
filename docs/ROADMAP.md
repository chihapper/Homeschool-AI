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

**First step:** classify every page of The Good and the Beautiful History Year 1 sample (Student
Explorer, grades 7-8) as prose, activity, or image, to size the problem on real material.
**Trigger:** any family whose unit is mostly workbook pages.

## 2. Voice narration

When "Already read this" is on, the first student turn needs a longer end-of-turn silence so a narration
is not cut off at a pause (`sttMaxSilenceMs` in `voice/live.ts`). Untestable until the Hume balance is
topped up.

## 3. Per-learner focus

Siblings sharing one unit at different levels. `Course.focus` is per family today; a per-learner override
merged at `createSession` is additive and needs no migration.

## 4. A Charlotte Mason week as a second demo

One chapter of an AmblesideOnline Year 7 book (Churchill's *Birth of Britain* ch. 1 plus Asser's *Life
of King Alfred*, both free), to prove narration-first on the reading it was designed for. Needs "one
chapter of a Gutenberg book" ingest: the URL path today takes a whole page.

## 5. "Suggest next week's focus"

From the Progress panel, without becoming a scheduler: the report's `recommendedNext` already exists;
this would rank kept concepts by latest level and staleness.

## 6. Pedagogy evals

The Stage 4 simulated-student harness in [TESTING.md](TESTING.md), and the Sonnet/Opus/Haiku comparison,
both better run against the Ancient Rome course than the photosynthesis sample.
