/**
 * Skills loader (spec §15 data-driven roles, §55 extensibility).
 *
 * A "skill" is a directory under `skills/<name>/SKILL.md`. Roles reference
 * skills via `agents/<role>/skills.json`. The runner injects the referenced
 * skill contents into the spawned agent's system prompt — no schema, no new
 * dependencies, just markdown on disk.
 */
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/** Names of installed skills (directories containing a SKILL.md). */
export function listSkills(skillsDir: string): string[] {
  if (!existsSync(skillsDir)) return [];
  return readdirSync(skillsDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => existsSync(join(skillsDir, name, "SKILL.md")));
}

/** Concatenate the SKILL.md bodies for the given skill names. */
export function loadSkillContents(skillsDir: string, names: string[]): string {
  const blocks: string[] = [];
  for (const name of names) {
    const path = join(skillsDir, name, "SKILL.md");
    if (existsSync(path)) blocks.push(readFileSync(path, "utf8").trim());
  }
  return blocks.join("\n\n---\n\n");
}

/** Skill names referenced by a role's `skills.json` (may be empty). */
export function roleSkills(agentsDir: string, roleName: string): string[] {
  const path = join(agentsDir, roleName.toLowerCase(), "skills.json");
  if (!existsSync(path)) return [];
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8")) as { skills?: unknown };
    return Array.isArray(parsed.skills) ? (parsed.skills as string[]) : [];
  } catch {
    return [];
  }
}
