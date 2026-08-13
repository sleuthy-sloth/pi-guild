import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { ModelRouter, pickForClass } from "../../core/orchestration/model-router.ts";

const CLASSES = ["reasoning", "cheap-reasoning", "coding", "cheap-coding", "research"] as const;

describe("ModelRouter", () => {
  it("assignAuto picks a concrete model for every class", () => {
    const repo = newTestRepo();
    const router = new ModelRouter(repo);
    const available = [
      { provider: "opencode-go", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
      { provider: "anthropic", id: "claude-sonnet-4-5", name: "Sonnet" },
      { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o Mini" },
    ];

    const assigned = router.assignAuto(available);

    expect(assigned).toBeGreaterThan(0);
    const classes = router.byClass();
    for (const cls of CLASSES) expect(classes[cls]?.model).toBeTruthy();
  });

  it("assignAuto restricted to a provider only uses that provider's models", () => {
    const repo = newTestRepo();
    const router = new ModelRouter(repo);
    const available = [
      { provider: "opencode-go", id: "deepseek-v4-pro" },
      { provider: "anthropic", id: "claude-sonnet-4-5" },
    ];

    router.assignAuto(available, { provider: "opencode-go" });

    for (const ref of Object.values(router.byClass())) {
      expect(ref.provider).toBe("opencode-go");
    }
  });

  it("resolve falls back role -> class -> role model", () => {
    const repo = newTestRepo();
    const router = new ModelRouter(repo);

    expect(router.resolve("Developer")).toBeUndefined();

    router.setClassModel("coding", "deepseek-v4-pro", "opencode-go");
    expect(router.resolve("Developer")).toEqual({ model: "deepseek-v4-pro", provider: "opencode-go" });

    router.setRoleModel("Developer", "claude-sonnet-4-5", "anthropic");
    expect(router.resolve("Developer")).toEqual({ model: "claude-sonnet-4-5", provider: "anthropic" });
  });

  it("pickForClass prefers capability hints", () => {
    const pool = [
      { provider: "a", id: "gpt-4o-mini" },
      { provider: "b", id: "claude-opus-4-5" },
    ];
    expect(pickForClass(pool, "reasoning")!.id).toBe("claude-opus-4-5");
    expect(pickForClass(pool, "cheap-coding")!.id).toBe("gpt-4o-mini");
  });
});
