import { beforeEach, describe, expect, it } from "vitest";
import { AgentRegistryService } from "../../core/agents/index.ts";
import { Scheduler } from "../../core/orchestration/scheduler.ts";
import { StudioRepository } from "../../core/repository.ts";
import type { Agent } from "../../core/types.ts";
import { newTestRepo } from "../helpers.ts";

describe("Scheduler", () => {
  let repo: StudioRepository;
  let agents: AgentRegistryService;

  beforeEach(() => {
    repo = newTestRepo();
    agents = new AgentRegistryService(repo);
  });

  function org() {
    return repo.createOrganization({ name: "o" });
  }

  function project(organizationId: string, name = "p") {
    return repo.createProject({ organizationId, name });
  }

  function idleAgent(organizationId: string, projectId: string, name: string): Agent {
    const agent = agents.create({ name, organizationId, roleName: "Developer", projectId });
    agents.setState(agent.id, "IDLE");
    return repo.getAgent(agent.id) as Agent;
  }

  it("assigns a ready task to an idle agent", () => {
    const o = org();
    const p = project(o.id);
    const agent = idleAgent(o.id, p.id, "dev-1");
    const task = repo.createTask({ title: "t1", projectId: p.id });

    const scheduler = new Scheduler(repo, undefined, { maxConcurrentAgents: 1 });
    const assignments = scheduler.tick(p.id);

    expect(assignments).toHaveLength(1);
    expect(assignments[0].agent.id).toBe(agent.id);
    expect(assignments[0].task.id).toBe(task.id);
    expect(repo.getTask(task.id)?.assigneeId).toBe(agent.id);
    expect(repo.getTask(task.id)?.state).toBe("READY");
    expect(repo.getAgent(agent.id)?.state).toBe("WORKING");
  });

  it("respects maxConcurrentAgents", () => {
    const o = org();
    const p1 = project(o.id, "p1");
    const p2 = project(o.id, "p2");
    idleAgent(o.id, p1.id, "dev-1");
    idleAgent(o.id, p2.id, "dev-2");
    repo.createTask({ title: "t1", projectId: p1.id });
    repo.createTask({ title: "t2", projectId: p2.id });

    const limited = new Scheduler(repo, undefined, { maxConcurrentAgents: 1 });
    expect(limited.tick()).toHaveLength(1);
  });

  it("pairs multiple projects in one tick when concurrency allows", () => {
    const o = org();
    const p1 = project(o.id, "p1");
    const p2 = project(o.id, "p2");
    idleAgent(o.id, p1.id, "dev-1");
    idleAgent(o.id, p2.id, "dev-2");
    repo.createTask({ title: "t1", projectId: p1.id });
    repo.createTask({ title: "t2", projectId: p2.id });

    const scheduler = new Scheduler(repo, undefined, { maxConcurrentAgents: 2 });
    expect(scheduler.tick()).toHaveLength(2);
  });

  it("skips tasks with unfinished dependencies", () => {
    const o = org();
    const p = project(o.id);
    idleAgent(o.id, p.id, "dev-1");
    const dep = repo.createTask({ title: "dep", projectId: p.id });
    const blocked = repo.createTask({ title: "blocked", projectId: p.id });
    repo.addDependency(blocked.id, dep.id);

    const scheduler = new Scheduler(repo, undefined, { maxConcurrentAgents: 4 });
    const assignments = scheduler.tick(p.id);

    expect(assignments).toHaveLength(1);
    expect(assignments[0].task.id).toBe(dep.id);
    expect(repo.getTask(blocked.id)?.assigneeId).toBeNull();
    expect(repo.getTask(blocked.id)?.state).toBe("BACKLOG");
  });

  it("filters available agents by role", () => {
    const o = org();
    const p = project(o.id);
    idleAgent(o.id, p.id, "dev-1");
    const reviewer = agents.create({ name: "rev-1", organizationId: o.id, roleName: "Reviewer", projectId: p.id });
    agents.setState(reviewer.id, "IDLE");
    repo.createTask({ title: "t1", projectId: p.id });

    const scheduler = new Scheduler(repo, undefined, { maxConcurrentAgents: 4 });
    const assignments = scheduler.tick(p.id, { roleName: "Reviewer" });

    expect(assignments).toHaveLength(1);
    expect(assignments[0].agent.roleName).toBe("Reviewer");
  });
});
