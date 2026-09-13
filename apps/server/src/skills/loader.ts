/**
 * Loads `skills/<name>/SKILL.md` files and renders them into a system-prompt section.
 *
 * Frontmatter is a minimal `key: value` block between `---` lines. Skills are cached per process;
 * restart the server after editing a skill.
 */
import fs from "node:fs";
import path from "node:path";
import { config } from "../config.js";

export interface Skill {
  name: string;
  description: string;
  body: string;
}

const cache = new Map<string, Skill>();

export function parseSkillFile(raw: string, fallbackName: string): Skill {
  const m = raw.match(/^---\s*\n([\s\S]*?)\n---\s*\n?([\s\S]*)$/);
  if (!m) return { name: fallbackName, description: "", body: raw.trim() };
  const front: Record<string, string> = {};
  for (const line of m[1].split("\n")) {
    const kv = line.match(/^([A-Za-z_][\w-]*):\s*(.*)$/);
    if (kv) front[kv[1]] = kv[2].trim();
  }
  return { name: front.name ?? fallbackName, description: front.description ?? "", body: m[2].trim() };
}

export function loadSkill(name: string, skillsDir: string = config.skillsDir): Skill {
  const key = `${skillsDir}::${name}`;
  const hit = cache.get(key);
  if (hit) return hit;
  const file = path.join(skillsDir, name, "SKILL.md");
  if (!fs.existsSync(file)) throw new Error(`Skill not found: ${file}`);
  const skill = parseSkillFile(fs.readFileSync(file, "utf8"), name);
  cache.set(key, skill);
  return skill;
}

export function listSkills(skillsDir: string = config.skillsDir): Skill[] {
  if (!fs.existsSync(skillsDir)) return [];
  return fs
    .readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && fs.existsSync(path.join(skillsDir, d.name, "SKILL.md")))
    .map((d) => loadSkill(d.name, skillsDir));
}

/** Render skills as a stable block of text for a system prompt. Order is preserved (it affects caching). */
export function renderSkills(names: string[], skillsDir: string = config.skillsDir): string {
  return names
    .map((n) => loadSkill(n, skillsDir))
    .map((s) => `<skill name="${s.name}">\n${s.body}\n</skill>`)
    .join("\n\n");
}
