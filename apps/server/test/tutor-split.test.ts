import { describe, expect, it } from "vitest";
import { buildTutorContext, passagesForLatestReply, tutorTools, type TutorContext } from "../src/agents/tutor-agent.js";
import { openThread, setOpenThread, THREAD_PATIENCE, THREAD_PREFIX } from "../src/orchestrator/notes.js";
import type { Concept, Course, Learner, Lesson, Session, SourceChunk } from "../src/domain/types.js";

const concept: Concept = { id: "photosynthesis-definition", name: "What photosynthesis is", summary: "Plants make their own food using light.", keyFacts: ["Plants cannot eat the way animals do."], commonMisconceptions: ["Plants eat soil."], sourceChunkIds: [], prerequisites: [] };
const lesson: Lesson = { id: "l1", title: "Lesson 1", objectives: ["The student can explain photosynthesis."], conceptIds: [concept.id], guidingQuestions: [], practiceItems: [], order: 0 };
const course: Course = { id: "c1", title: "Unit 3", subject: "Science", level: "Grade 7", description: "", lessons: [lesson], concepts: [concept], chunks: [], sourceFiles: [], createdAt: "" };
const learner: Learner = { id: "l", name: "Sam", createdAt: "" };
const session: Session = { id: "s", learnerId: "l", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "" };
const ctx = { session, learner, course, lesson, concept, index: { search: () => [] }, onObservation: () => "ok", onAdvance: () => "ok" } as unknown as TutorContext;

