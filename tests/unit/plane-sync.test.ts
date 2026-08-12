import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { PlaneSyncService } from "../../integrations/plane/sync.ts";
import type { PlaneClient, PlaneIssue, PlaneProject } from "../../integrations/plane/client.ts";

class FakePlaneClient implements PlaneClient {
  projects: PlaneProject[] = [];
  issuesByProject: Record<string, PlaneIssue[]> = {};
  createdIssues: Array<{ projectId: string; input: Record<string, unknown> }> = [];
  updates: Array<{ projectId: string; issueId: string; patch: Record<string, unknown> }> = [];

  async listProjects() {
    return this.projects;
  }
  async createProject(name: string, identifier: string) {
    const project = { id: `proj-${this.projects.length + 1}`, name, identifier };
    this.projects.push(project);
    return project;
  }
  async listIssues(projectId: string) {
    return this.issuesByProject[projectId] ?? [];
  }
  async createIssue(projectId: string, input: { name: string; state?: string; priority?: string }) {
    const issue: PlaneIssue = { id: `issue-${this.createdIssues.length + 1}`, name: input.name, state: input.state, priority: input.priority };
    this.createdIssues.push({ projectId, input: input as unknown as Record<string, unknown> });
    (this.issuesByProject[projectId] ??= []).push(issue);
    return issue;
  }
  async updateIssue(projectId: string, issueId: string, patch: Record<string, unknown>) {
    this.updates.push({ projectId, issueId, patch });
    return { id: issueId, name: (patch.name as string) ?? "" };
  }
  async listStates() {
    return [];
  }
}

describe("PlaneSyncService", () => {
  it("maps task states to Plane states", () => {
    const svc = new PlaneSyncService(newTestRepo(), new FakePlaneClient());
    expect(svc.mapState("BACKLOG")).toBe("Backlog");
    expect(svc.mapState("READY")).toBe("Unstarted");
    expect(svc.mapState("IN_PROGRESS")).toBe("Started");
    expect(svc.mapState("REVIEW")).toBe("Started");
    expect(svc.mapState("QA")).toBe("Started");
    expect(svc.mapState("DONE")).toBe("Completed");
    expect(svc.mapState("CANCELLED")).toBe("Cancelled");
  });

  it("creates a Plane project and pushes tasks as issues", async () => {
    const repo = newTestRepo();
    const fake = new FakePlaneClient();
    const svc = new PlaneSyncService(repo, fake);
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "My Project", organizationId: org.id });
    repo.createTask({ title: "Task A", projectId: proj.id });
    repo.createTask({ title: "Task B", projectId: proj.id });

    const result = await svc.pushProject(proj.id);

    expect(result.created).toBe(2);
    expect(fake.projects.length).toBe(1);
    expect(fake.createdIssues.length).toBe(2);
  });

  it("updates existing issues on the second push", async () => {
    const repo = newTestRepo();
    const fake = new FakePlaneClient();
    const svc = new PlaneSyncService(repo, fake);
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "My Project", organizationId: org.id });
    const task = repo.createTask({ title: "Task A", projectId: proj.id });

    await svc.pushProject(proj.id);
    repo.setTaskState(task.id, "DONE");
    const result = await svc.pushProject(proj.id);

    expect(result.created).toBe(0);
    expect(result.updated).toBe(1);
    expect(fake.updates.length).toBe(1);
    expect(fake.updates[0].patch.state).toBe("Completed");
  });
});
