import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { loadSkillContents, roleSkills } from "../skills.ts";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  ModelRuntime,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai/compat";
import type { Agent, AgentRole, Task } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import { ABORT_SIGNAL_KEY, type AgentRunner, type AgentRunResult } from "./spawner.ts";
import type { ModelRouter } from "./model-router.ts";
import { ContextAssembler } from "../context/assembler.ts";
import { bus } from "../events.ts";

/**
 * createPiRunner — the real runtime adapter (spec §20, §54).
 *
 * Each `run()` spins up an in-process AgentSession via Pi's SDK with a project
 * workspace cwd, a role-derived system prompt, the model the ModelRouter
 * resolved for that role (falling back to the session default), and the shared
 * guild tool surface as `customTools`. Nothing is started at import time;
 * sessions are created lazily inside `run()` and disposed in a `finally`.
 */

// The compat catalog getter is tightly typed against the generated catalog; we
// only need the loose `(provider, id) -> Model | undefined` lookup.
const resolveCatalogModel = getModel as unknown as (
  provider: string,
  modelId: string,
) => Model<any> | undefined;

// Lazy ModelRuntime so custom providers (e.g. opencode-go from models.json) can
// resolve models, not just the static catalog.
let modelRuntime: ModelRuntime | undefined;
async function resolveModel(provider: string, modelId: string): Promise<Model<any> | undefined> {
  if (!modelRuntime) modelRuntime = await ModelRuntime.create();
  return modelRuntime.getModel(provider, modelId) ?? resolveCatalogModel(provider, modelId);
}

/** Built-in tool names that Pi's SDK can enable via the `tools` option. */
const BUILTIN_TOOL_NAMES = ["read", "bash", "edit", "write", "grep", "find", "ls"];

/**
 * Filter the shared guild tool surface down to what a role is allowed to use
 * (spec §15: roles determine tools). Returns the custom tools and the built-in
 * tool names for the role; `builtinTools: undefined` means "role has no tool
 * restrictions — use defaults".
 */
export function resolveRoleTools(
  role: AgentRole | undefined,
  allCustomTools: ToolDefinition[],
): { customTools: ToolDefinition[]; builtinTools: string[] | undefined } {
  if (!role || role.tools.length === 0) {
    return { customTools: allCustomTools, builtinTools: undefined };
  }
  const allowed = new Set(role.tools);
  return {
    customTools: allCustomTools.filter((t) => allowed.has(t.name)),
    builtinTools: BUILTIN_TOOL_NAMES.filter((n) => allowed.has(n)),
  };
}

function defaultWorkspaceDir(projectId: string): string {
  return join(homedir(), ".pi", "agent", "pi-guild", "workspaces", projectId);
}

function buildSystemPrompt(role: AgentRole | undefined, agent: Agent, skillsText?: string): string {
  const lines: string[] = [];
  lines.push(`You are ${agent.name}, a Pi Guild agent acting in the "${agent.roleName}" role.`);
  if (role?.systemPrompt) {
    lines.push("");
    lines.push(role.systemPrompt);
  }
  if (role?.responsibilities.length) {
    lines.push("");
    lines.push("Responsibilities:");
    for (const r of role.responsibilities) lines.push(`- ${r}`);
  }
  if (role?.permissions.length) {
    lines.push("");
    lines.push("Permissions:");
    for (const p of role.permissions) lines.push(`- ${p}`);
  }
  if (skillsText) {
    lines.push("");
    lines.push("## Skills");
    lines.push(skillsText);
  }
  return lines.join("\n");
}

