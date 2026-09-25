/**
 * Tutor Agent: the live Socratic teacher. Runs behind the browser voice path, the text chat API and the
 * Hume voice bridge.
 *
 * A turn is TWO calls, because they have different deadlines:
 *
 *  1. `tutorTurn` — SPEAK. The learner is waiting, so this call has no bookkeeping tools and no private
 *     reasoning: it hears the learner and asks the next question. Only `lookup_source` is available,
 *     because reading a passage before answering is part of answering.
 *  2. `reflectTurn` — REFLECT. Runs after the words are out, while the learner is listening. It records
 *     observations and requests the phase change, with the session's normal effort and thinking. Nobody
 *     is waiting on it, so it may take as long as it needs; the orchestrator applies its decisions before
 *     the next turn.
 *
 * This is what a human tutor does: answer in the gap of the conversation, file the note afterwards.
 * Measured on 2026-09-22, the single-call design spent 5-15 s thinking before speaking on the turns where
 * it was deciding whether to advance, which is exactly the wrong place to spend it.
 *
 * Tools:
 *  - lookup_source        retrieve verbatim passages from the course material (grounding) — SPEAK call
 *  - record_observation   log evidence of understanding / misconception for the Assessor — REFLECT call
 *  - advance              request a phase change or move to the next concept (validated by the orchestrator) — REFLECT call
 *  - open_thread          name what this dialogue is still working on, for the next turn — REFLECT call
 *
 * `open_thread` is what makes the turns one dialogue rather than a series of separate questions. The
 * speaking call cannot deliberate, so the reflect pass names the unfinished business in one sentence and
 * the next speaking turn sees it beside the phase: the phase is what kind of work is being done, the
 * thread is what the work is on.
 */
import { config } from "../config.js";
import type { Concept, Course, Learner, Lesson, Observation, Session, SessionPhase, SourceChunk } from "../domain/types.js";
import { ChunkIndex, searchWithLearner, tokenize } from "../ingest/retrieval.js";
import { buildSystem, prewarm, streamTurn, transcriptToMessages, type AgentTool, type AgentSpec, type TurnResult } from "./base.js";
import { openThread, THREAD_PATIENCE, THREAD_PREFIX } from "../orchestrator/notes.js";
import { walkedConceptIds } from "../domain/focus.js";

export const tutorAgent: AgentSpec = {
  name: "Socratic Tutor",
  role:
    "You are a one-on-one teacher for a homeschool student, working from the course material the parent chose. " +
    "You teach by questioning, you stay inside the material, and you never do the student's thinking for them. " +
    "Your aim is durable understanding the student can demonstrate, not coverage.",
  skills: ["socratic-method", "learner-adaptation", "grounding", "voice-conversation"],
  // Getters: a change in the Settings tab applies on the next turn without a restart.
  get model() {
    return config.tutorModel;
  },
  get effort() {
    return config.tutorEffort;
  },
  get thinking() {
    return config.tutorThinking;
  },
};

/**
 * The same tutor, reflecting after the fact. Same prompt and skills (so the cached prefix is shared), but
 * it may think: the learner is listening to the reply while this runs.
 */
export const reflectAgent: AgentSpec = {
  ...tutorAgent,
  get model() {
    return config.tutorModel;
  },
  get effort() {
    return config.reflectEffort;
  },
  thinking: "adaptive",
};

export type AdvanceTarget = "inquire" | "assess" | "next-concept";

export interface TutorContext {
  session: Session;
  learner: Learner;
  course: Course;
  lesson: Lesson;
  concept: Concept;
  index: ChunkIndex;
  /** Orchestrator hooks; return a message the model will see as the tool result. */
  onObservation: (o: Observation) => string;
  onAdvance: (to: AdvanceTarget, rationale: string) => string;
  /** Name what the dialogue is still working on, for the next spoken turn (reflect pass only). */
  onThread?: (thread: string) => string;
  /** Passages lookup_source returned, so the session can remember what the tutor read (speak call). */
  onLookup?: (chunkIds: string[]) => void;
}

