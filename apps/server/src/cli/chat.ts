/**
 * Text-mode tutoring session in the terminal (no Hume needed). Good for tuning skills.
 *
 *   npm run chat -- --learner "Maya" --course <courseId> [--lesson <lessonId>] [--skip-intake] [--narration-first]
 *   npm run chat -- --learner-id <id> --course <courseId>
 */
import readline from "node:readline/promises";
import { stdin, stdout } from "node:process";
import { createSession, endSession, latencySummary, respond } from "../orchestrator/session.js";
import { learners, courses } from "../store/index.js";
import { requireAnthropicKey } from "../config.js";

async function main(): Promise<void> {
  requireAnthropicKey();
  const args = process.argv.slice(2);
  const opt = (name: string): string | undefined => {
    const i = args.indexOf(name);
    return i >= 0 ? args[i + 1] : undefined;
  };
  let learnerId = opt("--learner-id");
  if (!learnerId) {
    const name = opt("--learner") ?? "Student";
    const existing = learners.list().find((l) => l.name === name);
    learnerId = existing?.id ?? learners.put({ id: learners.newId(), name, gradeLevel: opt("--grade"), createdAt: new Date().toISOString() }).id;
  }
  let courseId = opt("--course");
  if (!courseId) {
    const all = courses.list();
    if (!all.length) {
      console.error("No courses yet. Run `npm run ingest -- <file>` first.");
      process.exit(1);
    }
    courseId = all[0].id;
    console.log(`Using course: ${all[0].title} (${courseId})`);
  }
  const session = createSession({ learnerId, courseId, lessonId: opt("--lesson"), skipIntake: args.includes("--skip-intake"), narrationFirst: args.includes("--narration-first") });
  console.log(`Session ${session.id} · phase=${session.phase}. Type /end to finish, /state to inspect.\n`);

  const rl = readline.createInterface({ input: stdin, output: stdout });
  let userText = ""; // agent speaks first
  for (;;) {
    stdout.write("Tutor: ");
    const gen = respond(session.id, userText);
    let r = await gen.next();
    while (!r.done) {
      stdout.write(r.value);
      r = await gen.next();
    }
    await r.value.reflection?.catch(() => {}); // the tutor's notes, taken after the words are out
    const last = r.value.session.transcript.at(-1)?.latency;
    stdout.write(`\n   [phase=${r.value.session.phase} concept=${r.value.session.conceptIndex + 1} obs=${r.value.session.observations.length}${last ? ` ttft=${last.ttftMs}ms total=${last.totalMs}ms cache=${last.cacheReadTokens}/${last.cacheReadTokens + last.cacheWriteTokens + last.inputTokens}` : ""}]\n\n`);
    if (r.value.session.phase === "complete") break;
    userText = (await rl.question("You: ")).trim();
    if (userText === "/end") break;
    if (userText === "/state") {
      console.log(JSON.stringify({ ...r.value.session, transcript: undefined }, null, 2));
      userText = "";
      continue;
    }
  }
  rl.close();
  console.log("\nLatency:", JSON.stringify(latencySummary(session.id ? (await import("../store/index.js")).sessions.require(session.id) : session)));
  console.log("\nAssessing session...");
  const { report } = await endSession(session.id);
  if (report) {
    console.log(`\nParent summary:\n${report.parentSummary}\n`);
    for (const c of report.concepts) console.log(`  ${c.conceptId}: level ${c.level} — ${c.nextStep}`);
    if (report.ungroundedClaims.length) console.log(`\nUngrounded tutor claims:\n${report.ungroundedClaims.map((u) => `  - ${u}`).join("\n")}`);
    console.log(`\nFull report saved for session ${session.id}.`);
  }
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
