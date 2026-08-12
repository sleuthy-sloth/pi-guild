/**
 * ProjectRunner — the autonomous execution loop (spec §20, §34).
 *
 * Drives a project from READY tasks through developer work, review, and QA to
 * DONE without a human issuing per-step commands. Developers, reviewers, and QA
 * agents are reused when idle or spawned on demand. Verdicts are read from
 * task-scoped memory written by the `studio_report_verdict` tool, falling back
 * to the run's ok/fail when an agent does not record one.
 */
import { randomUUID } from "node:crypto";
import type { Agent, Task } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { bus as defaultBus } from "../events.ts";
import type { EventBus } from "../events.ts";
import { TaskService } from "../tasks/index.ts";
import { AgentRegistryService } from "../agents/index.ts";
import { Scheduler } from "./scheduler.ts";
import { BudgetService } from "./budget.ts";
import type { AgentSpawner } from "./spawner.ts";

export type ReviewPolicy =
  | "manual_merge"
  | "review_required"
  | "review_and_tests_required"
  | "fully_autonomous";

export interface RunOptions {
  projectId: string;
  reviewPolicy?: ReviewPolicy;
  onProgress?: (message: string) => void;
  signal?: AbortSignal;
  /** Consulted every pass; returns true while the user has paused the studio. */
  paused?: () => boolean;
}

export interface RunSummary {
  completed: number;
  failed: number;
  cancelled: number;
  budgetPaused: boolean;
  iterations: number;
}

