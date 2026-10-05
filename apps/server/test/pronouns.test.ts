import { describe, expect, it } from "vitest";
import { genderedSentences, licensedBy, outsideQuotes } from "../src/agents/pronouns.js";

describe("a record must not give a child a gender nobody stated", () => {
  it("finds the sentences that use he or she in the record's own voice (the 2026-10-05 runs)", () => {
    const guidance = "Maya volunteers confidence numbers, and they matched her answers: keep asking for them.";
    const summary = "Before starting Ancient Rome, Eli knew that the Romans had soldiers. He did not yet know about Rome's early kings. Nothing was mixed up.";
    expect(genderedSentences([guidance, summary])).toEqual([guidance, "He did not yet know about Rome's early kings."]);
  });

  it("leaves they and the name alone", () => {
    expect(genderedSentences(["Eli rated their confidence 3 out of 10, which fit a guess. Eli hangs out with their dog."])).toEqual([]);
    expect(genderedSentences(["The answer was right; there is nothing here."])).toEqual([]);
  });

  it("ignores pronouns inside the student's quoted words, in any quote style", () => {
    expect(outsideQuotes(`Sam said "my grandpa says his corn needs it" and 'he told me so' and “she knows”.`)).not.toMatch(/\b(his|he|she)\b/);
    expect(genderedSentences([`Sources this from family: 'my grandpa has a farm and he says the soil feeds the corn'.`])).toEqual([]);
    // An apostrophe is not a quotation mark: the pronoun after "Maya's" is still seen.
    expect(genderedSentences(["Maya's retelling was close to word for word, so ask her to use new words."])).toHaveLength(1);
  });

  it("flags a pronoun for someone else too, for the rewording pass to leave alone", () => {
    // Broad on purpose: telling Caesar from the student is the second pass's job, and a needless look is cheap.
    expect(genderedSentences(["Says Julius Caesar founded Rome and named it after himself."])).toHaveLength(1);
  });

  it("lets the records use a pronoun the parent used in their notes, and only that one", () => {
    expect([...licensedBy("He shuts down if rushed. Give him time.")]).toEqual(["he"]);
    expect([...licensedBy(undefined)]).toEqual([]);
    const he = licensedBy("He shuts down if rushed.");
    expect(genderedSentences(["He did not yet know about the kings."], he)).toEqual([]);
    expect(genderedSentences(["She did not yet know about the kings."], he)).toHaveLength(1);
  });
});