const PHASE_GUIDANCE: Record<SessionPhase, string> = {
  intake: "",
  teach: "Phase: TEACH. Elicit what the learner already thinks, then build the concept through questions grounded in the material. Call advance to 'inquire' once the learner has stated the core idea in their own words.",
  inquire: "Phase: INQUIRE. Invite the learner's own questions about the concept. Answer accurately from the material, then turn each answer into a question back — including back to anything the dialogue left unfinished. Call advance to 'assess' once their questions are answered or after a few exchanges.",
  assess: "Phase: ASSESS. No more scaffolding. Ask for demonstrations (own words, apply to a new case, predict, teach back). Record at least two observations. Then call advance to 'next-concept'.",
  "wrap-up": "Phase: WRAP-UP. Summarise what the learner figured out today in two or three sentences, name one thing to think about before next time, and say goodbye.",
  complete: "The session is complete. Say a brief goodbye.",
};

/** Number of leading context blocks that are stable for the whole session (course+lesson, learner). Cached. */
export const STABLE_CONTEXT_BLOCKS = 2;

/** How many passages matching the learner's latest words ride along with a turn. */
const PREFETCH_PASSAGES = 2;
/** A reply with fewer content words than this ("yes", "I don't know") fetches nothing. */
const PREFETCH_MIN_TERMS = 3;

/**
 * Passages that match what the learner just said, from anywhere in the course, found before the tutor
 * speaks. With the passage already in front of it the tutor answers straight away instead of stopping to
 * look it up, a round trip it also narrated aloud (2026-09-25, asked about Aeneas: "I want to check that
 * against the material before I answer you straight"). The current concept's own passages are shown
 * already and are skipped. Pure, so the speaking call and the reflect pass see the same passages.
 */
export function passagesForLatestReply(ctx: TutorContext): SourceChunk[] {
  const latest = [...ctx.session.transcript].reverse().find((t) => t.role === "user")?.content ?? "";
  if (tokenize(latest).length < PREFETCH_MIN_TERMS) return [];
  const shown = new Set(ctx.concept.sourceChunkIds.slice(0, 4));
  return ctx.index
    .search(latest, PREFETCH_PASSAGES + shown.size)
    .map((h) => h.chunk)
    .filter((c) => !shown.has(c.id))
    .slice(0, PREFETCH_PASSAGES);
}

