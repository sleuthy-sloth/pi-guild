/**
 * Repository providers (spec §8, §33).
 *
 * One abstraction over local git and GitHub (`gh` CLI), with a `CommandRunner`
 * seam so tests can substitute a fake. Providers are thin: they shell out to
 * `git` / `gh`; policy (branch naming, protected branches, DB recording) lives
 * in `core/git/service.ts`.
 */
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Repository } from "../../core/types.ts";

const execFileAsync = promisify(execFile);

export type CommandRunner = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<{ stdout: string; stderr: string }>;

export function realCommandRunner(): CommandRunner {
  return async (command, args, cwd) => {
    const { stdout, stderr } = await execFileAsync(command, args, { cwd });
    return { stdout: String(stdout), stderr: String(stderr) };
  };
}

export interface RepositoryProvider {
  readonly kind: string;
  createBranch(branch: string): Promise<void>;
  addAll(): Promise<void>;
  commit(message: string): Promise<string>;
  push(branch: string): Promise<void>;
  currentBranch(): Promise<string>;
  isClean(): Promise<boolean>;
  createPullRequest(opts: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number }>;
  mergePullRequest(opts: { base: string; head: string }): Promise<void>;
}

export class LocalGitProvider implements RepositoryProvider {
  readonly kind: string = "local";

  constructor(
    protected readonly path: string,
    protected readonly run: CommandRunner = realCommandRunner(),
  ) {}

  protected git(args: string[]): Promise<{ stdout: string; stderr: string }> {
    return this.run("git", args, this.path);
  }

  async init(): Promise<void> {
    await this.git(["init"]);
    await this.git(["add", "-A"]);
    try {
      await this.git(["commit", "-m", "chore: initial commit"]);
    } catch {
      // Nothing to commit (empty repo) — callers should place a file first.
    }
  }

  async createBranch(branch: string): Promise<void> {
    await this.git(["checkout", "-b", branch]);
  }

  async addAll(): Promise<void> {
    await this.git(["add", "-A"]);
  }

  async commit(message: string): Promise<string> {
    await this.git(["commit", "-m", message]);
    const { stdout } = await this.git(["rev-parse", "HEAD"]);
    return stdout.trim();
  }

  async push(branch: string): Promise<void> {
    // A fresh local repo has no remote — skip rather than fail the run.
    try {
      await this.git(["remote", "get-url", "origin"]);
    } catch {
      return;
    }
    await this.git(["push", "-u", "origin", branch]);
  }

  async currentBranch(): Promise<string> {
    const { stdout } = await this.git(["rev-parse", "--abbrev-ref", "HEAD"]);
    return stdout.trim();
  }

  async isClean(): Promise<boolean> {
    const { stdout } = await this.git(["status", "--porcelain"]);
    return stdout.trim() === "";
  }

  async createPullRequest(_opts: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number }> {
    throw new Error("local repositories have no pull requests — configure a GitHub repository");
  }

  async mergePullRequest(_opts: { base: string; head: string }): Promise<void> {
    throw new Error("local repositories have no pull requests — configure a GitHub repository");
  }
}

export class GitHubProvider extends LocalGitProvider {
  readonly kind: string = "github";

  constructor(
    private readonly repoUrl: string,
    path: string,
    run: CommandRunner = realCommandRunner(),
  ) {
    super(path, run);
  }

  async clone(): Promise<void> {
    await this.run("git", ["clone", this.repoUrl, this.path], this.path);
  }

  async createPullRequest(opts: {
    base: string;
    head: string;
    title: string;
    body: string;
  }): Promise<{ url: string; number: number }> {
    const { stdout } = await this.run(
      "gh",
      ["pr", "create", "--base", opts.base, "--head", opts.head, "--title", opts.title, "--body", opts.body],
      this.path,
    );
    const url = (stdout.trim().split("\n").pop() ?? "").trim();
    const match = url.match(/\/pull\/(\d+)/);
    return { url, number: match ? Number(match[1]) : 0 };
  }

  async mergePullRequest(opts: { base: string; head: string }): Promise<void> {
    await this.run("gh", ["pr", "merge", opts.head, "--merge"], this.path);
  }
}

/** Build the right provider for a persisted repository record. */
export function buildProvider(repository: Repository): RepositoryProvider {
  if (!repository.path) {
    throw new Error(`repository ${repository.id} has no local path — run /studio git setup`);
  }
  if (repository.kind === "github") {
    return new GitHubProvider(repository.url ?? "", repository.path);
  }
  return new LocalGitProvider(repository.path);
}
