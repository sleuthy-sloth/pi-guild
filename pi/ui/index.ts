/**
 * Small pure formatting helpers for Pi Guild command output (spec §6).
 *
 * No TUI component classes here — just aligned, human-readable text.
 */
import type { Agent, Task } from "../../core/types.ts";
import type { Guild } from "../state.ts";

function column(value: string, width: number): string {
  return value.padEnd(width);
}

function maxWidth(values: string[], fallback: number): number {
  return values.reduce((max, v) => Math.max(max, v.length), fallback);
}

/** Short readable ids (8 chars) in terminal output. */
function shortId(id: string): string {
  return id ? id.slice(0, 8) : id;
}

/** Aligned name / role / state / id columns. */
export function formatAgents(agents: Agent[]): string {
  if (agents.length === 0) return "(no agents)";
  const nameW = maxWidth(agents.map((a) => a.name), 4);
  const roleW = maxWidth(agents.map((a) => a.roleName), 4);
  const stateW = maxWidth(agents.map((a) => a.state), 5);
  const header = `${column("name", nameW)}  ${column("role", roleW)}  ${column("state", stateW)}  id`;
  const rows = agents.map(
    (a) => `${column(a.name, nameW)}  ${column(a.roleName, roleW)}  ${column(a.state, stateW)}  ${shortId(a.id)}`,
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
    const assignee = t.assigneeId ? shortId(t.assigneeId) : "(unassigned)";
    return `${column(t.state, stateW)}  ${column(t.title, titleW)}  ${column(assignee, assigneeW)}  ${shortId(t.id)}`;
  });
  return [header, ...rows].join("\n");
}

/** Live dashboard: org/project/task counts + the current agent roster. */
export function formatLive(guild: Guild): string {
  const tasks = guild.tasks.list();
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const taskSummary = Object.entries(counts)
    .map(([state, n]) => `${state}=${n}`)
    .join(" ") || "(none)";

  return [
    "Pi Guild — live",
    `orgs=${guild.organization.list().length} projects=${guild.project.list().length} paused=${guild.paused}`,
    `tasks: ${taskSummary}`,
    "",
    formatAgents(guild.agents.list()),
  ].join("\n");
}
