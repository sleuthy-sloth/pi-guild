import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { ContextAssembler } from "../../core/context/assembler.ts";

describe("ContextAssembler", () => {
  it("assembles parent, dependencies, memory, decisions, attempts, and messages", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const parent = repo.createTask({ title: "Parent epic", projectId: proj.id, description: "big goal" });
    const dep = repo.createTask({ title: "Dep task", projectId: proj.id });
    repo.setTaskState(dep.id, "DONE");
    const task = repo.createTask({ title: "Task", projectId: proj.id, parentId: parent.id });
    repo.addDependency(task.id, dep.id);
    repo.addMemory({ scope: "project", scopeId: proj.id, content: "use React", kind: "fact" });
    repo.addMemory({ scope: "project", scopeId: proj.id, content: "Use React for UI", kind: "decision" });
    repo.addMemory({ scope: "task", scopeId: task.id, content: "tried X, failed", kind: "attempt" });
    repo.createMessage({
      senderName: "architect",
      recipientId: "human",
      messageType: "DECISION",
      content: "use Phaser",
      taskId: task.id,
      projectId: proj.id,
    });

    const context = await new ContextAssembler(repo).assemble(task);

    expect(context).toContain("Parent epic");
    expect(context).toContain("Dep task");
    expect(context).toContain("use React");
    expect(context).toContain("Use React for UI");
    expect(context).toContain("tried X");
    expect(context).toContain("use Phaser");
  });

  it("returns empty for a bare task", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "Task", projectId: proj.id });

    expect(await new ContextAssembler(repo).assemble(task)).toBe("");
  });

  it("supports custom sources", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "Task", projectId: proj.id });

    const assembler = new ContextAssembler(repo);
    assembler.addSource({ name: "custom", gather: async () => "## Custom\nhello" });

    expect(await assembler.assemble(task)).toContain("hello");
  });
});
