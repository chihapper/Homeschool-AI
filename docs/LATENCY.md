# Conversational latency

The student speaks; the tutor should answer like a person, not like a form. What that means in numbers,
where the time goes, and what the build does about it.

**The stack as it runs today** (2026-11-07): AssemblyAI streaming speech-to-text listening, the Claude API
in the middle, and Inworld (the default) or ElevenLabs speaking — switched by the `ttsProvider` setting at
the top of Settings, Voice. Hume EVI and Hume's Octave text-to-speech were the voice until 2026-10-06 and
were removed when Hume announced their sunset; the historical measurements below are labelled where they
involve them. The live model setting is Haiku 5.5 speaking with Sonnet 5.5 taking the notes; the code
default is Sonnet 5.5 for both. Measurements taken before 2026-10-08 were made with Sonnet 5 and are
labelled with their date.

## Target

Human turn-taking gaps are roughly 200 to 500 ms. Voice products feel conversational under about
800 ms from end of speech to first audio and start to feel laggy past 1.5 s. We aim for **under 1 s
to first audio on a warm cache**, and we measure it on every turn.

## Where the time goes (voice path)

```
student stops talking
  ├─ AssemblyAI end-of-turn + transcript ............... ~0 after end of speech (streaming; the words are ready as they stop)
  ├─ Claude time-to-first-token ........................ the big one; depends on model, effort, thinking, cache
  ├─ first sentence to the voice ....................... ~0 (we stream every delta and send the first sentence alone)
  └─ speech generation, first audio chunk .............. Inworld 0.2-0.3 s, ElevenLabs Flash ~0.25 s, from the first word
```

We control the middle two. Everything below is about Claude time-to-first-token (TTFT).

## What the build does

| Lever | Where | Effect |
|---|---|---|
| **Stream every token to the voice** | `voice/live.ts` cuts the stream into sentences (`sentence-chunker.ts`) and sends the first alone | The voice starts on the first sentence, not the whole reply |
| **The reflect pass steers the next turn** | `open_thread` -> `orchestrator/notes.ts` | The speaking call cannot deliberate, so anything the reflect pass notices that should change the NEXT question (a dodged question, a contradiction, a lucky guess) is queued as one sentence and rides beside the phase guidance next turn. Costs no latency: it is written while the learner listens |
| **Two calls per turn: speak, then reflect** | `tutorTurn` / `reflectTurn` in `tutor-agent.ts` | The speaking call has no bookkeeping tools and thinking disabled, so nothing can delay the first word; `record_observation` and `advance` run in a second call that starts once the reply is out, while the learner listens. `lookup_source` stays in the speaking call because reading a passage is part of answering. Measured 2026-09-22: the old single call spent 5-15 s thinking before speaking on decision turns (worst 16.4 s); after the split, time-to-first-token was 1.1-1.6 s on every turn and the notes took 4.5-6.4 s off the learner's clock |
| **Low effort on the live tutor** | `CLAUDE_TUTOR_EFFORT=low` | Fewer thinking tokens before the first word. Offline agents stay at `high` |
| **Adaptive thinking, not forced** | `reasoningParams()` in `llm/client.ts`, rules in `llm/models.ts` | At low effort Opus 5 rarely thinks on a conversational turn. `CLAUDE_TUTOR_THINKING=disabled` shaves more but has known failure modes (tool calls emitted as text); use only if measured TTFT demands it. "Disabled" means the least thinking the model allows: `{type: "disabled"}` on Opus 5 / Sonnet 5, `{type: "between_tools"}` on Sonnet 5.5 (no thinking before the first word), and plain adaptive at low effort on Opus 5.5, which never turns thinking off. The speaking call always asks for it, whatever the setting |
| **Two prompt-cache breakpoints** | `buildSystem(..., STABLE_CONTEXT_BLOCKS)` | Role + skills is one cached prefix; course + lesson + learner profile is a second. Only the current concept and observations vary per turn |
| **Cache pre-warm on session start** | `prewarmTutor()` fires when a session is created | A `max_tokens: 0` request writes the cache before the student says a word, so the first turn is a cache hit |
| **Short replies by design** | `voice-conversation` skill, `SPEAK_MAX_TOKENS` (1200) / `REFLECT_MAX_TOKENS` (2000) in `tutor-agent.ts` | Two to four sentences then a question. The caps are room, not a target: `max_tokens` covers thinking too, and a spoken turn measures 60 to 200 output tokens on Sonnet 5 (2026-09-30) |
| **Abort on interruption** | `interrupt` in `voice/live.ts` -> `AbortController` | When the student barges in, the model and the voice stop at once; what was already said stays in the transcript |
| **Model choice** | `CLAUDE_TUTOR_MODEL` (Settings, Tutor model) | Code default `claude-sonnet-5-5`, the tier that can speak with no thinking first; `claude-haiku-5-5` (2026-10-07) can too, at about a tenth of the price and the same time to first word (measured below), which is why it is the live setting. `claude-opus-5-5` is stronger but always thinks a little (low effort is the only control, and `{type: "disabled"}` is a 400 on it). Note for the diagnostics: `thinkingChars` counts thinking *text*, which Sonnet 5, Sonnet 5.5 and Opus 5.5 omit from responses by default, so it reads 0 there even when the model thought; `outputTokens` still includes the thinking |
| **A separate model for the notes** | `CLAUDE_REFLECT_MODEL` (Settings, Notes model) | Costs no latency on the speaking call, so the reflect pass can run on a more careful model than the speaker. Each model keeps its own prompt cache, which is one extra cache write per session, off the student's clock |

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

