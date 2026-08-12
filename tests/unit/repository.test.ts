import { beforeEach, describe, expect, it } from "vitest";
import { StudioRepository } from "../../core/repository.ts";
import { newTestRepo } from "../helpers.ts";

describe("StudioRepository", () => {
  let repo: StudioRepository;

  beforeEach(() => {
    repo = newTestRepo();
  });

  it("round-trips organizations, projects, agents, and tasks", () => {
    const org = repo.createOrganization({ name: "Acme" });
    expect(repo.getOrganization(org.id)?.name).toBe("Acme");

    repo.updateOrganization(org.id, { description: "widgets" });
    expect(repo.getOrganization(org.id)?.description).toBe("widgets");

    const project = repo.createProject({ organizationId: org.id, name: "calculator" });
    expect(repo.getProject(project.id)?.name).toBe("calculator");
    expect(repo.listProjects(org.id).map((p) => p.id)).toContain(project.id);

    const agent = repo.createAgent({ name: "dev-1", organizationId: org.id, roleName: "Developer" });
    expect(repo.getAgent(agent.id)?.roleName).toBe("Developer");
    expect(repo.listAgents({ organizationId: org.id }).map((a) => a.id)).toContain(agent.id);

    const task = repo.createTask({ title: "add two numbers", projectId: project.id });
    expect(repo.getTask(task.id)?.title).toBe("add two numbers");
    expect(repo.listTasks({ projectId: project.id }).map((t) => t.id)).toContain(task.id);

    // Deletes work in dependency-safe order.
    repo.deleteTask(task.id);
    expect(repo.getTask(task.id)).toBeUndefined();
    repo.deleteAgent(agent.id);
    expect(repo.getAgent(agent.id)).toBeUndefined();
    repo.deleteProject(project.id);
    expect(repo.getProject(project.id)).toBeUndefined();
    repo.deleteOrganization(org.id);
    expect(repo.getOrganization(org.id)).toBeUndefined();
  });

  it("records task dependency edges in both directions", () => {
    const org = repo.createOrganization({ name: "o" });
    const project = repo.createProject({ organizationId: org.id, name: "p" });
    const a = repo.createTask({ title: "a", projectId: project.id });
    const b = repo.createTask({ title: "b", projectId: project.id });

    repo.addDependency(b.id, a.id);
    expect(repo.listDependencies(b.id).map((t) => t.id)).toEqual([a.id]);
    expect(repo.listDependents(a.id).map((t) => t.id)).toEqual([b.id]);

    repo.removeDependency(b.id, a.id);
    expect(repo.listDependencies(b.id)).toHaveLength(0);
    expect(repo.listDependents(a.id)).toHaveLength(0);
  });

  it("builds a recursive message thread", () => {
    const root = repo.createMessage({
      senderName: "ceo",
      recipientId: "manager",
      messageType: "TASK",
      content: "root",
    });
    const reply = repo.createMessage({
      senderName: "manager",
      recipientId: "ceo",
      messageType: "STATUS",
      content: "reply",
      parentMessageId: root.id,
    });
    const reply2 = repo.createMessage({
      senderName: "ceo",
      recipientId: "manager",
      messageType: "STATUS",
      content: "reply 2",
      parentMessageId: reply.id,
    });

    expect(repo.listThread(root.id).map((m) => m.id)).toEqual([root.id, reply.id, reply2.id]);
  });

  it("scopes memory entries to their scopeId", () => {
    repo.addMemory({ scope: "project", scopeId: "p1", content: "p1 note" });
    repo.addMemory({ scope: "project", scopeId: "p2", content: "p2 note" });
    repo.addMemory({ scope: "project", content: "global note" });

    const p1 = repo.listMemory("project", "p1").map((m) => m.content);
    expect(p1).toContain("p1 note");
    expect(p1).not.toContain("p2 note");
    expect(p1).toContain("global note");
  });

  it("records audit entries, events, and usage stats", () => {
    repo.audit({ actor: "tester", action: "test.run", entityType: "x", entityId: "1", details: { ok: true } });
    const audit = repo.listAudit();
    expect(audit.some((a) => a.action === "test.run" && a.actor === "tester")).toBe(true);

    repo.recordEvent("custom.event", { hello: "world" });
    const events = repo.listEvents();
    expect(events.some((e) => e.type === "custom.event" && e.payload.hello === "world")).toBe(true);

    repo.recordUsage({ projectId: "p1", promptTokens: 10, completionTokens: 5, modelCalls: 2, elapsedMs: 100 });
    repo.recordUsage({ projectId: "p1", promptTokens: 20, completionTokens: 5, modelCalls: 1, elapsedMs: 50 });
    repo.recordUsage({ projectId: "p2", promptTokens: 100, completionTokens: 0, modelCalls: 1, elapsedMs: 10 });

    const stats = repo.usageStats({ projectId: "p1" });
    expect(stats.totalCalls).toBe(2);
    expect(stats.totalPromptTokens).toBe(30);
    expect(stats.totalCompletionTokens).toBe(10);
    expect(stats.totalElapsedMs).toBe(150);
  });
});
