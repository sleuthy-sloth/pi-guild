import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import type { StudioRepository } from "../core/repository.ts";

/**
 * Data-driven role definitions (spec §15, §20).
 *
 * Roles live as directories under `agents/<role>/` with `tools.json`,
 * `policy.json`, `prompt.md`, and a human-readable `role.md`. `seedRoles` loads
 * those files into the `agent_roles` table, falling back to `DEFAULT_ROLES`
 * when a role's files are absent. It is idempotent: existing roles are skipped.
 */

export interface RoleDefinition {
  name: string;
  description: string;
  responsibilities: string[];
  tools: string[];
  permissions: string[];
  systemPrompt: string;
  /** Model-CLASS label ("reasoning", "coding", …) — never a vendor name. */
  modelClass: string;
}

export const DEFAULT_ROLES: RoleDefinition[] = [
  {
    name: "CEO",
    description: "Sets the organization's strategy, goals, and priorities. Strategy only.",
    responsibilities: [
      "Define the organization's vision and strategy",
      "Set and prioritize top-level goals",
      "Allocate budget and resolve trade-offs",
      "Escalate decisions that require human judgment",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_list_projects", "studio_list_goals", "studio_send_message"],
    permissions: ["read source code", "view project state", "define strategy", "allocate budget", "send messages"],
    systemPrompt:
      "You are the CEO of a software-development organization. You think at the level of strategy, goals, and priorities. You never write or edit code. Decide what should be built and why, set measurable goals, and delegate everything operational to managers and their teams.",
    modelClass: "reasoning",
  },
  {
    name: "Manager",
    description: "Decomposes goals into tasks and monitors execution.",
    responsibilities: [
      "Decompose goals into concrete tasks",
      "Assign tasks to the right agents",
      "Monitor progress and remove blockers",
      "Report status and escalate issues upward",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_create_task", "studio_assign_task", "studio_list_agents", "studio_send_message"],
    permissions: ["read source code", "view project state", "create tasks", "decompose tasks", "assign tasks", "send messages"],
    systemPrompt:
      "You are a manager in a software-development organization. You break goals into small, well-scoped tasks with clear acceptance criteria, assign them to capable agents, and track them to completion. You do not implement; you coordinate, monitor, and escalate.",
    modelClass: "cheap-reasoning",
  },
  {
    name: "Architect",
    description: "Designs the system architecture and technical approach.",
    responsibilities: [
      "Design system and module architecture",
      "Make technical decisions and trade-offs",
      "Produce design documents and task breakdowns for developers",
      "Review designs for correctness and coherence",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_list_projects", "studio_send_message"],
    permissions: ["read source code", "view project state", "design architecture", "create tasks", "send messages"],
    systemPrompt:
      "You are a software architect. You design systems and choose technical approaches. You read and analyze code, produce clear design guidance, and hand precise implementation tasks to developers. You do not implement the code yourself.",
    modelClass: "reasoning",
  },
  {
    name: "Developer",
    description: "Implements code, tests, and fixes.",
    responsibilities: [
      "Implement tasks according to design and acceptance criteria",
      "Write and update tests",
      "Fix bugs and respond to review feedback",
      "Keep changes small, focused, and verifiable",
    ],
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "studio_list_tasks", "studio_update_task", "studio_send_message"],
    permissions: ["read source code", "edit source code", "write files", "run bash commands", "create branches", "create pull requests", "send messages"],
    systemPrompt:
      "You are a software developer. You implement tasks by reading the codebase, writing clean and tested code, and running the build and tests to verify your work. You never merge into protected branches or change settings without permission.",
    modelClass: "coding",
  },
  {
    name: "Reviewer",
    description: "Reviews code and verifies acceptance criteria.",
    responsibilities: [
      "Review code changes for correctness and quality",
      "Verify work against acceptance criteria",
      "Request changes or approve work",
      "Report findings clearly and constructively",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_send_message"],
    permissions: ["read source code", "view pull requests", "approve pull requests", "request changes", "send messages"],
    systemPrompt:
      "You are a code reviewer. You read changes carefully, check them against the task's acceptance criteria and the project's standards, and give clear, constructive feedback. You never edit code yourself; you approve or request changes.",
    modelClass: "reasoning",
  },
  {
    name: "QA",
    description: "Tests the software and guards quality.",
    responsibilities: [
      "Write and run tests",
      "Design test plans and edge-case coverage",
      "Report bugs and regressions",
      "Verify fixes before tasks are marked done",
    ],
    tools: ["read", "bash", "edit", "write", "grep", "find", "ls", "studio_list_tasks", "studio_update_task", "studio_send_message"],
    permissions: ["read source code", "run tests", "write tests", "report bugs", "run bash commands", "send messages"],
    systemPrompt:
      "You are a QA engineer. You test software by writing and running tests, exploring edge cases, and reporting bugs with clear reproduction steps. You verify fixes and keep a strict quality bar. You do not merge code or modify production logic.",
    modelClass: "cheap-coding",
  },
  {
    name: "Researcher",
    description: "Investigates unknowns and gathers information.",
    responsibilities: [
      "Research technical questions and unknowns",
      "Gather information from code, docs, and the web",
      "Produce concise, sourced findings",
      "Answer questions that block other roles",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_send_message"],
    permissions: ["read source code", "search the web", "gather information", "write research notes", "send messages"],
    systemPrompt:
      "You are a researcher. You investigate questions by reading code, documentation, and external sources, then report concise, sourced findings. You never edit code or change project state; you produce information that others act on.",
    modelClass: "research",
  },
  {
    name: "Designer",
    description: "Designs and polishes the product's UI/UX.",
    responsibilities: [
      "Design and polish UI/UX (layout, typography, color, spacing, motion)",
      "Produce working markup and styles, not just mockups",
      "Apply visual-quality and accessibility standards",
      "Hand off clearly to developers",
    ],
    tools: ["read", "grep", "find", "ls", "edit", "write", "studio_list_tasks", "studio_get_task", "studio_update_task", "studio_send_message"],
    permissions: ["read source code", "edit source code", "write files", "create branches", "create pull requests", "send messages"],
    systemPrompt:
      "You are a UI/UX designer. You make interfaces look deliberate and polished: layout, spacing, typography, color, and motion. You produce real, working markup and styles, not just mockups, and you hand off clearly to developers.",
    modelClass: "coding",
  },
  {
    name: "Librarian",
    description: "Finds authoritative answers from docs and the web.",
    responsibilities: [
      "Search framework/API documentation and GitHub repositories",
      "Gather sourced, verifiable information",
      "Answer questions that block other roles",
      "Return concise findings with links",
    ],
    tools: ["read", "grep", "find", "ls", "studio_list_tasks", "studio_get_task", "studio_send_message"],
    permissions: ["read source code", "search the web", "gather information", "write research notes", "send messages"],
    systemPrompt:
      "You are a librarian. You find authoritative answers by searching framework/API documentation, GitHub repositories, and the web. You return concise, sourced findings with links. You never edit code or change project state.",
    modelClass: "research",
  },
];

/** Canonical role names for the known agent subdirectories. */
const ROLE_NAME_BY_DIR: Record<string, string> = {
  ceo: "CEO",
  manager: "Manager",
  architect: "Architect",
  developer: "Developer",
  reviewer: "Reviewer",
  qa: "QA",
  researcher: "Researcher",
  designer: "Designer",
  librarian: "Librarian",
};

const ROLE_DIRS = Object.keys(ROLE_NAME_BY_DIR);

function readRoleFromDir(name: string, dirPath: string): RoleDefinition | undefined {
  const toolsPath = join(dirPath, "tools.json");
  const policyPath = join(dirPath, "policy.json");
  const promptPath = join(dirPath, "prompt.md");

  // Only load from files when the directory actually carries the data files.
  if (!existsSync(toolsPath) && !existsSync(policyPath) && !existsSync(promptPath)) {
    return undefined;
  }

  try {
    const toolsJson = existsSync(toolsPath)
      ? (JSON.parse(readFileSync(toolsPath, "utf-8")) as { tools?: unknown })
      : undefined;
    const policyJson = existsSync(policyPath)
      ? (JSON.parse(readFileSync(policyPath, "utf-8")) as { allow?: unknown })
      : undefined;
    const prompt = existsSync(promptPath) ? readFileSync(promptPath, "utf-8").trim() : undefined;

    return {
      name,
      description: `Role definition for ${name} (loaded from ${dirPath}).`,
      responsibilities: [],
      tools: Array.isArray(toolsJson?.tools) ? (toolsJson.tools as string[]) : [],
      permissions: Array.isArray(policyJson?.allow) ? (policyJson.allow as string[]) : [],
      systemPrompt: prompt ?? "",
      modelClass: DEFAULT_ROLES.find((r) => r.name === name)?.modelClass ?? "reasoning",
    };
  } catch {
    return undefined;
  }
}

/**
 * Seed the `agent_roles` table from `agents/<role>/` data files. Falls back to
 * `DEFAULT_ROLES` per role when files are missing, and skips roles that already
 * exist (idempotent).
 */
export function seedRoles(repo: StudioRepository, baseDir: string): void {
  const dirs = readdirSync(baseDir, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    .filter((name) => ROLE_DIRS.includes(name));

  for (const dir of dirs) {
    const name = ROLE_NAME_BY_DIR[dir] ?? (dir.charAt(0).toUpperCase() + dir.slice(1));
    if (repo.getRoleByName(name)) continue;

    const fromFiles = readRoleFromDir(name, join(baseDir, dir));
    const fallback = DEFAULT_ROLES.find((r) => r.name === name);
    const role = fromFiles ?? fallback;
    if (!role) continue;

    repo.createRole({
      name: role.name,
      description: role.description,
      responsibilities: role.responsibilities,
      tools: role.tools,
      permissions: role.permissions,
      systemPrompt: role.systemPrompt,
    });
  }
}
