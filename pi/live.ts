/**
 * Live activity feed for the Pi Guild panel (spec §6, §39).
 *
 * A tiny in-memory ring buffer of the most recent lifecycle events plus a
 * subscription helper that attaches to the shared event bus and triggers a
 * panel refresh on every event. Formatting/resolution lives in ui/index.ts so
 * this stays dumb and the `guild-live` widget can re-render reactively.
 */
import type { EventBus } from "../core/events.ts";
import { GuildEvents } from "../core/events.ts";
import type { GuildEvent } from "../core/types.ts";

/** Event types worth surfacing in the live panel. */
const FEED_EVENTS: string[] = [
  GuildEvents.agentStarted,
  GuildEvents.agentStopped,
  GuildEvents.agentStateChanged,
  GuildEvents.taskStarted,
  GuildEvents.taskBlocked,
  GuildEvents.taskCompleted,
  GuildEvents.taskFailed,
  GuildEvents.humanEscalationCreated,
  GuildEvents.humanEscalationResolved,
  "runner.progress",
  "agent.activity",
];

const MAX = 80;

class LiveFeed {
  private events: GuildEvent[] = [];

  list(): GuildEvent[] {
    return this.events.slice();
  }

  push(event: GuildEvent): void {
    this.events.push(event);
    if (this.events.length > MAX) this.events.splice(0, this.events.length - MAX);
  }
}

let feed: LiveFeed | undefined;
let off: (() => void) | undefined;

export function getLiveFeed(): LiveFeed {
  if (!feed) feed = new LiveFeed();
  return feed;
}

/** Subscribe to the shared bus, refreshing the panel on each event. Idempotent. */
export function startLiveFeed(bus: EventBus, onChange: () => void): void {
  const f = getLiveFeed();
  off?.();
  const offs = FEED_EVENTS.map((type) =>
    bus.on(type, (event) => {
      f.push(event);
      onChange();
    }),
  );
  off = () => offs.forEach((o) => o());
}

export function resetLiveFeed(): void {
  off?.();
  off = undefined;
  feed = undefined;
}
