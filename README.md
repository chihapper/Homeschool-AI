# Homeschool AI

A Socratic AI tutor for homeschool families. Upload the material you already teach from; the system
turns it into a course, learns how your student learns, tutors them **by questioning** over voice or
text, and hands you a mastery report you can act on.

Built as a small multi-agent system on the Claude API (Opus 5) with Hume EVI for the voice layer.

## What it does

1. **Ingest** lesson plans, textbook chapters, and worksheets (PDF, DOCX, Markdown, text) into structured lessons and concepts, each traceable to the source passage.
2. **Profile** a new student with a short intake conversation: how they take in ideas, how they best show understanding, pace, and challenge tolerance. Not to make it easier; to make it stick.
3. **Tutor** with the Socratic method: elicit, probe, expose contradictions, ask for demonstrations, and only then move on. The tutor stays inside your material and says so when something isn't covered.
4. **Assess** through the conversation itself. A separate agent reads the transcript, scores mastery per concept (0-4), lists misconceptions, audits the tutor's claims against the source, and writes summaries for parent and student.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the agent design and [skills/](skills/) for the competencies each agent is built from.

## Quick start (text mode, Anthropic key only)

```bash
npm install
cp .env.example .env            # set ANTHROPIC_API_KEY
npm run dev:server              # API on :3001
npm run dev:web                 # UI on :5173
```

Or from the terminal:

```bash
npm run ingest -- --title "Life Science 7" ./my-chapter.pdf
npm run chat -- --learner "Maya" --grade 7      # runs intake, then the lesson, then prints the report
```

## Voice mode (Hume EVI)

1. Get a Hume API key and secret key; put them in `.env`.
2. Expose the server publicly during development (e.g. `ngrok http 3001`) and set `PUBLIC_URL` and a random `CLM_SECRET`.
3. Create the EVI config that points Hume at this server's custom-language-model endpoint:
   ```bash
   npm run setup:hume
   ```
   Put the printed id in `.env` as `HUME_CONFIG_ID` and restart the server.
4. In the web app choose **Voice** when starting a session.

Hume does speech-to-text, expression measurement, turn-taking, and text-to-speech; our server is the
brain behind it, so voice and text sessions share the same tutor, state, and report.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required. |
| `CLAUDE_MODEL` | Model for offline agents (curriculum, profile, assessment). Default `claude-opus-5`. |
| `CLAUDE_TUTOR_MODEL`, `CLAUDE_TUTOR_EFFORT` | Live tutor model and effort. Default `claude-opus-5` at `low` effort for voice latency. |
| `CLAUDE_REFUSAL_FALLBACKS` | Server-side fallback to another Claude model if a safety classifier declines a turn. Default on. |
| `HUME_API_KEY`, `HUME_SECRET_KEY`, `HUME_CONFIG_ID`, `PUBLIC_URL`, `CLM_SECRET` | Voice layer. |

## Project layout

```
apps/server   Fastify API, agents, orchestrator, Hume CLM bridge, CLIs, tests
apps/web      Vite + React UI (text and voice)
skills/       SKILL.md competencies loaded into agent prompts
docs/         Architecture notes
data/         Local JSON store (gitignored)
```

## Development

```bash
npm test            # unit tests (no network)
npm run typecheck
```

Tune agent behaviour by editing `skills/*/SKILL.md` and restarting the server. Add your own skills by
dropping a folder in `skills/` and listing it in the agent's `skills` array in `apps/server/src/agents/`.

## Honest limits

- No model "can't make mistakes". The system reduces the risk by grounding the tutor in your material, giving it a retrieval tool, and having a second agent audit its claims. Read the grounding audit in each report.
- Retrieval is lexical (BM25). Fine for a course; upgrade to embeddings for a whole library.
- Storage is JSON files. Fine for a family; swap `JsonStore` for a database for a school.
