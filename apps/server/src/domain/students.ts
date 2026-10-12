/**
 * A family's students, by name. Pure. Two records under one name are the same child added twice, not two
 * children: on 2026-10-12 a parent added Andy, left the Students tab before the intake began, came back to an
 * empty form and added Andy again. The intake ran on the second record, and the first sat above it on the tab
 * with no profile, so the intake looked unsaved. `POST /api/learners` refuses a name already on file, and the
 * Students tab opens the existing student's intake instead.
 */

/** The form a name is compared in: case and spacing do not make a different child ("andy", " Andy ", "ANDY"). */
export function nameKey(name: string): string {
  return name.trim().replace(/\s+/g, " ").toLowerCase();
}

/** The student already on file under this name, if any. A blank name matches nobody. */
export function studentNamed<T extends { name: string }>(students: readonly T[], name: string): T | undefined {
  const key = nameKey(name);
  return key ? students.find((s) => nameKey(s.name) === key) : undefined;
}
