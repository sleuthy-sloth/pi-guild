import { beforeEach, describe, expect, it } from "vitest";
import { MemoryService } from "../../core/memory/index.ts";
import { StudioRepository } from "../../core/repository.ts";
import { newTestRepo } from "../helpers.ts";

describe("MemoryService", () => {
  let repo: StudioRepository;
  let memory: MemoryService;

  beforeEach(() => {
    repo = newTestRepo();
    memory = new MemoryService(repo);
  });

  it("adds and lists scoped memory", () => {
    memory.add("project", "note for p1", { scopeId: "p1" });
    memory.add("project", "note for p2", { scopeId: "p2" });
    memory.add("project", "global note");

    const p1 = memory.list("project", "p1").map((m) => m.content);
    expect(p1).toContain("note for p1");
    expect(p1).not.toContain("note for p2");
    expect(p1).toContain("global note");
  });

  it("records decisions with a decision kind", () => {
    memory.recordDecision("project", "use SQLite", {
      scopeId: "p1",
      author: "architect",
      alternatives: ["Postgres", "files"],
      owner: "ceo",
    });
    memory.add("project", "regular note", { scopeId: "p1" });

    const decisions = memory.decisions("project", "p1");
    expect(decisions).toHaveLength(1);
    expect(decisions[0].kind).toBe("decision");
    expect(decisions[0].content).toContain("use SQLite");
    expect(decisions[0].content).toContain("Alternatives considered");
    expect(decisions[0].content).toContain("Postgres");
    expect(decisions[0].content).toContain("Decision owner: ceo");
  });
});
