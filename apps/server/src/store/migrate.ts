/**
 * One-off migrations of the JSON store, run when a server or a CLI starts (never on import, so tests stay pure).
 *
 * The profile split (2026-10-05, docs/INTAKE.md §8 A): a learner profile used to hold what the student knew
 * about every course (`priorKnowledge`, `observedGaps`) and a preference label (`intakePreferences`). Those keys
 * are gone from the schema, and the store drops unknown keys on the next save, so without this step a
 * student's notes would vanish the first time their record was written. Here each entry moves to the
 * course-knowledge record of the course it is about, and the label is dropped.
 *
 * Which course an entry belongs to: the profile pass tagged its entries ("Rome: knows the founding legend"),
 * so a tag that names exactly one course on record decides it; an untagged entry came from the old intake,
 * which probed the course of the student's first session. An entry that fits neither stays only in the backup.
 *
 * Safe to run every time: a record without the old keys is left alone, and the untouched original of each
 * migrated learner is kept in <data>/backups/intake-split/.
 */
import fs from "node:fs";
import path from "node:path";

const LEGACY_KEYS = ["intakePreferences", "priorKnowledge", "observedGaps"] as const;
const MAX_PRIOR_KNOWLEDGE = 15;
const MAX_GAPS = 12;

export interface SplitReport {
  learnerId: string;
  name: string;
  moved: Array<{ courseId: string; priorKnowledge: number; observedGaps: number }>;
  /** Entries no course could be found for; they remain in the backup file only. */
  unplaced: number;
}

type Raw = Record<string, unknown>;

function readJson(file: string): Raw | undefined {
  try {
    return JSON.parse(fs.readFileSync(file, "utf8")) as Raw;
  } catch {
    return undefined;
  }
}

function writeJson(file: string, value: unknown): void {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function jsonFiles(dir: string): string[] {
  return fs.existsSync(dir) ? fs.readdirSync(dir).filter((n) => n.endsWith(".json")).map((n) => path.join(dir, n)) : [];
}

const strings = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : []);
const words = (s: string): string[] => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];

/** The id of a learner's record for a course. Mirrors knowledgeId in store/index.ts (kept apart so this file imports nothing). */
const recordId = (learnerId: string, courseId: string): string => `${learnerId}__${courseId}`;

/** "Rome: knows the legend" -> the one course whose title carries every word of the tag, and the entry without its tag. */
export function courseForEntry(entry: string, courses: Array<{ id: string; title: string }>): { courseId?: string; text: string } {
  const m = /^([A-Za-z][\w' -]{0,30}?):\s+(.+)$/s.exec(entry.trim());
  if (!m) return { text: entry.trim() };
  const tag = words(m[1]);
  const matches = courses.filter((c) => tag.length > 0 && tag.every((w) => words(c.title).includes(w)));
  return matches.length === 1 ? { courseId: matches[0].id, text: m[2].trim() } : { text: entry.trim() };
}

export function migrateIntakeSplit(dataDir: string, now: string = new Date().toISOString()): SplitReport[] {
  const reports: SplitReport[] = [];
  const legacy = jsonFiles(path.join(dataDir, "learners"))
    .map((file) => ({ file, raw: readJson(file) }))
    .filter((l): l is { file: string; raw: Raw } => {
      const p = l.raw?.profile as Raw | undefined;
      return Boolean(p) && LEGACY_KEYS.some((k) => k in (p as Raw));
    });
  if (!legacy.length) return reports;

  // Read only when there is something to migrate: course files are large.
  const courses = jsonFiles(path.join(dataDir, "courses"))
    .map((f) => readJson(f))
    .filter((c): c is Raw => Boolean(c) && typeof c?.id === "string")
    .map((c) => ({ id: String(c.id), title: String(c.title ?? "") }));
  const sessions = jsonFiles(path.join(dataDir, "sessions"))
    .map((f) => readJson(f))
    .filter((s): s is Raw => Boolean(s))
    .map((s) => ({ learnerId: String(s.learnerId ?? ""), courseId: typeof s.courseId === "string" ? s.courseId : undefined, startedAt: String(s.startedAt ?? "") }));

  for (const { file, raw } of legacy) {
    const learnerId = String(raw.id);
    const profile = raw.profile as Raw;
    // The old intake probed the course of the student's first session, so that is where untagged entries belong.
    const first = sessions
      .filter((s) => s.learnerId === learnerId && s.courseId && courses.some((c) => c.id === s.courseId))
      .sort((a, b) => a.startedAt.localeCompare(b.startedAt))[0]?.courseId;
    const byCourse = new Map<string, { priorKnowledge: string[]; observedGaps: string[] }>();
    let unplaced = 0;
    for (const key of ["priorKnowledge", "observedGaps"] as const) {
      for (const entry of strings(profile[key])) {
        const placed = courseForEntry(entry, courses);
        const courseId = placed.courseId ?? first;
        if (!courseId) {
          unplaced += 1;
          continue;
        }
        const bucket = byCourse.get(courseId) ?? { priorKnowledge: [], observedGaps: [] };
        if (!bucket[key].includes(placed.text)) bucket[key].push(placed.text);
        byCourse.set(courseId, bucket);
      }
    }

    const backup = path.join(dataDir, "backups", "intake-split", path.basename(file));
    if (!fs.existsSync(backup)) writeJson(backup, raw);

    const moved: SplitReport["moved"] = [];
    for (const [courseId, notes] of byCourse) {
      const recordFile = path.join(dataDir, "course-knowledge", `${recordId(learnerId, courseId)}.json`);
      const existing = readJson(recordFile);
      const merge = (old: unknown, add: string[], max: number): string[] => [...new Set([...strings(old), ...add])].slice(0, max);
      writeJson(recordFile, {
        id: recordId(learnerId, courseId),
        learnerId,
        courseId,
        starts: [],
        guidance: [],
        createdAt: now,
        ...(existing ?? {}),
        priorKnowledge: merge(existing?.priorKnowledge, notes.priorKnowledge, MAX_PRIOR_KNOWLEDGE),
        observedGaps: merge(existing?.observedGaps, notes.observedGaps, MAX_GAPS),
        updatedAt: now,
      });
      moved.push({ courseId, priorKnowledge: notes.priorKnowledge.length, observedGaps: notes.observedGaps.length });
    }

    const rest = Object.fromEntries(Object.entries(profile).filter(([k]) => !(LEGACY_KEYS as readonly string[]).includes(k)));
    writeJson(file, { ...raw, profile: rest });
    reports.push({ learnerId, name: String(raw.name ?? learnerId), moved, unplaced });
  }
  return reports;
}

let done = false;

/** Run every migration once per process, and say what moved. Called by the server and the CLIs before they touch the store. */
export function ensureMigrated(dataDir: string, log: (line: string) => void = (line) => console.log(line)): void {
  if (done) return;
  done = true;
  for (const r of migrateIntakeSplit(dataDir)) {
    const where = r.moved.map((m) => `${m.priorKnowledge} prior-knowledge and ${m.observedGaps} gap entries to ${m.courseId}`).join("; ") || "nothing to move";
    log(`[migrate] ${r.name}: profile split (${where}${r.unplaced ? `; ${r.unplaced} entries had no course and stay in the backup` : ""}). Original kept in backups/intake-split/.`);
  }
}
