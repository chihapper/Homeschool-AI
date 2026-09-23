import { describe, expect, it } from "vitest";
import { buildTutorContext, tutorTools, type TutorContext } from "../src/agents/tutor-agent.js";
import { openThread, setOpenThread, THREAD_PATIENCE, THREAD_PREFIX } from "../src/orchestrator/notes.js";
import type { Concept, Course, Learner, Lesson, Session } from "../src/domain/types.js";

const concept: Concept = { id: "photosynthesis-definition", name: "What photosynthesis is", summary: "Plants make their own food using light.", keyFacts: ["Plants cannot eat the way animals do."], commonMisconceptions: ["Plants eat soil."], sourceChunkIds: [], prerequisites: [] };
const lesson: Lesson = { id: "l1", title: "Lesson 1", objectives: ["The student can explain photosynthesis."], conceptIds: [concept.id], guidingQuestions: [], practiceItems: [], order: 0 };
const course: Course = { id: "c1", title: "Unit 3", subject: "Science", level: "Grade 7", description: "", lessons: [lesson], concepts: [concept], chunks: [], sourceFiles: [], createdAt: "" };
const learner: Learner = { id: "l", name: "Sam", createdAt: "" };
const session: Session = { id: "s", learnerId: "l", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "" };
const ctx = { session, learner, course, lesson, concept, index: { search: () => [] }, onObservation: () => "ok", onAdvance: () => "ok" } as unknown as TutorContext;

describe("the tutor's turn is split into speaking and reflecting", () => {
  it("gives the speak call only the read-only lookup, and the reflect call the bookkeeping", () => {
    expect(tutorTools(ctx, "speak").map((t) => t.definition.name)).toEqual(["lookup_source"]);
    expect(tutorTools(ctx, "reflect").map((t) => t.definition.name)).toEqual(["record_observation", "advance", "open_thread"]);
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

  it("keeps the cached prefix identical across both calls, so only the last block differs", () => {
    const speak = buildTutorContext(ctx, "speak");
    const reflect = buildTutorContext(ctx, "reflect");
    expect(speak.length).toBe(reflect.length);
    expect(speak.slice(0, -1)).toEqual(reflect.slice(0, -1));
    expect(speak.at(-1)).not.toEqual(reflect.at(-1));
  });
});
