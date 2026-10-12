---
name: curriculum-parsing
description: Turn raw lesson plans, textbook chapters and worksheets into a structured, source-faithful course model.
---
# Curriculum parsing

You receive verbatim chunks of a parent's teaching material and must produce a structured course:
lessons, concepts, objectives, guiding questions and practice items.

## Rules

- **Be faithful, not creative.** Every key fact must be traceable to a chunk. Do not add facts from
  general knowledge, even if you are sure they are true. If the material is thin, the course is thin.
- **Cite chunks.** Each concept lists the `sourceChunkIds` that support it. A concept with no chunk is not allowed.
- **Concept granularity.** A concept is one idea a learner could explain in two or three sentences.
  Split "cells" into "cell membrane", "nucleus", etc. if the material treats them separately.
- **Objectives are demonstrable.** Write "The student can predict what happens to ... when ..." not
  "The student understands ...".
- **Guiding questions** are the questions a Socratic tutor would open with: genuine, open, answerable from the material.
- **Practice items** are copied or lightly adapted from exercises present in the material. Do not invent problems.
- **Prerequisites** only when the material itself builds one concept on another.
- **Misconceptions**: include those the material explicitly warns about, plus at most two widely
  documented ones for the concept, clearly phrased as misconceptions.
- **Level**: infer the grade band from vocabulary and stated audience; state it as given if the material says.
- Preserve the material's own terminology and notation exactly.
- **Lesson titles follow the material.** When the material names or numbers its lessons (a table of
  contents, "Lesson 4", "Week 2", "Chapter 3"), each lesson title starts with that label exactly as
  printed, in the material's order: "Lesson 6–7", never "Lessons 6–7" or "Lesson 6". The table of
  contents wins over page headings. Add a topic after a colon only from the material's own heading for
  that lesson ("Lesson 4: Ocean Life Classification"). Never renumber, merge or split what the material
  labels as one lesson, and never fill a gap: if the contents skip a number, the course skips it too, and
  the description says so in one plain sentence (a student journal has pages only for some lessons; the
  parent's own lesson book has the rest).
- **Publisher and grades.** `publisher` is the publisher the material names (title page, copyright
  line), exactly as written, or empty. `grades` is the grade range the material states for itself
  ("3–8"), or empty when it does not state one; your own inference stays in `level`.

## Spoken and visual sources

- **Transcripts** (videos, TED talks, podcasts): paragraphs begin with `[mm:ss]` timestamps. Speech is
  redundant and loosely ordered; extract the *ideas*, not the sentences. Segment lessons where the
  speaker changes topic. Quote the speaker's own phrasing in key facts so the tutor can say "the
  speaker put it this way". Skip intros, sponsor reads, jokes, and housekeeping. Keep the timestamp
  of the passage a concept comes from in your head; cite the chunk id as always.
- **Slide decks**: each slide is a heading. Bullet fragments are not facts by themselves; read the
  speaker notes (if any) and the surrounding slides to reconstruct the claim. A run of slides on one
  idea is one concept. If a slide is only an image caption or title, fold it into its neighbours.
- **Web pages**: ignore navigation, comments, and related-article lists.
