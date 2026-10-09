/**
 * Run the profile pass on one saved session and its report with several models, and compare what each would
 * change on the two records, apples to apples: the same records, transcript and report go to each run, nothing
 * is saved (the revision is applied in memory only), and the user's settings are untouched.
 *
 *   npm run profile:compare -- <sessionIdPrefix> <label=model@effort> [...]
 *   npm run profile:compare -- 7e285a2c opus=claude-opus-5-5@high sonnet=claude-sonnet-5-5@high
 *
 * Real model calls: about $0.05 to $0.15 a run. The proposals are written to data/experiments/profile/.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, updateSettings, useSettingsFile } from "../src/config.js";
import { proposeRevision, type ProposeUsage } from "../src/agents/profile-agent.js";
import { applyRevision } from "../src/domain/profile.js";
import type { ProfileChange } from "../src/domain/types.js";
import { courses, knowledgeFor, learners, reports, sessions } from "../src/store/index.js";

useSettingsFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hsai-profile-")), "settings.json"));

/** List prices per million tokens: input, output, cache read, cache write (5 minutes). Checked 2026-10-08. */
const PRICE: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
};

const describe = (c: ProfileChange): string => (c.from && c.to ? `${c.from} -> ${c.to}` : c.to ? `added "${c.to}"` : `removed "${c.from}"`);

async function main(): Promise<void> {
  const [prefix, ...runs] = process.argv.slice(2);
  if (!prefix || !runs.length) {
    console.error("Usage: npm run profile:compare -- <sessionIdPrefix> <label=model@effort> [...]");
    process.exit(2);
  }
  const session = sessions.list().find((s) => s.id.startsWith(prefix));
  if (!session) throw new Error(`No session starts with ${prefix}`);
  const report = reports.get(session.id);
  if (!report) throw new Error("That session has no report; the profile pass runs after one.");
  const learner = learners.require(session.learnerId);
  if (!learner.profile) throw new Error(`${learner.name} has no profile to revise.`);
  if (!session.courseId) throw new Error("That session has no course.");
  const course = courses.require(session.courseId);
  const knowledge = knowledgeFor(learner.id, course.id);
  // The same three earlier reports the live pass would see.
  const priorReports = reports
    .list()
    .filter((r) => r.learnerId === learner.id && r.sessionId !== session.id && r.createdAt < report.createdAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .slice(-3)
    .map((r) => ({ report: r, course: r.courseId ? courses.get(r.courseId) : undefined }));
  console.log(`${learner.name} on "${course.title}", ${session.transcript.length} turns, report of ${report.createdAt.slice(0, 10)}, ${priorReports.length} earlier reports in view`);

  const outDir = path.join(config.dataDir, "experiments", "profile");
  fs.mkdirSync(outDir, { recursive: true });
  for (const run of runs) {
    const [label, spec] = run.split("=");
    const [model, effort] = (spec ?? "").split("@");
    if (!label || !model || !effort) throw new Error(`Each run is label=model@effort, not "${run}"`);
    updateSettings({ model, analysisEffort: effort });
    let usage: ProposeUsage = { input_tokens: 0, output_tokens: 0 };
    const t0 = performance.now();
    try {
      const revision = await proposeRevision({ learner, course, session, report, knowledge, priorReports }, (u) => { usage = u; });
      const seconds = Math.round((performance.now() - t0) / 100) / 10;
      const [pin, pout, pread, pwrite] = PRICE[model] ?? [0, 0, 0, 0];
      const cost = (usage.input_tokens * pin + usage.output_tokens * pout + (usage.cache_read_input_tokens ?? 0) * pread + (usage.cache_creation_input_tokens ?? 0) * pwrite) / 1e6;
      // What would land and what would be held, against the records as they stand now.
      const notes = knowledge ? { priorKnowledge: knowledge.priorKnowledge, observedGaps: knowledge.observedGaps, guidance: knowledge.guidance } : undefined;
      const { update } = applyRevision(learner, revision, { sessionId: session.id, courseId: course.id, courseTitle: course.title, at: new Date().toISOString() }, notes);
      fs.writeFileSync(path.join(outDir, `${session.id.slice(0, 8)}-${label}.json`), JSON.stringify({ revision, update }, null, 2));
      console.log(`\n== ${label} (${model} @ ${effort}): ${seconds} s, in ${usage.input_tokens} + cache ${usage.cache_read_input_tokens ?? 0} read / ${usage.cache_creation_input_tokens ?? 0} written, out ${usage.output_tokens} tokens, about $${cost.toFixed(3)}`);
      console.log(`summary for the parent: ${revision.summary}`);
      if (!update) {
        console.log("nothing would change on either record");
        continue;
      }
      console.log(`would land: ${update.changes.length} change(s); held for another session: ${update.held.length}`);
      const byField = new Map<string, ProfileChange[]>();
      for (const c of update.changes) byField.set(c.field, [...(byField.get(c.field) ?? []), c]);
      for (const [field, items] of byField) {
        console.log(`  ${field} (${items.find((c) => c.why)?.why ?? "no reason given"})`);
        for (const c of items) console.log(`    - ${describe(c)}`);
      }
      for (const c of update.held) console.log(`  held: ${c.field}: ${describe(c)}`);
    } catch (err) {
      console.log(`\n== ${label} FAILED after ${Math.round((performance.now() - t0) / 1000)} s: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
  console.log(`\nproposals written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
