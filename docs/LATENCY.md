# Conversational latency

The student speaks; the tutor should answer like a person, not like a form. What that means in numbers,
where the time goes, and what the build does about it.

## Target

Human turn-taking gaps are roughly 200 to 500 ms. Voice products feel conversational under about
800 ms from end of speech to first audio and start to feel laggy past 1.5 s. We aim for **under 1 s
to first audio on a warm cache**, and we measure it on every turn.

## Where the time goes (voice path)

```
student stops talking
  ├─ Hume end-of-turn detection + speech-to-text ........ Hume-side, ~200-400 ms
  ├─ HTTPS hop Hume -> our server ...................... ~50-150 ms (keep the server near Hume's region)
  ├─ Claude time-to-first-token ........................ the big one; depends on model, effort, thinking, cache
  ├─ our SSE stream -> Hume, first sentence buffered .... ~0 (we stream every delta)
  └─ Hume speech generation, first audio chunk ......... Hume-side, ~200-300 ms
```

We control the middle three. Everything below is about Claude time-to-first-token (TTFT).

## What the build does

| Lever | Where | Effect |
|---|---|---|
| **Stream every token to Hume** | `voice/clm.ts` writes each delta as an SSE chunk | Hume starts speaking on the first sentence, not the whole reply |
| **The reflect pass steers the next turn** | `note_for_next_turn` -> `orchestrator/notes.ts` | The speaking call cannot deliberate, so anything the reflect pass notices that should change the NEXT question (a dodged question, a contradiction, a lucky guess) is queued as one sentence and outranks the phase guidance next turn. Costs no latency: it is written while the learner listens |
| **Two calls per turn: speak, then reflect** | `tutorTurn` / `reflectTurn` in `tutor-agent.ts` | The speaking call has no bookkeeping tools and thinking disabled, so nothing can delay the first word; `record_observation` and `advance` run in a second call that starts once the reply is out, while the learner listens. `lookup_source` stays in the speaking call because reading a passage is part of answering. Measured 2026-09-22: the old single call spent 5-15 s thinking before speaking on decision turns (worst 16.4 s); after the split, time-to-first-token was 1.1-1.6 s on every turn and the notes took 4.5-6.4 s off the learner's clock |
| **Low effort on the live tutor** | `CLAUDE_TUTOR_EFFORT=low` | Fewer thinking tokens before the first word. Offline agents stay at `high` |
| **Adaptive thinking, not forced** | `reasoningParams()` in `llm/client.ts` | At low effort Opus 5 rarely thinks on a conversational turn. `CLAUDE_TUTOR_THINKING=disabled` shaves more but has known failure modes (tool calls emitted as text); use only if measured TTFT demands it |
| **Two prompt-cache breakpoints** | `buildSystem(..., STABLE_CONTEXT_BLOCKS)` | Role + skills is one cached prefix; course + lesson + learner profile is a second. Only the current concept and observations vary per turn |
| **Cache pre-warm on session start** | `prewarmTutor()` fires when a session is created | A `max_tokens: 0` request writes the cache before the student says a word, so the first turn is a cache hit |
| **Short replies by design** | `voice-conversation` skill, `max_tokens: 700` | Two to four sentences then a question |
| **Abort on interruption** | `req.raw.on("close")` -> `AbortController` | When Hume drops the request because the student barged in, we stop generating immediately |
| **Model choice** | `CLAUDE_TUTOR_MODEL` | Default `claude-opus-5`. If measured TTFT is too high, try `claude-sonnet-5`, then `claude-haiku-4-5` (the code drops effort/thinking params automatically for Haiku) |

## Measuring

Every assistant turn records `latency` on the transcript: `ttftMs`, `totalMs`, `iterations`, and cache
token counts. Look at it three ways:

- `npm run chat` prints `ttft=… total=… cache=read/total` after every turn and a session summary at the end.
- `GET /api/sessions/:id/latency` returns p50 / max TTFT, p50 total, and cache hit rate.
- The raw numbers are in `data/sessions/<id>.json`.

Run the same lesson at `low` / `medium` effort and across models, and pick per measured TTFT. Cache hit
rate should be above 0.8 after the first turn; if it is not, something in the stable prompt is changing
between turns (see `docs/ARCHITECTURE.md`, "Prompt caching").

## What we cannot fix from here

Hume's own end-of-turn detection and speech generation are fixed costs. Two things help: run the
server in the same cloud region as Hume, and keep the tutor's first sentence short so the first audio
chunk is ready sooner.

## Ideas not yet built

- **Backchannel filler**: emit "Hmm," or "Okay," immediately while Claude thinks. Cheap to add in `clm.ts`; risks sounding canned. Try only if measured TTFT stays above 1 s.
- **Speculative reply**: start generating the most likely next tutor turn while the student is still speaking, using Hume's interim transcripts. Larger change; only worth it if the model is the bottleneck after everything above.