export function buildTutorContext(ctx: TutorContext, mode: "speak" | "reflect" = "speak"): string[] {
  const { learner, course, lesson, concept, session } = ctx;
  const profile = learner.profile;
  const blocks: string[] = [];

  // Course-level block is stable for the whole session (good cache hit rate). It lists the session's frozen
  // walk, so a concept the parent skipped is simply absent, and a focus edit mid-session changes nothing here.
  const lessonConcepts = walkedConceptIds(session, course, lesson)
    .map((id) => course.concepts.find((c) => c.id === id))
    .filter((c): c is Concept => Boolean(c));
  blocks.push(
    `<course title="${course.title}" subject="${course.subject}" level="${course.level}">\n${course.description}\n</course>\n\n` +
      `<lesson title="${lesson.title}">\nObjectives:\n${lesson.objectives.map((o) => `- ${o}`).join("\n")}\n\n` +
      `Concepts in this lesson (teach in order):\n${lessonConcepts.map((c, i) => `${i + 1}. ${c.name} (${c.id}): ${c.summary}`).join("\n")}\n\n` +
      (lesson.guidingQuestions.length ? `Guiding questions:\n${lesson.guidingQuestions.map((q) => `- ${q}`).join("\n")}\n\n` : "") +
      (lesson.practiceItems.length ? `Practice items from the material:\n${lesson.practiceItems.map((q) => `- ${q}`).join("\n")}\n` : "") +
      `</lesson>`,
  );

  if (profile) {
    blocks.push(
      `<learner_profile name="${learner.name}">\n` +
        `Intake preferences: ${profile.intakePreferences.join(", ")}\n` +
        `Demonstration preferences: ${profile.demonstrationPreferences.join(", ")}\n` +
        `Challenge tolerance: ${profile.challengeTolerance}. Pace: ${profile.pace}. Verbal level: ${profile.verbalLevel}\n` +
        `Interests: ${profile.interests.join(", ")}\n` +
        `Prior knowledge: ${profile.priorKnowledge.map((p) => `- ${p}`).join("\n")}\n` +
        `Observed gaps: ${profile.observedGaps.map((p) => `- ${p}`).join("\n")}\n` +
        `Tutoring guidance (follow literally):\n${profile.tutoringGuidance.map((p) => `- ${p}`).join("\n")}\n</learner_profile>`,
    );
  } else {
    blocks.push(`<learner name="${learner.name}"${learner.gradeLevel ? ` grade="${learner.gradeLevel}"` : ""}>No profile yet: start with a concrete example, keep steps small, and watch how they respond.</learner>`);
  }

  // Current concept: the part that changes as the session advances.
  const sourceText = concept.sourceChunkIds
    .map((id) => course.chunks.find((c) => c.id === id))
    .filter((c): c is NonNullable<typeof c> => Boolean(c))
    .slice(0, 4)
    .map((c) => `<passage id="${c.id}">\n${c.text}\n</passage>`)
    .join("\n");
  blocks.push(
    `<current_concept id="${concept.id}" name="${concept.name}">\n${concept.summary}\n\nKey facts the learner should be able to state:\n${concept.keyFacts.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Common misconceptions to listen for:\n${concept.commonMisconceptions.map((f) => `- ${f}`).join("\n")}\n\n` +
      `Source passages:\n${sourceText || "(none linked; use lookup_source)"}\n</current_concept>`,
  );

  // Everything already on file for this concept (so the reflect pass does not file it again), plus a count
  // for the others. Measured 2026-09-24: with only the last six shown, one quote was recorded four times.
  const mine = session.observations.filter((o) => o.conceptId === concept.id).slice(-12);
  const elsewhere = new Map<string, number>();
  for (const o of session.observations) if (o.conceptId !== concept.id) elsewhere.set(o.conceptId, (elsewhere.get(o.conceptId) ?? 0) + 1);
  if (mine.length || elsewhere.size) {
    blocks.push(
      `<observations_so_far>\n${mine.map((o) => `- [${o.kind}] ${o.evidence} (${o.note})`).join("\n")}` +
        (elsewhere.size ? `\nAlready recorded for other concepts: ${[...elsewhere].map(([id, n]) => `${id} (${n})`).join(", ")}.` : "") +
        `\n</observations_so_far>`,
    );
  }

  // The phase is what kind of work this turn does; the thread is what the work is on. One dialogue, so
  // they are given together rather than as competing instructions.
  const thread = openThread(session);
  blocks.push(
    PHASE_GUIDANCE[session.phase] +
      (thread
        ? `\n\nThis dialogue is still working on something: ${thread.text}\n` +
          "That is where you and the learner actually are, so this turn works on it — inside whatever the phase above asks of you. " +
          "If they take you somewhere else, go with them for a sentence, because a real question of theirs deserves a real answer, then bring it back in the same turn. " +
          "A question they answered around is not an interruption to the lesson; it is the lesson, and holding them to it gently is the whole method.\n" +
          (thread.turns < THREAD_PATIENCE
            ? `This is turn ${thread.turns} on it, so a fresh angle is better than repeating yourself word for word.`
            : `This is turn ${thread.turns} on it: you have come at it from several angles and the learner has not accounted for it yet. ` +
              "Stop varying the approach. Say plainly that you want to come back to this, ask the question in its simplest form, and wait — silence here is doing work, so do not fill it with a hint.")
        : ""),
  );
  const machineDirectives = session.pendingDirectives.filter((d) => !d.startsWith(THREAD_PREFIX));
  if (machineDirectives.length) blocks.push(`<orchestrator>\n${machineDirectives.join("\n")}\n</orchestrator>`);
  const fetched = passagesForLatestReply(ctx);
  if (fetched.length) {
    blocks.push(
      `<passages_for_this_turn>\nThese passages from elsewhere in the material match what the learner just said. Use them if they bear on it; otherwise leave them.\n` +
        fetched.map((c) => `<passage id="${c.id}" heading="${c.headingPath.join(" > ")}">\n${c.text}\n</passage>`).join("\n") +
        `\n</passages_for_this_turn>`,
    );
  }
  // Only the last block differs between the two calls, so the reflect-only retrieval note rides inside it.
  const retrieval = mode === "reflect" ? retrievalAnswered(session, course) : undefined;
  blocks.push(
    mode === "speak"
      ? "You are speaking to the learner now and they are waiting, so answer straight away: two to four sentences ending in your single question, and nothing after it. " +
        "Do not answer your own question, and do not narrate a pause, a hesitation, or a reaction the learner has not actually given: their last message is the only thing they have said. " +
        "Do not stop to weigh whether they are ready to move on and do not take notes; that happens after you speak, in a separate pass you do not run here. " +
        "Passages that match the learner's latest words are above when there are any. If you need another passage to answer honestly, call lookup_source before your first word, " +
        "and never announce or narrate a lookup (no \"let me check the material\"): say what the material says, not that you are checking it. Never mention tools, phases, or the profile out loud."
      : "The learner has just heard your reply (the last assistant message) and is listening; nothing you write here reaches them, so write nothing. " +
        "Take your notes now: call record_observation for what the learner showed in their LATEST reply only, quoting them; everything from earlier turns is already on file above, so do not record it again, " +
        "and call advance when the phase is genuinely finished. " +
        "This is also the only place you get to think before teaching: the next spoken turn happens fast and cannot weigh anything. " +
        "So decide what this dialogue is still working on and call open_thread with it in one sentence — a question they answered around, a claim that contradicts something they said earlier, " +
        "an answer that was right but sounded like a guess. If the thread is finished, do not call it, and the next turn moves on. " +
        "Make every call in one batch. If there is nothing to record, no reason to advance and nothing unfinished, do nothing at all." +
        (retrieval
          ? ` The session opened with a spaced-retrieval question about "${retrieval.name}", from an earlier lesson, and the learner's latest reply is their answer to it: ` +
            `record how they did with record_observation under conceptId "${retrieval.id}", not the current concept. If they said they do not remember, that is a gap; if they did not take the question up, record nothing for it.`
          : ""),
  );
  return blocks;
}

