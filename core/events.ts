/**
 * Minimal in-process event bus (spec §19).
 *
 * Event-driven coordination avoids manager agents polling workers. The bus is
 * synchronous and in-memory; the persistence layer records events separately
 * via the repository's `recordEvent` for audit/replay, but runtime
 * subscriptions live here.
 */
import type { StudioEvent } from "./types.ts";

type Handler = (event: StudioEvent) => void | Promise<void>;

export class EventBus {
  private handlers = new Map<string, Set<Handler>>();

  on(type: string, handler: Handler): () => void {
    let set = this.handlers.get(type);
    if (!set) {
      set = new Set();
      this.handlers.set(type, set);
    }
    set.add(handler);
    return () => this.off(type, handler);
  }

  once(type: string, handler: Handler): () => void {
    const wrapper: Handler = (event) => {
      this.off(type, wrapper);
      handler(event);
    };
    return this.on(type, wrapper);
  }

  off(type: string, handler: Handler): void {
    this.handlers.get(type)?.delete(handler);
  }

  emit(type: string, payload: Record<string, unknown> = {}): void {
    const event: StudioEvent = { type, payload, at: Date.now() };
    const set = this.handlers.get(type);
    if (!set) return;
    for (const handler of [...set]) {
      // Fire-and-forget; handlers must not throw.
      void Promise.resolve(handler(event)).catch((err) => {
        console.error(`[pi-studio] event handler for "${type}" failed:`, err);
      });
    }
  }
}

/** Canonical event names emitted across the system (spec §19). */
export const StudioEvents = {
  agentCreated: "agent.created",
  agentStarted: "agent.started",
  agentStopped: "agent.stopped",
  agentStateChanged: "agent.state_changed",

  taskCreated: "task.created",
  taskAssigned: "task.assigned",
  taskStarted: "task.started",
  taskBlocked: "task.blocked",
  taskCompleted: "task.completed",
  taskFailed: "task.failed",
  taskStateChanged: "task.state_changed",

  messageSent: "message.sent",

  reviewRequested: "review.requested",
  reviewCompleted: "review.completed",

  humanEscalationCreated: "human.escalation.created",
  humanEscalationResolved: "human.escalation.resolved",

  goalCreated: "goal.created",
  policyChanged: "policy.changed",
  budgetLimitReached: "budget.limit_reached",
} as const;

/** Shared singleton so domain services and the extension share one bus. */
export const bus = new EventBus();
