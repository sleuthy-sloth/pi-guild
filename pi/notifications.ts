/**
 * Notifications (spec §39) — config-driven event → TUI notification.
 *
 * Subscribes to the shared event bus and surfaces human-relevant events as
 * `ctx.ui.notify` calls, gated by the `notifications` setting. Returns an
 * unsubscribe function for session teardown.
 */
import type { GuildRepository } from "../core/repository.ts";
import { GuildEvents } from "../core/events.ts";
import type { EventBus } from "../core/events.ts";
import type { GuildEvent } from "../core/types.ts";

export interface NotificationConfig {
  onBlocked: boolean;
  onEscalation: boolean;
  onReviewNeeded: boolean;
  onRepeatedFailure: boolean;
}

export const DEFAULT_NOTIFICATIONS: NotificationConfig = {
  onBlocked: true,
  onEscalation: true,
  onReviewNeeded: true,
  onRepeatedFailure: true,
};

export function installNotifications(
  deps: { repo: GuildRepository; bus: EventBus },
  notify: (message: string, kind: "info" | "warning" | "error") => void,
): () => void {
  const config = deps.repo.getSettingJson<NotificationConfig>("notifications", DEFAULT_NOTIFICATIONS);
  const unsubs: Array<() => void> = [];
  const on = (type: string, handler: (event: GuildEvent) => void) => {
    unsubs.push(deps.bus.on(type, handler));
  };

  on(GuildEvents.taskBlocked, (e) => {
    if (config.onBlocked) notify(`Task blocked: ${e.payload.taskId}`, "warning");
  });
  on(GuildEvents.humanEscalationCreated, (e) => {
    if (config.onEscalation) {
      notify(`Human decision needed: ${e.payload.problem ?? e.payload.escalationId}`, "warning");
    }
  });
  on(GuildEvents.taskStateChanged, (e) => {
    if (config.onReviewNeeded && e.payload.state === "REVIEW") {
      notify(`Review needed: ${e.payload.taskId}`, "info");
    }
  });
  on(GuildEvents.taskFailed, (e) => {
    if (config.onRepeatedFailure) notify(`Task failed: ${e.payload.taskId}`, "error");
  });

  return () => unsubs.forEach((u) => u());
}
