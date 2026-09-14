# Architecture

## The idea

Students learn by being questioned, not by being told. The tutor here is "Socrates": it teaches by
eliciting, probing, and asking for demonstrations, working strictly from material the parent chose.
Everything is built to make that reliable rather than merely plausible.

## Agents and their skills

| Agent | When it runs | Skills | Output |
|---|---|---|---|
| **Curriculum Agent** | On upload | `curriculum-parsing`, `grounding` | `Course` (lessons, concepts, objectives, guiding questions, cited source chunks) |
| **Profiler Agent** | First session with a new learner | `initial-assessment`, `voice-conversation`, `grounding` | Intake conversation, then `LearnerProfile` |
| **Socratic Tutor** | Every teaching turn (voice or text) | `socratic-method`, `learner-adaptation`, `grounding`, `voice-conversation` | Spoken turn + tool calls (`lookup_source`, `record_observation`, `advance`) |
| **Assessor Agent** | When a session ends | `mastery-assessment`, `grounding` | `MasteryReport` (0-4 per concept, misconceptions, grounding audit, parent/student summaries) |
| **Orchestrator** | Always (plain code, no LLM) | — | Session state machine, persistence, routing |

Skills live in `skills/<name>/SKILL.md` and are concatenated into the agent's system prompt. They are
the "competencies" layer: you can reshape how the tutor questions, how strict the assessor is, or how
the intake runs by editing markdown.

## Ingestion sources

`ingest/media/sources.ts` is the single entry point. Uploaded bytes and URLs both become
`SourceDocument { fileName, text, kind, url? }` and flow into the same chunker and Curriculum Agent.

| Source | Path | Notes |
|---|---|---|
| PDF, DOCX, MD, TXT | `ingest/extract.ts` | as before |
| PowerPoint `.pptx` | `media/pptx.ts` | slide text + speaker notes; each slide becomes a heading so chunks keep slide boundaries |
| YouTube, TED, Vimeo, ~1,000 sites | `media/ytdlp.ts` | metadata + captions via `yt-dlp`; if no captions, audio is downloaded and transcribed |
| Podcast RSS / direct audio URL | `media/podcast.ts` | latest N episodes, enclosure download, transcription |
| Uploaded audio/video files | `media/transcribe.ts` | Deepgram (default) or a local whisper CLI |
| Web page | `media/sources.ts` | tag-stripped text with headings preserved |

Transcripts are rendered as paragraphs prefixed with `[mm:ss]` so a concept's source chunk still says
where in the recording it came from. The `curriculum-parsing` skill has specific rules for spoken and
slide sources (segment by topic shift, ignore intros and sponsor reads, read speaker notes as the
lecturer's explanation).

## Session flow

```
upload material ──> Curriculum Agent ──> Course (data/courses/*.json)

new learner ──> Session(phase=intake) ──> Profiler Agent (conversation)
                     │ finish_intake tool
                     ▼
              finalizeProfile ──> LearnerProfile stored on the learner

Session(phase=teach) ─ Tutor ─> inquire ─> assess ─(≥2 observations)─> next concept ... ─> wrap-up ─> complete
                                                                                      │
                                                                       endSession ──> Assessor Agent ──> MasteryReport
```

Phase transitions are requested by the tutor through the `advance` tool and validated in
`orchestrator/session.ts`. For example, the tutor cannot move to the next concept until it has recorded
at least two non-engagement observations for the current one. That is the "assess via conversation"
requirement enforced in code rather than left to the prompt.

## Voice path (Hume EVI)

Hume handles microphone capture, speech-to-text, expression measurement, turn-taking, interruption,
and text-to-speech. We plug in as the **custom language model**:

```
browser ──(WebSocket, access token, configId, customSessionId)──> Hume EVI
Hume ──POST /clm/chat/completions?custom_session_id=<session>──> our server
our server ──> orchestrator.respond() ──> Tutor Agent (streams text)
our server ──SSE chat.completion.chunk ... data: [DONE]──> Hume ──> speech ──> browser
```

The server ignores Hume's copy of the history and uses its own session transcript, so text and voice
sessions share one state and one assessment path. Prosody labels on the user turn are passed to the
tutor as `[expressions: ...]` so it can adapt (the `voice-conversation` skill says how).

## Grounding

"An AI that can't make mistakes" is not something any model can promise. What the system does instead:

1. The Curriculum Agent may only produce concepts with `sourceChunkIds`; dangling references are dropped.
2. The tutor's system prompt carries the current concept's verbatim passages, and a `lookup_source`
   BM25 tool for anything else. The `grounding` skill instructs it to say when the material doesn't cover something.
3. The Assessor audits every tutor claim against the material and lists `ungroundedClaims` in the report the parent sees.

## Data

File-backed JSON in `data/` (`courses/`, `learners/`, `sessions/`, `reports/`). `JsonStore` is the only
persistence abstraction; swap it for a database when needed.

## Prompt caching and latency

`base.ts` renders `[role + skills]` as the first cached system block, then the per-session stable
context (course + lesson, learner profile) as a second cached block, then the per-turn blocks (current
concept, observations, phase). Skill order is part of the cached prefix; keep it stable. Sessions
pre-warm the cache on creation, and every assistant turn records time-to-first-token and cache usage.
See [LATENCY.md](LATENCY.md).
