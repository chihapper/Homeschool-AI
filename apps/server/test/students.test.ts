import { describe, expect, it } from "vitest";
import { nameKey, studentNamed } from "../src/domain/students.js";

describe("one record per child", () => {
  it("finds a student by name whatever the case and spacing, and a blank name matches nobody", () => {
    const list = [{ id: "a", name: "Andy" }, { id: "s", name: "Sam Lee" }];
    expect(studentNamed(list, "andy")?.id).toBe("a");
    expect(studentNamed(list, "  ANDY ")?.id).toBe("a");
    expect(studentNamed(list, "sam   lee")?.id).toBe("s");
    expect(studentNamed(list, "Andrew")).toBeUndefined();
    expect(studentNamed(list, "   ")).toBeUndefined();
    expect(nameKey(" Maya  Rose ")).toBe("maya rose");
  });
});