function buildTaskPrompt(task: Task, roleName?: string): string {
  const lines: string[] = [];
  lines.push(`# Task: ${task.title}`);
  lines.push(`Task ID: ${task.id}`);
  lines.push(`Project: ${task.projectId}`);
  lines.push(`Priority: ${task.priority}`);
  if (task.description) {
    lines.push("");
    lines.push("## Description");
    lines.push(task.description);
  }
  if (task.acceptanceCriteria.length > 0) {
    lines.push("");
    lines.push("## Acceptance criteria");
    for (const c of task.acceptanceCriteria) lines.push(`- ${c}`);
  }
  if (task.labels.length > 0) {
    lines.push("");
    lines.push(`Labels: ${task.labels.join(", ")}`);
  }
  if (task.branch) {
    lines.push("");
    lines.push(`Branch: ${task.branch}`);
  }
  if (task.pr) {
    lines.push("");
    lines.push(`Pull request: ${task.pr}`);
  }

  lines.push("");
  switch (roleName) {
    case "Manager":
      lines.push(
        "Record the plan by creating tasks with guild_create_task (or guild_decompose_task) and wiring order with guild_add_task_dependency. Then summarize the plan.",
      );
      break;
    case "Reviewer":
      lines.push(
        'Review the work against the acceptance criteria, then end by calling guild_report_verdict with verdict "approve" or "request_changes" and your comments.',
      );
      break;
    case "QA":
      lines.push(
        'Test the work, then end by calling guild_report_verdict with verdict "pass" or "fail" and your findings.',
      );
      break;
    default:
      lines.push("Complete the task and report a concise summary of what changed and how it was verified.");
      lines.push(
        "Commit your work locally with guild_git_commit. Push and pull requests only work when a remote repository is configured.",
      );
  }
  return lines.join("\n");
}

export interface CreatePiRunnerOptions {
  repo: GuildRepository;
  router: ModelRouter;
  workspaceDir?: string;
  customTools?: ToolDefinition[] | (() => ToolDefinition[]);
  /** Package root (defaults to the repo root two levels up from this file). */
  packageRoot?: string;
}

export function createPiRunner(opts: CreatePiRunnerOptions): AgentRunner {
  const { repo, router } = opts;
  const workspaceRoot = opts.workspaceDir;

  return {
    async run(agent: Agent, task: Task): Promise<AgentRunResult> {
      const cwd = workspaceRoot ?? defaultWorkspaceDir(task.projectId);
      mkdirSync(cwd, { recursive: true });

      const role = repo.getRoleByName(agent.roleName);

      const root = opts.packageRoot ?? fileURLToPath(new URL("../../", import.meta.url));
      const skillsText = loadSkillContents(
        join(root, "skills"),
        roleSkills(join(root, "agents"), agent.roleName),
      );

      let model: Model<any> | undefined;
      const resolved = router.resolve(agent.roleName);
      if (resolved?.model && resolved.provider) {
        model = await resolveModel(resolved.provider, resolved.model);
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        systemPrompt: buildSystemPrompt(role, agent, skillsText),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await resourceLoader.reload();

      const tools = typeof opts.customTools === "function" ? opts.customTools() : opts.customTools;

      const { customTools: roleTools, builtinTools } = resolveRoleTools(role, tools ?? []);
      const customToolNames = roleTools.map((t) => t.name);
      // Only pass `tools` when the role specifies a tool set — otherwise keep
      // Pi's default built-ins.
      const sessionTools =
        builtinTools === undefined ? undefined : [...builtinTools, ...customToolNames];

      const { session } = await createAgentSession({
        cwd,
        model,
        sessionManager: SessionManager.inMemory(cwd),
        resourceLoader,
        customTools: roleTools,
        tools: sessionTools,
      });

      // Capture the agent's final answer as the run summary (streamed deltas)
      // and surface each tool invocation on the live feed.
      let finalText = "";
      const unsubscribe = session.subscribe((event) => {
        if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
          finalText += event.assistantMessageEvent.delta;
        } else if (event.type === "tool_execution_start") {
          bus.emit("agent.activity", { agentId: agent.id, action: `→ ${event.toolName}` });
        }
      });

      const signal = agent.settings[ABORT_SIGNAL_KEY] as AbortSignal | undefined;
      const onAbort = () => void session.abort();
      if (signal) signal.addEventListener("abort", onAbort);

      try {
        const context = await new ContextAssembler(repo).assemble(task);
        const prompt =
          buildTaskPrompt(task, agent.roleName) + (context ? `\n\n## Context\n${context}` : "");
        await session.prompt(prompt);
        const stats = session.getSessionStats();
        return {
          ok: true,
          summary: finalText.trim().slice(0, 4000) || "Task completed by the agent session.",
          promptTokens: stats.tokens.input,
          completionTokens: stats.tokens.output,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        unsubscribe();
        if (signal) signal.removeEventListener("abort", onAbort);
        session.dispose();
      }
    },
  };
}
