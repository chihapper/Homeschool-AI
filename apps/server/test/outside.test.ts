import { describe, expect, it } from "vitest";
import {
  aboutFaith,
  applyCheckResult,
  followUpFor,
  materialDiffers,
  MAX_CHECKS_PER_SESSION,
  mergeFinishedChecks,
  recordOutsideClaim,
  sameClaim,
  SAY_FIRST,
  settleChecks,
  spokenFollowUps,
  startCheck,
  type FlagInput,
} from "../src/orchestrator/outside.js";
import type { OutsideClaim, Session } from "../src/domain/types.js";

function session(over: Partial<Session> = {}): Session {
  return { id: `s-${Math.random()}`, learnerId: "x", courseId: "c1", lessonId: "l1", conceptIndex: 0, phase: "teach", transcript: [], observations: [], pendingDirectives: [], startedAt: "", ...over };
}
const flag = (over: Partial<FlagInput> = {}): FlagInput => ({ claim: "Aphrodite rescued Aeneas during the Trojan War.", raisedBy: "learner", tutorStance: "confirmed", query: "Aeneas", materialSays: "", ...over });

describe("recording a fact from outside the material", () => {
  it("records it for the parent and asks for a check when the setting is answer and check", () => {
    const s = session();
    const r = recordOutsideClaim(s, flag(), { mode: "check", checksAvailable: true, id: "c1", at: "t" });
    expect(r.check).toBe(true);
    expect(r.message).toMatch(/checked against an encyclopedia in the background/);
    expect(s.outsideClaims).toEqual([{ id: "c1", at: "t", claim: "Aphrodite rescued Aeneas during the Trojan War.", raisedBy: "learner", tutorStance: "confirmed", query: "Aeneas", status: "pending" }]);
  });

  it("records it without a check in the other settings, or without a Wikipedia contact, and says why", () => {
    for (const [mode, available, why] of [
      ["answer", true, /Checks are off/],
      ["material-only", true, /Material only/],
      ["check", false, /WIKIPEDIA_CONTACT/],
    ] as const) {
      const s = session();
      const r = recordOutsideClaim(s, flag(), { mode, checksAvailable: available });
      expect(r.check).toBe(false);
      expect(s.outsideClaims?.[0]).toMatchObject({ status: "not-checked", statusNote: expect.stringMatching(why) });
    }
  });

  it("does not record the same fact twice, refuses an empty one, and keeps what the material says", () => {
    const s = session();
    recordOutsideClaim(s, flag({ materialSays: "  The reading says Venus.  " }), { mode: "check", checksAvailable: true });
    expect(s.outsideClaims?.[0].materialSays).toBe("The reading says Venus.");
    expect(recordOutsideClaim(s, flag({ claim: "aphrodite rescued Aeneas during the Trojan War" }), { mode: "check", checksAvailable: true }).message).toMatch(/Already flagged/);
    expect(recordOutsideClaim(s, flag({ claim: "   " }), { mode: "check", checksAvailable: true }).message).toMatch(/^Refused/);
    expect(s.outsideClaims).toHaveLength(1);
    expect(sameClaim("Julius Caesar was the first emperor.", "Julius Caesar was the first emperor of Rome")).toBe(true);
    expect(sameClaim("Caesar was first.", "Augustus was first.")).toBe(false);
  });

  it("treats a reworded fact as the same one, but not a different number (seen live: every fact was flagged twice)", () => {
    const pairs: Array<[string, string]> = [
      ["The Trojans stayed with Queen Dido in Carthage for exactly seven years.", "The Trojan refugees stayed with Queen Dido in Carthage for exactly seven years."],
      ["Pompey captured Jerusalem in 63 B.C., bringing Judea under Roman rule.", "Pompey captured Jerusalem and Rome took control of Judea in 63 B.C."],
      ["Constantine the Great began his reign as emperor in 306 A.D., when his troops proclaimed him emperor in Britain, rather than 312 A.D.", "Constantine became emperor in 306 A.D. rather than 312 A.D."],
    ];
    for (const [a, b] of pairs) expect(sameClaim(a, b)).toBe(true);
    expect(sameClaim("Constantine became emperor in 306.", "Constantine became emperor in 312.")).toBe(false);
    expect(sameClaim("Aphrodite rescued Aeneas during the Trojan War.", "The Trojans stayed with Queen Dido in Carthage.")).toBe(false);
  });

  it("never sends faith or scripture to an encyclopedia, however it is worded, but still records it for the parent", () => {
    // Seen live 2026-09-25: a student's challenge to Luke's census came back from Wikipedia as "Luke is in error".
    expect(aboutFaith("Some historians dispute that the census described in Luke 2:1-5 occurred exactly as recorded.")).toBe(true);
    expect(aboutFaith("God prepared the Empire so Jesus could be born in it.")).toBe(true);
    expect(aboutFaith("The Bible says the census was ordered by Caesar Augustus.")).toBe(true);
    for (const plain of ["Constantine became emperor in 306.", "Aphrodite, the goddess of love, rescued Aeneas.", "Mark Antony allied with Cleopatra.", "Christians were persecuted under Nero.", "The sine of 30 degrees is one half."]) {
      expect(aboutFaith(plain)).toBe(false);
    }
    const s = session();
    const r = recordOutsideClaim(s, flag({ claim: "Some historians dispute that the census in Luke happened as recorded.", tutorStance: "deferred" }), { mode: "check", checksAvailable: true });
    expect(r.check).toBe(false);
    expect(s.outsideClaims?.[0]).toMatchObject({ status: "not-checked", statusNote: expect.stringMatching(/faith or scripture/) });
  });

  it("keeps what the material says only when it tells the point differently, not when it is silent", () => {
    expect(materialDiffers("Palestine came under the rule of the Romans in 64 B.C.")).toBe("Palestine came under the rule of the Romans in 64 B.C.");
    expect(materialDiffers("The material only states that Romulus and Remus were descendants of Aeneas; it does not mention Aphrodite.")).toBeUndefined();
    expect(materialDiffers("The material uses the census of Luke 2:1-5 without addressing historical debate about it.")).toBeUndefined();
    expect(materialDiffers("The material doesn't cover how long they stayed.")).toBeUndefined();
    expect(materialDiffers("   ")).toBeUndefined();
  });

  it("stops checking after the session's limit, still recording", () => {
    const s = session();
    for (let i = 0; i < MAX_CHECKS_PER_SESSION; i++) expect(recordOutsideClaim(s, flag({ claim: `Fact number ${i} about Rome` }), { mode: "check", checksAvailable: true }).check).toBe(true);
    const over = recordOutsideClaim(s, flag({ claim: "One fact too many" }), { mode: "check", checksAvailable: true });
    expect(over.check).toBe(false);
    expect(over.claim?.statusNote).toMatch(/limit of 8 checks/);
  });
});

