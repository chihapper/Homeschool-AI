# Roadmap

What is deliberately not built yet, each with the trigger that would start it and the first concrete
step. The scope this sits on is in [ARCHITECTURE.md](ARCHITECTURE.md): one course of the family's own
material at a time, uploaded as they bought it, a Socratic session on it, a report to the parent; not a
curriculum, a scheduler, or a grader.

Every item here, plus the smaller fixes from the first real sessions, is tracked as a GitHub issue
(chihapper/Homeschool-AI issues 1 to 14 and 16 to 29; 15 was the merged pull request). The issues carry the
detail, this file the shape. Four issues carry the `pre-launch` label and must be settled before any family
uses the product: **#13** hosting, copyright and the children's-data line; **#18** Inworld's data answers;
**#23** turning off AssemblyAI's model training (needs a paid plan, which also gives zero retention on
streaming); **#26** moving the Wikipedia checks to a Wikimedia Enterprise account.

Two things on this list have since been built and their issues are simply still open: **#17**, Inworld as a
voice provider (2026-09-25, now the default), and **#20**, usage recorded per turn (2026-10-09, the meter in
[ARCHITECTURE.md](ARCHITECTURE.md) and [COST.md](COST.md)). **#28**, the dynamic learner profile, is built
and closed.

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
is not cut off at a pause (`sttMaxSilenceMs` in `voice/live.ts`). Not yet tried by voice.

## 4. Per-learner focus

Siblings sharing one course at different levels. `Course.focus` is per family today; a per-learner override
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
both better run against the Ancient Rome course than the photosynthesis sample. This is the next gate: skill
edits are judged by hand today, and the Khanmigo RCT (+0.06 to 0.08 SD a year) is the warning that
engagement, not features, is the risk ([COMPETITORS.md](COMPETITORS.md)).

## 8. Facts from outside the material: beyond Wikipedia, and scripture

The check built in September reads Wikipedia through its free API. Two open questions sit on top of it.
**Other sources** (#27) where the checks show gaps — added from evidence, never as a parent-curated source
list, because a parent may not know which sources matter. **Scholarly questions about scripture** (#29) —
"historians doubt Matthew wrote Matthew" is handed to the parent today and never checked against Wikipedia,
whatever the wording, because a student's question about the census in Luke once came back as "Luke is in
error" in a family's report. Whether the tutor may say more than "ask your parent" — the family's own
tradition, or the views described without a verdict — is the user's decision and is not taken.

## 9. Cost, and cheaper models per agent

[COST.md](COST.md) holds the measurements. Settled: the report on Sonnet 5.5 (half of Opus, level for level
on two sessions), Haiku 5.5 speaking with Sonnet 5.5 taking the notes. Open: the profile pass on Sonnet 5.5
(#22 — replayed, it proposed nearly the same revisions at half the cost, and the setting would be a
`profileModel` beside the others), medium-effort ingest and a cached course block for the assessor (#12),
and a monthly allowance read off the same meter. The constraint is real — a dozen spoken lessons a month per
child is $8 to $10 at list prices — and the user's reading is that only Gemini, GPT or Anthropic would do.

## 10. Voice: what was tried and parked

**ElevenLabs' Text to Dialogue socket** (#16) works and was measured, but Inworld is cheaper, was ranked
higher by ear, and has been the default since 2026-10-05; the socket stays on hold unless the user prefers
ElevenLabs. **ElevenLabs Agents** (#19), which would run the conversation on ElevenLabs' side, is revisited
only if echo or turn-taking fail in real family sessions — handing the conversation over means giving up the
orchestrator, the grounding and the assessor, which is the product. **Inworld's speech-to-text** against
AssemblyAI's two streaming models (#24) is untried. **AI video** (#25) — generated visualisations, the
material on screen, a tutor avatar — is noted, not scoped.
