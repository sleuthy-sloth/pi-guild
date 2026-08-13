import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { installNotifications } from "../../pi/notifications.ts";
import { EventBus, StudioEvents } from "../../core/events.ts";

describe("notifications", () => {
  it("notifies on configured events", () => {
    const repo = newTestRepo();
    const bus = new EventBus();
    const messages: Array<[string, string]> = [];
    const unsub = installNotifications({ repo, bus }, (message, kind) => messages.push([message, kind]));

    bus.emit(StudioEvents.taskBlocked, { taskId: "t1" });
    bus.emit(StudioEvents.humanEscalationCreated, { problem: "need a decision" });
    bus.emit(StudioEvents.taskStateChanged, { taskId: "t2", state: "REVIEW" });
    bus.emit(StudioEvents.taskStateChanged, { taskId: "t3", state: "DONE" });
    bus.emit(StudioEvents.taskFailed, { taskId: "t4" });
    unsub();

    expect(messages.length).toBe(4);
    expect(messages.some(([m]) => m.includes("blocked"))).toBe(true);
    expect(messages.some(([m]) => m.includes("decision"))).toBe(true);
    expect(messages.some(([m]) => m.includes("Review"))).toBe(true);
    expect(messages.some(([m]) => m.includes("failed"))).toBe(true);
  });

  it("respects notification toggles", () => {
    const repo = newTestRepo();
    const bus = new EventBus();
    repo.setSettingJson("notifications", {
      onBlocked: false,
      onEscalation: true,
      onReviewNeeded: false,
      onRepeatedFailure: false,
    });

    const messages: string[] = [];
    const unsub = installNotifications({ repo, bus }, (message) => messages.push(message));

    bus.emit(StudioEvents.taskBlocked, { taskId: "t1" });
    bus.emit(StudioEvents.humanEscalationCreated, { problem: "x" });
    bus.emit(StudioEvents.taskFailed, { taskId: "t2" });
    unsub();

    expect(messages.length).toBe(1);
    expect(messages[0]).toContain("decision");
  });
});