The transcriber's end-of-turn window and the voice's generation time are fixed costs. Two things help:
keep the end-of-turn silences in Settings as short as the student can bear, and keep the tutor's first
sentence short so the first audio chunk is ready sooner.

## Ideas not yet built

- **Backchannel filler**: emit "Hmm," or "Okay," immediately while Claude thinks. Cheap to add in `live.ts`; risks sounding canned. Try only if measured TTFT stays above 1 s.
- **Speculative reply**: start generating the most likely next tutor turn while the student is still speaking, using AssemblyAI's partial transcripts. Larger change; only worth it if the model is the bottleneck after everything above.

## The wait a fast talker sees

A turn is two calls: the reply the student hears, then the reflect pass (notes and the phase change),
which runs while they listen and takes 4 to 19 s at medium effort (measured 2026-09-24, median about
7 s). The next turn waits for that pass to land before it is composed (`settleReflection`), so a student
who answers within a few seconds waits the remainder, on top of the usual time to first word. In text
this did not bite; in voice, where a one-word answer is normal, it will. Options when it does: lower
`reflectEffort`, or compose the next reply against the session as it stands and let a late phase change
apply one turn later.

## Two voices for the tutor (2026-09-24)

Browser voice mode can speak through ElevenLabs as well as Inworld (`ttsProvider`, the toggle at the
top of Settings, Voice). Both deliver 24 kHz PCM, so the switch applies from the next reply without
reconnecting. Measured 2026-09-24 on this machine (Starter plan, voice George):

| ElevenLabs model | First audio, direct | Through "Test this voice" | Stitching (`previous_request_ids`) |
|---|---|---|---|
| Flash v2.5 | 236 ms | 162-209 ms | works (277 ms stitched) |
| v3 Conversational | 263 ms | 247 ms | refused: HTTP 400 `unsupported_model` |
| Multilingual v2 | 1,328 ms | not measured | works |

Direct numbers follow one warm-up request per model. (Hume Octave 2, the voice until 2026-10-06, measured
about 0.6 s here earlier; Hume is sunsetting it and the adapter was removed.)
In a live voice session over the app's WebSocket (Flash v2.5, Sonnet 5 at low effort, text input, so no
transcription delay), first audio came 1.62 s and 1.79 s after the turn started, about 0.23 to 0.63 s
after the model's first word: the voice is no longer the slow part, the model is. Between 20 and 54 of
each clip's roughly 180 network chunks arrived with an odd byte count, which is why ElevenLabs audio goes
through `Pcm16Stream`; no odd-length frame reached the browser.

