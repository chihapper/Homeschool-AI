/**
 * Local readiness check: what is installed, what is configured, and what each stage of testing needs.
 *
 *   npm run doctor            # checks only
 *   npm run doctor -- --ping  # also makes one tiny Claude API call to confirm the key works
 *
 * The same checks back the Settings tab of the web app (GET /api/doctor).
 */
import { checkReadiness, type ReadinessStatus } from "../doctor.js";

async function main(): Promise<void> {
  const { rows, blocking, optional } = await checkReadiness({ ping: process.argv.includes("--ping") });
  const icon: Record<ReadinessStatus, string> = { ok: "OK  ", warn: "WARN", fail: "FAIL" };
  console.log("\nHomeschool AI · doctor\n");
  for (const r of rows) console.log(`  ${icon[r.status]}  ${r.item}${r.note ? `\n        ${r.note}` : ""}`);
  console.log(`\n  ${blocking} blocking, ${optional} optional.\n`);
  console.log("  Stage 1 (text tutor):  npm run ingest -- data/samples/photosynthesis-lesson.md && npm run chat -- --learner \"Test\" --grade 7");
  console.log("                         or: npm run dev:server + npm run dev:web, then Courses > Bundled samples > Ingest");
  console.log("  Stage 2 (media):       npm run ingest -- --title \"Deck\" ./lecture.pptx  |  npm run ingest -- https://www.ted.com/talks/...");
  console.log("  Stage 3 (voice):       ngrok http 3001 -> PUBLIC_URL -> npm run setup:hume -> HUME_CONFIG_ID -> web app, Voice mode");
  console.log("  See docs/TESTING.md for the full plan.\n");
  process.exit(0); // A report, not a gate: never surface as an npm lifecycle error.
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
