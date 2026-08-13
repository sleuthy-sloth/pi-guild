import { describe, it, expect } from "vitest";
import { GitHubClient } from "../../integrations/github/index.ts";
import type { CommandRunner } from "../../integrations/git/index.ts";

describe("GitHubClient", () => {
  it("parses gh JSON for repo, PRs, and CI runs", async () => {
    const runner: CommandRunner = async (_cmd, args) => {
      if (args[0] === "repo") {
        return { stdout: JSON.stringify({ nameWithOwner: "o/r", defaultBranchRef: { name: "main" } }), stderr: "" };
      }
      if (args[0] === "pr") {
        return {
          stdout: JSON.stringify([
            { number: 1, title: "t", state: "open", url: "u", headRefName: "feature/x", baseRefName: "main" },
          ]),
          stderr: "",
        };
      }
      return {
        stdout: JSON.stringify([{ name: "CI", status: "completed", conclusion: "success" }]),
        stderr: "",
      };
    };

    const client = new GitHubClient("/repo", runner);

    expect((await client.repoInfo()).nameWithOwner).toBe("o/r");
    expect((await client.listPullRequests())[0].number).toBe(1);
    expect((await client.listRuns())[0].conclusion).toBe("success");
  });
});
