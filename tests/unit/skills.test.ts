import { describe, it, expect } from "vitest";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { listSkills, loadSkillContents, roleSkills } from "../../core/skills.ts";

describe("skills loader", () => {
  it("lists skills, loads contents, and resolves role references", () => {
    const root = mkdtempSync(join(tmpdir(), "skills-test-"));
    mkdirSync(join(root, "skills", "ui-design"), { recursive: true });
    mkdirSync(join(root, "skills", "web-research"), { recursive: true });
    mkdirSync(join(root, "agents", "designer"), { recursive: true });

    writeFileSync(join(root, "skills", "ui-design", "SKILL.md"), "# UI Design\npolish it");
    writeFileSync(join(root, "skills", "web-research", "SKILL.md"), "# Research\ncite sources");
    writeFileSync(join(root, "agents", "designer", "skills.json"), JSON.stringify({ skills: ["ui-design"] }));

    expect(listSkills(join(root, "skills")).sort()).toEqual(["ui-design", "web-research"]);
    expect(loadSkillContents(join(root, "skills"), ["ui-design"])).toContain("polish it");
    expect(roleSkills(join(root, "agents"), "Designer")).toEqual(["ui-design"]);
    expect(roleSkills(join(root, "agents"), "Developer")).toEqual([]);
  });
});
