# Architecture

## The idea

Students learn by being questioned, not by being told. The tutor here is "Socrates": it teaches by
eliciting, probing, and asking for demonstrations, working strictly from material the parent chose.
Everything is built to make that reliable rather than merely plausible.

## Scope

One unit of the family's own material at a time, a Socratic session on it, a report to the parent. Not a
curriculum, a scheduler, or a grader. Two decisions are the parent's and never an agent's:

- **Focus** (`Course.focus`, `PUT /api/courses/:id/focus`): which lessons and concepts are taught.
  `createSession` resolves it once into `Session.conceptIds`; everything in a running session walks that
  frozen list through `domain/focus.ts`, so a later edit changes neither the walk nor the cached prompt.
- **Narration first** (`createSession({ narrationFirst })`): the student has already read the material,
  so the opening turn asks them to tell it back before any questioning (the `socratic-method` skill says
  how, and the assessor is told the first exchange is independent evidence).

`GET /api/progress/:learnerId/:courseId` (`domain/progress.ts`) is the parent's cross-session view: the
latest level per concept, the level before it, what the child still gets wrong, and the running grounding
and giveaway counts. What is deliberately not built is in [ROADMAP.md](ROADMAP.md).

## Agents and their skills

| Agent | When it runs | Skills | Output |
|---|---|---|---|
| **Curriculum Agent** | On upload | `curriculum-parsing`, `grounding` | `Course` (lessons, concepts, objectives, guiding questions, cited source chunks) |
| **Intake (general)** (`profiler-agent.ts`) | When a student is added (Students tab), once | `initial-assessment`, `voice-conversation` | A six-to-eight-exchange conversation on a passage built into the app (never the family's course), then, written in the background, the first `LearnerProfile`: how to work with this student on any course |
| **Intake (course)** (`course-intake-agent.ts`) | The start of a student's first lesson on each course, once | `course-intake`, `voice-conversation` | One first-step question on each of six to eight central concepts, with "how sure, 0 to 10?" and no teaching, then, written in the background, the `CourseKnowledge` record: where this student starts on this course |
| **Socratic Tutor** | Every teaching turn (voice or text), as two calls: the speaking call (the reply, `lookup_source` only, thinking off) and the reflect pass that runs while the student listens (`record_observation`, `advance`, `open_thread`, `flag_outside_claim`) | `socratic-method`, `learner-adaptation`, `grounding`, `voice-conversation` | The spoken turn, then the notes, the phase change and one thread for the next turn |
| **Assessor Agent** | When a session ends | `mastery-assessment`, `grounding` | `MasteryReport` (0-4 per concept, misconceptions, grounding audit, parent/student summaries) |
| **Reference Checker** | In the background, when the reflect pass flags a fact from outside the material | `reference-check` | A verdict on one fact from Wikipedia passages (supported, contradicted, complicated, not found), with a word-for-word quotation and a link to the version read |
| **Profile Reviser** | In the background, after every mastery report | `profile-update` | A revised `LearnerProfile` and revised notes for the course's `CourseKnowledge` record, with a reason per changed field; `domain/profile.ts` lands the course notes and the profile's fast fields, holds the slow ones until two sessions agree, and records every change with undo for both records |
| **Orchestrator** | Always (plain code, no LLM) | — | Session state machine, persistence, routing |

Skills live in `skills/<name>/SKILL.md` and are concatenated into the agent's system prompt. They are
the "competencies" layer: you can reshape how the tutor questions, how strict the assessor is, or how
the intake runs by editing markdown.

**Which model runs what** is a runtime setting (Settings, Models; `docs/COST.md` has the measurements):
the tutor's speaking call (`tutorModel`), its reflect pass (`reflectModel`, empty means the tutor's), the
offline agents (`model`: the course build, the intake write-ups, the profile pass) and the report
(`assessorModel`, empty means the offline model). Everything runs on the Claude API through
`llm/client.ts`, with one exception: the report may run on an OpenAI model through `llm/openai.ts`, the
adapter behind `streamParsed`, which translates a Claude-shaped structured-output request to OpenAI's
Responses API and shapes the reply like a Claude message, so the assessor code does not know the vendor.
The settings route lets only the report leave the Claude API.

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

A sitting is a chain of sessions, each with its own transcript (domain/intake.ts, planSitting):

