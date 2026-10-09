/**
 * Assess one saved session with several report models and compare the reports, apples to apples: the same
 * transcript, course material and records go to each run, nothing is saved to the app, and the user's
 * settings are untouched (the runs use a disposable settings file). This is how the report model was chosen
 * on 2026-10-08 and 09 (docs/COST.md).
 *
 *   npm run assess:compare -- <sessionIdPrefix> <label=model@effort> [...]
 *   npm run assess:compare -- 7e285a2c sonnet=claude-sonnet-5-5@high sol=gpt-6.1-sol@medium
 *
 * Real model calls: $0.10 to $0.40 a run depending on the model and the course. The reports are written to
 * data/experiments/assessor/<session>-<label>.json; the console gets the levels, the counts, the summaries and
 * each run's time, time to first word, tokens (reasoning tokens where the vendor reports them) and cost.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { config, updateSettings, useSettingsFile } from "../src/config.js";
import { assessSession, type AssessUsage } from "../src/agents/assessor-agent.js";
import type { MasteryReport } from "../src/domain/types.js";
import { courses, knowledgeFor, learners, reports, sessions } from "../src/store/index.js";

// Before any run: settings go to a disposable file, so the user's data/settings.json is never written.
useSettingsFile(path.join(fs.mkdtempSync(path.join(os.tmpdir(), "hsai-assess-")), "settings.json"));

/** List prices per million tokens: input, output, cache read, cache write (5 minutes). Checked 2026-10-08. */
const PRICE: Record<string, [number, number, number, number]> = {
  "claude-opus-5-5": [4, 20, 0.2, 5],
  "claude-sonnet-5-5": [2, 10, 0.1, 2.5],
  "claude-haiku-5-5": [0.1, 0.5, 0.01, 0.125],
  "gpt-6.1-sol": [2, 10, 0.1, 2.5],
  "gpt-6-luna": [0.1, 0.5, 0.01, 0.125],
};

type Usage = AssessUsage & { reasoning_tokens?: number; first_delta_ms?: number };

async function main(): Promise<void> {
  const [prefix, ...runs] = process.argv.slice(2);
  if (!prefix || !runs.length) {
    console.error("Usage: npm run assess:compare -- <sessionIdPrefix> <label=model@effort> [...]");
    process.exit(2);
  }
  const session = sessions.list().find((s) => s.id.startsWith(prefix));
  if (!session) throw new Error(`No session starts with ${prefix}`);
  const learner = learners.require(session.learnerId);
  if (!session.courseId || !session.lessonId) throw new Error("That session has no course or lesson (an intake?); pick a lesson session.");
  const course = courses.require(session.courseId);
  const lesson = course.lessons.find((l) => l.id === session.lessonId);
  if (!lesson) throw new Error(`Lesson ${session.lessonId} is no longer in the course.`);
  const knowledge = knowledgeFor(learner.id, course.id);
  const saved = reports.get(session.id);
  console.log(`${learner.name} on "${course.title}", lesson "${lesson.title}", ${session.transcript.length} turns, ${session.observations.length} observations; saved report from ${saved?.createdAt ?? "none"}`);

  const outDir = path.join(config.dataDir, "experiments", "assessor");
  fs.mkdirSync(outDir, { recursive: true });
  const results: Array<{ label: string; report: MasteryReport }> = [];
  for (const run of runs) {
    const [label, spec] = run.split("=");
    const [model, effort] = (spec ?? "").split("@");
    if (!label || !model || !effort) throw new Error(`Each run is label=model@effort, not "${run}"`);
    updateSettings({ assessorModel: model, analysisEffort: effort });
    let usage: Usage = { input_tokens: 0, output_tokens: 0 };
    const t0 = performance.now();
    try {
      const report = await assessSession({ session, learner, course, lesson, knowledge, onUsage: (u) => { usage = u as Usage; } });
      const seconds = Math.round((performance.now() - t0) / 100) / 10;
      const [pin, pout, pread, pwrite] = PRICE[model] ?? [0, 0, 0, 0];
      const cost = (usage.input_tokens * pin + usage.output_tokens * pout + (usage.cache_read_input_tokens ?? 0) * pread + (usage.cache_creation_input_tokens ?? 0) * pwrite) / 1e6;
      results.push({ label, report });
      fs.writeFileSync(path.join(outDir, `${session.id.slice(0, 8)}-${label}.json`), JSON.stringify(report, null, 2));
      console.log(
        `\n== ${label} (${model} @ ${effort}): ${seconds} s (first text after ${usage.first_delta_ms ?? "?"} ms), in ${usage.input_tokens} + cache ${usage.cache_read_input_tokens ?? 0} read / ${usage.cache_creation_input_tokens ?? 0} written, out ${usage.output_tokens} tokens${usage.reasoning_tokens ? ` (${usage.reasoning_tokens} reasoning)` : ""}, about $${cost.toFixed(3)}${PRICE[model] ? "" : " (no price on file)"}`,
      );
    } catch (err) {
      console.log(`\n== ${label} FAILED after ${Math.round((performance.now() - t0) / 1000)} s: ${err instanceof Error ? err.message : String(err)}`);
    }
  }

  const all = [...(saved ? [{ label: "saved", report: saved }] : []), ...results];
  if (!all.length) return;
  console.log("\n=== levels per concept (0 no evidence, 1 recalls, 2 explains, 3 applies, 4 extends)");
  console.log(["concept", ...all.map((a) => a.label)].join(" | "));
  for (const c of all[0].report.concepts) console.log([c.conceptId, ...all.map((a) => String(a.report.concepts.find((x) => x.conceptId === c.conceptId)?.level ?? "-"))].join(" | "));
  console.log("\n=== counts");
  for (const a of all) {
    const r = a.report;
    console.log(`${a.label}: misconceptions ${r.concepts.reduce((n, c) => n + c.misconceptions.length, 0)}, evidence quotes ${r.concepts.reduce((n, c) => n + c.evidence.length, 0)}, ungrounded claims ${r.ungroundedClaims.length}, answer-seeking turns ${r.answerSeekingTurns}, giveaways ${r.tutorAnswerGiveaways}, recommended next ${r.recommendedNext.length}, parent summary ${r.parentSummary.split(/\s+/).length} words`);
  }
  for (const a of all) {
    const r = a.report;
    console.log(`\n=== ${a.label}: parent summary\n${r.parentSummary}`);
    for (const c of r.concepts) if (c.level > 0 || c.misconceptions.length) console.log(`  - ${c.conceptId} (level ${c.level}): ${c.misconceptions.length ? `misconceptions: ${c.misconceptions.join(" / ")} · ` : ""}next: ${c.nextStep}`);
    console.log(`  ungrounded: ${r.ungroundedClaims.join(" / ") || "none"}`);
    console.log(`  recommended next: ${r.recommendedNext.join(" / ")}`);
  }
  console.log(`\nreports written to ${outDir}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
