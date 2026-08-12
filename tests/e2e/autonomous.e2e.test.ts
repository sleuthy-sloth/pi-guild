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

describe("autonomous run (mocked runtime, no real LLM)", () => {
  it("takes a job from goal to DONE across the whole team", async () => {
    const repo = newTestRepo();
    seedRoles(repo);
    const org = repo.createOrganization({ name: "Demo" });
    const proj = repo.createProject({ name: "calculator", organizationId: org.id });

    // A fake agent runtime that behaves like a real team: the manager decomposes
    // into tasks via the repository (standing in for studio tool calls), the
    // reviewer approves, QA passes, and developers succeed.
    const runtime: AgentRunner = {
      async run(agent, task) {
        if (agent.roleName === "Manager") {
          const design = repo.createTask({ title: "Design calculator", projectId: task.projectId });
          const implement = repo.createTask({ title: "Implement calculator", projectId: task.projectId });
          const test = repo.createTask({ title: "Test calculator", projectId: task.projectId });
          repo.addDependency(implement.id, design.id);
          repo.addDependency(test.id, implement.id);
          return { ok: true, summary: "planned 3 tasks" };
        }
        if (agent.roleName === "Reviewer") {
          repo.addMemory({
            scope: "task",
            scopeId: task.id,
            kind: "review",
            source: "verdict",
            content: JSON.stringify({ verdict: "approve", comments: "lgtm" }),
          });
          return { ok: true, summary: "approved" };
        }
        if (agent.roleName === "QA") {
          repo.addMemory({
            scope: "task",
            scopeId: task.id,
            kind: "review",
            source: "verdict",
            content: JSON.stringify({ verdict: "pass" }),
          });
          return { ok: true, summary: "passed" };
        }
        return { ok: true, summary: "implemented" };
      },
    };

    const spawner = new AgentSpawner(repo, bus, runtime);
    const runner = new ProjectRunner(repo, bus, spawner);

    const tasks = await runner.plan(proj.id, "Build a command-line calculator with tests");
    expect(tasks.length).toBe(3);

    const summary = await runner.runProject({
      projectId: proj.id,
      reviewPolicy: "review_and_tests_required",
    });

    expect(summary.failed).toBe(0);
    expect(summary.completed).toBeGreaterThanOrEqual(3);

    // Dependency order respected: every subtask is DONE.
    for (const t of tasks) {
      expect(repo.getTask(t.id)!.state).toBe("DONE");
    }

    // Persistence: the team materialized as persistent agents.
    const roles = repo.listAgents({ projectId: proj.id }).map((a) => a.roleName);
    expect(roles).toContain("Manager");
    expect(roles).toContain("Developer");
    expect(roles).toContain("Reviewer");
    expect(roles).toContain("QA");

    // Attempts were recorded as task memory.
    const attempts = repo.listMemory("task", tasks[0].id).filter((m) => m.kind === "attempt");
    expect(attempts.length).toBeGreaterThan(0);
  });
});
