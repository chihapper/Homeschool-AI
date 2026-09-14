# Homeschool-AI — project guide for Claude Code

A Socratic AI tutor for homeschool families. Multi-agent TypeScript app: a Fastify server hosts the
agents and a Hume EVI custom-language-model endpoint; a Vite/React app is the parent/student UI.

## Layout

- `apps/server/src/domain/types.ts` — every persisted object and structured LLM output, as Zod schemas. Change schemas here first.
- `apps/server/src/agents/` — one file per agent (`curriculum`, `profiler`, `tutor`, `assessor`) plus `base.ts` (prompt assembly + streaming tool loop).
- `apps/server/src/orchestrator/session.ts` — deterministic state machine; the only place phase transitions and persistence happen.
- `apps/server/src/voice/` — Hume bridge: `clm.ts` (SSE endpoint Hume calls), `hume.ts` (tokens, config creation).
- `apps/server/src/ingest/` — file -> text -> heading-aware chunks -> BM25 index. `ingest/media/` handles pptx, video (yt-dlp), podcasts (RSS), speech-to-text, and web pages; `media/sources.ts` is the single entry point.
- `skills/*/SKILL.md` — agent competencies, loaded at runtime into system prompts. Tune behaviour here before touching code.
- `apps/web/` — React UI (text mode works with only an Anthropic key; voice needs Hume).
- `data/` — file-backed JSON store (gitignored). One JSON per course/learner/session/report.

## Conventions

- Claude API via `@anthropic-ai/sdk` only. Default model `claude-opus-5`; adaptive thinking on; effort from config. Never add `temperature` or `budget_tokens`.
- Structured outputs use `client.messages.parse` + `zodOutputFormat`. Avoid JSON-schema features structured outputs reject (numeric min/max, defaults); validate those in code.
- Streaming agents use `client.beta.messages.stream` (needed for server-side refusal fallbacks). Always check `stop_reason` before trusting content.
- System prompts: stable role + skills first (cached), per-session context after. Keep the stable part byte-identical across turns.
- Agents *request* transitions through tools; the orchestrator validates and applies them. Don't let an agent mutate session state directly.
- Grounding is a product requirement: the tutor must not assert facts outside the course material. The assessor audits this. Keep it that way.
- Latency is a product requirement for the live tutor: stream every delta, speak before tool calls, keep the cached prefix stable, gate effort/thinking params on the model (`reasoningParams`). Every assistant turn records `latency`; see `docs/LATENCY.md`.
- External binaries (`yt-dlp`, `whisper`) and STT APIs are optional and must fail with a clear message, never crash ingestion of other sources.
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
