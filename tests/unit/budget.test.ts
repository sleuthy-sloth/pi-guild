import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { BudgetService } from "../../core/orchestration/budget.ts";

describe("BudgetService", () => {
  it("reports exceeded token/call/time limits", () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({
      name: "o",
      budgets: { maxTokensPerTask: 100, maxModelCallsPerTask: 1, maxAgentMinutes: 1, onLimit: "pause" },
    });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "t", projectId: proj.id });

    repo.recordUsage({
      organizationId: org.id,
      projectId: proj.id,
      taskId: task.id,
      promptTokens: 100,
      completionTokens: 60,
      modelCalls: 2,
      elapsedMs: 120_000,
    });

    const exceeded = new BudgetService(repo).exceeded(task.id, org.id);
    expect(exceeded).toEqual(
      expect.arrayContaining(["maxTokensPerTask", "maxModelCallsPerTask", "maxAgentMinutes"]),
    );
  });

  it("reports nothing when no limits are configured", () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "t", projectId: proj.id });

    repo.recordUsage({ taskId: task.id, promptTokens: 9999, completionTokens: 9999, modelCalls: 50, elapsedMs: 999_999 });

    expect(new BudgetService(repo).exceeded(task.id, org.id)).toEqual([]);
  });
});
