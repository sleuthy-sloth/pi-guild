import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { Council } from "../../core/orchestration/council.ts";

describe("Council", () => {
  it("gathers perspectives and synthesizes a consensus", async () => {
    const repo = newTestRepo();
    const synthPrompts: string[] = [];
    const respond = async (member: { provider: string; model: string }, prompt: string) => {
      if (prompt.includes("synthesis moderator")) {
        synthPrompts.push(prompt);
        return "consensus answer";
      }
      return `answer from ${member.provider}/${member.model}`;
    };

    const council = new Council(repo, respond);
    council.setMembers([
      { provider: "anthropic", model: "sonnet" },
      { provider: "openai", model: "gpt" },
    ]);

    const result = await council.deliberate("which library?");

    expect(result.perspectives.length).toBe(2);
    expect(result.perspectives[0].answer).toBe("answer from anthropic/sonnet");
    expect(result.consensus).toBe("consensus answer");
    expect(synthPrompts.length).toBe(1);
  });

  it("returns empty consensus when no members are configured", async () => {
    const repo = newTestRepo();
    const council = new Council(repo, async () => "never called");
    const result = await council.deliberate("question");
    expect(result.perspectives).toEqual([]);
    expect(result.consensus).toBe("");
  });
});
