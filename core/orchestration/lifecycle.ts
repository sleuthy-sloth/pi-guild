import type { AgentState, TaskState } from "../types.ts";

/**
 * Canonical lifecycle state lists (spec §15, §22).
 *
 * `canTransition` encodes the directed adjacency graph between agent states.
 * Every state change elsewhere in the engine is expected to honor this graph;
 * it is exported so callers (scheduler, spawner, TUI) can validate a proposed
 * transition before mutating state.
 */

export const AGENT_STATES: AgentState[] = [
  "CREATED",
  "STARTING",
  "IDLE",
  "WORKING",
  "BLOCKED",
  "WAITING",
  "REVIEWING",
  "FAILED",
  "COMPLETED",
  "STOPPED",
];

export const TASK_STATES: TaskState[] = [
  "BACKLOG",
  "READY",
  "PLANNING",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "QA",
  "DONE",
  "CANCELLED",
];

/** Adjacency map for legal agent state transitions (spec §15). */
const AGENT_TRANSITIONS: Record<AgentState, AgentState[]> = {
  CREATED: ["STARTING", "STOPPED"],
  STARTING: ["IDLE", "WORKING", "FAILED"],
  IDLE: ["WORKING", "STOPPED", "REVIEWING", "WAITING", "BLOCKED"],
  WORKING: ["IDLE", "BLOCKED", "WAITING", "REVIEWING", "FAILED", "COMPLETED", "STOPPED"],
  BLOCKED: ["IDLE", "WORKING", "FAILED", "STOPPED"],
  WAITING: ["IDLE", "WORKING", "FAILED", "STOPPED"],
  REVIEWING: ["IDLE", "WORKING", "FAILED", "COMPLETED", "STOPPED"],
  FAILED: ["IDLE", "STOPPED"],
  COMPLETED: ["IDLE", "STOPPED"],
  STOPPED: ["IDLE"],
};

/** Whether `from -> to` is a legal agent state transition. */
export function canTransition(from: AgentState, to: AgentState): boolean {
  return (AGENT_TRANSITIONS[from] ?? []).includes(to);
}
