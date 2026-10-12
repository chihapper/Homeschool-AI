# The two intakes: research and design

Written 2026-09-27. Status: **built on 2026-10-05** (§0 says what exists and where it differs); the rest is the
proposal as written, kept for its reasoning and sources. It answers two questions the user put on 2026-09-27: what
should the app ask a new student, and what can the agents actually use from the answers? Every element below
says where it came from, why, and whether it fits our model. The three research reports it rests on are
appended in full (Appendix A: AI tutoring products; B: schools, tutoring companies and homeschool publishers;
C: the learning science). "R1 §3" points into them.

Two features, by the user's decision:

1. **The general intake**: once, when a student is added (Students tab). It writes the learner profile, "how this
   student learns", which every course shares and the profile pass keeps current after each session.
2. **The course intake**: once per student per course, at the start of the student's first lesson on it (or
   from "Ask again" on the Courses tab). It writes the course-knowledge record, "where this student starts on this
   content", which the profile pass keeps current after each session on that course.

A rule that runs through both: **the general intake never uses the parent's course as its material.** The
old intake did, and taught lesson one before the lesson (sessions of 2026-09-15 and 2026-09-21).

## 0. As built (2026-10-05)

Stages A to D of §8 are built, on branch `feature/intakes`. This section says what exists, where, and where
it differs from the proposal below, which is kept as written for its reasoning and sources.

| Piece | Where | In short |
|---|---|---|
| Two records | `LearnerProfileSchema`, `CourseKnowledgeSchema` in `domain/types.ts`; `data/course-knowledge/` | The profile lost `intakePreferences`, `priorKnowledge` and `observedGaps`. The course record holds starting points, prior knowledge, gaps, course guidance and a summary for the parent. `Learner.parentNotes` is the parent's box. |
| Migration | `store/migrate.ts`, run when a server or CLI starts | Entries tagged with a course ("Rome: ...") moved to that course's record, untagged ones to the course of the student's first session. Originals are in `data/backups/intake-split/`. |
| The passage and its questions | `domain/intake.ts` | "Why ice floats", as proposed. The band questions that §7.1 left open are written (below). |
| General intake | `agents/profiler-agent.ts`, skill `initial-assessment` | The agent calls `read_passage` and the orchestrator speaks the passage word for word, once. |
| Course intake | `agents/course-intake-agent.ts`, skill `course-intake`, `selectProbeConcepts` | Six questions up to twelve kept lessons, eight beyond: half from the first two kept lessons, one from each later stretch, the concept most others build on first. |
| The sitting | `planSitting`, `createSession`, `continueSitting` in `orchestrator/session.ts` | Each intake is its own session with its own transcript. The hand-over and the next opening are one reply. |
| Records in the background | `writeIntakeRecord` | A pending mark on the learner or the course record while it is written; a failed write is shown with a way to try again, and the conversation is never held twice. |
| Tutor | the learner block and `startingPoint` in `agents/tutor-agent.ts`; skills `learner-adaptation`, `socratic-method` | Entry point from what the student knows; opens a probed concept with their own words; a confident wrong answer is corrected early and in full. |
| Assessor and progress | `startingPointsBlock`; `buildProgress(..., knowledge)`; skill `mastery-assessment` | "Before and after" in the report; a "Before the course" column in the progress table. |
| Profile pass | `agents/profile-agent.ts`, `domain/profile.ts`, skill `profile-update` | Revises both records; undo puts both back. |
| The parent's side | Students, Courses, Lesson and Reports tabs | Both records, the notes box, the passage, why there is no learning style. Since 2026-10-06 (the user's call): the general intake is held on the Students tab when a student is added ("Add and begin the intake"); a first lesson on a course opens with the course intake on the Lesson tab, with a notice and "Skip the questions this time"; the Courses tab has "Start X on this course", "Continue with X" and "Ask again". |
| Scripted personas | `apps/server/scripts/intake-personas.ts` | Three students through both intakes on a running server, with checks. |

**The questions, by band.** One passage; the intake starts in the student's grade band, and the hard question
comes from the next band up after a sound answer, the band below after a weak one.

| Band | Apply (step 3) | The hard one (step 4) |
|---|---|---|
| A, grades 4 to 6 (and below) | An ice cube dropped in a full glass: where does it end up, and why, from what was read? | Fish live through the winter under the ice. If ice sank, what would happen to the lake, and to the fish? |
| B, grades 7 to 9 | A bottle filled to the top, sealed, put in the freezer: what happens to it, and why? | The ice works like a lid: step by step, why does ice form on top, and how does that keep the fish alive? |
| C, grade 10 and up | A pipe bursts on a freezing night: why, and would it if water behaved like most things? | Suppose water were not the odd one out: a winter in that lake step by step, and the one fact everything depends on. |

**Where it differs from the proposal, and why.**

1. **Faith is never asked about.** §5 says religion is never asked of a child, and the Rome unit has a lesson on
   God's plan. The course intake leaves out any concept whose name or summary trips the guard that already keeps
   scripture away from Wikipedia (`aboutFaith`), and asks about the next most central one instead; the lesson
   teaches the concept from the family's material as before. A course with nothing left to ask has no course
   intake.
2. **The passage is spoken by the orchestrator, not the model**, so every student hears the same words, and it is
   read once: after the first reading the tool is no longer offered (a quiet student's thin retelling got a
   second reading in a test run).
3. **A concept the opening narration covered is not asked again** (the proposal said "a shorter probe or none").
4. **`challengeTolerance` keeps its name and three values**, and is shown to the parent as "When stuck" with a
   sentence per value. What the student actually did is in the guidance.
5. **The lesson does not wait for the notes.** A record takes about a minute to write. Until it lands, the lesson
   that follows a course intake reads the intake's exchange itself, so the first concept still opens with the
   student's own answer.
6. **The records are checked in code for a gender nobody stated** (`agents/pronouns.ts`). The skill's rule alone
   did not hold: test runs wrote "her" for a Maya and "He" for an Eli. A record that trips the check is sent
   back once to be reworded. A pronoun in the parent's notes is the only thing that licenses one.
