# Skills

Each agent is composed from one or more **skills**: a `SKILL.md` file with YAML frontmatter
(`name`, `description`) and a body of concrete instructions. Skills are loaded at runtime by
`apps/server/src/skills/loader.ts` and concatenated into the agent's system prompt in the
order the agent declares them.

| Skill | Used by | Competency |
|---|---|---|
| `curriculum-parsing` | Curriculum Agent | Turn raw lesson plans / textbooks into structured lessons, concepts, objectives |
| `grounding` | Curriculum, Tutor, Assessor | Only assert what the source material supports; cite chunks; say "the material doesn't cover that" |
| `initial-assessment` | Profiler Agent | Run the intake conversation and produce a learner profile |
| `learner-adaptation` | Tutor Agent | Apply the learner profile: pacing, analogies, demonstration formats |
| `socratic-method` | Tutor Agent | Elenchus, guided questioning, never handing over the answer prematurely |
| `voice-conversation` | Tutor, Profiler | Spoken-register output for TTS: short turns, no markdown, one question at a time |
| `mastery-assessment` | Assessor Agent | Score mastery from transcript evidence, detect misconceptions, recommend next steps |

Edit a skill and restart the server: no code changes needed to tune agent behavior.
If you keep personal skills on your desktop, drop them here (or symlink) and reference them
from an agent's `skills` array in `apps/server/src/agents/*.ts`.