describe("the tutor's turn is split into speaking and reflecting", () => {
  it("gives the speak call only the read-only lookup, and the reflect call the bookkeeping", () => {
    expect(tutorTools(ctx, "speak").map((t) => t.definition.name)).toEqual(["lookup_source"]);
    expect(tutorTools(ctx, "reflect").map((t) => t.definition.name)).toEqual(["record_observation", "advance", "open_thread", "flag_outside_claim"]);
  });

  it("tells the speak call to answer now and the reflect call to stay silent", () => {
    const speak = buildTutorContext(ctx, "speak").at(-1) ?? "";
    expect(speak).toMatch(/waiting/i);
    expect(speak).toMatch(/do not take notes/i);
    expect(speak).toMatch(/lookup_source/);

    const reflect = buildTutorContext(ctx, "reflect").at(-1) ?? "";
    expect(reflect).toMatch(/nothing you write here reaches them/i);
    expect(reflect).toMatch(/record_observation/);
    expect(reflect).toMatch(/advance/);
  });

  it("carries one open thread from the reflect pass into the next spoken turn", () => {
    const s: Session = { ...session, pendingDirectives: ["Now in ASSESS: ask for demonstrations."] };
    expect(setOpenThread(s, "  He answered around what the fertilizer\n  actually does.  ")).toMatch(/The open thread is now/);
    expect(openThread(s)).toEqual({ text: "He answered around what the fertilizer actually does.", turns: 1 });
    expect(s.pendingDirectives[0]).toBe("Now in ASSESS: ask for demonstrations.");

    // A dialogue is stuck in one place: the latest reading replaces the last, so threads never pile up,
    // and the count keeps running however the tutor rephrases it.
    setOpenThread(s, "His glucose answer sounded like a guess.");
    expect(s.pendingDirectives.filter((d) => d.startsWith(THREAD_PREFIX))).toHaveLength(1);
    expect(openThread(s)).toEqual({ text: "His glucose answer sounded like a guess.", turns: 2 });
    expect(s.pendingDirectives[0]).toBe("Now in ASSESS: ask for demonstrations.");

    // Long threads are clipped to one sentence's worth, and an empty one is refused.
    setOpenThread(s, "x".repeat(500));
    expect(openThread(s)?.text.length).toBe(200);
    expect(setOpenThread(s, "   ")).toMatch(/^Refused/);
  });

  it("gives the next speaking turn the thread with its phase, not as a competing instruction", () => {
    const s: Session = { ...session, pendingDirectives: [] };
    setOpenThread(s, "He answered around what the fertilizer actually does.");
    const blocks = buildTutorContext({ ...ctx, session: s }, "speak");
    // The thread rides with the phase guidance in one block, and no <orchestrator> block is created for it alone.
    const phaseBlock = blocks.find((b) => b.startsWith("Phase: ")) ?? "";
    expect(phaseBlock).toContain("He answered around what the fertilizer actually does.");
    expect(phaseBlock).toMatch(/inside whatever the phase above asks of you/);
    expect(phaseBlock).toMatch(/fresh angle is better than repeating yourself/);
    expect(blocks.some((b) => b.includes("<orchestrator>"))).toBe(false);
    // Real machine directives still get their own block.
    s.pendingDirectives.unshift("Spaced retrieval: open with one question about an earlier concept.");
    const withBoth = buildTutorContext({ ...ctx, session: s }, "speak");
    const orch = withBoth.find((b) => b.includes("<orchestrator>")) ?? "";
    expect(orch).toContain("Spaced retrieval");
    expect(orch).not.toContain("fertilizer");
  });

  it("stops varying the angle once a thread has stayed open too long", () => {
    const s: Session = { ...session, pendingDirectives: [] };
    // Each turn the orchestrator clears the directive list, so the count is carried in explicitly; a
    // thread the reflect pass does not renew simply vanishes.
    for (let i = 0; i < THREAD_PATIENCE; i++) {
      const prior = openThread(s)?.turns ?? 0;
      s.pendingDirectives = [];
      setOpenThread(s, "He has not said what the fertilizer does.", prior);
    }
    expect(openThread(s)?.turns).toBe(THREAD_PATIENCE);
    const phaseBlock = buildTutorContext({ ...ctx, session: s }, "speak").find((b) => b.startsWith("Phase: ")) ?? "";
    expect(phaseBlock).toMatch(/Stop varying the approach/);
    expect(phaseBlock).toMatch(/simplest form/);
    expect(phaseBlock).toMatch(/do not fill it with a hint/);
  });

  it("has the reflect pass file the answer to the opening retrieval question under the earlier concept", () => {
    const earlier: Concept = { ...concept, id: "cell-walls", name: "Cell walls" };
    const c: Course = { ...course, concepts: [concept, earlier] };
    const opened: Session = {
      ...session,
      retrievalConceptId: "cell-walls",
      transcript: [
        { role: "assistant", content: "Quick memory check: what does a cell wall do?", at: "" },
        { role: "user", content: "It keeps the cell stiff.", at: "" },
      ],
    };
    const reflect = buildTutorContext({ ...ctx, course: c, session: opened }, "reflect");
    expect(reflect.at(-1)).toMatch(/spaced-retrieval question about "Cell walls"/);
    expect(reflect.at(-1)).toContain('conceptId "cell-walls"');
    // The speaking call hears nothing about notes, and the shared prefix is untouched.
    const speak = buildTutorContext({ ...ctx, course: c, session: opened }, "speak");
    expect(speak.join("\n")).not.toMatch(/record_observation|spaced-retrieval/);
    expect(speak.slice(0, -1)).toEqual(reflect.slice(0, -1));
    // Only the first reply answers it.
    const later: Session = {
      ...opened,
      transcript: [...opened.transcript, { role: "assistant", content: "Good. Now, what is photosynthesis?", at: "" }, { role: "user", content: "Plants make food.", at: "" }],
    };
    expect(buildTutorContext({ ...ctx, course: c, session: later }, "reflect").at(-1)).not.toMatch(/spaced-retrieval/);
  });

  it("hands the tutor the passages matching the learner's latest words, so it need not stop to look them up", () => {
    const aeneas = { id: "c-aeneas", text: "Romulus and Remus were descendants of Aeneas, a hero of the Trojan War.", headingPath: ["Founding"] } as unknown as SourceChunk;
    const index = { search: (q: string) => (/aeneas/i.test(q) ? [{ chunk: aeneas, score: 4 }] : []) };
    const asked: Session = {
      ...session,
      transcript: [
        { role: "assistant", content: "Any questions about the founding story?", at: "" },
        { role: "user", content: "Isn't there more legend about Aeneas fleeing the Trojan War?", at: "" },
      ],
    };
    const c = { ...ctx, session: asked, index } as unknown as TutorContext;
    const speak = buildTutorContext(c, "speak");
    expect(speak.find((b) => b.startsWith("<passages_for_this_turn>"))).toContain("descendants of Aeneas");
    expect(speak.at(-1)).toMatch(/never announce or narrate a lookup/);
    // The reflect pass sees the same passages: only the last block differs.
    expect(buildTutorContext(c, "reflect").slice(0, -1)).toEqual(speak.slice(0, -1));
    // A short reply fetches nothing, and a passage the concept already shows is not repeated.
    const yes = { ...c, session: { ...asked, transcript: [asked.transcript[0], { role: "user" as const, content: "Yes.", at: "" }] } } as TutorContext;
    expect(buildTutorContext(yes, "speak").some((b) => b.startsWith("<passages_for_this_turn>"))).toBe(false);
    expect(passagesForLatestReply({ ...c, concept: { ...concept, sourceChunkIds: ["c-aeneas"] } } as TutorContext)).toEqual([]);
  });

  it("states the parent's outside-the-material setting in the cached block, and only the reflect pass flags outside facts", () => {
    const checking: Session = { ...session, outsideKnowledge: "check" };
    const speak = buildTutorContext({ ...ctx, session: checking }, "speak");
    expect(speak[0]).toContain('<outside_the_material setting="check">Answer and check.');
    expect(speak.at(-1)).not.toMatch(/flag_outside_claim|reference check/);
    const reflect = buildTutorContext({ ...ctx, session: checking }, "reflect");
    expect(reflect.at(-1)).toMatch(/call flag_outside_claim for it; never for faith, values or opinion/);
    expect(reflect.slice(0, -1)).toEqual(speak.slice(0, -1));
    // The reflect pass sees what is already flagged, so it does not flag a fact again in new words.
    const flagged: Session = { ...checking, outsideClaims: [{ id: "a", at: "", claim: "Aphrodite rescued Aeneas.", raisedBy: "learner", tutorStance: "confirmed", query: "Aeneas", status: "pending" }] };
    expect(buildTutorContext({ ...ctx, session: flagged }, "reflect").at(-1)).toContain('Already flagged this session, so never flag these again, however you would word them now: "Aphrodite rescued Aeneas."');
    expect(buildTutorContext({ ...ctx, session: flagged }, "speak").join(" ")).not.toContain("Already flagged");
    // Sessions from before the setting existed answer without checking; material only is stated plainly.
    expect(buildTutorContext(ctx, "speak")[0]).toContain('setting="answer">Answer without checking.');
    expect(buildTutorContext({ ...ctx, session: { ...session, outsideKnowledge: "material-only" } }, "speak")[0]).toMatch(/Material only\. Do not confirm or correct/);
  });

  it("puts a follow-up the tutor owes at the head of the speaking call's final instruction, not with the other directives", () => {
    const owed = "Keep your word first: earlier you told the learner you were not sure whether the Aeneid has 9,896 lines. You have since looked it up, and it is right.";
    const s: Session = { ...session, pendingDirectives: [owed, "Now in ASSESS: ask for demonstrations."] };
    const speak = buildTutorContext({ ...ctx, session: s }, "speak");
    expect(speak.at(-1)).toMatch(/^Your reply starts with something you owe the learner, before anything else\. Keep your word first:/);
    const orch = speak.find((b) => b.includes("<orchestrator>")) ?? "";
    expect(orch).toContain("Now in ASSESS");
    expect(orch).not.toContain("Keep your word first");
    const reflect = buildTutorContext({ ...ctx, session: s }, "reflect");
    expect(reflect.join(" ")).not.toContain("Keep your word first");
    expect(reflect.slice(0, -1)).toEqual(speak.slice(0, -1));
  });

  it("tells the speaking call what the orchestrator already said for it, and keeps the marker out of its directives", () => {
    const line = "I looked that up: your brother was right, the Aeneid really does have 9,896 lines.";
    const s: Session = { ...session, pendingDirectives: [`Say first: ${line}`, "Now in ASSESS: ask for demonstrations."] };
    const speak = buildTutorContext({ ...ctx, session: s, saidFirst: line }, "speak");
    expect(speak.at(-1)).toMatch(/^You have already said this to the learner, as the start of this reply: "I looked that up: your brother was right/);
    expect(speak.at(-1)).toMatch(/without repeating it/);
    expect(speak.join(" ")).not.toContain("Say first:");
    expect(buildTutorContext({ ...ctx, session: s }, "reflect").join(" ")).not.toContain("Say first:");
  });

  it("passes a flagged outside fact to the orchestrator", async () => {
    const seen: unknown[] = [];
    const flag = tutorTools({ ...ctx, onOutsideClaim: (input) => (seen.push(input), "Flagged.") }, "reflect").find((t) => t.definition.name === "flag_outside_claim")!;
    const input = { claim: "Aphrodite rescued Aeneas.", raisedBy: "learner", tutorStance: "confirmed", query: "Aeneas", materialSays: "" };
    expect(await flag.run(input as never)).toBe("Flagged.");
    expect(seen).toEqual([input]);
  });

  it("tells the tutor how much of an answer the learner is ready for, from the profile's depth", () => {
    const profile = { intakePreferences: [], demonstrationPreferences: [], challengeTolerance: "medium" as const, pace: "moderate" as const, verbalLevel: "casual", interests: [], priorKnowledge: [], observedGaps: [], parentSummary: "", tutoringGuidance: [] };
    const plain = buildTutorContext({ ...ctx, learner: { ...learner, profile } }, "speak")[1];
    expect(plain).toContain("Depth: simple (the plain version)");
    const full = buildTutorContext({ ...ctx, learner: { ...learner, profile: { ...profile, depth: "full" as const } } }, "speak")[1];
    expect(full).toContain("Depth: full (the full picture)");
  });

  it("keeps the cached prefix identical across both calls, so only the last block differs", () => {
    const speak = buildTutorContext(ctx, "speak");
    const reflect = buildTutorContext(ctx, "reflect");
    expect(speak.length).toBe(reflect.length);
    expect(speak.slice(0, -1)).toEqual(reflect.slice(0, -1));
    expect(speak.at(-1)).not.toEqual(reflect.at(-1));
  });
});
