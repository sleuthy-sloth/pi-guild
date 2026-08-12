import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { bus } from "../../core/events.ts";
import { AgentSpawner } from "../../core/orchestration/spawner.ts";
import type { AgentRunner } from "../../core/orchestration/spawner.ts";
import { ProjectRunner } from "../../core/orchestration/runner.ts";
import { DEFAULT_ROLES } from "../../agents/roles.ts";
import type { StudioRepository } from "../../core/repository.ts";

function seedRoles(repo: StudioRepository): void {
  for (const r of DEFAULT_ROLES) {
    if (!repo.getRoleByName(r.name)) {
      repo.createRole({
        name: r.name,
        description: r.description,
        responsibilities: r.responsibilities,
        tools: r.tools,
        permissions: r.permissions,
        systemPrompt: r.systemPrompt,
      });
    }
  }
}

function setup(repo: StudioRepository) {
  const org = repo.createOrganization({ name: "Demo" });
  const proj = repo.createProject({ name: "calc", organizationId: org.id });
  return { org, proj };
}

const okRunner: AgentRunner = {
  async run(_agent, _task) {
    return { ok: true, summary: "done" };
  },
};

function runnerWith(repo: StudioRepository, agentRunner: AgentRunner): ProjectRunner {
  return new ProjectRunner(repo, bus, new AgentSpawner(repo, bus, agentRunner));
}

describe("ProjectRunner.plan", () => {
  it("returns manager-created subtasks", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);

    const manager: AgentRunner = {
      async run(_agent, task) {
        const a = repo.createTask({ title: "Implement", projectId: task.projectId });
        const b = repo.createTask({ title: "Test", projectId: task.projectId });
        repo.addDependency(b.id, a.id);
        return { ok: true, summary: "planned 2 tasks" };
      },
    };

    const tasks = await runnerWith(repo, manager).plan(proj.id, "build a calc");
    expect(tasks.map((t) => t.title)).toEqual(["Implement", "Test"]);
  });

  it("falls back to a deterministic chain when the manager creates nothing", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);

    const tasks = await runnerWith(repo, okRunner).plan(proj.id, "build a calc");
    expect(tasks.length).toBe(3);
    expect(tasks[0].title).toContain("Implement");
    expect(tasks[1].title).toContain("Test");
    expect(tasks[2].title).toContain("Review");

    const test = tasks.find((t) => t.title.startsWith("Test"))!;
    expect(repo.listDependencies(test.id).length).toBe(1);
  });
});

describe("ProjectRunner.runProject", () => {
  it("drives dev -> review -> qa -> done", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);
    const task = repo.createTask({ title: "Build it", projectId: proj.id });

    const summary = await runnerWith(repo, okRunner).runProject({
      projectId: proj.id,
      reviewPolicy: "review_and_tests_required",
    });

    expect(summary.completed).toBe(1);
    expect(repo.getTask(task.id)!.state).toBe("DONE");

    const roles = repo.listAgents({ projectId: proj.id }).map((a) => a.roleName);
    expect(roles).toContain("Developer");
    expect(roles).toContain("Reviewer");
    expect(roles).toContain("QA");
  });

  it("fully_autonomous skips review and QA", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);
    const task = repo.createTask({ title: "Build it", projectId: proj.id });

    const summary = await runnerWith(repo, okRunner).runProject({
      projectId: proj.id,
      reviewPolicy: "fully_autonomous",
    });

    expect(summary.completed).toBe(1);
    expect(repo.getTask(task.id)!.state).toBe("DONE");

    const roles = repo.listAgents({ projectId: proj.id }).map((a) => a.roleName);
    expect(roles).toContain("Developer");
    expect(roles).not.toContain("Reviewer");
    expect(roles).not.toContain("QA");
  });

  it("request_changes sends the task back to the developer", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);
    const task = repo.createTask({ title: "Build it", projectId: proj.id });

    let reviews = 0;
    const reviewer: AgentRunner = {
      async run(agent, t) {
        if (agent.roleName === "Reviewer") {
          reviews++;
          const verdict = reviews === 1 ? "request_changes" : "approve";
          repo.addMemory({
            scope: "task",
            scopeId: t.id,
            kind: "review",
            source: "verdict",
            content: JSON.stringify({ verdict }),
          });
          return { ok: true, summary: verdict };
        }
        return { ok: true, summary: "done" };
      },
    };

    const summary = await runnerWith(repo, reviewer).runProject({
      projectId: proj.id,
      reviewPolicy: "review_and_tests_required",
    });

    expect(summary.completed).toBe(1);
    expect(repo.getTask(task.id)!.state).toBe("DONE");
    expect(reviews).toBe(2);
  });

  it("returns immediately when aborted", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);
    repo.createTask({ title: "Build it", projectId: proj.id });

    const controller = new AbortController();
    controller.abort();

    const summary = await runnerWith(repo, okRunner).runProject({
      projectId: proj.id,
      signal: controller.signal,
    });

    expect(summary.cancelled).toBe(1);
    expect(summary.completed).toBe(0);
  });

  it("routes design-labeled tasks to the Designer role", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const { proj } = setup(repo);
    const designTask = repo.createTask({ title: "Polish the UI", projectId: proj.id, labels: ["design"] });

    const summary = await runnerWith(repo, okRunner).runProject({
      projectId: proj.id,
      reviewPolicy: "fully_autonomous",
    });

    expect(summary.completed).toBe(1);
    expect(repo.getTask(designTask.id)!.state).toBe("DONE");

    const roles = repo.listAgents({ projectId: proj.id }).map((a) => a.roleName);
    expect(roles).toContain("Designer");
    expect(roles).not.toContain("Developer");
  });
});
