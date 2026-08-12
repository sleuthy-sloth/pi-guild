/**
 * Small pure formatting helpers for Pi Studio command output (spec §6).
 *
 * No TUI component classes here — just aligned, human-readable text.
 */
import type { Agent, Task } from "../../core/types.ts";
import type { Studio } from "../state.ts";

function column(value: string, width: number): string {
  return value.padEnd(width);
}

function maxWidth(values: string[], fallback: number): number {
  return values.reduce((max, v) => Math.max(max, v.length), fallback);
}

/** Aligned name / role / state / id columns. */
export function formatAgents(agents: Agent[]): string {
  if (agents.length === 0) return "(no agents)";
  const nameW = maxWidth(agents.map((a) => a.name), 4);
  const roleW = maxWidth(agents.map((a) => a.roleName), 4);
  const stateW = maxWidth(agents.map((a) => a.state), 5);
  const header = `${column("name", nameW)}  ${column("role", roleW)}  ${column("state", stateW)}  id`;
  const rows = agents.map(
    (a) => `${column(a.name, nameW)}  ${column(a.roleName, roleW)}  ${column(a.state, stateW)}  ${a.id}`,
  );
  return [header, ...rows].join("\n");
}

/** Aligned state / title / assignee / id columns. */
export function formatTasks(tasks: Task[]): string {
  if (tasks.length === 0) return "(no tasks)";
  const stateW = maxWidth(tasks.map((t) => t.state), 5);
  const titleW = maxWidth(tasks.map((t) => t.title), 5);
  const assigneeW = maxWidth(tasks.map((t) => t.assigneeId ?? "(unassigned)"), 11);
  const header = `${column("state", stateW)}  ${column("title", titleW)}  ${column("assignee", assigneeW)}  id`;
  const rows = tasks.map((t) => {
    const assignee = t.assigneeId ?? "(unassigned)";
    return `${column(t.state, stateW)}  ${column(t.title, titleW)}  ${column(assignee, assigneeW)}  ${t.id}`;
  });
  return [header, ...rows].join("\n");
}

/** Live dashboard: org/project/task counts + the current agent roster. */
export function formatLive(studio: Studio): string {
  const tasks = studio.tasks.list();
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const taskSummary = Object.entries(counts)
    .map(([state, n]) => `${state}=${n}`)
    .join(" ") || "(none)";

  return [
    "Pi Studio — live",
    `orgs=${studio.organization.list().length} projects=${studio.project.list().length} paused=${studio.paused}`,
    `tasks: ${taskSummary}`,
    "",
    formatAgents(studio.agents.list()),
  ].join("\n");
}
