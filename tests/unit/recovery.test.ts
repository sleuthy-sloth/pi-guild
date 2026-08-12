import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { RecoveryService } from "../../core/orchestration/recovery.ts";

describe("RecoveryService", () => {
  it("resets orphaned agents and reopens interrupted tasks", () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "t1", projectId: proj.id, state: "IN_PROGRESS" });
    const agent = repo.createAgent({
      name: "dev-1",
      organizationId: org.id,
      projectId: proj.id,
      roleName: "Developer",
      state: "WORKING",
      currentTaskId: task.id,
    });

    const report = new RecoveryService(repo).reconcile();

    expect(report.agentsReset).toBe(1);
    expect(report.tasksReopened).toBe(1);
    expect(repo.getAgent(agent.id)!.state).toBe("IDLE");
    expect(repo.getAgent(agent.id)!.currentTaskId).toBeUndefined();
    expect(repo.getTask(task.id)!.state).toBe("READY");
    expect(repo.getTask(task.id)!.assigneeId).toBeUndefined();
  });

  it("leaves idle agents and terminal tasks alone", () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const idle = repo.createAgent({ name: "dev-1", organizationId: org.id, projectId: proj.id, roleName: "Developer", state: "IDLE" });
    const done = repo.createTask({ title: "done", projectId: proj.id, state: "DONE" });

    const report = new RecoveryService(repo).reconcile();

    expect(report.agentsReset).toBe(0);
    expect(report.tasksReopened).toBe(0);
    expect(repo.getAgent(idle.id)!.state).toBe("IDLE");
    expect(repo.getTask(done.id)!.state).toBe("DONE");
  });
});
