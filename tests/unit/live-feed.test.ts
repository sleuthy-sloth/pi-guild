import { describe, it, expect } from "vitest";
import { EventBus, GuildEvents } from "../../core/events.ts";
import { getLiveFeed, resetLiveFeed, startLiveFeed } from "../../pi/live.ts";

describe("live feed", () => {
  it("buffers lifecycle events and notifies on change", () => {
    resetLiveFeed();
    const bus = new EventBus();
    let refreshes = 0;
    startLiveFeed(bus, () => {
      refreshes++;
    });

    bus.emit(GuildEvents.agentStarted, { agentId: "a1", taskId: "t1" });
    bus.emit("runner.progress", { projectId: "p1", message: "planning" });
    bus.emit(GuildEvents.taskCompleted, { taskId: "t1", state: "DONE" });

    const feed = getLiveFeed();
    expect(feed.list().map((e) => e.type)).toEqual([
      GuildEvents.agentStarted,
      "runner.progress",
      GuildEvents.taskCompleted,
    ]);
    expect(refreshes).toBe(3);
    resetLiveFeed();
  });
});
