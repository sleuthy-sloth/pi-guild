import { beforeEach, describe, expect, it } from "vitest";
import { GuildRepository } from "../../core/repository.ts";
import { TaskService } from "../../core/tasks/index.ts";
import { newTestRepo } from "../helpers.ts";

describe("TaskService", () => {
  let repo: GuildRepository;
  let tasks: TaskService;

  beforeEach(() => {
    repo = newTestRepo();
    tasks = new TaskService(repo);
  });

  function project() {
    const org = repo.createOrganization({ name: "o" });
    return repo.createProject({ organizationId: org.id, name: "p" });
  }

  it("creates and assigns tasks", () => {
    const p = project();
    const task = tasks.create({ title: "t1", projectId: p.id });
    expect(task.state).toBe("BACKLOG");
    expect(task.depth).toBe(0);

    const agent = repo.createAgent({ name: "a", organizationId: p.organizationId, roleName: "Developer" });
    tasks.assign(task.id, agent.id);

    const updated = tasks.get(task.id);
    expect(updated?.assigneeId).toBe(agent.id);
    expect(updated?.state).toBe("READY");
  });

  it("decomposes into children and enforces maxDepth", () => {
    const p = project();
    const parent = tasks.create({ title: "epic", projectId: p.id });
    const children = tasks.decompose(parent.id, [{ title: "story 1" }, { title: "story 2" }], 2);

    expect(children).toHaveLength(2);
    expect(children[0].parentId).toBe(parent.id);
    expect(children[0].depth).toBe(1);

    // Children sit at depth 1; a maxDepth of 1 must now reject further splits.
    expect(() => tasks.decompose(children[0].id, [{ title: "leaf" }], 1)).toThrow(
      "max decomposition depth reached",
    );
  });

  it("rejects self and transitive dependency cycles", () => {
    const p = project();
    const a = tasks.create({ title: "a", projectId: p.id });
    const b = tasks.create({ title: "b", projectId: p.id });
    const c = tasks.create({ title: "c", projectId: p.id });

    expect(() => tasks.addDependency(a.id, a.id)).toThrow("task cannot depend on itself");

    tasks.addDependency(a.id, b.id); // a depends on b
    tasks.addDependency(b.id, c.id); // b depends on c
    // c depends on a would close the loop a -> b -> c -> a
    expect(() => tasks.addDependency(c.id, a.id)).toThrow("cycle");
  });

  it("gates readiness on all dependencies being DONE", () => {
    const p = project();
    const dep = tasks.create({ title: "dep", projectId: p.id });
    const t = tasks.create({ title: "t", projectId: p.id });
    tasks.addDependency(t.id, dep.id);

    expect(tasks.isReady(t.id)).toBe(false);

    tasks.setState(dep.id, "DONE");
    expect(tasks.isReady(t.id)).toBe(true);

    // A task that already left the backlog is never "ready" again.
    tasks.setState(t.id, "IN_PROGRESS");
    expect(tasks.isReady(t.id)).toBe(false);
  });
});