## One stream per reply (2026-09-24/25)

Sending a reply to the voice in separate requests restarts the voice at each one, and ElevenLabs refuses
request stitching for v3 models. A streaming socket keeps one voice context for the whole reply. One
reply (427 characters, five sentences) was voiced each way, with text arriving at the tutor's median
writing speed (238 characters in 1,143 ms after its first word, from 112 saved turns). Times are from the
tutor's first word:

| Route | First sound | Live gaps | Notes |
|---|---|---|---|
| ElevenLabs v3 Conversational, sentence batches over HTTP (today's method) | ~375 ms, estimated | none | no stitching, so each batch starts cold |
| ElevenLabs v3 Conversational, Text to Dialogue socket, text fed word by word | 502 / 533 ms | none | waits for about 8 words before speaking |
| **Inworld TTS-2 (`tts-inworld.ts`), one context, a sentence at a time** | **282 ms** | none | 111 ms after the first sentence was sent |
| **Inworld TTS-2 Flash, same** | **223 ms** | none | 51 ms after the first sentence was sent |
| Whole reply in one request | ~2.3 s, estimated | none | the smoothest read, but waits for the whole reply |

The Inworld socket connects in about 0.23 s, so the app opens it at `mic_start`, while the student is still
talking. Speaking time was 21 to 23 s in every clip. The ElevenLabs socket paused longest (6.7 s of pauses in
all, the longest 1.06 s), and Inworld less (5.8 s, the longest 0.66 s), with a different voice (Duncan
against George). Every chunk from both sockets was whole samples. Through the app's own voice WebSocket
(Inworld TTS-2, Sonnet 5 at low effort, typed input), first audio came 0.55 to 0.57 s after the model's first
word, most of it spent finishing the first sentence. "Test this voice" over HTTP: first audio 100 to 250 ms.
`speaking_rate` is accepted on both routes.

## Haiku 5.5 as the tutor (2026-10-08)

Claude Haiku 5.5 (released 2026-10-07) is the first Haiku with effort, speaks with thinking off at effort
high or below, and costs about a tenth of Sonnet 5.5 ($0.10 in / $0.50 out per million tokens, cache reads
$0.01, for prompts under 100k tokens). The same five-turn scripted lesson on each model (Test Student, the
plants unit, text, low effort, thinking off on the speaking call, one run each):

| | Haiku 5.5 | Sonnet 5.5 |
|---|---|---|
| Time to first token, warm turns | 1.06 to 1.43 s (median 1.36) | 1.03 to 1.53 s (median 1.47) |
| First turn, cold (12k-token cache write) | 2.7 s | 1.5 s |
| Reflect pass, median | 6.4 s | 4.2 s |
| Observations in five turns | 6: four partial, two told; phase stayed teach | 7: three understanding, one partial, one told, one gap, one engagement; phase moved to inquire |
| Tutor tokens per turn, about | 12.4k cached in and 100 out, twice (speak, reflect) | the same |
| The two tutor calls per turn, about | $0.0005 | $0.0065 |

The first word comes as fast, and the replies read as a tutor's, with no reasoning leaking into the text
(the Haiku 5.5 prompting guide warns of that with thinking off at low effort). The reflect pass was blunter:
every student answer filed as "partial", no gap for the dodged question, no phase change in five turns. One
run each, so a direction, not a verdict; the questions themselves are the user's to judge by ear. Settings
switches the tutor between them at runtime; the code default stays Sonnet 5.5. Since 2026-10-08 the reflect
pass can run on its own model (`reflectModel`, Settings "Notes model"): the user's choice is Haiku 5.5 speaking
and Sonnet 5.5 taking the notes, about $0.0044 per turn for the two calls.
