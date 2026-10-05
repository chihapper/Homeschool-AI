import { describe, expect, it } from "vitest";
import { figuresIn, isEvidence, toldFigures } from "../src/domain/told.js";

const FACTS = ["Rome's traditional founding date is 754 or 753 B.C.", "Two villages on two of the seven hills may have merged in about 753 B.C."];
const tutor = (content: string) => ({ role: "assistant" as const, content });
const learner = (content: string) => ({ role: "user" as const, content });

describe("figures in a key fact", () => {
  it("takes numbers of two or more digits, once each, without separators", () => {
    expect(figuresIn(FACTS[0])).toEqual(["754", "753"]);
    expect(figuresIn("An army of about 1,200 men marched 40 miles in 27 B.C.")).toEqual(["1200", "40", "27"]);
    expect(figuresIn("753 and again 753")).toEqual(["753"]);
  });

  it("ignores single digits and decimals", () => {
    expect(figuresIn("Rome stands on 7 hills; 2 villages merged; pi is 3.14")).toEqual([]);
  });
});

describe("what the tutor has already told the learner", () => {
  it("finds the date the tutor read out before the learner ever said it (the 2026-09-30 session)", () => {
    const transcript = [
      learner("Because there is some scholarly disagreement on it."),
      tutor("Fair enough. Your reading says it may well be that two existing villages, on two of Rome's seven hills, merged around 753 B.C. to form one town. So what do you think?"),
      learner("I don't remember."),
      tutor("Your reading gives a specific year for when this founding is traditionally said to have happened. What's that date?"),
      learner("753 BC."),
    ];
    const told = toldFigures(FACTS, transcript);
    expect(told.map((t) => t.figure)).toEqual(["753"]); // 754 was never said by anyone
    expect(told[0].turn).toBe(1);
    expect(told[0].repliesAgo).toBe(2); // the reply that asked for "that date" came after it
    expect(told[0].fact).toBe(FACTS[0]); // listed once, under the first fact that carries it
    expect(told[0].quote).toContain("merged around 753 B.C. to form one town");
    expect(told[0].quote.length).toBeLessThan(200);
  });

  it("does not count a figure the learner brought first, however often the tutor echoes it", () => {
    const transcript = [learner("I read it was founded in 753 BC."), tutor("That's it, 753 B.C., the traditional date. Why does the reading say 'traditional'?")];
    expect(toldFigures(FACTS, transcript)).toEqual([]);
  });

  it("matches whole numbers only", () => {
    expect(toldFigures(FACTS, [tutor("Much later, in 1753, a scholar doubted the story; another wrote 7530 pages on it.")])).toEqual([]);
    expect(toldFigures(["About 1,200 men"], [tutor("Roughly 1200 men, the reading says.")]).map((t) => t.figure)).toEqual(["1200"]);
  });

  it("counts the reply the learner has just heard, which the transcript does not hold yet", () => {
    const told = toldFigures(["The kings were driven out in 510 B.C."], [learner("Who ruled after the kings?")], "The reading says the Romans drove out the last king in 510 B.C. and set up a republic.");
    expect(told).toHaveLength(1);
    expect(told[0]).toMatchObject({ figure: "510", turn: 1, repliesAgo: 1 });
  });

  it("returns nothing when nobody has said the figure, and for facts without figures", () => {
    expect(toldFigures(FACTS, [learner("Romulus and Remus."), tutor("What happened to them as babies?")])).toEqual([]);
    expect(toldFigures(["The twins were raised by a she-wolf."], [tutor("They were raised by a she-wolf.")])).toEqual([]);
  });
});

describe("which observations are evidence", () => {
  it("leaves out engagement and what the tutor told", () => {
    expect(["understanding", "partial", "misconception", "gap"].every(isEvidence)).toBe(true);
    expect(isEvidence("engagement")).toBe(false);
    expect(isEvidence("told")).toBe(false);
  });
});
