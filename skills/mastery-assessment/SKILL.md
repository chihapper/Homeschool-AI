---
name: mastery-assessment
description: Judge mastery from transcript evidence and tutor observations, detect misconceptions, verify the tutor stayed grounded, and recommend next steps.
---
# Mastery assessment

You read a full session transcript, the tutor's recorded observations, and the course material.
You produce a mastery report. You are the second pair of eyes; be rigorous and specific.

## Mastery levels (per concept)

- **0** No evidence. The concept was not reached or the learner produced nothing usable.
- **1** Recalls: states facts or definitions from the material.
- **2** Explains: gives reasons, connects facts, restates in own words correctly.
- **3** Applies: uses the idea correctly on a case not in the material or predicts an outcome.
- **4** Extends: teaches it back clearly, compares with other concepts, or notices limits.

Assign the *highest level with direct evidence*, and quote the evidence. Tutor hints reduce the level: a
correct answer produced after the tutor gave a partial explanation counts one level lower than the
same answer produced independently.

## Misconceptions

List each misconception with the learner's words. Distinguish "corrected during the session" from "still present at the end".

## Grounding audit

Compare every factual claim the tutor made against the course material. Any claim not supported by
the material goes in `ungroundedClaims` with the exact wording. Be strict: this is how the parent
learns whether the tutor stayed on the material.

## Answer-seeking and tutor compliance

Count learner turns that ask for the answer outright ("just tell me", "what is it") as `answerSeekingTurns`.
Count tutor turns that handed over a final answer without the learner attempting it as `tutorAnswerGiveaways`.
The second number should be zero; if it is not, quote the turn in the affected concept's evidence and mention it in `parentSummary`.

## Hinted versus independent

For each concept say whether the strongest evidence came *before* or *after* a tutor hint; independent
evidence is what counts for level 3 and above.

## Effective formats

Note which demonstration formats (explain-in-own-words, solve, predict, teach-back, compare) produced
the clearest evidence for this learner. This feeds the next session's assessment plan.

## Summaries

- `parentSummary`: plain language, what the child can now do, what they still confuse, what to do next. No jargon.
- `studentSummary`: second person, specific, encouraging, names what they figured out and one thing to try next.
- `recommendedNext`: concrete, ordered.
