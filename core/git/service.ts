/**
 * GitService — the branch/commit/push/PR workflow (spec §33).
 *
 * All policy lives here: branch naming, protected-branch defaults, and DB
 * recording of commits and pull requests. Providers (local git / GitHub) are
 * thin shells; inject a fake provider in tests.
 */
import type { Commit, PullRequest, Repository, Task } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { buildProvider, type RepositoryProvider } from "../../integrations/git/index.ts";

const DEFAULT_PROTECTED = ["main", "master"];

function slugify(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40) || "task";
}

export class GitService {
  constructor(
    private readonly repo: StudioRepository,
    private readonly resolveProvider: (repository: Repository) => RepositoryProvider = buildProvider,
  ) {}

  repositoryFor(projectId: string): Repository | undefined {
    return this.repo.listRepositories(projectId)[0];
  }

  register(projectId: string, opts: { kind: "local" | "github"; path: string; url?: string }): Repository {
    return this.repo.createRepository({
      projectId,
      kind: opts.kind,
      path: opts.path,
      url: opts.url,
      defaultBranch: "main",
      protectedBranches: [],
    });
  }

  /** Branch name for a task: feature|bugfix|refactor/<taskId>-<slug>. */
  branchName(task: Task): string {
    const type = task.labels.includes("bugfix")
      ? "bugfix"
      : task.labels.includes("refactor")
        ? "refactor"
        : "feature";
    return `${type}/${task.id.slice(0, 8)}-${slugify(task.title)}`;
  }

  isProtected(repository: Repository, branch: string): boolean {
    return DEFAULT_PROTECTED.includes(branch) || repository.protectedBranches.includes(branch);
  }

  private require(projectId: string): { repository: Repository; provider: RepositoryProvider } {
    const repository = this.repositoryFor(projectId);
    if (!repository) {
      throw new Error(`no repository configured for project ${projectId} — run /studio git setup`);
    }
    return { repository, provider: this.resolveProvider(repository) };
  }

  async startBranch(task: Task): Promise<string> {
    const { repository, provider } = this.require(task.projectId);
    const branch = this.branchName(task);
    if (this.isProtected(repository, branch)) {
      throw new Error(`refusing to create protected branch ${branch}`);
    }
    await provider.createBranch(branch);
    this.repo.updateTask(task.id, { branch });
    this.repo.audit({
      actor: "git",
      action: "git.branch",
      entityType: "task",
      entityId: task.id,
      details: { branch },
    });
    this.repo.recordEvent("git.branch_created", { taskId: task.id, branch });
    return branch;
  }

  async commit(task: Task, message: string): Promise<Commit> {
    const { repository, provider } = this.require(task.projectId);
    const branch = task.branch ?? (await provider.currentBranch());
    if (this.isProtected(repository, branch)) {
      throw new Error(`refusing to commit directly to protected branch ${branch}`);
    }
    await provider.addAll();
    const sha = await provider.commit(message);
    const commit = this.repo.createCommit({ repositoryId: repository.id, sha, message, branch });
    this.repo.audit({
      actor: "git",
      action: "git.commit",
      entityType: "task",
      entityId: task.id,
      details: { sha, branch },
    });
    this.repo.recordEvent("git.committed", { taskId: task.id, sha, branch });
    return commit;
  }

  async push(task: Task): Promise<void> {
    const { repository, provider } = this.require(task.projectId);
    const branch = task.branch ?? (await provider.currentBranch());
    if (this.isProtected(repository, branch)) {
      throw new Error(`refusing to push protected branch ${branch}`);
    }
    await provider.push(branch);
    this.repo.audit({
      actor: "git",
      action: "git.push",
      entityType: "task",
      entityId: task.id,
      details: { branch },
    });
    this.repo.recordEvent("git.pushed", { taskId: task.id, branch });
  }

  async openPullRequest(task: Task, opts: { title?: string; body?: string } = {}): Promise<PullRequest> {
    const { repository, provider } = this.require(task.projectId);
    const branch = task.branch ?? (await provider.currentBranch());
    if (this.isProtected(repository, branch)) {
      throw new Error(`refusing to open a PR for protected branch ${branch}`);
    }
    const base = repository.defaultBranch ?? "main";
    const result = await provider.createPullRequest({
      base,
      head: branch,
      title: opts.title ?? task.title,
      body: opts.body ?? task.description ?? "",
    });
    const pr = this.repo.createPullRequest({
      repositoryId: repository.id,
      number: result.number,
      title: opts.title ?? task.title,
      state: "open",
      branch,
      baseBranch: base,
      url: result.url,
    });
    this.repo.updateTask(task.id, { pr: result.url });
    this.repo.audit({
      actor: "git",
      action: "git.pull_request",
      entityType: "task",
      entityId: task.id,
      details: { pr: result.url, branch },
    });
    this.repo.recordEvent("pr.created", { taskId: task.id, url: result.url, number: result.number });
    return pr;
  }

  async status(task: Task): Promise<{ branch: string; clean: boolean }> {
    const { provider } = this.require(task.projectId);
    const branch = task.branch ?? (await provider.currentBranch());
    const clean = await provider.isClean();
    return { branch, clean };
  }
}
