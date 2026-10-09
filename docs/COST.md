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
Opus at medium effort saves little, because the material is the cost. Decision pending with the user.

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

1. The assessor off Opus 5.5: Sonnet 5.5 at half the cost, GPT-6.1 Sol at a little under that, or GPT-6 Luna at
   under a cent, all with the same levels on the one session compared. Pending the user's decision; the
   Claude summaries read better to a parent, the OpenAI ones are terser.
2. Haiku 5.5 speaking, Sonnet 5.5 taking notes: done 2026-10-08.
3. Fewer harness runs, each quoted first.
4. The profile pass on Sonnet 5.5: untested; the same shape of saving as the assessor.
