import { describe, expect, it } from "vitest";
import { EventBus } from "../../core/events.ts";
import type { GuildEvent } from "../../core/types.ts";

describe("EventBus", () => {
  it("delivers events to on() handlers and unsubscribes via the returned off()", () => {
    const bus = new EventBus();
    const seen: Array<{ type: string; k: string }> = [];
    const handler = (e: GuildEvent) => {
      seen.push({ type: e.type, k: e.payload.k as string });
    };

    const off = bus.on("foo", handler);
    bus.emit("foo", { k: "a" });
    bus.emit("foo", { k: "b" });
    off();
    bus.emit("foo", { k: "c" });

    expect(seen).toEqual([
      { type: "foo", k: "a" },
      { type: "foo", k: "b" },
    ]);
  });

  it("once() fires exactly once", () => {
    const bus = new EventBus();
    let count = 0;
    bus.once("bar", () => {
      count += 1;
    });
    bus.emit("bar");
    bus.emit("bar");
    expect(count).toBe(1);
  });

  it("off(type, handler) removes only that handler", () => {
    const bus = new EventBus();
    let a = 0;
    let b = 0;
    const ha = () => {
      a += 1;
    };
    const hb = () => {
      b += 1;
    };
    bus.on("x", ha);
    bus.on("x", hb);
    bus.emit("x");
    bus.off("x", ha);
    bus.emit("x");

    expect(a).toBe(1);
    expect(b).toBe(2);
  });

  it("emitting with no subscribers is a no-op", () => {
    const bus = new EventBus();
    expect(() => bus.emit("nobody", {})).not.toThrow();
  });
});
