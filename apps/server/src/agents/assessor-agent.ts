/**
 * Assessor Agent: transcript + observations + course -> MasteryReport.
 *
 * Runs offline at the end of a session. Also performs a grounding audit of the tutor's claims.
 */
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { anthropic, assertNotRefused } from "../llm/client.js";
import { config } from "../config.js";
import { MasteryExtractionSchema, type Course, type Learner, type Lesson, type MasteryReport, type Session } from "../domain/types.js";
import { buildSystem, type AgentSpec } from "./base.js";

export const assessorAgent: AgentSpec = {
  name: "Assessor Agent",
  role:
    "You evaluate a tutoring session after the fact. You are fair, evidence-driven, and specific. " +
    "You never infer mastery the transcript does not show, and you audit the tutor for claims the material does not support.",
  skills: ["mastery-assessment", "grounding"],
  get model() {
    return config.model;
  },
  get effort() {
    return config.analysisEffort;
  },
};

export async function assessSession(args: { session: Session; learner: Learner; course: Course; lesson: Lesson }): Promise<MasteryReport> {
  const { session, learner, course, lesson } = args;
  const concepts = course.concepts.filter((c) => lesson.conceptIds.includes(c.id));
  const material = concepts
    .map((c) => {
      const passages = c.sourceChunkIds
        .map((id) => course.chunks.find((ch) => ch.id === id)?.text)
        .filter(Boolean)
        .join("\n---\n");
      return `<concept id="${c.id}" name="${c.name}">\n${c.summary}\nKey facts:\n${c.keyFacts.map((f) => `- ${f}`).join("\n")}\nSource:\n${passages}\n</concept>`;
    })
    .join("\n\n");
  const transcript = session.transcript
    .map((t) => `${t.role === "user" ? learner.name : "Tutor"}${t.expressions?.length ? ` [${t.expressions.join(", ")}]` : ""}: ${t.content}`)
    .join("\n");
  const observations = session.observations.map((o) => `- ${o.at} [${o.conceptId}/${o.kind}] ${o.evidence} :: ${o.note}`).join("\n") || "(none recorded)";

  const system = buildSystem(assessorAgent, [
    `<learner name="${learner.name}">${learner.profile ? `Demonstration preferences: ${learner.profile.demonstrationPreferences.join(", ")}` : "No profile."}</learner>`,
  ]);

  const response = await anthropic.messages.parse({
    model: assessorAgent.model,
    max_tokens: 16_000,
    system: system.map((b) => ({ type: "text" as const, text: b.text, cache_control: b.cache_control })),
    output_config: { effort: assessorAgent.effort, format: zodOutputFormat(MasteryExtractionSchema) },
    messages: [
      {
        role: "user",
        content:
          `Assess this session on lesson "${lesson.title}". Produce one entry in concepts for EVERY concept listed in the material, even if level is 0.\n\n` +
          `<material>\n${material}\n</material>\n\n<tutor_observations>\n${observations}\n</tutor_observations>\n\n<transcript>\n${transcript}\n</transcript>`,
      },
    ],
  });
  assertNotRefused(response);
  const out = response.parsed_output;
  if (!out) throw new Error("Assessment returned no parsable output.");

  // Clamp and complete: every lesson concept gets an entry.
  const byId = new Map(out.concepts.map((c) => [c.conceptId, { ...c, level: Math.max(0, Math.min(4, Math.round(c.level))) }]));
  for (const c of concepts) if (!byId.has(c.id)) byId.set(c.id, { conceptId: c.id, level: 0, evidence: [], misconceptions: [], nextStep: "Not reached this session." });

  return {
    ...out,
    concepts: concepts.map((c) => byId.get(c.id)!),
    sessionId: session.id,
    learnerId: learner.id,
    courseId: course.id,
    lessonId: lesson.id,
    createdAt: new Date().toISOString(),
  };
}