describe("coming back to it", () => {
  const checked = (over: Partial<OutsideClaim>): OutsideClaim => ({
    id: "c", at: "", claim: "Aphrodite rescued Aeneas during the Trojan War.", raisedBy: "learner", tutorStance: "unsure", query: "Aeneas",
    status: "checked", verdict: "supported", explanation: "In the Iliad, Aphrodite carries him out of the fight.", source: { title: "Aeneas", url: "u" }, ...over,
  });

  it("follows up when the tutor was not sure, whatever the check found", () => {
    expect(followUpFor(checked({}))).toMatch(/^Keep your word first: earlier you told the learner you were not sure whether Aphrodite rescued Aeneas during the Trojan War\. You have since looked it up \(Wikipedia, "Aeneas"\), and it is right\./);
    expect(followUpFor(checked({}))).toMatch(/Open this reply with it in one plain sentence/);
    expect(followUpFor(checked({ verdict: "contradicted" }))).toMatch(/and it is not right\./);
    expect(followUpFor(checked({ verdict: "complicated" }))).toMatch(/Open this reply with the short version, at the learner's level/);
  });

  it("keeps the tutor's word even when the check finds nothing, or the reading tells it differently", () => {
    // Live 2026-09-25: "I'll look into it" about Dido, then silence, because the check found nothing definite.
    expect(followUpFor(checked({ verdict: "not-found" }))).toMatch(/and it did not settle it\. Open this reply by saying so .*couldn't find a clear answer/);
    const differs = followUpFor(checked({ claim: "Constantine became emperor in 306.", verdict: "complicated", materialSays: "Constantine ruled 312-337 A.D." }));
    expect(differs).toMatch(/Their reading says: "Constantine ruled 312-337 A\.D\."\. Open this reply with it .*what their reading says first/);
    expect(differs).toMatch(/Never say the reading is wrong, and do not explain the difference away/);
  });

  it("corrects the tutor when the check contradicts it, and credits the learner the tutor wrongly corrected", () => {
    expect(followUpFor(checked({ tutorStance: "confirmed", verdict: "contradicted" }))).toMatch(/^Correct yourself first: earlier you said that Aphrodite .* That is not right .* Open this reply with the correction/);
    expect(followUpFor(checked({ tutorStance: "corrected", verdict: "supported" }))).toMatch(/They were right .* giving them the credit/);
    expect(followUpFor(checked({ raisedBy: "tutor", tutorStance: "deferred", verdict: "contradicted" }))).toMatch(/^Correct yourself first/);
  });

  it("says nothing when the tutor was right, the check found nothing, or the material tells it differently", () => {
    expect(followUpFor(checked({ tutorStance: "confirmed" }))).toBeUndefined();
    expect(followUpFor(checked({ tutorStance: "corrected", verdict: "contradicted" }))).toBeUndefined();
    expect(followUpFor(checked({ tutorStance: "confirmed", verdict: "not-found" }))).toBeUndefined();
    expect(followUpFor(checked({ status: "failed", verdict: undefined }))).toBeUndefined();
    // In the session the material wins; the difference is the parent's to see in the report.
    expect(followUpFor(checked({ tutorStance: "confirmed", verdict: "contradicted", materialSays: "Your reading gives 64 B.C." }))).toBeUndefined();
  });

  it("fills in the claim and queues the follow-up for the next turn, but not once the session is over", () => {
    const s = session();
    recordOutsideClaim(s, flag({ tutorStance: "unsure" }), { mode: "check", checksAvailable: true, id: "c1" });
    const say = applyCheckResult(s, { claimId: "c1", at: "t", status: "checked", verdict: "supported", explanation: "The Iliad tells it.", source: { title: "Aeneas", url: "u" } });
    expect(say).toMatch(/^Keep your word first/);
    expect(s.pendingDirectives).toEqual([say]);
    expect(s.outsideClaims?.[0]).toMatchObject({ status: "checked", verdict: "supported", checkedAt: "t", followUp: say });

    // With the sentence the check wrote, that sentence is queued to be spoken first, word for word.
    const t = session();
    recordOutsideClaim(t, flag({ tutorStance: "unsure" }), { mode: "check", checksAvailable: true, id: "c3" });
    const line = "I looked that up: you were right, Aphrodite carries him out of the fight.";
    expect(applyCheckResult(t, { claimId: "c3", at: "t", status: "checked", verdict: "supported", sayToLearner: line })).toBe(`${SAY_FIRST}${line}`);
    expect(spokenFollowUps(t.pendingDirectives)).toEqual([line]);
    expect(t.outsideClaims?.[0].followUp).toBe(line);
    // A sentence is not spoken when nothing is owed: the tutor agreed, and the check agrees.
    const u = session();
    recordOutsideClaim(u, flag({ tutorStance: "confirmed" }), { mode: "check", checksAvailable: true, id: "c4" });
    expect(applyCheckResult(u, { claimId: "c4", at: "t", status: "checked", verdict: "supported", sayToLearner: line })).toBeUndefined();
    expect(u.pendingDirectives).toEqual([]);

    const done = session({ phase: "complete" });
    recordOutsideClaim(done, flag({ tutorStance: "unsure" }), { mode: "check", checksAvailable: true, id: "c2" });
    expect(applyCheckResult(done, { claimId: "c2", at: "t", status: "checked", verdict: "supported" })).toBeUndefined();
    expect(done.pendingDirectives).toEqual([]);
    expect(done.outsideClaims?.[0].verdict).toBe("supported");
  });
});

describe("checks in the background", () => {
  it("keeps finished checks until the next turn merges them, and turns a failure into a readable note", async () => {
    const s = session();
    recordOutsideClaim(s, flag({ tutorStance: "unsure" }), { mode: "check", checksAvailable: true, id: "a" });
    recordOutsideClaim(s, flag({ claim: "Rome had a million people." }), { mode: "check", checksAvailable: true, id: "b" });
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    void startCheck(s.id, "a", async () => {
      await gate;
      return { status: "checked", verdict: "supported", source: { title: "Aeneas", url: "u" } };
    });
    void startCheck(s.id, "b", async () => {
      throw new Error("Wikipedia asked us to slow down");
    });
    await new Promise((r) => setTimeout(r, 5));
    expect(mergeFinishedChecks(s)).toEqual([]); // only b has finished, and it asks for no follow-up
    expect(s.outsideClaims?.[1]).toMatchObject({ status: "failed", statusNote: "The check could not run: Wikipedia asked us to slow down" });
    expect(s.outsideClaims?.[0].status).toBe("pending");

    release();
    await settleChecks(s.id, 1000);
    const said = mergeFinishedChecks(s);
    expect(said).toHaveLength(1);
    expect(s.pendingDirectives).toEqual(said);
    expect(mergeFinishedChecks(s)).toEqual([]); // merged once
  });

  it("stops waiting for a slow check after the limit", async () => {
    const s = session();
    void startCheck(s.id, "slow", () => new Promise(() => {}));
    const t0 = Date.now();
    await settleChecks(s.id, 30);
    expect(Date.now() - t0).toBeLessThan(1000);
  });
});
