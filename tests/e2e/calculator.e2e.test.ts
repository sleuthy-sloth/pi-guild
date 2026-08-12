import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { seedRoles } from "../../agents/roles.ts";
import { AgentRegistryService } from "../../core/agents/index.ts";
import { EventBus } from "../../core/events.ts";
import { MessagingService } from "../../core/messaging/index.ts";
import { Scheduler } from "../../core/orchestration/scheduler.ts";
import { AgentSpawner } from "../../core/orchestration/spawner.ts";
import type { AgentRunner, AgentRunResult } from "../../core/orchestration/spawner.ts";
import { OrganizationService } from "../../core/organization/index.ts";
import { ProjectService } from "../../core/projects/index.ts";
import { StudioRepository } from "../../core/repository.ts";
import { TaskService } from "../../core/tasks/index.ts";
import type { Agent, Task } from "../../core/types.ts";
import { createDb } from "../../database/db.ts";

const AGENTS_DIR = join(dirname(fileURLToPath(import.meta.url)), "..", "..", "agents");

describe("calculator end-to-end (mocked runtime)", () => {
  it("drives the full pipeline to completion with persistence", async () => {
    const repo = new StudioRepository(createDb(":memory:"));
    const bus = new EventBus();
    const orgs = new OrganizationService(repo, bus);
    const projects = new ProjectService(repo, bus);
    const agents = new AgentRegistryService(repo, bus);
    const tasks = new TaskService(repo, bus);
    const messaging = new MessagingService(repo, bus);

    // Seed role definitions from the data-driven agents/ directory.
    seedRoles(repo, AGENTS_DIR);
    expect(repo.listRoles().length).toBeGreaterThanOrEqual(5);

    const org = orgs.create("Demo");
    const project = projects.create(org.id, "calculator");

    // Spawn the org hierarchy (CEO → Manager → workers).
    const ceo = agents.create({ name: "CEO", organizationId: org.id, roleName: "CEO", projectId: project.id });
    const manager = agents.create({
      name: "Manager",
      organizationId: org.id,
      roleName: "Manager",
      projectId: project.id,
      parentAgentId: ceo.id,
    });
    const developer = agents.create({
      name: "Developer",
      organizationId: org.id,
      roleName: "Developer",
      projectId: project.id,
      parentAgentId: manager.id,
    });
    const reviewer = agents.create({
      name: "Reviewer",
      organizationId: org.id,
      roleName: "Reviewer",
      projectId: project.id,
      parentAgentId: manager.id,
    });
    const qa = agents.create({
      name: "QA",
      organizationId: org.id,
      roleName: "QA",
      projectId: project.id,
      parentAgentId: manager.id,
    });
    for (const a of [ceo, manager, developer, reviewer, qa]) {
      agents.setState(a.id, "IDLE");
    }

    // Epic → Stories → Tasks.
    const epic = tasks.create({ title: "Calculator epic", projectId: project.id, priority: "HIGH" });
    const [storyA, storyB] = tasks.decompose(
      epic.id,
      [{ title: "Add & Subtract" }, { title: "Multiply & Divide" }],
      4,
    );
    const [a1, a2] = tasks.decompose(storyA.id, [{ title: "Implement add" }, { title: "Implement subtract" }], 4);
    const [b1, b2] = tasks.decompose(storyB.id, [{ title: "Implement multiply" }, { title: "Implement divide" }], 4);

    // Wire dependencies: leaf order, stories after their leaves, epic after stories.
    tasks.addDependency(a2.id, a1.id);
    tasks.addDependency(b2.id, b1.id);
    tasks.addDependency(storyA.id, a1.id);
    tasks.addDependency(storyA.id, a2.id);
    tasks.addDependency(storyB.id, b1.id);
    tasks.addDependency(storyB.id, b2.id);
    tasks.addDependency(epic.id, storyA.id);
    tasks.addDependency(epic.id, storyB.id);

    const allTaskIds = [epic.id, storyA.id, storyB.id, a1.id, a2.id, b1.id, b2.id];

    // Fake runner: records every run and emits a status message (no real LLM).
    const runs: Array<{ agent: Agent; task: Task }> = [];
    const fakeRunner: AgentRunner = {
      async run(agent, task): Promise<AgentRunResult> {
        runs.push({ agent, task });
        messaging.send({
          senderId: agent.id,
          senderName: agent.name,
          recipientId: manager.id,
          projectId: task.projectId,
          taskId: task.id,
          messageType: "STATUS",
          content: `completed ${task.title}`,
        });
        return { ok: true, summary: "done" };
      },
    };

    const scheduler = new Scheduler(repo, bus, { maxConcurrentAgents: 4 });
    const spawner = new AgentSpawner(repo, bus, fakeRunner);

    // Run until no ready tasks remain.
    let iterations = 0;
    while (iterations++ < 100) {
      const assignments = scheduler.tick(project.id);
      if (assignments.length === 0) break;
      for (const { task, agent } of assignments) {
        await spawner.run(agent, task);
      }
    }

    expect(scheduler.readyTasks(project.id)).toHaveLength(0);
    for (const id of allTaskIds) {
      expect(repo.getTask(id)?.state).toBe("DONE");
    }
    expect(runs).toHaveLength(allTaskIds.length);
    expect(messaging.list()).toHaveLength(runs.length);

    // Read everything back from the repository to prove persistence.
    expect(repo.getOrganization(org.id)?.name).toBe("Demo");
    expect(repo.getProject(project.id)?.name).toBe("calculator");
    expect(repo.listAgents({ organizationId: org.id })).toHaveLength(5);
    expect(repo.listTasks({ projectId: project.id }).every((t) => t.state === "DONE")).toBe(true);
    expect(repo.listMessages().length).toBeGreaterThanOrEqual(allTaskIds.length);
    expect(repo.listAudit().length).toBeGreaterThan(0);
    expect(repo.listEvents().length).toBeGreaterThan(0);
  });
});
