import type { Agent, Priority, Task } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { bus as defaultBus } from "../events.ts";
import type { EventBus } from "../events.ts";
import { TaskService } from "../tasks/index.ts";
import { AgentRegistryService } from "../agents/index.ts";

/**
 * Scheduler — pairs READY tasks with IDLE agents (spec §53).
 *
 * Readiness is gated by the dependency graph (`TaskService.isReady`); pairing
 * is bounded by `maxConcurrentAgents`. Tasks sharing a project are not paired
 * within a single tick so concurrent agents never race on one workspace.
 */

export interface SchedulerOptions {
  maxConcurrentAgents?: number;
  maxDepth?: number;
}

/** Filters for ready-task selection and agent pairing. */
export interface TickFilter {
  roleName?: string;
  /** Only tasks carrying this label (case-insensitive). */
  label?: string;
  /** Exclude tasks carrying this label (case-insensitive). */
  excludeLabel?: string;
}

const PRIORITY_ORDER: Record<Priority, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export class Scheduler {
  private readonly maxConcurrentAgents: number;
  private readonly tasks: TaskService;
  private readonly agents: AgentRegistryService;

  constructor(
    private readonly repo: StudioRepository,
    private readonly bus: EventBus = defaultBus,
    opts: SchedulerOptions = {},
  ) {
    this.maxConcurrentAgents = opts.maxConcurrentAgents ?? 4;
    this.tasks = new TaskService(repo, bus);
    this.agents = new AgentRegistryService(repo, bus);
  }

  /** BACKLOG/READY tasks whose dependencies are all DONE, priority-ordered. */
  readyTasks(projectId?: string, filter: { label?: string; excludeLabel?: string } = {}): Task[] {
    const has = (t: Task, l: string) => t.labels.some((x) => x.toLowerCase() === l.toLowerCase());
    return this.repo
      .listTasks({ projectId })
      .filter((t) => (t.state === "BACKLOG" || t.state === "READY") && this.tasks.isReady(t.id))
      .filter((t) => (!filter.label || has(t, filter.label)) && (!filter.excludeLabel || !has(t, filter.excludeLabel)))
      .sort((a, b) => {
        const pa = PRIORITY_ORDER[a.priority];
        const pb = PRIORITY_ORDER[b.priority];
        if (pa !== pb) return pa - pb;
        return a.createdAt - b.createdAt;
      });
  }

  /** IDLE persistent/ephemeral agents, optionally scoped to a project + role. */
  availableAgents(projectId?: string, roleName?: string): Agent[] {
    return this.repo
      .listAgents({ projectId, state: "IDLE" })
      .filter(
        (a) =>
          (a.kind === "persistent" || a.kind === "ephemeral") &&
          (!roleName || a.roleName === roleName),
      );
  }

  /**
   * Pair ready tasks to available agents up to `maxConcurrentAgents`.
   * Never pairs two tasks from the same project in one tick. `roleName`
   * restricts the agent pool; `label`/`excludeLabel` filter the task set.
   */
  tick(projectId?: string, opts: TickFilter = {}): Array<{ task: Task; agent: Agent }> {
    const assignments: Array<{ task: Task; agent: Agent }> = [];
    const usedProjectIds = new Set<string>();
    const ready = this.readyTasks(projectId, { label: opts.label, excludeLabel: opts.excludeLabel });
    const available = this.availableAgents(projectId, opts.roleName);

    for (const task of ready) {
      if (assignments.length >= this.maxConcurrentAgents) break;
      if (task.assigneeId) continue; // already paired in a previous tick
      if (usedProjectIds.has(task.projectId)) continue;

      const agent = available.find((a) => !assignments.some((x) => x.agent.id === a.id));
      if (!agent) break;

      this.tasks.assign(task.id, agent.id);
      this.agents.setState(agent.id, "WORKING");
      usedProjectIds.add(task.projectId);
      assignments.push({ task, agent });
    }

    return assignments;
  }
}