7. **Course guidance has a ceiling of four items**, like the profile's six.
8. **Not built:** read-aloud fluency in voice mode (§7.4, waits on the COPPA question in #13); a periodic refresh
   of the general intake ("Reset profile" runs it again); a per-lesson pre-assessment (the tutor's opening
   retrieval question does that job, as decided on 2026-09-28).

**Stage D: three scripted students, both intakes, on the running server** (2026-10-05; tutor on Sonnet 5.5, records
written by Opus 5.5, the students played by Sonnet 5.5, text mode, the Ancient Rome unit). Run it again with
`npm run personas:intake` while the server is up.

| | Confident, grade 7 | Quiet, grade 5 | Bluffer, grade 9 |
|---|---|---|---|
| General intake, exchanges (limit 8) | 5 | 7 | 5 to 6 |
| Its two questions | band B, then band C: stepped up | band A, then band A | band B, then band A: stepped down after a right answer with a wrong reason |
| Course intake, exchanges (limit 12) | 8 to 10 | 4: stopped after two "I don't know"s in a row | 10 |
| Hand-over replies, closing words and next opening together | 7.5 to 10.8 s, then 4.9 to 5.2 s | 6.2 to 6.9 s, then 5.2 to 5.5 s | 9.8 to 11.1 s, then 4.2 to 5.3 s |
| How the lesson opened | with the legend as they had told it | "you said you didn't know how Rome began", then taught first | "you told me Julius Caesar founded Rome, 10 out of 10 sure. Here is exactly what your reading says" |

The words stream from the first second of a hand-over reply; the seconds above are for the whole of it, two
calls back to back. In every run the passage was read word for word, the apply question matched the student's
grade band, nothing was given away before the hard question, the course intake never said whether an answer
was right and put no date or figure in a question, and "that's right, isn't it?" got "Hold that thought, you'll
see in the reading." Checks passed: 59 of 63 on the first run of all three, 67 of 69 on the second, then 23 of
23 (quiet) and 24 of 24 (bluffer, through to a report). What the misses were:

- **Assigned gender** (runs 1 and 2): "her" and "He" in the records. Now checked in code (item 6 above); the
  second run and after were clean.
- **The passage read twice** (run 2, the quiet student): fixed by no longer offering the tool once it is read.
- **The hand-over repeated itself** ("…what you already know about Ancient Rome. Tell me everything you already
  know about Ancient Rome."): the general intake now leads in without naming the course.
- **One question without "how sure"** (the quiet student's second question, both runs): the tutor drops it
  after an "I don't know" on the question before. The student gave a number anyway; left as it is.
- **Three were my checks, not the product**: counting an apostrophe as a quotation mark, counting a line written
  for the tutor as the student's words, and expecting "how sure?" when the student had already said.

Two things the report run showed and that are fixed: the profile pass took the quotation marks off twenty-two
course notes, which would have shown the parent twenty-two removals and twenty-two additions (a revision that
only re-punctuates an entry now changes nothing, `keepWording`), and the assessor called a student's "like I
said earlier" a claim never made, because the course intake is a conversation it does not see (it is now given
the notes on record as well as the starting points). The report itself used the baseline as intended: "Before
the course, Jordan was completely sure (10 out of 10) that Julius Caesar founded Rome… That change is real
progress, but it came right after the tutor read the passage aloud, so it is not yet solid recall."

Not covered by these runs: voice mode (the hand-over is the same code path, with the socket following the
session; not yet heard aloud), a real child, and estimates on a guess that happens to be right, which the
record files as "some knowledge" with a low number rather than "nothing yet".

## 1. What the research says, in short

The three reports agree more than expected. Ranked by evidence that the characteristic changes what good
teaching looks like AND can be read from a short conversation (R3, ranking; R1 §b; R2 bottom line):

| Rank | Characteristic | Evidence | What it changes |
|---|---|---|---|
| 1 | **Prior knowledge of this unit's central ideas** | Novices gain from more guidance (d = 0.51), knowledgeable learners from less (d = −0.43), 60 studies (Tetzlaff 2025, R3 §1). Asking only for a problem's first step correlates up to .92 with a full test, at a fifth of the time (Kalyuga & Sweller 2004, R3 §1). ALEKS's 30-question check predicts held-out answers at AUROC .875 (R1 ALEKS, R3 §1). | Teach-first or question-first, per concept. The single most useful thing a tutor can know. |
| 2 | **Confidence on each answer** | Children fix confident errors best after feedback (Metcalfe & Finn 2012, R3 §4); less overconfident students retain more (Dunlosky & Rawson 2012); Area9 asks on every question (R1 §b). | Confident-wrong answers get a full correction, not a hint ladder. |
| 3 | **Help- and answer-seeking, observed** | Gaming the system predicts post-tests as strongly as prior knowledge (Baker 2004, R3 §5); tutor design explains 56 % of it, five times the student's traits (Baker 2009). | Something to watch in sessions (the assessor already counts answer-seeking turns), and mostly our design's job. Not a question to ask. |
| 4 | **Task-specific self-efficacy** ("how sure are you that you can do this?", 0–10) | Predicts next-period help-seeking and learning when asked every few problems (Bernacki 2015, R3 §3). In children, doing well raises the belief, not the reverse (Talsma 2018): measure it, don't try to change it. | How early to scaffold; confirm early successes for an under-confident student. |
| 5 | **Interests, specific** | Interest-matched content: retention g = 0.48, transfer 0.36 across 34 studies (Lin 2024, R2 §2, R3 §6); gains largest for struggling students, but only when the problem's depth matched how the student actually uses the hobby (Walkington 2013, 2019); picking a context from a menu did nothing (Iterbeke 2022). | The tutor's analogies. Ask the student directly and specifically; never offer a menu. |
| — | Reading level | Valid only through reading aloud: automatic words-correct-per-minute within 3–4 words of human scorers (Bolaños 2013, R3 §9); chat understates a child's syntax (Nippold 2005). | A voice-mode measure for later, and a privacy question (§5). Typed words give a register, not a level. |
| — | Age | Question-first beats explain-first (g = 0.36) but reverses for grades 2–5 (Sinha & Kapur 2021); unguided discovery hurts adolescents (d = −0.53), discovery with feedback helps (Alfieri 2011, R3 §8). | Explain-first by default for grade 5 and below; question-first with quick feedback from about age 12. The parent gives the grade; nothing to measure. |

Two findings about the intake itself:

- **Being asked before learning helps learning.** Pretested content is learned far better than untested
  content (g = 0.54 and 0.66 in two meta-analyses, stronger with feedback afterwards: St. Hilaire 2024,
  King-Shepard 2025, R3 §2). A course intake that asks about the unit's central ideas is not just measurement;
  it primes the lessons, provided the answers come soon after.
- **What helps a language-model tutor is the student's knowledge state and history, not trait labels.** Khan
  Academy's tutor got 6.1 % more next-problem answers right when shown the student's recent attempts and
  unmastered prerequisites (R1 Khanmigo); sequencing work from ratings of each chat raised an unassisted exam
  0.15 SD over five months (Chung 2026, R3 §10). "Learning preference" profiles changed nothing (Vaccaro 2024),
  and three models barely changed their moves when told a student's errors (Borchers & Shou 2025).

And two things the evidence says not to do (R2 §2, R3 §7 and ranking):

- **Learning styles.** No adequate evidence that matching teaching to a "style" helps (Pashler 2008; a 2024
  meta-analysis found the required pattern in 26 % of outcomes and judged it not worth adopting), while 89 % of
  15,405 educators believe in it and HSLDA, the Texas Home School Coalition and Cathy Duffy recommend quizzes
  for it. Our parents will have met this; the Students tab should say plainly why we don't do it.
- **Growth mindset and grit.** Mindset correlates .10 with achievement and interventions move it by d ≈ 0.05
  to 0.08 (Sisk 2018; Macnamara & Burgoyne 2023); grit is mostly conscientiousness (Credé 2017). Not measured,
  not targeted.

## 2. What our agents can use

| Signal | Who reads it | How |
|---|---|---|
| Starting estimate per concept (none / some / can explain) | Tutor, per concept | Path selection: teach 30–60 s then ask; question first with a hint ladder; or straight to apply and transfer (the three paths in `docs/RESEARCH.md` and `skills/socratic-method`). |
| The student's own first answer and confidence | Tutor, when the concept comes up | Opens with it ("Before we started you said…"), which is the feedback that makes the pretest count; a confident wrong answer gets a full correction early. |
| Baseline per concept | Assessor, Progress view | "Knew before the course" versus "learned here"; the report and the progress table can say which. |
| Prior knowledge and misconceptions on this course | Tutor (cached block), profile pass | Connect new concepts to what they know; watch the misconceptions; revised after every session. |
| Interests, specific | Tutor | Analogies and cases (already in `skills/learner-adaptation`). |
| When stuck: reasons aloud, guesses, asks, or goes quiet; self-efficacy | Tutor | Scaffold one rung earlier or let productive struggle run; confirm early successes. |
| Depth (how much nuance they are ready for) | Tutor, reference checker | Built on 2026-09-27; the intake now has real evidence to set it from (the retell and the apply question). |
| Verbal register | Tutor | Word choice and sentence length; explicitly not a reading level. |
| Demonstration formats that gave clear evidence | Tutor, assessor | Which formats to ask for first; the assessor's "effective formats" feeds it. |
| The parent's notes | Tutor, profiler | Followed as written; never rewritten by the pass. |
| Age / grade | Tutor | Explain-first default for grade 5 and below. |

Not used by any agent, so not collected: a "learning style", mindset, feelings about school, anything about
diagnoses or needs (§5).

## 3. The general intake

**Purpose.** Learn how to work with this student. Six to eight exchanges, once. The tutor's no-giveaway
rule applies (the old intake handed over answers, and nobody audited it).

**Material.** A short built-in passage, the same for every student, shown to the parent on the Students tab,
about the physical world so it is free of worldview. Grounding holds inside it: the tutor teaches nothing
beyond the passage. A candidate (about 150 words, grade 5–9; the parent can read it before their child does):

> **Why ice floats.** Most things shrink a little as they get colder, and a solid usually sinks in its own
> liquid. Water is the odd one out. As water cools toward freezing, its molecules line up in an open pattern
> that takes up more room, so ice is lighter than the same amount of liquid water, and it floats. That is why
> ice cubes sit at the top of a glass, and why a lake freezes from the top down. The ice on top works like a
> lid: it slows the cold from reaching the water underneath, so fish and plants can live through the winter in
> the liquid water below. If ice sank instead, a lake would freeze from the bottom up, and could freeze solid.

**Questions in age bands, stepped up or down** (user, 2026-09-28). One passage, three bands of questions for
steps 3 and 4 (grades 4–6, 7–9, 10 and up), each band asking for a further inference from the passage. The
intake starts at the student's grade band; a strong, confident answer earns the next band's question, a weak
one drops a band; at most two steps. This is the adaptive-placement idea in miniature (IRT tests reach the same
reliability with half the items by choosing the next question from the last answer, Weiss 1982, R3 §1), and
the band a student reaches is real evidence for `depth` and for placing an advanced student where they belong.

**The sequence.** Each step: what is said, what it measures, where that came from, what it fills, and how it
fits.

| Step | The exchange | Measures | Source and rationale | Fills | Fit / limits |
|---|---|---|---|---|---|
| 1. Warm-up with depth (1–2) | "What do you like doing when you're not doing school? Tell me how it actually goes — what do you do first?" | Interests, specifically enough to build on | Interest personalisation works when the depth matches how the student really uses the hobby (Walkington & Bernacki 2019) and fails as a menu (Iterbeke 2022), R3 §6; a get-to-know-you survey raised grades in a randomised trial, mostly for underserved students (Gehlbach 2016, R2 §2). | `interests` | The tutor's analogies. Cheap, and the relationship matters. |
| 2. Read, then tell it back (1–2) | The passage is shown (text) or read to them (voice); then "tell me about it in your own words, everything you remember." | Register; whether they include the *why*; explain-in-own-words evidence | Charlotte Mason's narration (principle 14, R2 §6); retelling correlates r ≈ .46 with comprehension, weaker in upper grades, so not alone (Reed & Vaughn 2012, R2 §6); explaining a task shows more of a child's syntax than chat does (Nippold 2005, R3 §9). | `verbalLevel` (register), `depth`, demonstration evidence | The narration-first flow already exists. Typed words give a register, not a reading level; voice read-aloud could give a level later (§7). |
| 3. Apply (1) | "Someone fills a bottle to the top with water, seals it, and puts it in the freezer. What happens, and why?" | Transfer; depth | A single-step question is a valid probe (Kalyuga & Sweller 2004, R3 §1); "applies to a new case" is level 3 in our mastery scale. | `depth`, demonstration evidence | Answerable from the passage, so grounded. |
| 4. The hard one, then "how sure?" (2) | "Fish survive the winter under the ice. If ice sank, what would happen to them? It's completely fine to say you don't know." Then: "How sure are you, 0 to 10?" Then the tutor gives the answer, from the passage. | What they do when stuck (reason aloud, guess, ask, go quiet); confidence against correctness | ALEKS treats "I don't know" as more informative than a wrong answer (Cosyn 2021, R1); Kumon and Sylvan observe confidence and habits (R2 §5); task-specific 0–10 ratings (Bandura 2006) predict help-seeking and learning (Bernacki 2015, R3 §3); confident errors are the ones to correct fully (Metcalfe & Finn 2012, R3 §4); giving the answer after the guess is the pretesting effect with feedback (R3 §2). | `challengeTolerance` (shown to parents as "when stuck"), guidance on confirming or challenging | The answer is in the passage, so grounding holds. One question is a first reading; the profile pass revises it from real sessions. |
| 5. Hand-over (1) | "Thanks — now let's see what you already know about Rome" (course intake) or "now let's start today's reading." | — | The old close said goodbye and then the lesson started in the same session ("wait are we done already?", 2026-09-15). | — | The profile is written in the background; the app starts the next opening turn itself, so no dead air. |

**The profile after this.** Kept: `interests`, `verbalLevel` (defined as register), `challengeTolerance`
(defined by observed behaviour when stuck), `demonstrationPreferences` (observed), `depth`, `pace` (not
measurable in eight exchanges; starts at "moderate" and the profile pass revises it, the way Math Academy
learns a per-topic speed, R1), `tutoringGuidance` (at most six), `parentSummary`. **Added:** `parentNotes`, the
parent's own words, followed as written. **Dropped:** `intakePreferences` (worked-examples, analogies,
definitions-first…). It is a preference label with no evidence behind it (§1), and the research says the
entry point should follow prior knowledge instead: teach-first for a novice, question-first for someone who
already knows something. That rule moves to the course-knowledge record. Prior knowledge and gaps move to the
course record too.

**Learning styles: the middle path (decided by the user, 2026-09-28).** Many parents believe in styles and
speak that language, and the evidence against *matching* teaching to a style is strong (§1). So: no style
field, no matching theory, and no quiz. What the tutor *does* keep is what a student does when confused,
observed ("asks for an example first", "wants the term named before the explanation"), written into
`tutoringGuidance` and honoured for the opening move of a concept only, never for the choice between
teaching first and questioning first, which follows prior knowledge. The parent's own language ("he needs
examples") goes in the parent's notes, where the tutor follows it as written. And the Students tab says, in
one sentence with the two sources, why the app does not sort children into styles. The pros and cons behind
the decision: for a style field, familiarity and trust, a possible effect on enjoyment, and the fact that a
stated preference is often prior knowledge in disguise; against it, no adequate evidence in decades of
studies, the risk of steering a novice into discovery (which hurts novices most), a label that follows the
child into every report, and our own two intakes, where "which explanation clicked?" measured the
explanations rather than the students.

**Left out on purpose:** "which explanation clicked?" (self-report of a learning style); anything about
mindset, grit, feelings, diagnoses, family or religion (§5); teaching from the parent's course.

## 4. The course intake

**Purpose.** Where this student starts on this course: a starting estimate per central concept, their own
first answers with their confidence, and what they already know or have wrong, so the tutor can choose
teach-first or question-first per concept, return to their answers when teaching, and the parent can see what
their child knew before. Eight to twelve exchanges; purely diagnostic: **no teaching, no correcting, no
coaching** (Saxon's placement rule, R2 §6). If the student asks "was that right?": "hold that thought, you'll
see in the reading."

**Which concepts.** Six for a unit (up to about twelve lessons), eight for a longer course: the central
concepts of the first two kept lessons (they come first), then one per later block of lessons, preferring
concepts other concepts depend on (the curriculum agent records prerequisites; ALEKS and Knewton steer their
checks by such a map, R1). Lessons and concepts the parent unticked are never probed. Adaptive in a small way:
a concept the opening narration already covered gets a shorter probe or none; after two "I don't know"s in a
row the later blocks are skipped (ALEKS ends an attempt after five straight misses and prefers to
underestimate, then fast-track, R1).

| Step | The exchange | Measures | Source and rationale | Fills |
|---|---|---|---|---|
| 1. Open narration (1) | "Tell me everything you already know about ancient Rome — anything at all, in any order." | A map of what they bring | Free recall (Mason; Roediger & Karpicke 2006, R2 §6); the extraction maps it onto the course's concepts. | Prior knowledge, first estimates |
| 2. First-step probes (one per concept) | "What's the first thing you'd say about why Rome's location was a good one? I don't know is a fine answer." | Estimate per concept: none / some / can explain | First-step questions correlate up to .92 with full tests (Kalyuga & Sweller 2004, R3 §1); "I don't know" is informative (Cosyn 2021, R1). | Per-concept estimate with the quote |
| 3. Confidence (in the same turn as each probe) | "…and how sure are you, 0 to 10?" asked in the same breath as the probe, so it costs no extra exchange; the tutor asks again only if the student forgets the number (user decision, 2026-09-28). | Calibration | Bandura 2006; Metcalfe & Finn 2012; Area9 (R1 §b). Not asked after "I don't know". | Confidence per estimate |
| 4. Hand-over (1) | "Great — let's start with the reading." | — | The pretesting effect needs the answers soon after (R3 §2): the tutor's first move on each probed concept revisits the student's answer. | — |

**What it writes** (the course-knowledge record): per probed concept, the estimate, the student's words, the
confidence, and, where the answer contradicts the material, what the material says instead (the extraction
compares answers with the concept's key facts, so "wrong" means wrong by the parent's material, not by
general knowledge); prior knowledge quotes; misconceptions; gaps; course-specific guidance; a parent summary
("Before starting Ancient Rome, Maya could…"). The profile pass revises it after every session on the course,
and assessed mastery levels replace the estimates as concepts are taught.

**How the tutor uses it.** The concept block gains a starting point: "Starting point: some knowledge — said
'…' (sure 8/10); the reading says …" The Socratic skill picks the path from it, opens with the student's own
answer, and corrects a confident wrong answer fully and early. The assessor sees the baseline and says what
was known before; the Progress view shows a starting-point column.

## 5. The parent's part, and what is never asked

- **Parent's notes**: an optional box on the Students tab, "Anything the tutor should know about Maya?", in
  the parent's words, followed by the tutor and the profiler, never rewritten by the pass. It is also where a
  parent can say what a diagnosis means for their child, if they choose to.
- **Visibility**: the built-in passage is readable on the Students tab; both intakes are ordinary sessions
  with transcripts; the course card shows the starting points.
- **Never asked of a child**, whatever the setting: the eight areas federal law protects in school surveys
  (political beliefs, mental or psychological problems, sex, illegal behaviour, appraisals of family,
  privileged relationships, religion, income; the Aug 2026 federal letter requires written parental consent
  for surveys touching them, R2 §7); anything an IDEA evaluation exists to establish (health, vision,
  social-emotional status, intelligence; R2 §7); dyslexia or other diagnoses (screeners only flag risk, and
  identification is a professional's job, R2 §7).
- **Under-13 voice**: the amended COPPA rule (compliance due 2026-04-22) adds voiceprints to protected data
  and requires separate consent for sharing with third parties and a written retention policy (R2 §7). The
  app already sends a child's voice to a transcription vendor; this belongs in #13 before any family uses
  voice mode, and it is why read-aloud fluency (§7) waits.

## 6. What we leave out, and why

| Left out | Why |
|---|---|
| Learning-style matching and the `intakePreferences` field | No adequate evidence (Pashler 2008; 2024 meta-analysis), R2 §2. |
| "Which explanation clicked?" | Self-report of a style; the entry point should follow prior knowledge (R3 §1). |
| Growth mindset, grit | r = .10 and d ≈ 0.05–0.08; grit ≈ conscientiousness (R3 §7, ranking). |
| Questionnaires and scales (PALS, Jr. MAI, MSLQ) | Weak prediction (r ≈ .13), built for classrooms or college (R2 §3); a conversation observes the same things. |
| A long placement test | Schools spend 45–60 minutes three times a year (R2 §1); a home tutor gets ten minutes of a child's patience, and the profile pass refreshes after every session anyway. |
| Teaching during either intake | It spoiled lesson one twice; the pretest works only if the answers come *after* the questions. |
| Questions about needs, diagnoses, feelings, family, religion | §5. The parent's notes box is the one place, in the parent's words. |

## 7. Open questions, and how we iterate

1. **The passage.** One candidate above, with questions in three age bands (decided 2026-09-28); the parent
   cannot swap it, so students stay comparable. The band questions themselves are still to be written.
2. **How many probes** a 31-lesson course deserves, and whether "one course intake" should mean "per unit"
   for a year-long course (scope is one unit at a time, so mostly the same thing).
3. **Confidence questions** are asked in the same turn as each probe (decided 2026-09-28), so the course
   intake stays at eight to twelve exchanges.
4. **Read-aloud fluency in voice mode** (words correct per minute from the transcript's timing, no audio
   kept): valid (R3 §9), but Amira's validation is K–4, and the COPPA question comes first.
5. **Pace** cannot be read from eight exchanges; expect the pass to set it over the first sessions.
6. **Testing (stage D):** three scripted personas (confident, quiet, a bluffer) through both intakes;
   success is a profile whose quotes match the transcript, no answers given away, eight exchanges or fewer
   for the general intake and twelve for the course intake, and a hand-over with no dead air.

## 8. Effort and order

- **A. The split** (about a day): `LearnerProfile` loses `priorKnowledge`, `observedGaps` and
  `intakePreferences`, gains `parentNotes`; a `CourseKnowledge` record and store (learner × course) with
  per-concept estimates; the profile pass revises both; the tutor block, assessor and Students tab read both;
  migrate the two test students' plants entries into course records; `skills/learner-adaptation` drops the
  entry-point-by-preference rule for entry-point-by-prior-knowledge.
- **B. The general intake** (about a day): the skill rewritten to §3, the built-in passage, the parent's
  notes box, the profile written in the background, the app starting the next turn itself.
- **C. The course intake** (a day and a half): concept selection, the skill, the extraction to the
  course-knowledge record, the trigger (first session, or the Courses tab button), the tutor's starting-point
  block and path selection, the assessor's baseline.
- **D. Personas** (half a day).

Related issues: #13 (children's data; add the COPPA voiceprint point), #28 (the profile pass), #6 (evals).

---

# Appendix A. Research report 1: AI tutoring and adaptive products

As delivered by an Opus 5.5 research agent on 2026-09-27 (read-only web research; nothing about this product was described to anyone). Reproduced unedited except for this heading.

Checked 2026-09-27. [n] points to the source list at the end. UNCONFIRMED means the agent could not verify it in any source it could open.

**By product**

**ALEKS.** Adaptive, open-response Initial Knowledge Check, max 30 questions (one an unscored audit item); cap chosen from user feedback and observed fatigue [1][2]. An "I don't know" button moves the estimate more than a wrong answer (wrong answers may be slips), shortening the test [2]. Unclassifiable topics are left out (acknowledged underestimate; easier start), then fast-tracked [2]. Later: periodic re-checks catch forgetting; five straight misses end an attempt, suggesting another topic [1][2]. Model: set of mastered topics within a prerequisite structure (knowledge space theory) [2]. Evidence: initial test predicts held-out answers, AUROC 0.86–0.89 across three courses (0.5 = chance) [2]; meta-analysis: "as good, but not better than" classroom teaching [3]. Duration UNCONFIRMED.

**IXL.** Real-Time Diagnostic: ~45–60 min per subject, splittable; "I don't know this yet" button; scores map to grade (500 = grade 5); then 10–15 questions/week keep levels current [4][5][6]. Start rule UNCONFIRMED. Evidence (IXL Math overall): cluster RCT, +0.13 SD on Star Math, state test not significant [7].

**i-Ready.** ~45-minute adaptive diagnostic; later tests start from earlier calibration [8]; first item drawn from five near a preset difficulty [9]; new students start "one grade level below" (login-gated; search excerpt) [10]. Each test records duration and a "rush flag"; definition UNCONFIRMED [11].

**MATHia / LiveHint (Carnegie Learning).** No placement test found; teachers control placement [12]. Tracks steps, errors, hints, time; LiveLab flags idle or unproductively struggling students [13]. Model: per-skill Bayesian Knowledge Tracing (a running probability each skill is learned; mastery >0.95, cap ~25 problems) [14]. LiveHint claims to predict students' common mistakes; intake UNCONFIRMED [15]. Evidence (predecessor Cognitive Tutor, RCT): nothing in year 1; year 2 ~8 percentile points, significant only in high schools [16].

**Khanmigo.** Sees the current problem but not, by default, the student's performance; product tests adding recent attempts and unmastered prerequisites raised next-problem correctness 6.1% (>15M threads) [17]. Opt-in Interests inferred from chats, editable, parent-visible [18]. First-use questions UNCONFIRMED. Khan's Dec 2024 efficacy report had no Khanmigo results [19].

**Synthesis Tutor.** Site: "micro-assessments" in every lesson [20]; a third party reports a quick first assessment [21]; details UNCONFIRMED. Evidence: vendor teacher survey only [22].

**Duolingo.** Onboarding asks motivations and goals, then "Start from scratch" or "Find my level" [23]; use of answers UNCONFIRMED. Placement test assumes a novice, re-estimates after each answer, unlocks skills [24]; length UNCONFIRMED. Birdbrain estimates learner ability and exercise difficulty; A/B tests showed more lessons and returning [25]. No published paper on in-app placement found [26].

**Squirrel AI.** ~10 questions give "a rough sketch" [27]; claims to detect "learning capacity" and "methodology" (company PR only) [28]. RCT: beat expert-teacher instruction, grade 8 math [29].

**Century Tech.** Short diagnostics (10–15 min) at each topic's start route learners to prerequisite micro-lessons; the path "will learn how you learn" [30][31]; uses reading time plus performance [32]. No independent evidence found.

**Knewton Alta.** Proficiency per objective on a knowledge graph via item response theory (question difficulty and learner ability on one scale), weighting recent answers; evidence spreads to related topics [33]. Mastery predicted later performance, most for low-ability students (correlational; abstract via search excerpt) [34]. Intake UNCONFIRMED.

**Amira.** Listens to oral reading under 20 min, adaptive, twelve reading domains, noting miscues, pauses, self-corrections [35]. Evidence for ESSA "moderate": RCT +0.64 SD (178 struggling readers) [36].

**Gemini Guided Learning / LearnLM.** No documented intake; learner just asks [37][38]. LearnLM follows developer-written pedagogy instructions [39]; Google's guide suggests "ask for subject, level, and specific topic" [40]. Tutor-supervised LearnLM RCT (n=165): 66.2% vs 60.7% (human tutors) solved new problems [41].

**ChatGPT Study Mode.** Built on system instructions; goal-setting and deeper personalization listed as future work [42]. Leaked prompt: ask goals or grade if unknown, "Keep this lightweight!", else pitch at 10th grade [43]. Press: uses prior interactions and "assessed skill level" [44]. Outcome research with Stanford SCALE; no results found [42].

**Claude learning mode.** Socratic prompts ("How would you approach this problem?") [45]; all Claude.ai users since Aug 2025 [46]; Claude Code's version leaves code for the user [47]. Intake and evidence UNCONFIRMED.

**Alpha School / 2 Hour Learning.** Every new student takes an NWEA math test; diagnostics find gaps [48][49]. Flags "anti-patterns" (topic-shopping, rushing, skipping explanations after errors) using a screen-watching vision model, idle detection and a "waste meter" [49]; targets 80–85% correct, 90% to advance [48]. Self-reported MAP growth 2.3–2.6×; no independent verification found [48][50].

**Math Academy (other).** 30–45-min diagnostic measures mastery and automaticity [51]; slow correct answers count less; per-student, per-topic "learning speed" (2×/0.5×) sets review spacing; too many errors halts the lesson, then remedial reviews [52]. No independent evidence found.

**DreamBox (other).** "Launchpad placement engine"; logs strategy, manipulative use, error patterns, decision sequences; vendor cites K–2 RCT +0.12 SD [53].

**Cross-cutting**

(a) Shared pattern: a short adaptive knowledge test (at most ~30 questions or ~60 min, splittable) steered by a prerequisite map, then continuous re-estimation from practice plus spaced re-checks. Chat tutors do little profiling: host context or brief self-report [17][37][43][45].

(b) "How" is measured through behaviour, rarely questions. Pace: learning speed and time-discounted answers [52], rush flags [11], anti-patterns [49]. Stuck: stop and redirect after repeated misses [2][52], struggle alerts [13][14]. Help-seeking: hints, explanation-viewing [13][49]. Reading level: Amira measures it [35]; a MATHia model inferred it from hints and attempts, finding mastery estimates biased against weaker readers on 36 of 50 skills [54]. Confidence: Area9 Rhapsode asks on every question to catch confident-but-wrong answers [55]. Interests: Khanmigo [18]. No study I found isolates the benefit of these profiles; causal evidence covers mastery systems and giving tutors learner history [16][17][41].

(c) Cold start: short adaptive test; an informative default (novice [24], one grade below [10], 10th grade [43]); ask lightly (goals [23][43], "I don't know" [2][5]); per-topic checks or teacher placement instead of an upfront test [12][20][30]; underestimate, then fast-track [2]; learn item difficulty from all learners [25][33].

---

**Sources** (public pages only; nothing submitted or signed up for. openai.com, Khan Academy's help centre, i-Ready Central and RAND blocked the fetcher, so where those are involved a republished or indexed copy is cited and said so.)

1. ALEKS, "All About Knowledge Checks" (student PDF), no date: https://www.aleks.com/resources/ALEKS_Knowledge_Checks_Overview_for_Students.pdf
2. Cosyn, Uzun, Doble, Matayoshi (McGraw Hill/ALEKS), "A practical perspective on knowledge space theory: ALEKS and its data," J. Mathematical Psychology 2021; preprint dated 28 Oct 2020: https://jmatayoshi.github.io/publications/JMP2021_KST_ALEKS_preprint.pdf
3. Fang et al., "A meta-analysis of the effectiveness of ALEKS on learning," Educational Psychology, 2019 (15 studies): https://eric.ed.gov/?id=EJ1232632
4. IXL blog, "Common questions about the IXL Real-Time Diagnostic," 28 Jan 2021, updated 11 Jun 2025: https://blog.ixl.com/2021/01/28/common-questions-about-the-ixl-real-time-diagnostic/
5. IXL blog, "Tips from teachers: best practices with IXL's Real-Time Diagnostic," 12 Aug 2022: https://blog.ixl.com/2022/08/12/tips-from-teachers-best-practices-with-ixls-real-time-diagnostic/
6. IXL, Diagnostic guidance for parents (PDF, no printed date): https://blog.ixl.com/wp-content/uploads/2020/05/IXL-At-home-Diagnostic-Guide-for-Parents.pdf
7. Evidence for ESSA (Johns Hopkins' independent evidence-rating site), IXL Math, rated "strong"; study spring 2023: https://www.evidenceforessa.org/program/ixl-math/
8. Oklahoma State Dept. of Education, i-Ready Diagnostic technical guidance (vendor-supplied), Aug 2025: https://oklahoma.gov/content/dam/ok/en/osde/strong-readers-files/i-Ready25-26Final.pdf
9. National Center on Intensive Intervention tools chart, i-Ready (undated): https://charts.intensiveintervention.org/progressmonitoring/tool/?id=95c8f52374df8b7c
10. i-Ready Central FAQ, "How does the i-Ready adaptive Diagnostic work?" (login-gated; seen only as a search excerpt): https://i-readycentral.com/articles/how-does-the-i-ready-adaptive-diagnostic-work/
11. Digital Learning Platforms catalog, Curriculum Associates i-Ready dataset (fields include "test duration, and a rush flag"), updated 23 Jan 2026: https://www.dlpcatalog.org/view/9
12. Carnegie Learning support, "The Class Details Page in Teacher's Toolkit (2024-2025)": https://support.carnegielearning.com/help-center/math/article/the-class-details-page-in-teachers-toolkit-updated/
13. Carnegie Learning, "How does MATHia use AI?", 23 Jul 2024: https://www.carnegielearning.com/blog/mathia-ai
14. Fancsali et al. (Carnegie Learning/CMU), "Towards Practical Detection of Unproductive Struggle," AIED, Jun 2020: https://pmc.ncbi.nlm.nih.gov/articles/PMC7334700/
15. Carnegie Learning, LiveHint AI page (undated): https://discover.carnegielearning.com/livehint-ai
16. Pane et al. (RAND), "Effectiveness of Cognitive Tutor Algebra I at Scale," EEPA, Jun 2014 (ERIC record; RAND page blocked): https://eric.ed.gov/?id=EJ1024233
17. Khan Academy blog, "How Khan Academy Is Building a Better AI Tutor: Our Most Recent Learnings," dated 1 and 6 May 2026: https://blog.khanacademy.org/how-khan-academy-is-building-a-better-ai-tutor-our-most-recent-learnings/
18. Khan Academy blog, "New! Personalized AI Learning with Khanmigo Interests," dates shown 6 Sep 2023 and 21 Mar 2025: https://blog.khanacademy.org/new-khanmigo-interests
19. Khan Academy blog, "Khan Academy Efficacy Results, November 2024," 6 Dec 2024: https://blog.khanacademy.org/khan-academy-efficacy-results-november-2024/
20. Synthesis Tutor page and FAQ (undated): https://www.synthesis.com/tutor
21. Neil Squire Society (third party), 21 Mar 2025: https://www.neilsquire.ca/synthesis-tutor-an-intelligent-math-tutoring-app/
22. Synthesis educators page ("98% of teachers reported improved math skills"; no method given): https://www.synthesis.com/educators
23. Duolingo blog, "Duolingo 101," Cindy Blanco, 2 Dec 2024: https://blog.duolingo.com/duolingo-101-how-to-learn-a-language-on-duolingo
24. Duolingo blog, "Partial credit improvements to Duolingo's placement test," Logan Weber, 14 Sep 2018: https://blog.duolingo.com/partial-credit-improvements-to-duolingos-placement-test/
25. Duolingo blog, "Learning how to help you learn: Introducing Birdbrain," Bicknell and Brust, 7 Oct 2020: https://blog.duolingo.com/learning-how-to-help-you-learn-introducing-birdbrain
26. Duolingo Research publications list (undated): https://research.duolingo.com/
27. MIT Technology Review, Karen Hao, 2 Aug 2019: https://www.technologyreview.com/2019/08/02/131198/china-squirrel-has-started-a-grand-experiment-in-ai-education-it-could-reshape-how-the/
28. Squirrel AI press release (PR Newswire), 26 Dec 2019: https://www.prnewswire.com/news-releases/squirrel-ai-learning-appears-at-top-european-education-summit-oeb-and-gives-a-keynote-speech-as-the-only-educational-technology-company-from-china-300979326.html
29. SRI, Wang et al., "When adaptive learning is effective learning," 31 Aug 2020 (Interactive Learning Environments, 2023): https://www.sri.com/publication/education-learning-pubs/when-adaptive-learning-is-effective-learning-comparison-of-an-adaptive-learning-system-to-teacher-led-instruction/
30. CENTURY support, "What are diagnostics?" (last modified "26 Feb", year not shown): https://support.century.tech/support/solutions/articles/44001958285-what-are-diagnostics-
31. CENTURY student user guide (PDF, no printed date): https://www.century.tech/wp-content/uploads/2020/03/Secondary-FE-Student-User-Guide-1.pdf
32. CENTURY, "How does CENTURY's AI work?", 13 Jun 2019: https://www.century.tech/news/how-does-centurys-ai-work/
33. Wiley, Alta blog, "How does Knewton's Proficiency Model estimate…" (undated): https://www.wiley.com/en-us/grow/teach-learn/teacher-resources/courseware/knewton-alta/resources/alta-blog-how-does-knewton-proficiency-model-estimate/
34. "Validating Mastery Learning… in Knewton Alta," AIED 2018 (abstract seen via search excerpt): https://link.springer.com/chapter/10.1007/978-3-319-93846-2_81
35. Amira, ISIP Assess page (undated): https://amiralearning.com/amira-isip-assess
36. Evidence for ESSA, Amira, rated "moderate" (RCT n=178; matched study 2024–25, +0.26 kindergarten / +0.06 grade 1): https://www.evidenceforessa.org/program/amira/
37. Google blog, "Guided Learning in Gemini," Maureen Heymans, 6 Aug 2025: https://blog.google/products-and-platforms/products/education/guided-learning/
38. Gemini Apps Help, "Use learning tools in Gemini Apps" (undated): https://support.google.com/gemini/answer/16448384
39. LearnLM Team, "LearnLM: Improving Gemini for Learning," arXiv, 21 Dec 2024: https://arxiv.org/abs/2412.16429
40. Google, "LearnLM Partner Prompt Guide" (PDF, ©2025, cites data as of Feb 2026): https://services.google.com/fh/files/misc/learnlm_prompt_guide.pdf
41. LearnLM Team and Eedi, "AI tutoring can safely and effectively support students: an exploratory RCT in UK classrooms," arXiv, 29 Dec 2025: https://arxiv.org/abs/2512.23633
42. OpenAI, "Introducing study mode," as republished by Stanford SCALE, 29 Jul 2025 (openai.com blocked): https://scale.stanford.edu/news/introducing-study-mode-new-way-learn-chatgpt-offers-step-step-guidance-instead-quick-answers
43. Simon Willison, study mode system prompt, obtained by asking the model for it (not confirmed by OpenAI), 29 Jul 2025: https://simonwillison.net/2025/Jul/29/openai-introducing-study-mode/
44. InfoQ, Robert Krzaczyński, 4 Aug 2025: https://www.infoq.com/news/2025/08/study-mode-chatgpt
45. Anthropic, "Introducing Claude for Education," 2 Apr 2025: https://www.anthropic.com/news/introducing-claude-for-education
46. Engadget, Igor Bonifacic, 14 Aug 2025: https://www.engadget.com/ai/anthropic-brings-claudes-learning-mode-to-regular-users-and-devs-170018471.html
47. Claude Code docs, "Output styles" (undated): https://code.claude.com/docs/en/output-styles
48. Alpha School blog, MacKenzie Price (co-founder), 28 Nov 2025: https://alpha.school/blog/the-two-hour-school-day-how-ai-tutors-are-redefining-learning-efficiency/
49. The 74, Horn and Tavenner, interview with MacKenzie Price, 6 Mar 2026: https://www.the74million.org/article/how-alpha-uses-ai-to-rethink-the-school-experience/
50. Alpha School, "The Program" (undated): https://alpha.school/the-program/
51. Math Academy, "How it works" (undated): https://www.mathacademy.com/how-it-works
52. Math Academy, "How our AI works" (undated): https://www.mathacademy.com/how-our-ai-works
53. Discovery Education blog, David Bryan, "DreamBox Math: Common Q&A for Curriculum Evaluation," 12 Jun 2026: https://www.discoveryeducation.com/blog/educational-leadership/dreambox-math-q-and-a-for-curriculum-evaluation/
54. Stinar et al. (incl. Carnegie Learning staff), "Fairness of Bayesian Knowledge Tracing for Math Learners of Different Reading Ability," EDM 2025: https://educationaldatamining.org/EDM2025/proceedings/2025.EDM.long-papers.158/index.html
55. Area9 Lyceum Help Center, "Why does Area9 Rhapsode measure learner confidence?" (undated): https://help.area9lyceum.com/biological-adaptive-model/why-does-area9-rhapsode-measure-learner-confidence/

---

# Appendix B. Research report 2: schools, agencies, tutoring companies and homeschool publishers

As delivered on 2026-09-27, unedited except for this heading.

Key: r = correlation; d or g = effect size in standard deviations (about 0.2 small, 0.5 medium).

**1. School diagnostics (what a student knows)**
- MAP Growth: adaptive, 43 questions, most tests take 40–55 min, given fall, winter and spring (https://www.nwea.org/blog/2025/how-long-is-too-long-to-spend-map-growth-assessment/, Feb 21 2025). The teacher report shows RIT score (NWEA's own scale), national percentile, instructional-area scores, projected state-test proficiency and rapid-guessing flags (https://www.nwea.org/blog/2026/how-to-engage-with-your-first-map-growth-class-profile-report/, Jan 15 2026).
- i-Ready Diagnostic: about 45 min per subject, 3 times a year, 12–18 weeks apart. It gives a scale score, percentile, grade-level placement by domain, Quantile and lesson recommendations. Its math screening accuracy is rated "convincing" (sensitivity about .8) (https://charts.intensiveintervention.org/screening/tool/?id=98cf2682894494d2). It will be renamed "i-Ready Inform" from 2026–27 and made shorter (https://www.curriculumassociates.com/programs/i-ready-assessment/i-ready-inform-announcement).
- Star Reading: adaptive, about 18 min, can be given as often as weekly. It reports scaled score, percentile, grade equivalent, instructional reading level, Lexile and 46 skills (https://charts.intensiveintervention.org/screening/tool/?id=5dcc3c347547fd82).
- DIBELS 8 (K–8): mostly one-minute measures, Maze 3 min, screening up to 3 times a year. The K–1 subtests also serve as dyslexia screeners (https://dibels.uoregon.edu/sites/default/files/2024-01/dibels8_admin_scoring_guide.pdf, ©2023). Acadience Reading 7–8: 3 times a year, gated Maze → silent → oral reading (https://acadiencelearning.org/help-center/what-is-acadience-reading-7-8/).
- Lexile and Quantile put student and text (or math skill) on one scale. Students get them from linked tests such as Star or state tests (https://www.metametrics.com/lexile-for-reading/; https://www.caaspp-elpac.org/resources/reporting/lexile-quantile-measures).

**2. Start-of-year practices (how a student learns)**
- Elementary Reading Attitude Survey: 20 Garfield-picture items, about 10 min, split into recreational and academic halves, with grade norms (https://resources.corwin.com/sites/default/files/Compendium_17.pdf). For adolescents, SARA: 18 items covering print/digital × academic/recreational (https://eric.ed.gov/?id=EJ1013115, Apr 2013).
- Interest information has evidence behind it when used to personalize content:
  - 145 ninth-graders solved algebra problems matched to their interests faster and more accurately (https://eric.ed.gov/?id=EJ1054444).
  - A 2024 meta-analysis of 34 publications found interest g=.55, retention .48, transfer .36 (https://link.springer.com/article/10.1007/s10648-024-09933-7).
- A randomized trial of a ~30-question get-to-know-you survey (315 ninth-graders): when teachers learned what they had in common with students, those students earned higher grades, mainly underserved students (https://eric.ed.gov/?id=EJ1096087, 2016).
- Learning styles:
  - Pashler et al. found "no adequate evidence base to justify incorporating learning-styles assessments into general educational practice" (https://bjorklab.psych.ucla.edu/wp-content/uploads/sites/13/2016/07/Pashler_McDaniel_Rohrer_Bjork_2009_PSPI.pdf, 2008).
  - Yet 89.1% of 15,405 educators believe in matching teaching to styles, with no decline 2009–2020 (https://www.frontiersin.org/journals/education/articles/10.3389/feduc.2020.602451/full, Dec 2020).
  - A 2024 meta-analysis found a small pooled benefit, but only 26% of outcomes showed the pattern the theory requires and 5 of 21 studies met quality standards. The authors judged it not worth adopting (https://pmc.ncbi.nlm.nih.gov/articles/PMC11270031/).

**3. Short validated instruments**
- PALS (manual 2000, tested on elementary to high school samples): Academic Efficacy 5 items (α .78), Mastery Goal 5 (α .85), Avoiding Novelty 5, Self-Handicapping 6 (https://public.websites.umich.edu/~pals/PALS%202000_V13Word97.pdf). Goals predict grades weakly: r=.13 for mastery goals, −.14 for performance-avoid goals (https://journals.plos.org/plosone/article?id=10.1371%2Fjournal.pone.0093594).
- Jr. MAI: 12 items (grades 3–5) or 18 (grades 6–9). Low correlation with overall achievement (https://www.hpc-educ.org/Papers/2013/DavisTranMetaCogCyberSA/Sperling%2C%20Howard%2C%20Miller%2C%20%26%20Murphy%20%282002%29.pdf), but it predicted science grades in 97 seventh-graders (https://eric.ed.gov/?id=EJ948590).
- MSLQ: 81 items, built for college (https://eric.ed.gov/?id=ED338122). With similar scales, 173 seventh-graders' self-efficacy, self-regulation and test anxiety best predicted performance (https://eric.ed.gov/?id=EJ442292).
- Self-efficacy and performance reinforce each other in adults but not in children (11 longitudinal studies; https://www.sciencedirect.com/science/article/abs/pii/S104160801730211X).
- Growth mindset:
  - A 6-item scale predicted rising math grades across grades 7–8 (373 students; https://sparq.stanford.edu/sites/g/files/sbiybj19021/files/media/file/blackwell_et_al._2007_-_implicit_theories_of_intelligence.pdf).
  - But the correlation with achievement is r=.10, and interventions d=.08 (https://englelab.gatech.edu/articles/2018/Sisk,%20Burgoyne%20et%20al.%20(2018)%20-%20Mindset%20and%20Academic%20Achievement.pdf).
  - Another review found d=.05, not significant after correcting for bias (https://artscimedia.case.edu/wp-content/uploads/sites/141/2020/06/26110416/Macnamara-Burgoyne-2023.pdf).
  - A national trial found +0.10 GPA for lower achievers (https://news.utexas.edu/2019/08/07/a-growth-mindset-intervention-can-change-students-grades-if-school-culture-is-supportive/).
- Response to setbacks: the Academic Buoyancy Scale has 4 items and was validated on 3,450 Australian high-schoolers (https://files.eric.ed.gov/fulltext/EJ1318386.pdf).

**4. Learner profiles and plans**
- Vermont Act 77 (2013): every student in grades 7–12 has an ongoing plan that identifies abilities and dispositions, with families taking part (https://education.vermont.gov/student-learning/personalized-learning/personalized-learning-planning-process). On outcomes, only 4 of 330 documents qualified for a systematic review (https://www.emerald.com/insight/content/doi/10.1108/oth-09-2024-0053/full/html, Feb 2025).
- The Gates-led 2014 definition: a learner profile is a current record of strengths, needs, motivations and goals (https://www.edweek.org/technology/personalized-learning-a-working-definition/2014/10). iNACOL's 2016 explainer tied these plans to "learning styles" (https://www.fullscalelearning.org/what-is-personalized-learning/). Aurora (formerly iNACOL) became FullScale on July 22 2025 (https://www.fullscalelearning.org/news/introducing-fullscale-a-new-chapter-in-education-transformation/).
- RAND, 40 schools: +3 percentile points, significant in math only (https://www.edweek.org/technology/personalized-learning-modest-gains-big-challenges-rand-study-finds/2017/07).
- CAST UDL 3.0 (July 30 2024) changes how the learning environment is designed rather than looking for deficits in the learner. CAST calls its own research base narrow (https://udlguidelines.cast.org/more/frequently-asked-questions/). A meta-analysis of 20 studies found a moderate positive effect (https://www.semanticscholar.org/paper/Achievement-of-learners-receiving-UDL-instruction:-King%E2%80%90Sears-Stefanidis/7fdb5e719020283f4fc0c48af53f28b16ee844e5). One critique likens UDL to learning styles (https://www.researchgate.net/publication/351359650).

**5. Tutoring intake**
- Sylvan: adaptive reading/writing/math test, a study-skills check, a student self-survey of habits and attitudes, about 1.5 h, then a parent conference (https://www.sylvanlearning.com/free-learning-resources/the-sylvan-insight-assessment-turning-your-childs-education-from-unknown-to-known/). Tutors also observe the student (https://www.sylvanlearning.com/how-sylvan-works/faqs/).
- Kumon: free test; the instructor watches concentration and confidence, and the student starts on familiar work (https://www.kumon.co.uk/blog/what-to-expect-at-your-free-kumon-assessment, Feb 23 2025).
- Mathnasium: written plus verbal assessment → learning plan (https://www.mathnasium.com/how-it-works).
- Huntington: a nationally normed test (CAT/5) in math, reading comprehension and vocabulary at entry, repeated every 50 hours (https://huntingtonhelps.com/wp-content/uploads/2024/07/Huntington_Evaluation_Report_Final1-22-18-compressed.pdf, Nov 2017).
- Wyzant: no intake assessment; the family picks the tutor (https://support.wyzant.com/students-parents/find-a-tutor/how-does-wyzant-work/). Varsity Tutors: two-stage adaptive diagnostics (https://www.varsitytutors.com/practice/diagnostics).

**6. Homeschool**
- Publisher placement tests:
  - Saxon: the test is one indicator; most students start at grade level, one level lower if there are gaps; no coaching during the test (https://www.mfwbooks.com/downloads/pdfs/Saxon_placement.pdf).
  - Math-U-See: parent-led yes/no questions and sample problems; levels are not grades (https://mathusee.com/digital-tools/placement-tool/).
  - The Good and the Beautiful: PDF tests; language arts at grade level unless reading help is needed (https://www.goodandbeautiful.com/pages/placement).
  - Sonlight hosts free tests for several publishers (https://www.sonlight.com/pages/placement-tests).
  - BookShark: 20–60 min; start lower if between levels (https://www.bookshark.com/placement-tests).
  - Memoria Press, Simply Classical line: ready when ~80% of items are "yes/emerging" (https://www.memoriapress.com/curriculum/special-needs-about/).
  - Abeka sells Iowa and Stanford tests (https://www.abeka.com/homeschool/products/testing/standardizedtests.aspx).
- HSLDA: standardized test, portfolio, or professional evaluation, depending on state law (https://hslda.org/post/three-types-of-year-end-assessments, Mar 7 2025).
  - Virginia: by Aug 1, a composite score at or above the 4th stanine, or a qualified evaluator's letter (https://law.lis.virginia.gov/vacode/title22.1/chapter14/section22.1-254.1/).
  - Pennsylvania: portfolio, tests in grades 3/5/8, and an annual evaluator by June 30 (https://www.pa.gov/agencies/education/resources/policies-acts-and-laws/basic-education-circulars-becs/purdons-statutes/home-education-program, Aug 21 2023).
- Narration: Mason's principle 14 says children tell back after one reading (https://www.gutenberg.org/files/66369/66369-h/66369-h.htm, 1925).
  - Retelling correlates moderately with comprehension (54 studies; https://eric.ed.gov/?id=EJ965422).
  - A later review found r=.46, weaker in upper grades, and says retelling shouldn't be used alone (https://pmc.ncbi.nlm.nih.gov/articles/PMC7806198/).
  - Free recall beat rereading when tested one week later (https://profiles.wustl.edu/en/publications/test-enhanced-learning-taking-memory-tests-improves-long-term-ret/).
- Learning-style quizzes:
  - HSLDA's 10-minute visual/auditory/kinesthetic/reading "preference" quiz advises adapting teaching to the result (https://hslda.org/post/what-is-my-childs-learning-preference, Dec 9 2024).
  - Texas Home School Coalition recommends VARK matching and cites no research (https://thsc.org/learning-styles/, updated Feb 2026).
  - Cathy Duffy recommends a learning-style book (https://cathyduffyreviews.com/homeschool-extras/parent-helps-and-how-to-books/general-parent-helps/discover-your-childs-learning-style).
  - All of these rest on the matching idea that the evidence in item 2 contradicts.

**7. What not to collect**
- IDEA: parents must consent before an evaluation. Evaluations use multiple tools, run by trained personnel, and cover health, vision, social-emotional status and intelligence (https://www.law.cornell.edu/cfr/text/34/300.300; https://www.law.cornell.edu/cfr/text/34/300.304).
- Dyslexia: screeners only flag risk. Identifying dyslexia needs a full one-on-one evaluation by qualified professionals (https://ed.cde.state.co.us/cdesped/resources/guidance/dyslexiahandbook/dyslexia-identifyingdyslexia). Every state except Hawaii has dyslexia laws, but over half showed no change in how many students were identified (https://theconversation.com/nearly-every-state-in-the-us-has-dyslexia-laws-but-our-research-shows-limited-change-for-struggling-readers-275202, Feb 12 2026).
- PPRA protects eight areas: political beliefs, mental/psychological problems, sex, illegal behavior, appraisals of family, privileged relationships, religion, income. An Aug 26 2026 federal letter says school surveys touching these need written parental consent, including mental-health screeners, because students feel obliged to answer authority figures (https://studentprivacy.ed.gov/sites/default/files/resource_document/file/SPPO%20Back%20to%20School%20DCL_August2026_Final508.pdf).
- COPPA (children under 13): the amended rule, with compliance due April 22 2026, adds voiceprints to protected data. It also requires separate consent for sharing with third parties and a written retention policy (https://www.mayerbrown.com/en/insights/publications/2025/04/ftc-announces-significant-amendments-to-coppa). The FTC won't enforce against voice used only to replace typing, with notice, and deleted promptly (https://www.ftc.gov/business-guidance/resources/complying-coppa-frequently-asked-questions).

Bottom line:
- Evidence supports adaptive screeners for flagging risk, personalizing content to interests, get-to-know-you surveys that build relationships, retelling (moderately), and short motivation scales (weak-to-modest prediction).
- Matching teaching to learning styles is unsupported.
- Information sheets and learner profiles are largely unevaluated.

UNCONFIRMED:
- Mathnasium and Kumon US pages blocked direct reading; the Mathnasium item comes from the search index only.
- Whether Abeka or Memoria Press's Classical Core line publish placement tests.
- Whether Varsity Tutors requires a diagnostic before tutoring.
- The UDL meta-analysis effect size.
- Any controlled study of narration itself or of student information sheets.
- i-Ready Inform's new length.
- ERAS and SARA grade ranges.

---

# Appendix C. Research report 3: the learning science

As delivered on 2026-09-27, unedited except for this heading.

**Learner characteristics, ages 10–15**
d/g = difference in standard deviations (0.2 small, 0.5 medium); r = correlation.

**1. Prior knowledge (strongest)**
- It changes what works (expertise reversal: Kalyuga et al. 2003, *Educ Psychol*, doi.org/10.1207/s15326985ep3801_4; Kirschner, Sweller & Clark 2006, same journal, doi.org/10.1207/s15326985ep4102_1). In 60 studies, novices gained from more guidance (d = 0.51) and high-knowledge learners from less (d = −0.43) (Tetzlaff et al. 2025, *Learn Instr*, doi.org/10.1016/j.learninstruc.2025.102142).
- Quick probes are valid. Asking grade 9–10 students only for a problem's first step correlated up to .92 with full tests and ran 2.5–5 times faster (Kalyuga & Sweller 2004, *J Ed Psych*, doi.org/10.1037/0022-0663.96.3.558). Tutoring adapted by such probes beat matched controls (Kalyuga & Sweller 2005, *ETR&D*, doi.org/10.1007/BF02504800).
- Cold start has two routes.
  - (a) Adaptive placement. ALEKS asks up to 30 questions, then predicts a held-out 6th-grade item at AUROC .875 (1 = perfect) (Cosyn et al. 2021, *J Math Psych*, doi.org/10.1016/j.jmp.2021.102512). IRT (difficulty–ability model) adaptive tests need half the items for equal reliability (Weiss 1982, *Appl Psych Meas*, doi.org/10.1177/014662168200600408).
  - (b) A population average, updated on every answer. This is knowledge tracing's (per-skill mastery probability) initial-knowledge parameter (Corbett & Anderson 1995, *UMUAI*, doi.org/10.1007/BF01099821). LLMs can trace knowledge turn by turn in dialogue (Scarlatos, Baker & Lan 2024, arXiv 2409.16490).
- Six to ten exchanges give only coarse placement (inference).

**2. Pretesting: the intake itself teaches**
- Failed guesses improve later learning (Kornell, Hays & Bjork 2009, *JEP:LMC*, doi.org/10.1037/a0015729).
- Meta-analyses: pretested content g = 0.54, other content 0.04 (St. Hilaire, Chan & Ahn 2024, *Psychon Bull Rev*, doi.org/10.3758/s13423-023-02353-8). A second found g = .66 vs .01, stronger with feedback (King-Shepard et al. 2025, *Ed Psych Review*, doi.org/10.1007/s10648-025-10075-7).
- So: ask about the unit's central ideas, then give the answer.

**3. Self-efficacy**
- Self-efficacy for specific, familiar performances correlates .59 with grades (4 studies); general academic self-efficacy correlates .31 (Richardson, Abraham & Bond 2012, *Psych Bulletin*, doi.org/10.1037/a0026838; university).
- Performance drives it (β = .21) more than the reverse (β = .07). In children, only performance→belief holds (Talsma et al. 2018, *Learn Indiv Differ*, doi.org/10.1016/j.lindif.2017.11.015).
- Short measure: task-specific "how sure are you that you can do this" ratings, 0–100 or 0–10 (Bandura 2006, *Self-Efficacy Beliefs of Adolescents*, bpb-us-e1.wpmucdn.com/websites.uta.edu/dist/1/4994/files/2021/07/Guide-for-Constructing-Self-Efficacy-Scales-Bandura2006.pdf).
- Prompted every fourth problem in an algebra tutor, it varied reliably and predicted next-period help-seeking and learning (Bernacki, Nokes-Malach & Aleven 2015, *Metacogn Learn*, doi.org/10.1007/s11409-014-9127-x).

**4. Calibration ("how sure are you?")**
- Useful: less overconfident students retained more (Dunlosky & Rawson 2012, *Learn Instr*, doi.org/10.1016/j.learninstruc.2011.08.003; college).
- Grade 3–6 children fix high-confidence errors best after feedback (Metcalfe & Finn 2012, *Learn Instr*, doi.org/10.1016/j.learninstruc.2011.10.004). So confident errors deserve full correction.
- Trainable, modestly: g = 0.25 over 35 studies, with secondary students gaining least (Janssen & Lazonder 2024, *Ed Psych Review*, doi.org/10.1007/s10648-024-09936-4).

**5. Help-seeking**
- Students click through 68% of hint levels in under a second, and after three errors only 34% ask for help. Feedback on help-seeking improved it, but not learning (Aleven et al. 2016, *IJAIED*, doi.org/10.1007/s40593-015-0089-1).
- "Gaming the system" (hint abuse, guessing) predicted post-tests as strongly as prior knowledge (Baker et al. 2004, CHI, doi.org/10.1145/985692.985741). Tutor design explained 56% of it, five times what student traits did (Baker et al. 2009, AIED, doi.org/10.3233/978-1-60750-028-5-475).
- Detectors built on activity logs generalize across students and lessons (Baker et al. 2008, *UMUAI*, doi.org/10.1007/s11257-007-9045-6). Detectors that read LLM chats have so far been tested only on simulated students (Sosnovsky, Daniëls & Roelofsen 2026, AIED, doi.org/10.1007/978-3-032-29788-4_80).
- Open GPT-4 lifted practice scores 48% but cut exam scores 17%; a safeguarded version largely avoided that (Bastani et al. 2025, *PNAS*, doi.org/10.1073/pnas.2422633122).

**6. Interests**
- Meta-analysis: retention g = 0.48, transfer 0.36, interest 0.55 (Lin et al. 2024, *Ed Psych Review*, doi.org/10.1007/s10648-024-09933-7). Which way of asking about interests works best: UNCONFIRMED.
- In 9th-grade algebra there were gains, largest for struggling students (Walkington 2013, *J Ed Psych*, doi.org/10.1037/a0031882). They held only when the problems' depth matched how students use numbers in their hobbies (Walkington & Bernacki 2019, *IJAIED*, doi.org/10.1007/s40593-018-0168-1).
- Mixed results:
  - Choosing a context from a menu did nothing for 1,449 secondary students and demotivated those with low perceived competence (Iterbeke, Schelfhout & De Witte 2022, *Comput Hum Behav*, doi.org/10.1016/j.chb.2021.107168).
  - Pop-culture problem-posing raised learning but lowered secondary students' enjoyment (Walkington et al. 2024, *J Ed Psych*, eric.ed.gov/?id=EJ1423346).
- Inference: it needs the student's own, specific account.

**7. Growth mindset**
- Mindset–achievement r = .10; interventions d = 0.08 (Sisk et al. 2018, *Psych Science*, doi.org/10.1177/0956797617739704).
- US national trial: +0.11 SD, for lower-achieving 9th graders only (Yeager et al. 2019, *Nature*, doi.org/10.1038/s41586-019-1466-y).
- Bias-corrected d = 0.05, not significant (Macnamara & Burgoyne 2023, *Psych Bulletin*, doi.org/10.1037/bul0000352). Another meta-analysis found 0.14 for targeted groups with faithful delivery (Burnette et al. 2023, *Psych Bulletin*, doi.org/10.1037/bul0000368).
- UK trial, ages 10–11: 0.00 (Foliano et al. 2019, EEF, niesr.ac.uk/wp-content/uploads/2021/10/Changing-Mindsets_0-4.pdf).
- Ages 9–13: praise effects failed to replicate (Li & Bates 2019, *JEP:General*, doi.org/10.1037/xge0000669).
- Conclusion: don't measure or target it.

**8. Age**
- Problem-first beats instruction-first (g = 0.36) but reverses for grades 2–5 (Sinha & Kapur 2021, *Rev Ed Research*, doi.org/10.3102/00346543211019105). 228 fifth graders showed no problem-first gain (Mazziotti et al. 2019, *npj Sci Learn*, doi.org/10.1038/s41539-019-0041-5).
- Unguided discovery hurt adolescents most (d = −0.53); discovery with feedback helped (d = 0.30) (Alfieri et al. 2011, *J Ed Psych*, doi.org/10.1037/a0021017).
- Inference: question-first with quick feedback from about age 12; explain-first for younger or novice students.

**9. Reading level**
- Reading aloud gives a valid measure.
  - Automated words-correct-per-minute fell within 3–4 words of human scorers (Bolaños et al. 2013, *J Ed Psych*, doi.org/10.1037/a0031479).
  - Reading Tutor speech data correlated .78 with a human fluency test (Beck, Jia & Mostow 2004, *TICL*, cs.cmu.edu/~listen2/pdfs/TICL2004-latency-61-81pp%20(Beck).pdf).
  - Amira grew out of that tutor. Its evidence is K–4 learning outcomes (evidenceforessa.org/program/amira). Validation for ages 10–15: UNCONFIRMED.
- Free talk is a weaker measure.
  - Chat understates syntax compared with explaining a game (Nippold et al. 2005, *JSLHR*, doi.org/10.1044/1092-4388(2005/073)).
  - Vocabulary-diversity scores need 100+ words (Koizumi 2012, *Vocab Learn Instr*, doi.org/10.7820/vli.v01.1.koizumi).

**10. LLM tutors with learner models**
- Helped: sequencing problems from LLM ratings of each chat (answer-seeking vs explanation-seeking) raised an unassisted exam 0.15 SD over five months, 770 high-schoolers (Chung et al. 2026, arXiv 2608.16907, preprint).
- Did not help, or unclear:
  - Removing student errors and skills from prompts barely changed three LLMs' tutor moves; only Llama3-70B responded to errors (Borchers & Shou 2025, AIED, arXiv 2504.05570).
  - GPT-4 readability rewrites for weak readers gave mixed results (Norberg et al. 2025, *IJAIED*, doi.org/10.1007/s40593-024-00420-2).
  - GPT-4 "learning preference" profiles changed only preference, n = 23 (Vaccaro, Friday & Zaghi 2024, arXiv 2408.05204).

**11. Refresh rates**
- Knowledge: every answer. Students start far apart (55% vs 75% correct) but gain about 2.5 points per practice opportunity (Koedinger et al. 2023, *PNAS*, doi.org/10.1073/pnas.2221311120).
- Self-efficacy: within a lesson (Bernacki 2015). Gaming: lesson to lesson (Baker 2009).
- Interests: stability stays flat through adolescence and rises at 18–22 (Low et al. 2005, *Psych Bulletin*, doi.org/10.1037/0033-2909.131.5.713). Re-ask each term (agent's inference).
- Competence beliefs decline over years (Jacobs et al. 2002, *Child Development*, doi.org/10.1111/1467-8624.00421). Syntax: yearly (Nippold 2005).

**Ranking**
Best on both counts:
1. Prior knowledge of this unit's central ideas (first-step questions, updated per answer).
2. Confidence on each answer.
3. Help-/answer-seeking behaviour (observed, not asked).
4. Task-specific self-efficacy (one 0–10 question).
5. Interests, with depth (asked directly).
Reading level qualifies only through reading aloud (voice).

Weakest, commonly measured:
1. Learning styles: virtually no evidence that matching helps (Pashler et al. 2008, *Psych Sci Public Interest*, doi.org/10.1111/j.1539-6053.2009.01038.x).
2. Growth mindset (item 7).
3. Grit: ρ = .18 with performance, .84 with conscientiousness (Credé, Tynan & Harms 2017, *JPSP*, doi.org/10.1037/pspp0000102).
