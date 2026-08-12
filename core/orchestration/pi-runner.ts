import { mkdirSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai/compat";
import type { Agent, AgentRole, Task } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { ABORT_SIGNAL_KEY, type AgentRunner, type AgentRunResult } from "./spawner.ts";
import type { ModelRouter } from "./model-router.ts";

/**
 * createPiRunner — the real runtime adapter (spec §20, §54).
 *
 * Each `run()` spins up an in-process AgentSession via Pi's SDK with a project
 * workspace cwd, a role-derived system prompt, and the model the ModelRouter
 * resolved for that role (falling back to the session default when the router
 * only yields a model class or nothing at all). Nothing is started at import
 * time; sessions are created lazily inside `run()` and disposed in a `finally`.
 */

// The compat catalog getter is tightly typed against the generated catalog; we
// only need the loose `(provider, id) -> Model | undefined` lookup.
const resolveCatalogModel = getModel as unknown as (
  provider: string,
  modelId: string,
) => Model<any> | undefined;

function defaultWorkspaceDir(projectId: string): string {
  return join(homedir(), ".pi", "agent", "pi-studio", "workspaces", projectId);
}

function buildSystemPrompt(role: AgentRole | undefined, agent: Agent): string {
  const lines: string[] = [];
  lines.push(`You are ${agent.name}, a Pi Studio agent acting in the "${agent.roleName}" role.`);
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
  return lines.join("\n");
}

function buildTaskPrompt(task: Task): string {
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
  lines.push("");
  lines.push("Complete the task and report a concise summary of what changed and how it was verified.");
  return lines.join("\n");
}

export interface CreatePiRunnerOptions {
  repo: StudioRepository;
  router: ModelRouter;
  workspaceDir?: string;
  customTools?: unknown[];
}

export function createPiRunner(opts: CreatePiRunnerOptions): AgentRunner {
  const { repo, router } = opts;
  const workspaceRoot = opts.workspaceDir;
  const customTools = opts.customTools as ToolDefinition[] | undefined;

  return {
    async run(agent: Agent, task: Task): Promise<AgentRunResult> {
      const cwd = workspaceRoot ?? defaultWorkspaceDir(task.projectId);
      mkdirSync(cwd, { recursive: true });

      const role = repo.getRoleByName(agent.roleName);

      let model: Model<any> | undefined;
      const resolved = router.resolve(agent.roleName);
      if (resolved?.model && resolved.provider) {
        model = resolveCatalogModel(resolved.provider, resolved.model);
      }

      const resourceLoader = new DefaultResourceLoader({
        cwd,
        agentDir: getAgentDir(),
        systemPrompt: buildSystemPrompt(role, agent),
        noExtensions: true,
        noSkills: true,
        noPromptTemplates: true,
        noThemes: true,
        noContextFiles: true,
      });
      await resourceLoader.reload();

      const { session } = await createAgentSession({
        cwd,
        model,
        sessionManager: SessionManager.inMemory(cwd),
        resourceLoader,
        customTools,
      });

      const signal = agent.settings[ABORT_SIGNAL_KEY] as AbortSignal | undefined;
      const onAbort = () => void session.abort();
      if (signal) signal.addEventListener("abort", onAbort);

      try {
        await session.prompt(buildTaskPrompt(task));
        const stats = session.getSessionStats();
        return {
          ok: true,
          summary: "Task completed by the agent session.",
          promptTokens: stats.tokens.input,
          completionTokens: stats.tokens.output,
        };
      } catch (err) {
        return { ok: false, error: err instanceof Error ? err.message : String(err) };
      } finally {
        if (signal) signal.removeEventListener("abort", onAbort);
        session.dispose();
      }
    },
  };
}