const TERMINAL = new Set(["DONE", "CANCELLED", "FAILED"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export class ProjectRunner {
  private readonly tasks: TaskService;
  private readonly agents: AgentRegistryService;
  private readonly scheduler: Scheduler;
  private readonly budget: BudgetService;

  constructor(
    private readonly repo: StudioRepository,
    private readonly bus: EventBus = defaultBus,
    private readonly spawner: AgentSpawner,
    opts: { maxConcurrentAgents?: number } = {},
  ) {
    this.tasks = new TaskService(repo, bus);
    this.agents = new AgentRegistryService(repo, bus);
    this.scheduler = new Scheduler(repo, bus, { maxConcurrentAgents: opts.maxConcurrentAgents ?? 4 });
    this.budget = new BudgetService(repo);
  }

  /** Reuse an idle agent of `roleName` in the project, or spawn one. */
  ensureAgent(projectId: string, roleName: string): Agent {
    const existing = this.agents
      .list({ projectId, state: "IDLE" })
      .find((a) => a.roleName.toLowerCase() === roleName.toLowerCase());
    if (existing) return existing;

    const project = this.repo.getProject(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);
    const role = this.repo.getRoleByName(roleName);
    const suffix = randomUUID().slice(0, 6);

    return this.agents.create({
      name: `${roleName.toLowerCase()}-${suffix}`,
      roleName: role?.name ?? roleName,
      roleId: role?.id,
      organizationId: project.organizationId,
      projectId,
      state: "IDLE",
      kind: "persistent",
    });
  }

  /**
   * Decompose a goal into tasks. Primary path: a Manager agent records the plan
   * by calling the studio task tools. Falls back to a deterministic three-task
   * chain (implement → test → review) when the manager produces nothing.
   */
  async plan(projectId: string, goalText: string): Promise<Task[]> {
    const manager = this.ensureAgent(projectId, "Manager");
    const planTask = this.tasks.create({
      title: `Plan: ${goalText}`,
      description: goalText,
      projectId,
      assigneeId: manager.id,
    });

    try {
      await this.spawner.run(manager, planTask, { onSuccess: "DONE", onFailure: "DONE" });
    } catch {
      // Planning is best-effort; fall through to the deterministic fallback.
    }

    const subtasks = this.tasks.list({ projectId }).filter((t) => t.id !== planTask.id);
    if (subtasks.length > 0) return subtasks;
    return this.fallbackPlan(projectId, goalText);
  }

  private fallbackPlan(projectId: string, goalText: string): Task[] {
    const implement = this.tasks.create({ title: `Implement: ${goalText}`, projectId });
    const test = this.tasks.create({ title: `Test: ${goalText}`, projectId });
    const review = this.tasks.create({ title: `Review & document: ${goalText}`, projectId });
    this.tasks.addDependency(test.id, implement.id);
    this.tasks.addDependency(review.id, test.id);
    return [implement, test, review];
  }

  private verdictEntries(taskId: string) {
    return this.repo
      .listMemory("task", taskId)
      .filter((m) => m.kind === "review" && m.source === "verdict");
  }

  private verdictValue(entry: { content: string } | undefined): string | undefined {
    if (!entry) return undefined;
    try {
      return (JSON.parse(entry.content) as { verdict?: string }).verdict;
    } catch {
      return undefined;
    }
  }

  /** Verdict written during the latest run (id differs from the pre-run entry). */
  private newVerdict(taskId: string, beforeId: string | undefined): string | undefined {
    const entries = this.verdictEntries(taskId);
    const last = entries[entries.length - 1];
    if (!last || last.id === beforeId) return undefined;
    return this.verdictValue(last);
  }

  /** Send a task back to the developer pool (clears the assignee for re-pick). */
  private reopen(taskId: string): void {
    this.tasks.setState(taskId, "READY");
    this.repo.updateTask(taskId, { assigneeId: undefined });
  }

  /** Apply the org's budget policy for a finished task. Returns "paused" to stop the loop. */
  private enforceBudget(projectId: string, taskId: string, report: (m: string) => void): "ok" | "paused" {
    const project = this.repo.getProject(projectId);
    if (!project) return "ok";
    const exceeded = this.budget.exceeded(taskId, project.organizationId);
    if (exceeded.length === 0) return "ok";

    const policy = this.budget.policy(project.organizationId);
    const message = `Budget limit(s) exceeded for task ${taskId}: ${exceeded.join(", ")}`;
    this.repo.recordEvent("budget.limit_reached", { taskId, projectId, exceeded, onLimit: policy.onLimit });
    this.bus.emit("budget.limit_reached", { taskId, projectId, exceeded, onLimit: policy.onLimit });

    if (policy.onLimit === "escalate") {
      this.repo.createEscalation({ projectId, taskId, problem: message, options: ["continue", "pause", "increase budget"] });
      report(`Escalated: ${message}`);
      return "ok";
    }
    if (policy.onLimit === "pause") {
      report(`Paused: ${message}`);
      return "paused";
    }
    report(`Budget: ${message}`);
    return "ok";
  }

  async runProject(opts: RunOptions): Promise<RunSummary> {
    const { projectId, reviewPolicy = "review_and_tests_required", onProgress, signal } = opts;
    const paused = opts.paused ?? (() => false);
    const needsReview = reviewPolicy === "review_required" || reviewPolicy === "review_and_tests_required";
    const needsQa = reviewPolicy === "review_and_tests_required";

    let iterations = 0;
    let cancelled = 0;
    let budgetPaused = false;
    const report = (m: string) => {
      onProgress?.(m);
      this.bus.emit("runner.progress", { projectId, message: m });
    };

    // ponytail: unbounded retry loop bounded only by the iteration cap; add a
    // per-task retry budget if reviewers/QA thrash.
    while (iterations++ < 1000) {
      if (signal?.aborted) {
        cancelled++;
        break;
      }
      while (paused()) {
        await sleep(200);
        if (signal?.aborted) break;
      }
      if (signal?.aborted) {
        cancelled++;
        break;
      }

      // 1a. Design work (tasks labeled "design")
      if (this.scheduler.readyTasks(projectId, { label: "design" }).length > 0) {
        this.ensureAgent(projectId, "Designer");
      }
      const design = this.scheduler.tick(projectId, { roleName: "Designer", label: "design" });
      if (design.length > 0) {
        report(`Running ${design.length} design task(s)`);
        await Promise.all(
          design.map(({ task, agent }) =>
            this.spawner.run(agent, task, { onSuccess: needsReview ? "REVIEW" : "DONE" }),
          ),
        );
        for (const { task } of design) {
          if (this.enforceBudget(projectId, task.id, report) === "paused") budgetPaused = true;
        }
        if (budgetPaused) break;
        continue;
      }

      // 1b. Developer work (everything else)
      if (this.scheduler.readyTasks(projectId).length > 0) {
        // Guarantee at least one worker exists; ensureAgent reuses an idle one.
        this.ensureAgent(projectId, "Developer");
      }
      const dev = this.scheduler.tick(projectId, { roleName: "Developer", excludeLabel: "design" });
      if (dev.length > 0) {
        report(`Running ${dev.length} developer task(s)`);
        await Promise.all(
          dev.map(({ task, agent }) =>
            this.spawner.run(agent, task, { onSuccess: needsReview ? "REVIEW" : "DONE" }),
          ),
        );
        for (const { task } of dev) {
          if (this.enforceBudget(projectId, task.id, report) === "paused") budgetPaused = true;
        }
        if (budgetPaused) break;
        continue;
      }

      // 2. Review
      if (needsReview) {
        const inReview = this.tasks.list({ projectId, state: "REVIEW" });
        if (inReview.length > 0) {
          for (const task of inReview) {
            const reviewer = this.ensureAgent(projectId, "Reviewer");
            report(`Reviewing: ${task.title}`);
            const beforeId = this.verdictEntries(task.id).at(-1)?.id;
            const res = await this.spawner.run(reviewer, task, {
              onSuccess: needsQa ? "QA" : "DONE",
              onFailure: "IN_PROGRESS",
              successAgentState: "IDLE",
              failureAgentState: "IDLE",
            });
            const verdict = this.newVerdict(task.id, beforeId) ?? (res.ok ? "approve" : "request_changes");
            if (verdict === "request_changes") this.reopen(task.id);
            if (this.enforceBudget(projectId, task.id, report) === "paused") budgetPaused = true;
          }
          if (budgetPaused) break;
          continue;
        }
      }

      // 3. QA
      if (needsQa) {
        const inQa = this.tasks.list({ projectId, state: "QA" });
        if (inQa.length > 0) {
          for (const task of inQa) {
            const qa = this.ensureAgent(projectId, "QA");
            report(`Testing: ${task.title}`);
            const beforeId = this.verdictEntries(task.id).at(-1)?.id;
            const res = await this.spawner.run(qa, task, {
              onSuccess: "DONE",
              onFailure: "IN_PROGRESS",
              successAgentState: "IDLE",
              failureAgentState: "IDLE",
            });
            const verdict = this.newVerdict(task.id, beforeId) ?? (res.ok ? "pass" : "fail");
            if (verdict === "fail") this.reopen(task.id);
            if (this.enforceBudget(projectId, task.id, report) === "paused") budgetPaused = true;
          }
          if (budgetPaused) break;
          continue;
        }
      }

      // 4. Nothing actionable?
      const all = this.tasks.list({ projectId });
      const remaining = all.filter((t) => !TERMINAL.has(t.state));
      if (remaining.length === 0) break;

      const actionable = remaining.some(
        (t) =>
          t.state === "READY" ||
          t.state === "BACKLOG" ||
          t.state === "IN_PROGRESS" ||
          t.state === "REVIEW" ||
          t.state === "QA",
      );
      if (!actionable) break; // e.g. blocked on a FAILED dependency
      await sleep(100);
    }

    const all = this.tasks.list({ projectId });
    return {
      completed: all.filter((t) => t.state === "DONE").length,
      failed: all.filter((t) => t.state === ("FAILED" as Task["state"])).length,
      cancelled,
      budgetPaused,
      iterations,
    };
  }
}
