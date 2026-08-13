/**
 * BudgetService — cost limits (spec §32).
 *
 * Reads an organization's BudgetPolicy and checks a task's accumulated usage
 * against `maxTokensPerTask`, `maxModelCallsPerTask`, and `maxAgentMinutes`.
 * The caller (ProjectRunner) applies the `onLimit` policy: continue, pause,
 * or escalate.
 */
import type { BudgetPolicy } from "../types.ts";
import type { GuildRepository } from "../repository.ts";

export class BudgetService {
  constructor(private readonly repo: GuildRepository) {}

  policy(organizationId: string): BudgetPolicy {
    return this.repo.getOrganization(organizationId)?.budgets ?? { onLimit: "continue" };
  }

  /** Names of the limits a task has exceeded. */
  exceeded(taskId: string, organizationId: string): string[] {
    const policy = this.policy(organizationId);
    const usage = this.repo.taskUsage(taskId);
    const list: string[] = [];
    if (policy.maxTokensPerTask && usage.promptTokens + usage.completionTokens > policy.maxTokensPerTask) {
      list.push("maxTokensPerTask");
    }
    if (policy.maxModelCallsPerTask && usage.modelCalls > policy.maxModelCallsPerTask) {
      list.push("maxModelCallsPerTask");
    }
    if (policy.maxAgentMinutes && usage.elapsedMs / 60000 > policy.maxAgentMinutes) {
      list.push("maxAgentMinutes");
    }
    return list;
  }
}