/**
 * The concept whose spaced-retrieval question the learner's latest reply answers, if it does: the session
 * opened with that question, and this is the first thing the learner has said since the tutor first spoke.
 */
function retrievalAnswered(session: Session, course: Course): Concept | undefined {
  if (!session.retrievalConceptId) return undefined;
  const opened = session.transcript.findIndex((t) => t.role === "assistant");
  if (opened < 0) return undefined;
  const replies = session.transcript.slice(opened + 1).filter((t) => t.role === "user").length;
  return replies === 1 ? course.concepts.find((c) => c.id === session.retrievalConceptId) : undefined;
}

/** Tools for one call: the SPEAK call may only read; the REFLECT call does the bookkeeping. */
export function tutorTools(ctx: TutorContext, mode: "speak" | "reflect" = "speak"): AgentTool<never>[] {
  const lookup: AgentTool<{ query: string }> = {
    definition: {
      name: "lookup_source",
      description:
        "Search the course material for passages about a topic. Call this whenever the learner asks something not covered by the current concept's passages, or before stating any fact you are not certain is in the material. " +
        "The learner's latest words are searched as well, so a thing they named is found even if your query describes it differently.",
      input_schema: {
        type: "object",
        properties: { query: { type: "string", description: "What to look for, in plain words." } },
        required: ["query"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ query }) => {
      const learnerText = [...ctx.session.transcript].reverse().find((t) => t.role === "user")?.content;
      const hits = searchWithLearner(ctx.index, query, learnerText);
      if (!hits.length) return "No passages in the course material match that. Tell the learner the passages you can see do not cover it.";
      ctx.onLookup?.(hits.map((h) => h.chunk.id));
      return hits.map((h) => `<passage id="${h.chunk.id}" heading="${h.chunk.headingPath.join(" > ")}">\n${h.chunk.text}\n</passage>`).join("\n\n");
    },
  };

  const record: AgentTool<Omit<Observation, "at">> = {
    definition: {
      name: "record_observation",
      description:
        "Record evidence about the learner's understanding of a concept, for the assessment report. Call this every time the learner demonstrates understanding, partial understanding, a misconception, a gap, or a notable change in engagement. Quote what they said.",
      input_schema: {
        type: "object",
        properties: {
          conceptId: { type: "string", description: "Concept id, usually the current concept." },
          kind: { type: "string", enum: ["understanding", "partial", "misconception", "gap", "engagement"] },
          evidence: { type: "string", description: "What the learner said or did, briefly quoted." },
          note: { type: "string", description: "Why this matters for mastery." },
        },
        required: ["conceptId", "kind", "evidence", "note"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: (o) => ctx.onObservation({ ...o, at: new Date().toISOString() }),
    endsSpeech: "after-question",
  };

  const advance: AgentTool<{ to: AdvanceTarget; rationale: string }> = {
    definition: {
      name: "advance",
      description:
        "Move the session forward: 'inquire' after the learner has stated the concept in their own words; 'assess' when their questions are answered; 'next-concept' after you have recorded assessment observations. " +
        "Call it in the same batch as your record_observation calls, after you have spoken; the new phase applies from your next turn. The orchestrator may refuse and tell you what is missing.",
      input_schema: {
        type: "object",
        properties: {
          to: { type: "string", enum: ["inquire", "assess", "next-concept"] },
          rationale: { type: "string", description: "One sentence of evidence for why the learner is ready." },
        },
        required: ["to", "rationale"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ to, rationale }) => {
      const result = ctx.onAdvance(to, rationale);
      // A refusal is reported as a tool error, which earns the model one silent pass to fix its bookkeeping.
      if (result.startsWith("Refused")) throw new Error(result);
      return result;
    },
    endsSpeech: "after-question",
  };

  const thread: AgentTool<{ thread: string }> = {
    definition: {
      name: "open_thread",
      description:
        "Name in ONE SHORT SENTENCE (about fifteen words; longer is cut off) what this dialogue is still working on, so your next turn continues it instead of starting fresh. " +
        "Use it when the exchange left something unfinished: a question the learner answered around, a claim of theirs that contradicts something they said earlier, " +
        'an answer that was right but sounded like a guess. For example: "He answered around what the fertilizer actually does for the corn." ' +
        "Calling it again replaces it; when the thread is genuinely finished, do not call it at all. Do not use it to restate the phase or the lesson plan.",
      input_schema: {
        type: "object",
        properties: { thread: { type: "string", description: "One sentence naming the unfinished business of the dialogue." } },
        required: ["thread"],
        additionalProperties: false,
      },
      strict: true,
    },
    run: ({ thread: text }) => ctx.onThread?.(text) ?? "No thread channel on this turn.",
  };

  return mode === "speak" ? [lookup as AgentTool<never>] : [record as AgentTool<never>, advance as AgentTool<never>, thread as AgentTool<never>];
}

/** Warm the cache for the stable part of this session's tutor prompt (role + skills + course + learner). */
export function prewarmTutor(ctx: TutorContext): Promise<void> {
  const stable = buildTutorContext(ctx, "speak").slice(0, STABLE_CONTEXT_BLOCKS);
  return prewarm(tutorAgent, buildSystem(tutorAgent, stable, STABLE_CONTEXT_BLOCKS), tutorTools(ctx, "speak"));
}

/** The SPEAK call: what the learner hears, as fast as the model can say it. */
export function tutorTurn(ctx: TutorContext, signal?: AbortSignal): AsyncGenerator<string, TurnResult, void> {
  const system = buildSystem(tutorAgent, buildTutorContext(ctx, "speak"), STABLE_CONTEXT_BLOCKS);
  // The tutor read these passages this turn, so the assessor's grounding audit counts them too.
  const fetched = passagesForLatestReply(ctx);
  if (fetched.length) ctx.onLookup?.(fetched.map((c) => c.id));
  let messages = transcriptToMessages(ctx.session.transcript);
  if (!messages.length) messages = [{ role: "user", content: "(The student has just joined the lesson. Open with a warm one-line greeting and your first eliciting question.)" }];
  // Thinking off regardless of the session setting: this call is the one the learner waits on.
  return streamTurn({ spec: { ...tutorAgent, thinking: "disabled" }, system, messages, tools: tutorTools(ctx, "speak"), maxTokens: 700, signal });
}

/**
 * The REFLECT call: records observations and requests the phase change, after the reply was spoken.
 * `spokenText` is the reply the learner just heard (not yet in the transcript when this runs).
 * Returns when the bookkeeping is done; anything it writes as text is ignored.
 */
export async function reflectTurn(ctx: TutorContext, spokenText: string, signal?: AbortSignal): Promise<TurnResult> {
  const system = buildSystem(reflectAgent, buildTutorContext(ctx, "reflect"), STABLE_CONTEXT_BLOCKS);
  const messages = transcriptToMessages([...ctx.session.transcript, ...(spokenText ? [{ role: "assistant" as const, content: spokenText }] : [])]);
  if (!messages.length) return { text: "", appended: [], stopReason: null, latency: { ttftMs: 0, totalMs: 0, iterations: 0, cacheReadTokens: 0, cacheWriteTokens: 0, inputTokens: 0, outputTokens: 0, suppressedChars: 0 } };
  // The API requires the conversation to end with a user message, and this one ends with the tutor's own
  // reply, so close it with the instruction for this pass.
  messages.push({
    role: "user",
    content:
      "(Reflect on the exchange above. Record any evidence with record_observation, quoting the learner, and call advance if the phase is finished. " +
      "Make the calls in one batch and write no words: the learner cannot hear this pass.)",
  });
  const gen = streamTurn({ spec: reflectAgent, system, messages, tools: tutorTools(ctx, "reflect"), maxTokens: 700, signal });
  let r = await gen.next();
  while (!r.done) r = await gen.next(); // its words are for nobody
  return r.value;
}
