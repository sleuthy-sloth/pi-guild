import { describe, expect, it } from "vitest";
import { AGENT_STATES, canTransition, TASK_STATES } from "../../core/orchestration/index.ts";

describe("lifecycle canTransition", () => {
  it("allows the canonical forward paths", () => {
    expect(canTransition("CREATED", "STARTING")).toBe(true);
    expect(canTransition("STARTING", "IDLE")).toBe(true);
    expect(canTransition("IDLE", "WORKING")).toBe(true);
    expect(canTransition("WORKING", "COMPLETED")).toBe(true);
  });

  it("rejects illegal jumps", () => {
    expect(canTransition("CREATED", "WORKING")).toBe(false);
    expect(canTransition("CREATED", "IDLE")).toBe(false);
    expect(canTransition("COMPLETED", "WORKING")).toBe(false);
    expect(canTransition("STOPPED", "STARTING")).toBe(false);
  });

  it("allows recovery and terminal transitions", () => {
    expect(canTransition("FAILED", "IDLE")).toBe(true);
    expect(canTransition("FAILED", "STOPPED")).toBe(true);
    expect(canTransition("COMPLETED", "IDLE")).toBe(true);
    expect(canTransition("STOPPED", "IDLE")).toBe(true);
    expect(canTransition("BLOCKED", "WORKING")).toBe(true);
    expect(canTransition("WAITING", "WORKING")).toBe(true);
  });

  it("exposes the canonical state lists", () => {
    expect(AGENT_STATES).toContain("CREATED");
    expect(AGENT_STATES).toContain("STOPPED");
    expect(TASK_STATES).toContain("BACKLOG");
    expect(TASK_STATES).toContain("DONE");
  });
});