new student ──> Session(kind=general-intake) ── built-in passage, questions in three bands by grade
                     │ finish_intake: hands over inside the same reply; the profile is written in the background
                     ▼
first time on a course ──> Session(kind=course-intake) ── one first-step question per central concept, no teaching
                     │ finish_intake: hands over inside the same reply; the course record is written in the background
                     ▼
Session(kind=lesson, phase=teach) ─ Tutor ─> inquire ─> assess ─(≥2 observations)─> next concept ... ─> wrap-up ─> complete
                                                                                      │
                                                                       endSession ──> Assessor Agent ──> MasteryReport
                                                                                      └─> Profile Reviser ──> both records
```

In the web app the first box is held on the Students tab when a student is added ("Add and begin the
intake"), and the Lesson tab starts a sitting with `skipGeneralIntake`, so a first lesson on a course opens
with the second box; the CLI (`npm run chat`) and the API run the whole chain. A student with a profile
skips the first box; a student with a record for the course skips the second. The
two records are the learner profile (how to work with this student, on the learner) and the course-knowledge
record (what they know about one course: starting points from the course intake, and notes kept since;
`data/course-knowledge/<learner>__<course>.json`). A message sent to a finished intake is answered by the
session that took over (`Session.continuedIn`), so a browser or a voice socket can keep one session id.

Phase transitions are requested by the tutor through the `advance` tool and validated in
`orchestrator/session.ts`. For example, the tutor cannot move to the next concept until it has recorded
at least two observations of what the learner showed for the current one (engagement notes and facts the
tutor itself told them do not count). That is the "assess via conversation"
requirement enforced in code rather than left to the prompt.

## Voice path (browser)

One WebSocket per session (`voice/live.ts`). The browser streams microphone audio; AssemblyAI transcribes it
as the student talks and signals the end of their turn; the orchestrator's `respond()` runs the tutor turn
the instant they stop, and the reply is spoken sentence by sentence while the model is still writing the
next one, by Inworld (one stream per reply, over a socket opened when the student starts talking) or
ElevenLabs (sentence batches), chosen in Settings. Clicking Talk while the tutor speaks is a barge-in:
playback stops and the server aborts the rest of the reply. The server opens a fresh session itself the
moment the socket connects, so the tutor speaks first; after an intake's hand-over the same connection
speaks for the session that took over. Text and voice sessions share one state and one assessment path.

## Grounding

"An AI that can't make mistakes" is not something any model can promise. What the system does instead:

1. The Curriculum Agent may only produce concepts with `sourceChunkIds`; dangling references are dropped.
2. The tutor's system prompt carries the current concept's verbatim passages, and a `lookup_source`
   BM25 tool for anything else. The `grounding` skill instructs it to say when the material doesn't cover something.
3. The Assessor audits every tutor claim against the material and lists `ungroundedClaims` in the report the parent sees.
4. Facts the student brings in from outside the material follow the parent's setting (Settings, Outside the reading):
   answer and check, answer without checking, or material only. The tutor labels an outside fact as such, never
   introduces one itself, never rules on faith or values, and follows the material where it differs. The reflect pass
   flags each fact (`flag_outside_claim`); `orchestrator/outside.ts` runs the Reference Checker on it as a background
   job (Wikipedia search, then the articles' summaries, contents and best-matching passages, with one section on
   request), and merges the verdict at the start of the next turn. If the tutor was unsure or wrong, that turn comes
   back to it. The report lists every outside fact under "Outside the reading", with the check's verdict and a link
   to the exact Wikipedia version read, and the assessor no longer counts a correct one as a misconception.

## Data

File-backed JSON in `data/` (`courses/`, `learners/`, `course-knowledge/`, `sessions/`, `reports/`, plus
`settings.json` for the runtime settings and `backups/` for records a migration converted). `JsonStore` is
the only persistence abstraction; swap it for a database when needed. A learner record carries its profile and the
profile's revisions (`profileHistory`: each with the changes, their reasons, what was held, and the profile as it
was before, so the latest can be undone; the last 40 are kept).

## Prompt caching and latency

`base.ts` renders `[role + skills]` as the first cached system block, then the per-session stable
context (course + lesson, learner profile) as a second cached block, then the per-turn blocks (current
concept, observations, phase). Skill order is part of the cached prefix; keep it stable. Sessions
pre-warm the cache on creation, and every assistant turn records time-to-first-token and cache usage.
See [LATENCY.md](LATENCY.md).
