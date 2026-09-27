/**
 * Profile pass: after a session's report, propose a revised learner profile from what the session showed.
 *
 * Runs offline, after the assessor, off everyone's clock. It returns the whole revised profile with a reason per
 * changed field; what of it lands is decided by domain/profile.ts (the slow fields need two consecutive sessions
 * to agree), and the orchestrator persists it. The parent sees every change and can undo the latest.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import { config } from "../config.js";
import { LearnerProfileExtractionSchema, type Course, type Learner, type MasteryReport, type Session } from "../domain/types.js";
import { describeChange, PROFILE_FIELDS, type ProfileRevision } from "../domain/profile.js";
import { assertNotRefused, streamParsed } from "../llm/client.js";
import { buildSystem, type AgentSpec } from "./base.js";

export const profileAgent: AgentSpec = {
  name: "Profile Reviser",
  role:
    "You keep a homeschool student's learner profile current after each tutoring session, from that session's evidence. " +
    "You change what the evidence changed and nothing else, you give a reason for every change, and you write about a child: what they did, never what they are.",
  skills: ["profile-update"],
  get model() {
    return config.model;
  },
  get effort() {
    return config.analysisEffort;
  },
};

export const ProfileRevisionSchema = z.object({
  profile: LearnerProfileExtractionSchema,
  reasons: z.array(z.object({ field: z.enum(PROFILE_FIELDS), why: z.string().describe("One sentence quoting or naming the evidence.") })),
  summary: z.string().describe("One or two plain sentences for the parent on what this session showed about how the student learns."),
});

export interface ReviseInput {
  learner: Learner;
  course: Course;
  session: Session;
  report: MasteryReport;
  /** Earlier reports for this learner, oldest first, each with its course when it is still on record. */
  priorReports: Array<{ report: MasteryReport; course?: Course }>;
}

/** The learner's own turns, as a sample of how they speak this session. */
const LEARNER_WORDS_CHARS = 3000;

function conceptName(course: Course | undefined, id: string): string {
  return course?.concepts.find((c) => c.id === id)?.name ?? id;
}

function renderReport(r: MasteryReport, course: Course | undefined, full: boolean): string {
  const lesson = course?.lessons.find((l) => l.id === r.lessonId)?.title ?? r.lessonId ?? "";
  const concepts = r.concepts
    .map((c) => `- ${conceptName(course, c.conceptId)}: level ${c.level}` + (full ? `; evidence: ${c.evidence.join(" | ") || "none"}; misconceptions: ${c.misconceptions.join(" | ") || "none"}; next: ${c.nextStep}` : c.misconceptions.length ? `; misconceptions: ${c.misconceptions.join(" | ")}` : ""))
    .join("\n");
  return (
    `<report date="${r.createdAt.slice(0, 10)}" course="${course?.title ?? r.courseId ?? ""}" lesson="${lesson}">\n${concepts}\n` +
    (full ? `Effective formats: ${r.effectiveFormats.join(", ") || "none noted"}\nTurns asking for the answer: ${r.answerSeekingTurns}; tutor answer giveaways: ${r.tutorAnswerGiveaways}\n` : "") +
    `Parent summary: ${full ? r.parentSummary : r.parentSummary.slice(0, 600)}\n</report>`
  );
}

