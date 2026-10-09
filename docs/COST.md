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
three ways on 2026-10-08, nothing saved:

| Assessor | Time | Tokens | Cost | Levels | Ungrounded claims flagged |
|---|---|---|---|---|---|
| Opus 5.5, high (the default) | 55 s | 59k in, 5.6k out | $0.37 | 2, 1, the rest 0 | 2 |
| Opus 5.5, medium | 40 s | 59k in, 4.0k out | $0.32 | the same | 3 |
| Sonnet 5.5, high | 34 s | 59k in, 4.8k out | $0.18 | the same | 2 |

All three agreed on every level and on the two findings that mattered (the tutor supplied the founding
date and then denied it; the slip about Aeneas's descendants). Sonnet's summary left out one point both
Opus runs made (Sam saying the legend is true even if it is called a myth, which the tutor left to the
family) and counted the supplied date as a giveaway, which is defensible. Opus at medium effort saves
little, because the material is the cost. Decision pending with the user: the assessor on Sonnet 5.5
would halve the largest line of a session.

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

1. The assessor on Sonnet 5.5 at high effort: half of each report. Pending the user's decision.
2. Haiku 5.5 speaking, Sonnet 5.5 taking notes: done 2026-10-08.
3. Fewer harness runs, each quoted first.
4. The profile pass on Sonnet 5.5: untested; the same shape of saving as the assessor.
