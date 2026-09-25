# Homeschool-AI — project guide for Claude Code

A Socratic AI tutor for homeschool families. Multi-agent TypeScript app: a Fastify server hosts the
agents and a Hume EVI custom-language-model endpoint; a Vite/React app is the parent/student UI.

## Layout

- `apps/server/src/domain/types.ts` — every persisted object and structured LLM output, as Zod schemas. Change schemas here first.
- `apps/server/src/agents/` — one file per agent (`curriculum`, `profiler`, `tutor`, `assessor`) plus `base.ts` (prompt assembly + streaming tool loop).
- `apps/server/src/orchestrator/session.ts` — deterministic state machine; the only place phase transitions and persistence happen.
- `apps/server/src/domain/focus.ts`, `domain/progress.ts` — pure: the parent's focus (what the tutor teaches) and the cross-session progress view. `ingest/pdf-text.ts` joins PDF text by glyph geometry (scans fuse words otherwise).
- `apps/server/src/voice/` — voice. Browser path: `live.ts` (WebSocket per session: mic audio in, spoken reply out, barge-in), `stt-assemblyai.ts` (streaming speech-to-text with end-of-turn detection), `tts-hume.ts` (Octave, per sentence), `sentence-chunker.ts`, `pcm.ts`. Hume EVI path: `clm.ts` (SSE endpoint Hume calls), `hume.ts` (tokens, config creation). Provider specifics stay in the adapters; the turn loop lives in `live.ts`.
- `apps/server/src/ingest/` — file -> text -> heading-aware chunks -> BM25 index. `extract.ts` dispatches on file type (pdf, docx, epub, odt, rtf, html, text, zip) and refuses anything else by name with the conversion to run; `documents.ts` holds the markup readers and the shared text helpers; `ocr.ts` reads page scans through the model. `ingest/media/` handles pptx, video (yt-dlp), podcasts (RSS), speech-to-text, and web pages; `media/sources.ts` is the single entry point.
- `skills/*/SKILL.md` — agent competencies, loaded at runtime into system prompts. Tune behaviour here before touching code.
- `apps/web/` — React UI (text mode works with only an Anthropic key; voice needs Hume).
- `data/` — file-backed JSON store (gitignored). One JSON per course/learner/session/report.

## Conventions

- Claude API via `@anthropic-ai/sdk` only. Default model `claude-opus-5`; adaptive thinking on; effort from config. Never add `temperature` or `budget_tokens`.
- Structured outputs use `client.messages.parse` + `zodOutputFormat`. Avoid JSON-schema features structured outputs reject (numeric min/max, defaults); validate those in code.
- Streaming agents use `client.beta.messages.stream` (needed for server-side refusal fallbacks). Always check `stop_reason` before trusting content.
- System prompts: stable role + skills first (cached), per-session context after. Keep the stable part byte-identical across turns.
- Agents *request* transitions through tools; the orchestrator validates and applies them. Don't let an agent mutate session state directly.
- A tutor turn is **two calls**: `tutorTurn` speaks (no bookkeeping tools, thinking off, the learner is waiting) and `reflectTurn` records observations, requests the phase change, and may leave ONE note for the next turn (`note_for_next_turn` -> `orchestrator/notes.ts`), all while the learner listens. Never move bookkeeping back into the speaking call, not even as words in a directive it reads (a retrieval directive that said "record the result" made it narrate aloud; that answer is filed by the reflect pass via `Session.retrievalConceptId`); never let the speaking call think. Once a spoken reply ends in its question, any tool call ends the turn (`streamTurn` in `agents/base.ts`). `respond()` returns the reflect pass as `reflection` and awaits any pending one before the next turn (`settleReflection`). The thread is not a competing instruction: it rides with the phase guidance in one block (phase = what kind of work this turn does, thread = what the work is on) and carries how many turns it has been open, so the tutor varies its angle at first and then asks plainly. Keep it that way; an earlier version made the note *outrank* the phase, which worked but read as an org chart rather than a dialogue.
- Grounding is a product requirement: the tutor must not assert facts outside the course material. The assessor audits this. Keep it that way.
- Scope is one unit at a time plus a parent's view; no scheduling, planning, or grading. Focus (what the tutor teaches) is the parent's decision on `Course.focus`, never an agent's. It is resolved once at `createSession` into `Session.conceptIds`; every read in a running session goes through `domain/focus.ts` (`walkedConceptIds`), never a live `lesson.conceptIds`, so a mid-session edit cannot change the walk or the cached prompt prefix.
- Latency is a product requirement for the live tutor: stream every delta, keep bookkeeping and thinking out of the speaking call, keep the cached prefix stable, gate effort/thinking params on the model (`reasoningParams`). Every assistant turn records `latency`; see `docs/LATENCY.md`.
- External binaries (`yt-dlp`, `whisper`) and STT APIs are optional and must fail with a clear message, never crash ingestion of other sources.
- An unreadable upload must never become text. `extract.ts` refuses a binary rather than reading it as UTF-8, because mojibake looks enough like prose that the curriculum agent will build a course from it. Every refusal names the conversion that produces a readable file.
- Tests are pure (no network, no binaries). `npm test` must pass before pushing.

## Commands

```
npm install
npm run dev:server            # http://localhost:3001
npm run dev:web               # http://localhost:5173
npm run ingest -- --title "Bio 7" ./chapter.pdf
npm run chat -- --learner "Maya" --course <courseId>
npm run setup:hume -- --url https://<tunnel>
npm test && npm run typecheck
```
