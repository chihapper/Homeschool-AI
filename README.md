# Homeschool AI

A Socratic AI tutor for homeschool families. Upload the material you already teach from; the system
turns it into a course, learns how your student learns, tutors them **by questioning** over voice or
text, and hands you a mastery report you can act on.

Built as a small multi-agent system on the Claude API. Which model does which job is yours to set in
Settings: the default is Opus 5.5 for the work that happens offline (building a course, writing the
records, the end-of-session report) and Sonnet 5.5 for the live tutor, whose first word has to come fast;
Haiku 5.5 speaks for about a tenth of the price. Voice runs in the browser: AssemblyAI listens, Inworld or
ElevenLabs speaks, and the same tutor answers either way. Every call is priced as it is made, so a lesson
and a month both carry a measured cost.

## What it does

1. **Ingest** the course as you bought it: lesson books and textbook chapters (PDF, Word `.docx`, EPUB, ODT, RTF, HTML, Markdown, plain text, or a `.zip` of any of those), **page scans and photographs** (`.png`, `.jpg`, read by the model and transcribed verbatim), **PowerPoint lectures** (slide text plus speaker notes), **YouTube and TED videos** (captions, or transcribed when there are none), **podcasts** (RSS feed or episode link), and web pages. Files up to 500 MB each, twenty at a time — a publisher's full-colour course book runs to 150 MB. Everything becomes lessons and concepts traceable to the source passage or timestamp. A build runs in the background: "Add a course" takes your files and closes, a ring in the corner shows how far along it is, and a notice tells you when the course is ready or why it failed. Anything the tool cannot read is refused by name, with the conversion that would fix it.
2. **Get to know** a new student in two short conversations, each held once. The first happens when you add them on the Students tab and is about how to work with them, on any course: what they like doing, how they tell back a short passage built into the app (the same for every student, and you can read it on the Students tab), and what they do when a question gets hard. It never uses your course. The second opens their first lesson on each course (Lesson tab): one plain question on each of its central ideas and "how sure are you, 0 to 10?", with no teaching, so the tutor starts each idea from what your child already knows and you can see what they knew before. Both hand over to the lesson by themselves. What the app keeps is two records: how to work with your child, and what they know about each course. After every session's report both are revised from what the student showed, each change with its reason on the Students tab, and you can undo any of them. Pace, what they do when stuck and how much nuance they are ready for change only when two sessions in a row point the same way. There is a box for your own notes, which the tutor follows as written, and no "learning style": the evidence that matching teaching to one helps is not there.
3. **Tutor** with the Socratic method: elicit, probe, expose contradictions, ask for demonstrations, and only then move on. The tutor teaches only from your material. When your student brings up something from outside it, the tutor confirms it, corrects it or says it isn't sure, says it doesn't see it in the reading, and (your choice in Settings) checks it against Wikipedia in the background, coming back to it if it was unsure or wrong. It never rules on faith or values, and where your material and another source differ, it follows your material.
4. **Assess** through the conversation itself. A separate agent reads the transcript, scores mastery per concept (0-4), lists misconceptions, audits the tutor's claims against the source, and writes summaries for parent and student. A lesson runs on a clock you set (3 to 60 minutes, 30 by default): the tutor wraps up with two minutes left, says goodbye at the limit, and the session ends there.
5. **Show you the movement**, not just the level. Because the course intake recorded what your child could say about each idea *before* any teaching, the Reports tab can put the two ends side by side: how many concepts have been taught, how many moved up and by how many rungs, which sit where they started, and which have slipped below it. An idea your child could already explain has to reach "applies it to a new case" before it counts as learning — which is the difference between a reassuring report and a true one.

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the agent design, [docs/LATENCY.md](docs/LATENCY.md) for how the voice path stays conversational, [docs/COST.md](docs/COST.md) for what a session costs and which model does what, [docs/INTAKE.md](docs/INTAKE.md) for the two intakes and the research behind them, [docs/TESTING.md](docs/TESTING.md) for the testing plan, [docs/ROADMAP.md](docs/ROADMAP.md) for what is deliberately not built, [docs/RESEARCH.md](docs/RESEARCH.md) for the product and learning-science research, and [skills/](skills/) for the competencies each agent is built from.

## What this is (and is not)

This is a study partner for the material you already teach from, one course at a time, plus a running
picture of where your child stands on it. You bring the course as you have it, such as a lesson book and its
student workbook; the tutor
questions your child on it and never asserts anything the material does not say; the report shows you
what they can explain, apply, and still get wrong, and whether the tutor stayed inside your material.

It is not a curriculum. It does not choose what to teach, plan your week, replace the reading or the
workbook, grade tests, or keep records. Homeschool families skip and substitute parts of any curriculum,
so what gets taught stays your call: untick lessons or concepts on the Courses tab (**Focus**) and the
tutor leaves them alone. Tick **Already read this** when starting a lesson and the tutor opens the way a
Charlotte Mason narration does, asking your child to tell the reading back before any questions. The
**Progress** panel on the Reports tab turns the session reports into one view per child and course, measured
against where they started before the course rather than against nothing.

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
**Inworld** or **ElevenLabs**. Pick the provider with the toggle at the top of **Settings, Voice**;
the voice, model and sound fields below it change with the provider, and **Test this voice** speaks one
line with the unsaved settings (about 100 characters of credits). Needs `ASSEMBLYAI_API_KEY` plus the
chosen provider's key. The microphone works in Chrome at `http://localhost:5173`. Inworld voices each reply as
one continuous stream over a connection opened while the student is talking; ElevenLabs voices it in
sentence batches.

