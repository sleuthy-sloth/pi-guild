/**
 * RecoveryService — restart reconciliation (spec §40).
 *
 * On a fresh start, any agent left in an active state (STARTING/WORKING/REVIEWING)
 * is orphaned — its session process is gone. Reset them to IDLE and reopen
 * interrupted IN_PROGRESS tasks to READY. We never blindly resume a half-done
 * run; work restarts from a clean, re-assignable state.
 */
import type { GuildRepository } from "../repository.ts";
import { AgentRegistryService } from "../agents/index.ts";
import { TaskService } from "../tasks/index.ts";

export interface RecoveryReport {
  agentsReset: number;
  tasksReopened: number;
}

const ORPHANED_AGENT_STATES = ["STARTING", "WORKING", "REVIEWING"];

export class RecoveryService {
  private readonly agents: AgentRegistryService;
  private readonly tasks: TaskService;

  constructor(private readonly repo: GuildRepository) {
    this.agents = new AgentRegistryService(repo);
    this.tasks = new TaskService(repo);
  }

  reconcile(): RecoveryReport {
    const report: RecoveryReport = { agentsReset: 0, tasksReopened: 0 };

    for (const agent of this.repo.listAgents()) {
      if (ORPHANED_AGENT_STATES.includes(agent.state)) {
        this.agents.setState(agent.id, "IDLE");
        this.agents.setCurrentTask(agent.id, undefined);
        report.agentsReset++;
      }
    }

    for (const task of this.repo.listTasks({ state: "IN_PROGRESS" })) {
      this.tasks.setState(task.id, "READY");
      this.repo.updateTask(task.id, { assigneeId: undefined });
      report.tasksReopened++;
    }

    if (report.agentsReset > 0 || report.tasksReopened > 0) {
      this.repo.audit({
        actor: "system",
        action: "recovery.reconcile",
        details: report as unknown as Record<string, unknown>,
      });
      this.repo.recordEvent("recovery.reconciled", { ...report });
    }

    return report;
  }
}
