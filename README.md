# Homeschool AI

A Socratic AI tutor for homeschool families. Upload the material you already teach from; the system
turns it into a course, learns how your student learns, tutors them **by questioning** over voice or
text, and hands you a mastery report you can act on.

Built as a small multi-agent system on the Claude API (Opus 5) with Hume EVI for the voice layer.

## What it does

1. **Ingest** whatever you teach from: lesson plans and textbook chapters (PDF, DOCX, Markdown, text), **PowerPoint lectures** (slide text plus speaker notes), **YouTube and TED videos** (captions, or transcribed when there are none), **podcasts** (RSS feed or episode link), and web pages. Everything becomes lessons and concepts traceable to the source passage or timestamp.
2. **Profile** a new student with a short intake conversation: how they take in ideas, how they best show understanding, pace, and challenge tolerance. Not to make it easier; to make it stick.
3. **Tutor** with the Socratic method: elicit, probe, expose contradictions, ask for demonstrations, and only then move on. The tutor stays inside your material and says so when something isn't covered.
4. **Assess** through the conversation itself. A separate agent reads the transcript, scores mastery per concept (0-4), lists misconceptions, audits the tutor's claims against the source, and writes summaries for parent and student.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the agent design, [docs/LATENCY.md](docs/LATENCY.md) for how the voice path stays conversational, [docs/RESEARCH.md](docs/RESEARCH.md) for the product and learning-science research, and [skills/](skills/) for the competencies each agent is built from.

## What this is (and is not)

This is a study partner for one unit of the material you already teach from, plus a running picture of
where your child stands on it. You bring a chapter, a week's readings, or a topical booklet; the tutor
questions your child on it and never asserts anything the material does not say; the report shows you
what they can explain, apply, and still get wrong, and whether the tutor stayed inside your material.

It is not a curriculum. It does not choose what to teach, plan your week, replace the reading or the
workbook, grade tests, or keep records. Homeschool families skip and substitute parts of any curriculum,
so what gets taught stays your call: untick lessons or concepts on the Courses tab (**Focus**) and the
tutor leaves them alone. Tick **Already read this** when starting a session and the tutor opens the way a
Charlotte Mason narration does, asking your child to tell the reading back before any questions. The
**Progress** panel on the Reports tab turns the session reports into one view per child and course.

It works best on prose: history and science readings, literature, a parent's guide such as the Fords'
*Ancient Civilizations* units, a chapter from an AmblesideOnline book, single-topic products such as
Memoria Press's *Famous Men of Rome* or Beautiful Feet's *Ancient History*, and the reading articles
inside a workbook (The Good and the Beautiful's grade 7-8 "lesson extensions" are exactly that). The
activity pages of a workbook (maps to label, ciphers, timelines, cut-and-paste, math worksheets) mostly
do not come through as text yet; reading those as activities is the first item on the
[roadmap](docs/ROADMAP.md).

## Quick start (text mode, Anthropic key only)

```bash
npm install
cp .env.example .env            # set ANTHROPIC_API_KEY
npm run dev:server              # API on :3001
npm run dev:web                 # UI on :5173
```

Or from the terminal:

```bash
npm run ingest -- --title "Life Science 7" ./my-chapter.pdf ./lecture.pptx
npm run ingest -- --title "Cells" https://www.youtube.com/watch?v=... https://www.ted.com/talks/...
npm run ingest -- --episodes 2 https://example.com/podcast/feed.xml
npm run chat -- --learner "Maya" --grade 7      # runs intake, then the lesson, then prints the report
```

Video and podcast ingestion needs two extra pieces: the `yt-dlp` binary (`pip install yt-dlp`) for
video sites, and a speech-to-text provider for anything without captions (`DEEPGRAM_API_KEY`, or a
local `whisper` CLI with `STT_PROVIDER=whisper-cli`). YouTube captions need only `yt-dlp`.

## Voice mode in the browser

The student talks into the web app, AssemblyAI turns it into text, and the tutor's reply is spoken by
**ElevenLabs** or **Hume Octave**. Pick the provider with the toggle at the top of **Settings, Voice**;
the voice, model and sound fields below it change with the provider, and **Test this voice** speaks one
line with the unsaved settings (about 100 characters of credits). Needs `ASSEMBLYAI_API_KEY` plus the
chosen provider's key. The microphone works in Chrome at `http://localhost:5173`.

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
| `CLAUDE_TUTOR_THINKING`, `CLAUDE_PREWARM_CACHE` | Latency knobs; see [docs/LATENCY.md](docs/LATENCY.md). |
| `ASSEMBLYAI_API_KEY` | Browser voice: the student's speech to text. |
| `VOICE_TTS`, `ELEVENLABS_API_KEY`, `HUME_API_KEY` | Browser voice: who speaks the tutor's reply, ElevenLabs or Hume Octave. `VOICE_TTS` is only the default; the toggle at the top of Settings, Voice switches it from the next reply. An ElevenLabs key starts with `sk_`. |
| `HUME_API_KEY`, `HUME_SECRET_KEY`, `HUME_CONFIG_ID`, `PUBLIC_URL`, `CLM_SECRET` | Hume EVI voice mode (Hume runs the conversation loop). |
| `YTDLP_BIN`, `STT_PROVIDER`, `DEEPGRAM_API_KEY`, `WHISPER_BIN` | Video and podcast ingestion. |

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

- **YouTube.** Fetching transcripts or audio from videos you do not own breaches YouTube's terms of service (a civil matter, and cloud IPs get blocked). Use the video path for your family's own or clearly licensed videos, run it from your own machine, or plug in a hosted transcript API. TED talks are CC BY-NC-ND: fine for personal educational use; a commercial product built on them needs a licence check. Podcast feeds and PowerPoint files carry no such issue.
- **Voice latency.** Hume in custom-language-model mode is speech recognition, then Claude, then Hume's speech model voicing the text. It is not native speech-to-speech, and that is deliberate: it keeps the orchestrator, grounding, and assessor in charge. The cost is time-to-first-token, which is why the live tutor defaults to Sonnet 5 and every turn is measured. See [docs/LATENCY.md](docs/LATENCY.md).

- No model "can't make mistakes". The system reduces the risk by grounding the tutor in your material, giving it a retrieval tool, and having a second agent audit its claims. Read the grounding audit in each report.
- Retrieval is lexical (BM25). Fine for a course; upgrade to embeddings for a whole library.
- Storage is JSON files. Fine for a family; swap `JsonStore` for a database for a school.
