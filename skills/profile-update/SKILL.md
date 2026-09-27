---
name: profile-update
description: After a session's report, revise the learner profile from that session's evidence: what changed, with a reason each, and nothing else. Most sessions change little.
---
# Profile update

The profile is the tutor's running notes on how to teach this student. The intake wrote the first version
from one conversation; you keep it current from what each session showed. The parent reads every change
you make, with your reason, and can undo it. The student is a child; write only what they did, never
what they are.

## What you are given

The current profile and its recent revisions (including changes that were **held** last time), this
session's mastery report, the tutor's observations, any facts the student brought in from outside the
reading, the student's own words from the session, and the last few reports before this one.

## Merge, don't pile

The lists are read by the tutor on every turn, so they must stay short. Ceilings: `priorKnowledge` 15,
`observedGaps` 12, `interests` 10, `tutoringGuidance` 6; anything past a ceiling is cut from the end, so
put the most useful entries first. One entry per fact: when a session confirms something already listed,
leave the entry or replace its quote with the newer, stronger one, never add a second entry for the same
fact. Replaying nine sessions without this rule produced forty prior-knowledge entries, mostly the
founding legend recalled again.

## Fast fields: change them when this session's evidence says so

- `priorKnowledge`: what the student showed they know, one entry per fact, quoted, tagged with the course
  ("Rome: ..."). Keep entries from other courses. Drop an entry only when this session contradicted it,
  or to make room for a more useful one.
- `observedGaps`: what they got wrong or could not do when asked, in the student's words. Add this
  session's misconceptions. Remove a gap once a report shows it resolved (level 2 or above with
  independent evidence); a gap the tutor corrected but the student never restated stays. Topics not yet
  taught are not gaps: the progress view already shows what has not been reached.
- `interests`: what the student enjoys or keeps returning to, short ("the Trojan War stories"), for the
  tutor's analogies. A question asked once is not an interest; a subject they raise session after session
  is. Never remove one on a single session's silence.
- `demonstrationPreferences`: follow the report's effective formats when a pattern shows across sessions.
- `tutoringGuidance`: at most six concrete instructions the tutor follows literally. Replace one only
  with a reason; do not rewrite the list each session. A session that went badly because of the tutor
  (answers handed over, the same question five times) changes the guidance, not the student's fields.
- `parentSummary`: three to five plain sentences on where the student stands now, rewritten to fit.

## Slow fields: propose only on a pattern, and expect to be held

`pace`, `challengeTolerance`, `verbalLevel`, `depth` and `intakePreferences` describe the student, not
what they know. One session cannot move them: a change you propose is held, and lands only if the next
session's pass proposes the same (for `verbalLevel`, a revision again, in whatever words this session's
evidence supports). So propose one only when this session **and** the earlier reports point the same
way, and write the reason from more than this session. A proposal held last time that this session
confirms is the pattern you are looking for; a held proposal this session does not support should simply
not be proposed again.

## Depth

How much of an answer the student is ready for, from what they demonstrate, not their grade:
- `simple`: the plain version, one idea at a time.
- `some-nuance`: the main exception or a second view when they ask; they handle "it depends".
- `full`: the real complexity when it is true to the material.
Evidence up: mastery 3 or 4 with independent evidence, asking "why" and using the answer, bringing in
outside facts and connecting them, handling an "it's complicated" answer well. Evidence down: struggling
with the plain version, or nuance that lost them. A student can be curious and still need `simple`.

## Rules

- Every change quotes or names its evidence from this session; a reason per field you changed.
- No change is a fine answer, and the usual one. Do not reword entries for style.
- No labels or diagnoses (not "visual learner", "anxious", "gifted", "attention"). Describe what they did.
- Use the student's name; a pronoun only if the transcript uses one for them. An older entry in the
  profile that uses a pronoun is not evidence: write new text with the name, and drop the pronoun when
  you are rewriting an entry for another reason. Never rewrite an entry only to remove a pronoun (that
  showed the parent two removals and two additions that changed nothing). Never "your son" or "your
  daughter".
- Do not hold a tutor failure against the student: an answer given away is not their gap.
- `summary`: one or two plain sentences for the parent on what this session showed about how the student
  learns. If you changed nothing, say that this session confirmed the profile.
