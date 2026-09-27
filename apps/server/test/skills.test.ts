import { describe, expect, it } from "vitest";
import path from "node:path";
import { listSkills, parseSkillFile, renderSkills } from "../src/skills/loader.js";

const skillsDir = path.resolve(__dirname, "..", "..", "..", "skills");

describe("skills", () => {
  it("parses frontmatter", () => {
    expect(parseSkillFile("---\nname: x\ndescription: y\n---\nbody here", "fallback")).toEqual({ name: "x", description: "y", body: "body here" });
    expect(parseSkillFile("no frontmatter", "fb").name).toBe("fb");
  });

  it("loads every skill the agents reference", () => {
    const names = listSkills(skillsDir).map((s) => s.name).sort();
    expect(names).toEqual(["curriculum-parsing", "grounding", "initial-assessment", "learner-adaptation", "mastery-assessment", "profile-update", "reference-check", "socratic-method", "voice-conversation"]);
    const rendered = renderSkills(["socratic-method", "voice-conversation"], skillsDir);
    expect(rendered).toContain('<skill name="socratic-method">');
    expect(rendered.indexOf("socratic-method")).toBeLessThan(rendered.indexOf("voice-conversation"));
  });
});
