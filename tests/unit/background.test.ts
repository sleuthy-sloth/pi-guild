import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { BackgroundScheduler } from "../../core/orchestration/background.ts";
import type { RunSummary } from "../../core/orchestration/runner.ts";

const emptySummary: RunSummary = { completed: 0, failed: 0, cancelled: 0, budgetPaused: false, iterations: 0 };

describe("BackgroundScheduler", () => {
  it("tick runs a project with non-terminal work", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    repo.createTask({ title: "t", projectId: proj.id });

    const runIds: string[] = [];
    const scheduler = new BackgroundScheduler(repo, async (projectId) => {
      runIds.push(projectId);
      return emptySummary;
    });

    expect(await scheduler.tick()).toBe(true);
    expect(runIds).toEqual([proj.id]);
  });

  it("tick returns false when every project is terminal", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    repo.createTask({ title: "done", projectId: proj.id, state: "DONE" });

    const scheduler = new BackgroundScheduler(repo, async () => emptySummary);
    expect(await scheduler.tick()).toBe(false);
  });
});
