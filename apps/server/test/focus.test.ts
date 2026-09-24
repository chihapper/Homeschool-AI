import { describe, expect, it } from "vitest";
import { effectiveConceptIds, effectiveLessons, isConceptKept, isLessonKept, orderedLessons, sanitizeFocus, walkedConceptIds } from "../src/domain/focus.js";
import { CourseSchema, type Course, type CourseFocus, type Lesson, type Session } from "../src/domain/types.js";

const lesson = (id: string, conceptIds: string[], order: number): Lesson => ({ id, title: id.toUpperCase(), objectives: [], conceptIds, guidingQuestions: [], practiceItems: [], order });
const base: Course = {
  id: "c1", title: "Rome", subject: "History", level: "7", description: "", chunks: [], sourceFiles: [], createdAt: "",
  lessons: [lesson("food", ["diet", "dining"], 0), lesson("clothing", ["toga"], 1), lesson("government", ["senate", "consuls"], 2)],
  concepts: ["diet", "dining", "toga", "senate", "consuls"].map((id) => ({ id, name: id, summary: "", keyFacts: [], commonMisconceptions: [], sourceChunkIds: [], prerequisites: [] })),
};
const withFocus = (focus: CourseFocus): Course => ({ ...base, focus });
const session = (over: Partial<Session> = {}): Session => ({ id: "s", learnerId: "l", courseId: "c1", lessonId: "food", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "", ...over });

describe("focus: the parent decides what gets taught", () => {
  it("teaches everything when no focus was ever set, including courses saved before the field existed", () => {
    const parsed = CourseSchema.parse(JSON.parse(JSON.stringify(base)));
    expect(parsed.focus).toBeUndefined();
    expect(effectiveLessons(parsed).map((l) => l.id)).toEqual(["food", "clothing", "government"]);
    expect(effectiveConceptIds(parsed, parsed.lessons[0])).toEqual(["diet", "dining"]);
    expect(isLessonKept(parsed, "food")).toBe(true);
  });

  it("drops skipped concepts from a lesson and everything from a skipped lesson", () => {
    const course = withFocus({ skippedLessonIds: ["clothing"], skippedConceptIds: ["dining"] });
    expect(effectiveConceptIds(course, course.lessons[0])).toEqual(["diet"]);
    expect(effectiveConceptIds(course, course.lessons[1])).toEqual([]);
    expect(isLessonKept(course, "clothing")).toBe(false);
  });

  it("removes a lesson from the startable list once all its concepts are skipped, even if the lesson itself is not", () => {
    const course = withFocus({ skippedLessonIds: [], skippedConceptIds: ["toga"] });
    expect(effectiveLessons(course).map((l) => l.id)).toEqual(["food", "government"]);
  });

  it("orders lessons the parent's way, with unlisted lessons after in ingested order", () => {
    const course = withFocus({ skippedLessonIds: [], skippedConceptIds: [], lessonOrder: ["government"] });
    expect(orderedLessons(course).map((l) => l.id)).toEqual(["government", "food", "clothing"]);
    // Ingested order is by `order`, not array position.
    const shuffled: Course = { ...base, lessons: [base.lessons[2], base.lessons[0], base.lessons[1]] };
    expect(orderedLessons(shuffled).map((l) => l.id)).toEqual(["food", "clothing", "government"]);
  });

  it("knows whether a concept is still taught anywhere, so spaced retrieval stays off skipped material", () => {
    const course = withFocus({ skippedLessonIds: ["clothing"], skippedConceptIds: ["consuls"] });
    expect(isConceptKept(course, "diet")).toBe(true);
    expect(isConceptKept(course, "toga")).toBe(false); // only reachable through the skipped lesson
    expect(isConceptKept(course, "consuls")).toBe(false);
  });

  it("walks the session's frozen list when it has one, and a live filter for sessions that predate it", () => {
    const course = withFocus({ skippedLessonIds: [], skippedConceptIds: ["dining"] });
    expect(walkedConceptIds(session({ conceptIds: ["diet", "dining"] }), course, course.lessons[0])).toEqual(["diet", "dining"]); // frozen before the skip
    expect(walkedConceptIds(session(), course, course.lessons[0])).toEqual(["diet"]);
  });

  it("sanitizes a focus against the course: unknown ids and duplicates go, an empty order is dropped", () => {
    const dirty: CourseFocus = { skippedLessonIds: ["food", "nope", "food"], skippedConceptIds: ["toga", "ghost"], lessonOrder: ["ghost"] };
    expect(sanitizeFocus(base, dirty)).toEqual({ skippedLessonIds: ["food"], skippedConceptIds: ["toga"] });
    expect(sanitizeFocus(base, { skippedLessonIds: [], skippedConceptIds: [], lessonOrder: ["clothing", "clothing", "food"] })).toEqual({ skippedLessonIds: [], skippedConceptIds: [], lessonOrder: ["clothing", "food"] });
  });
});
