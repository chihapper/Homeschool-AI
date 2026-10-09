# What a session costs

Measured on this machine on 2026-10-08, at the Claude API's list prices
(platform.claude.com/docs/en/about-claude/pricing). Issue #20 asked for this.

## The live tutor, per turn

A turn is two calls: the speaking call (the reply the student hears) and the reflect pass (the notes,
the phase change, the open thread), which runs while the student listens. From the recorded turns, each
call reads about 12.4k cached tokens; the speaking call writes about 100 tokens, the reflect pass about
300 (tool calls and notes). The reflect pass is the dearer half.

| Speaks | Takes the notes | The two calls, about |
|---|---|---|
| Sonnet 5.5 | Sonnet 5.5 | $0.0065 |
| Haiku 5.5 | Sonnet 5.5 (the setting since 2026-10-08) | $0.0044 |
| Haiku 5.5 | Haiku 5.5 | $0.0005 |

A twenty-turn lesson is therefore about $0.13 on Sonnet alone and under $0.10 with Haiku speaking, plus
one cache write per model per session (about $0.03 on Sonnet). All 225 tutor turns recorded on this
machine add up to about $2.70 of speaking calls at Sonnet prices.

## The report, per session

The assessor reads the whole course (the Rome unit is about 59k tokens of material) plus the transcript,
so its cost is the input, not the thinking. One saved session (Sam on Ancient Rome, 23 turns) assessed
five ways on 2026-10-08, nothing saved:

| Assessor | Time | Tokens | Cost | Levels | Evidence quotes | Ungrounded claims flagged |
|---|---|---|---|---|---|---|
| Opus 5.5, high (the default) | 55 s | 59k in, 5.6k out | $0.37 | 2, 1, the rest 0 | 15 | 2 |
| Opus 5.5, medium | 40 s | 59k in, 4.0k out | $0.32 | the same | 13 | 3 |
| Sonnet 5.5, high | 34 s | 59k in, 4.8k out | $0.18 | the same | 14 | 2 |
| GPT-6.1 Sol, high (OpenAI, through `llm/openai.ts`) | 108 s | 44k in, 4.8k out | $0.14 | the same | 9 | 3 |
| GPT-6 Luna, high (OpenAI) | 43 s | 44k in, 6.0k out | $0.007 | the same | 5 | 3 |

All five agreed on every level and on the two findings that mattered (the tutor supplied the founding
date and then denied it; the slip about Aeneas's descendants). The differences are at the edges. Sonnet's
summary left out one point both Opus runs made (Sam saying the legend is true even if it is called a
myth, which the tutor left to the family); Sol noted the same exchange but read it as the tutor failing
to refer it to the parent; Luna did not mention it. The two OpenAI summaries are terser and more clinical
("today's work mainly rehearsed that knowledge"), with fewer quotes from the session, where the Claude
summaries read as a letter to the parent, name what to praise and give something to do at home. Sol was
the slowest by far at high effort. OpenAI's tokenizer counted the same material at 44k tokens against
Claude's 59k, so at the same list price Sol comes in about a quarter under Sonnet. Luna, at under a cent,
caught one more told-not-recalled line ("You pulled it right out...") and missed nothing on the levels.
Opus at medium effort saves little, because the material is the cost.

**Where a slow GPT report spends its time (2026-10-09).** Not in the prompt: the two skills the assessor
carries are about 3,300 tokens of a 44,000-token request, and the request is the same text for every
vendor. The time is reasoning before the first word. On the plants session below, Sol at high effort wrote
nothing for 123 s and then 5,200 reasoning tokens; Luna reasoned for 11,200 tokens over 95 s. At medium
effort (OpenAI's own default) Sol on the Rome session took 39 s with 12 s to the first word and 323
reasoning tokens, at the same price, with the same levels and the same flagged claims. For the Claude
models the equivalent cost is thinking: Opus 5.5 at high effort wrote nothing for 50 s on the plants
session, Sonnet for 21 s. OpenAI also notes that a strict output schema is slow the first time the API sees
it; that did not show as the main factor here.

**The second session (Test Student, the plants unit, 51 turns), high effort, same skill:**

| Assessor | Time, first word | Cost | Levels (7 concepts) | Quotes | Flagged |
|---|---|---|---|---|---|
| Opus 5.5 | 93 s, 50 s | $0.22 | 2 2 3 1 1 2 1 | 24 | 2 |
| Sonnet 5.5 | 43 s, 21 s | $0.10 | 2 2 3 1 1 2 1, the same | 25 | 2 |
| GPT-6.1 Sol | 165 s, 123 s | $0.10 | 3 1 3 1 1 1 1 | 22 | 3 |
| GPT-6 Luna | 111 s, 95 s | $0.008 | 1 1 3 1 1 1 1 | 13 | 3 |

Sonnet matched Opus level for level on both sessions; Sol differed on three of seven concepts here, in
both directions; Luna was the strictest. All four found the same two tutor slips (the yellow-grass claim,
the share of oxygen from plants).

**The terse summaries were a prompt problem, and the prompt was ours.** The skill's Summaries section said
only "plain language, what the child can now do, what they still confuse, what to do next". The Claude
models filled that in as a letter; the OpenAI models answered it literally. On 2026-10-09 the section was
made explicit (a letter of 180 to 260 words, in a set order: where the child started, what they can now do
with their own words quoted, what is still shaky and whether they showed the correction, one thing to do at
home this week, the tutor's conduct). Rerun on the Rome session at medium effort: Sol's summary went from
about 150 words and 9 quotes to a four-paragraph letter with 15 quotes and a task for the week, Luna's
likewise; Sonnet's, rerun at high effort with the same skill, kept its levels and gained the task for the
week. Luna, at medium, still missed the Aeneas slip, rated the Etruscan answer 0 where everyone else said 1,
and once wrote "he" for Sam, whose records state no gender.

**Decided 2026-10-09 (the user): the report runs on Sonnet 5.5 at high effort** (Settings, Report model). It
matched Opus level for level on both sessions at half the cost, in 35 to 45 s, and its letters need no
further prompting work. Sol at medium effort stays available as a second opinion; Luna is not the report a
parent reads.

The profile pass after the report (Opus 5.5) reads the two records, the transcript and the report; an
estimate, not a measurement: a tenth to a fifth of a dollar.

## Where the money has gone so far

Estimates from the saved files; the development sessions' own runs are not in them.

- Twenty-three reports on Opus 5.5 at high effort: roughly eight to ten dollars.
- Two course builds on Opus 5.5 (the Rome unit took four attempts, each allowed 64k output tokens):
  several dollars.
- Intake write-ups (Opus 5.5, up to 32k output tokens each) and profile passes: tens of cents each.
- Test harnesses run while building (replays of one turn dozens of times, scripted students through both
  intakes several times, the model comparisons): not recorded by the app, and probably more than all the
  live tutoring put together. Since 2026-10-08 the expected cost is quoted before a harness runs.
- Live tutoring: about $2.70 of speaking calls across 46 sessions, plus the notes.

## Levers, in order of what they save

1. The assessor on Sonnet 5.5 at high effort: done 2026-10-09, half of each report. GPT-6.1 Sol at medium
   effort is the second opinion if one is wanted; GPT-6 Luna is not the report a parent reads.
2. Haiku 5.5 speaking, Sonnet 5.5 taking notes: done 2026-10-08.
3. Fewer harness runs, each quoted first.
4. The profile pass on Sonnet 5.5: untested; the same shape of saving as the assessor.
