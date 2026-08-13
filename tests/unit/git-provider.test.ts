import { describe, it, expect } from "vitest";
import { LocalGitProvider } from "../../integrations/git/index.ts";
import type { CommandRunner } from "../../integrations/git/index.ts";

function providerFor(handler: CommandRunner) {
  return new LocalGitProvider("/tmp/repo", handler);
}

describe("LocalGitProvider", () => {
  it("skips push when no remote is configured", async () => {
    const calls: string[][] = [];
    const provider = providerFor(async (_cmd, args) => {
      calls.push(args);
      if (args[0] === "remote") throw new Error("no remote");
      return { stdout: "", stderr: "" };
    });

    await provider.push("feature/x"); // must not throw

    expect(calls.some((c) => c[0] === "push")).toBe(false);
  });

  it("pushes when a remote exists", async () => {
    const calls: string[][] = [];
    const provider = providerFor(async (_cmd, args) => {
      calls.push(args);
      if (args[0] === "remote") return { stdout: "https://github.com/o/r.git", stderr: "" };
      return { stdout: "", stderr: "" };
    });

    await provider.push("feature/x");

    expect(calls.some((c) => c[0] === "push")).toBe(true);
  });

  it("init runs init, add, commit", async () => {
    const calls: string[][] = [];
    const provider = providerFor(async (_cmd, args) => {
      calls.push(args);
      return { stdout: "", stderr: "" };
    });

    await provider.init();

    expect(calls.map((c) => c[0])).toEqual(["init", "add", "commit"]);
  });
});