## Configuration

| Variable | Purpose |
|---|---|
| `ANTHROPIC_API_KEY` | Required. |
| `CLAUDE_MODEL`, `CLAUDE_ASSESSOR_MODEL` | Model for the offline agents (curriculum, profile, assessment). Default `claude-opus-5-5`; the assessor may use its own (empty: the same). |
| `CLAUDE_TUTOR_MODEL`, `CLAUDE_REFLECT_MODEL`, `CLAUDE_TUTOR_EFFORT` | Live tutor model and effort; the notes the tutor takes after each reply may run on another model (empty: the same). Default `claude-sonnet-5-5` at `low` effort for voice latency. A cheap speaker with a careful note-taker is the pairing that has held up in use: `claude-haiku-5-5` speaking (about a tenth of Sonnet's price, and just as fast to the first word) with Sonnet 5.5 taking the notes, since Haiku's notes graded every answer alike. IDs use hyphens (`claude-sonnet-5-5`, not `5.5`); the Settings tab checks a typed ID with the API before saving. What each model accepts lives in one table, `apps/server/src/llm/models.ts`. |
| `CLAUDE_REFUSAL_FALLBACKS` | Server-side fallback to another Claude model if a safety classifier declines a turn. Default on. |
| `CLAUDE_TUTOR_THINKING`, `CLAUDE_PREWARM_CACHE` | Latency knobs; see [docs/LATENCY.md](docs/LATENCY.md). |
| `SESSION_MAX_MINUTES` | How long a lesson may run (3 to 60; default 30). The tutor wraps up with two minutes left and says goodbye at the limit; Settings changes it. |
| `OUTSIDE_KNOWLEDGE`, `WIKIPEDIA_CONTACT` | Facts your student brings in from outside the material: `check` (answer, then check against Wikipedia in the background), `answer`, or `material-only`; Settings, Outside the reading overrides it. The checks need a contact (an email address or website) that Wikimedia's policy requires in every request. |
| `ASSEMBLYAI_API_KEY` | Browser voice: the student's speech to text. |
| `VOICE_TTS`, `INWORLD_API_KEY`, `ELEVENLABS_API_KEY` | Browser voice: who speaks the tutor's reply, Inworld or ElevenLabs. `VOICE_TTS` is only the default; the toggle at the top of Settings, Voice switches it from the next reply. An ElevenLabs key starts with `sk_`; an Inworld key is the Portal's Base64 credential, pasted as-is. |
| `OPENAI_API_KEY` | Optional. Lets the report (and only the report) run on an OpenAI model such as `gpt-6.1-sol`, chosen in Settings. |
| `YTDLP_BIN`, `STT_PROVIDER`, `DEEPGRAM_API_KEY`, `WHISPER_BIN` | Video and podcast ingestion. |

## Project layout

```
apps/server   Fastify API, agents, orchestrator, browser voice socket, CLIs, tests
apps/web      Vite + React UI (text and voice)
skills/       SKILL.md competencies loaded into agent prompts
docs/         Architecture notes
data/         Local JSON store (gitignored)
```

## Development

```bash
npm test                  # 285 unit tests, no network and no binaries
npm run typecheck
npm run doctor -- --ping  # which keys and tools are present, and one tiny API call
npm run personas:intake   # server running: three scripted students through both intakes, with checks
npm run assess:compare -- <sessionIdPrefix> label=model@effort ...   # one saved session, several report models
npm run profile:compare -- <sessionIdPrefix> label=model@effort ...  # the same for the profile pass
npm run replay:lesson -- <sessionIdPrefix>   # replay a past lesson's turns on a throwaway copy
```

The three `compare`/`replay` scripts make real model calls and save nothing to the app; they are how a
change to the tutor's behaviour or a change of model gets measured rather than guessed at.

Tune agent behaviour by editing `skills/*/SKILL.md` and restarting the server. Add your own skills by
dropping a folder in `skills/` and listing it in the agent's `skills` array in `apps/server/src/agents/`.

## Honest limits

- **YouTube.** Fetching transcripts or audio from videos you do not own breaches YouTube's terms of service (a civil matter, and cloud IPs get blocked). Use the video path for your family's own or clearly licensed videos, run it from your own machine, or plug in a hosted transcript API. TED talks are CC BY-NC-ND: fine for personal educational use; a commercial product built on them needs a licence check. Podcast feeds and PowerPoint files carry no such issue.
- **Voice latency.** Voice is speech recognition (AssemblyAI), then Claude, then a speech model voicing the text (Inworld or ElevenLabs). It is not native speech-to-speech, and that is deliberate: it keeps the orchestrator, grounding, and assessor in charge. The cost is time-to-first-token, which is why the live tutor defaults to Sonnet 5.5 — the tier that can speak without stopping to think first — and why every turn is measured. See [docs/LATENCY.md](docs/LATENCY.md).
- **Running cost.** A spoken lesson of twenty turns costs roughly $0.65 to $0.80 at list prices today, most of it the voice rather than the thinking, and a report on top of that. A dozen lessons a month per child is $8 to $10. The session-length cap is the lever that bounds it; [docs/COST.md](docs/COST.md) has the measurements.

- No model "can't make mistakes". The system reduces the risk by grounding the tutor in your material, giving it a retrieval tool, and having a second agent audit its claims. Read the grounding audit in each report.
- Retrieval is lexical (BM25). Fine for a course; upgrade to embeddings for a whole library.
- Storage is JSON files. Fine for a family; swap `JsonStore` for a database for a school.