/** What the pass reads. Pure, so a test can see it. */
export function reviseContext(input: ReviseInput): string {
  const { learner, course, session, report } = input;
  const p = learner.profile!;
  const list = (xs: string[]): string => (xs.length ? xs.map((x) => `  - ${x}`).join("\n") : "  (none)");
  const profile =
    `<current_profile>\nintakePreferences: ${p.intakePreferences.join(", ")}\ndemonstrationPreferences: ${p.demonstrationPreferences.join(", ")}\n` +
    `challengeTolerance: ${p.challengeTolerance}\npace: ${p.pace}\ndepth: ${p.depth ?? "simple"}\nverbalLevel: ${p.verbalLevel}\n` +
    `interests:\n${list(p.interests)}\npriorKnowledge:\n${list(p.priorKnowledge)}\nobservedGaps:\n${list(p.observedGaps)}\ntutoringGuidance:\n${list(p.tutoringGuidance)}\nparentSummary: ${p.parentSummary}\n</current_profile>`;
  const history = (learner.profileHistory ?? []).slice(-3);
  const revisions = history.length
    ? `<recent_revisions>\n${history
        .map(
          (u) =>
            `- ${u.at.slice(0, 10)}${u.courseTitle ? ` (${u.courseTitle})` : ""}: ${u.summary}` +
            (u.changes.length ? `\n  changed: ${u.changes.map((c) => describeChange(c, 200)).join("; ")}` : "") +
            (u.held.length ? `\n  HELD, lands if this session proposes the same: ${u.held.map((h) => describeChange(h, 400)).join("; ")}` : ""),
        )
        .join("\n")}\n</recent_revisions>`
    : "<recent_revisions>\n(none yet: this is the first revision since the intake)\n</recent_revisions>";
  const observations = session.observations.map((o) => `- [${o.kind}] ${o.evidence} (${o.note})`).join("\n") || "(none recorded)";
  const outside = (session.outsideClaims ?? [])
    .map((c) => `- "${c.claim}" (raised by ${c.raisedBy === "learner" ? learner.name : "the tutor"}; ${c.status === "checked" ? `check: ${c.verdict}` : "not checked"})`)
    .join("\n");
  let words = session.transcript.filter((t) => t.role === "user").map((t) => t.content).join("\n");
  if (words.length > LEARNER_WORDS_CHARS) words = `${words.slice(0, LEARNER_WORDS_CHARS)}\n(...)`;
  const earlier = input.priorReports.slice(-3);
  return [
    `<learner name="${learner.name}"${learner.age ? ` age="${learner.age}"` : ""}${learner.gradeLevel ? ` grade="${learner.gradeLevel}"` : ""}/>`,
    profile,
    revisions,
    `<this_session course="${course.title}" subject="${course.subject}"${session.narrationFirst ? ' opened="narration"' : ""}>\n${renderReport(report, course, true)}\n` +
      `<tutor_observations>\n${observations}\n</tutor_observations>\n` +
      (outside ? `<outside_the_reading>\n${outside}\n</outside_the_reading>\n` : "") +
      `<learner_words>\n${words || "(the learner said nothing)"}\n</learner_words>\n</this_session>`,
    earlier.length ? `<earlier_reports>\n${earlier.map((e) => renderReport(e.report, e.course, false)).join("\n")}\n</earlier_reports>` : "<earlier_reports>\n(none)\n</earlier_reports>",
  ].join("\n\n");
}

/** One structured-output call: the revised profile, reasons, and the note for the parent. */
export async function proposeRevision(input: ReviseInput): Promise<ProfileRevision> {
  if (!input.learner.profile) throw new Error(`${input.learner.name} has no profile to revise; the intake writes the first one.`);
  const system = buildSystem(profileAgent, []);
  const { message, parsed } = await streamParsed<ProfileRevision>({
    model: profileAgent.model,
    // The whole profile comes back (about 2k tokens), but the model's thinking at high effort counts against this
    // too: 8,000 was cut off on the first live run (2026-09-27). Streamed, so a large ceiling costs nothing.
    max_tokens: 32_000,
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: profileAgent.effort, format: zodOutputFormat(ProfileRevisionSchema) },
    messages: [
      {
        role: "user",
        content:
          `Revise ${input.learner.name}'s profile from this session, following the profile-update skill. Return the whole profile: every field, unchanged where the evidence did not change it. ` +
          "Give a reason for each field you changed, and the summary for the parent.\n\n" +
          reviseContext(input),
      },
    ],
  });
  assertNotRefused(message);
  if (message.stop_reason === "max_tokens") throw new Error("The profile revision was cut off at its output limit.");
  if (!parsed) throw new Error("The profile revision returned no parsable output.");
  return parsed;
}
