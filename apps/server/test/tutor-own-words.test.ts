/**
 * The fixes after Andy's first Marine Biology lesson (2026-10-12): the tutor pressed a right answer for the book's
 * wording, called two wordings of one idea a contradiction, opened on a concept Andy already knew, and its note-taking
 * pass read every reply twice. What can be checked without a model is checked here; the replay script
 * (npm run replay:lesson) measures the rest.
 */
import { describe, expect, it } from "vitest";
import { buildTutorContext, notesOnPreviousAnswer, startingPoint, withReply, type TutorContext } from "../src/agents/tutor-agent.js";
import { toldFigures } from "../src/domain/told.js";
import type { Concept, Course, CourseKnowledge, Learner, Lesson, Observation, Session } from "../src/domain/types.js";

const concept: Concept = { id: "density", name: "Density and buoyancy", summary: "Things less dense than water float.", keyFacts: ["An egg sinks in plain water."], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] };
const oceans: Concept = { id: "oceans", name: "Earth's oceans", summary: "Oceans cover 71% of the Earth.", keyFacts: ["Oceans cover 71% of the Earth."], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] };
const lesson: Lesson = { id: "l1", title: "Lesson 1: Ocean Characteristics", objectives: [], conceptIds: [oceans.id, concept.id], guidingQuestions: [], practiceItems: [], order: 0 };
const course: Course = { id: "c1", title: "Marine Biology", subject: "Science", level: "3-8", description: "", lessons: [lesson], concepts: [oceans, concept], chunks: [], sourceFiles: [], createdAt: "" };
const learner: Learner = { id: "a", name: "Andy", createdAt: "" };

const obs = (at: string, conceptId: string, kind: Observation["kind"], evidence: string, note = ""): Observation => ({ at, conceptId, kind, evidence, note });

describe("the note-taking pass reads each reply once", () => {
  it("does not add the reply when it is already the last turn, and adds it when it is not", () => {
    const transcript = [{ role: "user" as const, content: "It floats." }, { role: "assistant" as const, content: "Why does it float?" }];
    expect(withReply(transcript, "Why does it float?")).toHaveLength(2);
    expect(withReply(transcript.slice(0, 1), "Why does it float?")).toHaveLength(2);
    expect(withReply(transcript, "")).toHaveLength(2);
  });

  it("counts a fact the tutor stated once, not twice, when the reply is already saved", () => {
    const reply = "Oceans cover 71% of the Earth. What do you think lives in them?";
    const saved = [{ role: "user" as const, content: "hi", at: "" }, { role: "assistant" as const, content: reply, at: "" }];
    const told = toldFigures(oceans.keyFacts, saved, reply);
    expect(told).toHaveLength(1);
    expect(told[0].repliesAgo).toBe(1);
  });
});

describe("the speaking call hears what the notes concluded about the previous answer", () => {
  const session: Session = {
    id: "s", learnerId: "a", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", pendingDirectives: [], startedAt: "",
    transcript: [
      { role: "assistant", content: "What does the salt do?", at: "2026-10-12T18:29:08.000Z" },
      { role: "user", content: "It changes the water, making the egg lighter than the salt water.", at: "2026-10-12T18:29:56.000Z" },
      { role: "assistant", content: "And how dense is the salt water compared with the egg?", at: "2026-10-12T18:29:58.000Z" },
      { role: "user", content: "It's more dense than the egg. I already said that", at: "2026-10-12T18:30:12.000Z" },
    ],
    observations: [
      obs("2026-10-12T18:29:11.000Z", "density", "understanding", "salt water becomes more dense"),
      obs("2026-10-12T18:30:02.000Z", "density", "understanding", "making the egg lighter than the salt water", "Lighter is loose wording for less dense."),
      obs("2026-10-12T18:30:03.000Z", "density", "told", "I said the egg is denser than plain water"),
    ],
  };

  it("takes the notes filed after the last reply, on any concept, and leaves out what the tutor told them", () => {
    const notes = notesOnPreviousAnswer(session);
    expect(notes.map((o) => o.evidence)).toEqual(["making the egg lighter than the salt water"]);
  });

  it("puts them in the speaking call's final instruction, with the rule that own words count", () => {
    const ctx = { session, learner, course, lesson, concept: oceans, index: { search: () => [] }, onObservation: () => "ok", onAdvance: () => "ok" } as unknown as TutorContext;
    const speak = buildTutorContext(ctx, "speak").at(-1) ?? "";
    expect(speak).toContain("Your notes on their answer before this one");
    expect(speak).toContain("Lighter is loose wording for less dense.");
    expect(speak).toMatch(/right idea in their own words is a right answer/);
    expect(speak).toMatch(/If they say they already said it, look back/);
    const reflect = buildTutorContext(ctx, "reflect").at(-1) ?? "";
    expect(reflect).not.toContain("Your notes on their answer before this one");
    expect(reflect).toMatch(/never open or keep a thread to get the material's wording/);
    expect(reflect).not.toMatch(/"He /);
  });
});

describe("a lesson starts where it is, and does not re-teach what the student knew", () => {
  const knowledge: CourseKnowledge = {
    id: "a__c1", learnerId: "a", courseId: "c1", createdAt: "", updatedAt: "", intakeAt: "2026-10-12T18:27:18Z", priorKnowledge: [], observedGaps: [], courseGuidance: [],
    starts: [{ conceptId: "density", estimate: "can-explain", said: "less dense things float", confidence: 10, from: "probe" }],
  } as unknown as CourseKnowledge;

  it("tells the tutor a concept the student could already explain needs a new case, not teaching", () => {
    expect(startingPoint("density", knowledge)).toMatch(/Do not teach it again/);
    expect(startingPoint("density", { ...knowledge, starts: [{ ...knowledge.starts[0], estimate: "some" }] })).not.toMatch(/Do not teach it again/);
  });

  it("opens on the current concept when the intake's answers are read word for word", () => {
    const session = { id: "s", learnerId: "a", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", pendingDirectives: [], startedAt: "", transcript: [], observations: [] } as unknown as Session;
    const ctx = { session, learner, course, lesson, concept: oceans, index: { search: () => [] }, onObservation: () => "ok", onAdvance: () => "ok", intakeJustNow: "Andy: less dense things float. 10" } as unknown as TutorContext;
    const block = buildTutorContext(ctx, "speak").find((b) => b.startsWith("<asked_just_now>")) ?? "";
    expect(block).toMatch(/Open on the current concept above/);
    expect(block).toMatch(/never open on another concept/);
  });
});
