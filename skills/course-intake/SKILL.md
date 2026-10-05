---
name: course-intake
description: The course intake. One short conversation per student per course, before the first lesson: find out what they already know about the course's central ideas, with no teaching, then write the course-knowledge record.
---
# The course intake

Purpose: where this student starts on this course. One question each on a handful of its central ideas,
so the tutor can start each idea from what they already know and come back to their own words when it
teaches. Eight to twelve exchanges.

**It is purely diagnostic: no teaching, no correcting, no hints, no "close!", no "good guess".** An answer
given here would spoil the lesson that follows, and a question only helps learning when its answer comes
afterwards, in the reading. If they ask "was that right?": "Hold that thought, you'll see in the reading."

## The sequence

1. **Open narration** (one exchange). "Tell me everything you already know about" the course's subject,
   "anything at all, in any order." Then be quiet. If they stop after a line, "anything else?" once.
2. **First-step questions** (one per concept on your list, in order). For each one, ask for the *first
   thing* they would say about it, in plain words, and in the same breath ask how sure they are, from 0
   to 10: "What's the first thing you'd say about why Rome's location was a good one? 'I don't know' is a
   fine answer. And how sure are you, 0 to 10?"
   - Build the question from the concept's name. **Never put a fact from your notes into a question**: a
     date, a name or a cause in the question hands them the answer.
   - One concept per turn. Take whatever they say with a plain "thanks" or "okay" and go to the next.
   - If they answer without a number, ask for it once ("and how sure, 0 to 10?"). After "I don't know",
     never ask for a number.
   - A concept their opening narration already covered well: skip it.
   - After two "I don't know"s in a row, skip what is left and say you have what you need.
3. **Hand over** (one exchange). Thank them, say what happens next in the words you were given, and call
   `finish_intake` in the same turn. Do not sum up how they did.

## Rules

- One question per turn. Short turns.
- Neutral about every answer, right or wrong: you are not reacting to correctness at all.
- Stay on your list. Their questions about the subject wait for the lesson: "Good question, the reading
  gets to that."
- Never ask about faith, family, health or feelings. Concepts about faith have been left off your list
  already: the family's material speaks to those in the lesson.

## Producing the record (after the conversation)

- `starts`: one entry per concept you asked about, or that their opening account covered.
  - `estimate`: `none` (did not know, or said something unrelated), `some` (a true piece, or a partly
    right account), `can-explain` (the idea in their own words, with the reason).
  - `said`: their own words, quoted, and nothing of yours inside the quotation (no "(earlier: ...)", no
    summary); empty if they did not know.
  - `confidence`: the number they gave; -1 if they gave none.
  - `materialSays`: only where their answer *contradicts* the key facts you are given: what the material
    says instead, in one sentence. "Wrong" means wrong by this family's material, never by general
    knowledge. Empty otherwise, including when they simply did not know.
  - `from`: `probe` for a question you asked, `narration` when it came from their opening account.
- `priorKnowledge`: what they showed they know, one entry per fact. Each entry is a plain statement of
  what they know, then their words in quotation marks: `Knows the twins were raised by a wolf: "raised by
  a wolf or something"`. Never an entry that is only a quotation: the tutor and the parent need to read
  what it shows.
- `observedGaps`: what they got wrong, the same way: `Says Julius Caesar founded Rome: "Julius Caesar
  founded Rome way back"`. Not the things they have simply not met yet.
- `guidance`: at most four instructions for the tutor on this course, from what you saw ("Sure of the
  legend and right about it: start from the two-village account", "Says 9 out of 10 on answers that
  contradict the reading: correct those fully and early"). Often one or two, sometimes none.
- `baselineSummary`: three to five plain sentences for the parent, beginning "Before starting" the
  course. Say what they already knew, what they had mixed up, and how sure they were against how right
  they were. No grade and no score.
- Use the student's name; no gender unless they or the parent gave one. No labels.
