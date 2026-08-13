/**
 * GitHub adapter (spec §36) — thin `gh` CLI wrapper for PRs, CI runs, and repo
 * info. The `CommandRunner` seam keeps it testable without a live GitHub.
 */
import { realCommandRunner, type CommandRunner } from "../git/index.ts";

export interface GitHubPr {
  number: number;
  title: string;
  state: string;
  url: string;
  headRefName: string;
  baseRefName: string;
}

export interface GitHubRun {
  name: string;
  status: string;
  conclusion: string | null;
}

export interface GitHubRepoInfo {
  nameWithOwner: string;
  defaultBranchRef: { name: string };
}

export class GitHubClient {
  constructor(
    private readonly repoDir: string,
    private readonly run: CommandRunner = realCommandRunner(),
  ) {}

  private async gh(args: string[]): Promise<string> {
    const { stdout } = await this.run("gh", args, this.repoDir);
    return String(stdout).trim();
  }

  async repoInfo(): Promise<GitHubRepoInfo> {
    return JSON.parse((await this.gh(["repo", "view", "--json", "nameWithOwner,defaultBranchRef"])) || "{}");
  }

  async listPullRequests(): Promise<GitHubPr[]> {
    const out = await this.gh(["pr", "list", "--state", "all", "--json", "number,title,state,url,headRefName,baseRefName"]);
    return JSON.parse(out || "[]") as GitHubPr[];
  }

  async listRuns(): Promise<GitHubRun[]> {
    const out = await this.gh(["run", "list", "--limit", "10", "--json", "name,status,conclusion"]);
    return JSON.parse(out || "[]") as GitHubRun[];
  }
}
