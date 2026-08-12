import type { Agent, Task, TaskState } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { StudioEvents } from "../events.ts";
import type { EventBus } from "../events.ts";
import { TaskService } from "../tasks/index.ts";
import { AgentRegistryService } from "../agents/index.ts";

/**
 * AgentSpawner — owns a single agent run from STARTING through completion or
 * failure (spec §15, §20). It drives state via the registry/task services (which
 * already audit + record + emit their own events) and adds the run-level
 * `agent.started` / `task.started` emissions, usage accounting, and the audit
 * trail for the whole attempt.
 *
 * `stop()` performs a best-effort abort: it aborts the AbortController stored
 * for that agent (which the default runner honors via the signal threaded
 * through `agent.settings`) and moves the agent to STOPPED.
 */

export interface AgentRunner {
  run(agent: Agent, task: Task): Promise<AgentRunResult>;
}

export interface AgentRunResult {
  ok: boolean;
  summary?: string;
  error?: string;
  promptTokens?: number;
  completionTokens?: number;
}

/** Internal key under which the spawner threads an AbortSignal to runners. */
export const ABORT_SIGNAL_KEY = "__piStudioAbortSignal";

const ACTOR = "system";

// The task state machine (core/types.ts) has no FAILED terminal state, but the
// runtime and TaskService already treat "FAILED" as a first-class string state.
const TASK_FAILED = "FAILED" as unknown as TaskState;

export class AgentSpawner {
  private readonly controllers = new Map<string, AbortController>();
  private readonly tasks: TaskService;
  private readonly agents: AgentRegistryService;

  constructor(
    private readonly repo: StudioRepository,
    private readonly bus: EventBus,
    private readonly runner: AgentRunner,
  ) {
    this.tasks = new TaskService(repo, bus);
    this.agents = new AgentRegistryService(repo, bus);
  }

  async run(agent: Agent, task: Task): Promise<AgentRunResult> {
    const startedAt = Date.now();

    this.agents.setState(agent.id, "STARTING");
    this.repo.recordEvent(StudioEvents.agentStarted, { agentId: agent.id, taskId: task.id });
    this.bus.emit(StudioEvents.agentStarted, { agentId: agent.id, taskId: task.id });

    this.agents.setState(agent.id, "WORKING");
    this.agents.setCurrentTask(agent.id, task.id);

    this.tasks.setState(task.id, "IN_PROGRESS");
    this.repo.recordEvent(StudioEvents.taskStarted, { taskId: task.id, agentId: agent.id });
    this.bus.emit(StudioEvents.taskStarted, { taskId: task.id, agentId: agent.id });

    const controller = new AbortController();
    this.controllers.set(agent.id, controller);
    const runnerAgent: Agent = {
      ...agent,
      settings: { ...agent.settings, [ABORT_SIGNAL_KEY]: controller.signal },
    };

    let result: AgentRunResult;
    try {
      result = await this.runner.run(runnerAgent, task);
    } catch (err) {
      result = { ok: false, error: err instanceof Error ? err.message : String(err) };
    } finally {
      this.controllers.delete(agent.id);
    }

    const elapsedMs = Date.now() - startedAt;
    const finalAgent = this.repo.getAgent(agent.id) ?? agent;
    const finalTask = this.repo.getTask(task.id) ?? task;

    if (result.ok) {
      // setState("DONE") emits task.completed + task.state_changed.
      this.tasks.setState(task.id, "DONE");
      this.agents.setState(agent.id, "IDLE");
      this.agents.setCurrentTask(agent.id, undefined);
    } else {
      // setState(TASK_FAILED) emits task.failed + task.state_changed.
      this.tasks.setState(task.id, TASK_FAILED);
      this.agents.setState(agent.id, "FAILED");
      this.agents.setCurrentTask(agent.id, undefined);
    }

    this.repo.recordUsage({
      organizationId: finalAgent.organizationId,
      projectId: finalTask.projectId,
      agentId: agent.id,
      taskId: task.id,
      model: finalAgent.model,
      provider: finalAgent.provider,
      promptTokens: result.promptTokens ?? 0,
      completionTokens: result.completionTokens ?? 0,
      modelCalls: 1,
      elapsedMs,
    });

    this.repo.audit({
      actor: ACTOR,
      action: result.ok ? "agent.run.completed" : "agent.run.failed",
      entityType: "task",
      entityId: task.id,
      details: {
        agentId: agent.id,
        ok: result.ok,
        elapsedMs,
        error: result.error,
        summary: result.summary,
      },
    });

    return result;
  }

  stop(agentId: string): void {
    this.controllers.get(agentId)?.abort();
    this.controllers.delete(agentId);
    this.agents.setState(agentId, "STOPPED");
  }
}
