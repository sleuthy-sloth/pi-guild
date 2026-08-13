import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { GitService } from "../../core/git/service.ts";
import type { RepositoryProvider } from "../../integrations/git/index.ts";

class FakeProvider implements RepositoryProvider {
  readonly kind = "fake";
  branches: string[] = [];
  commits: string[] = [];
  pushes: string[] = [];
  prs: Array<{ base: string; head: string; title: string; body: string }> = [];
  merges: string[] = [];

  async createBranch(branch: string) {
    this.branches.push(branch);
  }
  async addAll() {}
  async commit(message: string) {
    this.commits.push(message);
    return "abc123";
  }
  async push(branch: string) {
    this.pushes.push(branch);
  }
  async currentBranch() {
    return "feature/x";
  }
  async isClean() {
    return true;
  }
  async createPullRequest(opts: { base: string; head: string; title: string; body: string }) {
    this.prs.push(opts);
    return { url: "https://github.com/o/r/pull/1", number: 1 };
  }
  async mergePullRequest(_opts: { base: string; head: string }) {
    this.merges.push(_opts.head);
  }
}

function setup() {
  const repo = newTestRepo();
  const org = repo.createOrganization({ name: "Demo" });
  const proj = repo.createProject({ name: "calc", organizationId: org.id });
  const fake = new FakeProvider();
  const service = new GitService(repo, () => fake);
  service.register(proj.id, { kind: "local", path: "/tmp/repo" });
  const repository = service.repositoryFor(proj.id)!;
  return { repo, proj, fake, service, repository };
}

describe("GitService.branchName", () => {
  it("uses feature/ by default, bugfix/ and refactor/ from labels", () => {
    const { repo, proj, service } = setup();
    const feature = repo.createTask({ title: "Add login page", projectId: proj.id });
    const bugfix = repo.createTask({ title: "Fix crash on save", projectId: proj.id, labels: ["bugfix"] });
    const refactor = repo.createTask({ title: "Split module", projectId: proj.id, labels: ["refactor"] });

    expect(service.branchName(feature)).toMatch(/^feature\/[a-f0-9]{8}-add-login-page$/);
    expect(service.branchName(bugfix)).toMatch(/^bugfix\//);
    expect(service.branchName(refactor)).toMatch(/^refactor\//);
  });
});

describe("GitService", () => {
  it("startBranch creates and records the branch", async () => {
    const { repo, proj, fake, service } = setup();
    const task = repo.createTask({ title: "Add login page", projectId: proj.id });

    const branch = await service.startBranch(task);

    expect(fake.branches).toContain(branch);
    expect(repo.getTask(task.id)!.branch).toBe(branch);
  });

  it("commit records the commit row", async () => {
    const { repo, proj, service, repository } = setup();
    const task = repo.createTask({ title: "Add login page", projectId: proj.id });
    await service.startBranch(task);

    const commit = await service.commit(task, "add login");

    expect(commit.sha).toBe("abc123");
    expect(repo.listCommits(repository.id).length).toBe(1);
    expect(repo.listCommits(repository.id)[0].branch).toContain("feature/");
  });

  it("openPullRequest records the PR and links the task", async () => {
    const { repo, proj, service, repository } = setup();
    const task = repo.createTask({ title: "Add login page", projectId: proj.id });
    await service.startBranch(task);

    const pr = await service.openPullRequest(task);

    expect(pr.url).toContain("pull/1");
    expect(repo.getTask(task.id)!.pr).toBe(pr.url);
    expect(repo.listPullRequests(repository.id).length).toBe(1);
  });

  it("refuses to commit/push/PR directly on a protected branch", async () => {
    const { repo, proj, service } = setup();
    const task = repo.createTask({ title: "Add login page", projectId: proj.id, branch: "main" });

    await expect(service.commit(task, "bad")).rejects.toThrow(/protected/);
    await expect(service.push(task)).rejects.toThrow(/protected/);
    await expect(service.openPullRequest(task)).rejects.toThrow(/protected/);
  });

  it("merge calls the provider and marks the PR merged", async () => {
    const { repo, proj, fake, service, repository } = setup();
    const task = repo.createTask({ title: "Add login page", projectId: proj.id });
    await service.startBranch(task);
    await service.openPullRequest(task);

    await service.merge(task);

    expect(fake.merges).toContain("feature/x");
    expect(repo.listPullRequests(repository.id)[0].state).toBe("merged");
  });
});
