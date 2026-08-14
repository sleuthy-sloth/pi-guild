/**
 * Small pure formatting helpers for Pi Guild command output (spec §6).
 *
 * No TUI component classes here — just aligned, human-readable text.
 */
import type { Agent, GuildEvent, Task } from "../../core/types.ts";
import { GuildEvents } from "../../core/events.ts";
import type { Guild } from "../state.ts";
import { getLiveFeed } from "../live.ts";

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

/** Aligned name / role / state / current-task / id columns. */
export function formatAgents(agents: Agent[], tasks: Task[] = []): string {
  if (agents.length === 0) return "(no agents)";
  const taskById = new Map(tasks.map((t) => [t.id, t] as const));
  const nameW = maxWidth(agents.map((a) => a.name), 4);
  const roleW = maxWidth(agents.map((a) => a.roleName), 4);
  const stateW = maxWidth(agents.map((a) => a.state), 5);
  const header = `${column("name", nameW)}  ${column("role", roleW)}  ${column("state", stateW)}  task  id`;
  const rows = agents.map((a) => {
    const task = a.currentTaskId ? taskById.get(a.currentTaskId) : undefined;
    const doing = task ? `${task.title.slice(0, 40)} [${task.state}]` : "—";
    return `${column(a.name, nameW)}  ${column(a.roleName, roleW)}  ${column(a.state, stateW)}  ${doing}  ${shortId(a.id)}`;
  });
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

/** Human-readable line for one feed event, resolved against live guild state. */
export function formatActivity(guild: Guild, feed: ReturnType<typeof getLiveFeed>): string[] {
  const short = (v: unknown) => String(v ?? "").slice(0, 8);
  const agentName = (id: unknown) => guild.agents.get(String(id ?? ""))?.name ?? short(id);
  const taskTitle = (id: unknown) => guild.tasks.get(String(id ?? ""))?.title ?? short(id);
  return feed
    .list()
    .map((e) => {
      const t = new Date(e.at).toLocaleTimeString();
      const p = e.payload;
      switch (e.type) {
        case GuildEvents.agentStarted:
          return `${t}  ${agentName(p.agentId)} started ${taskTitle(p.taskId)}`;
        case GuildEvents.agentStopped:
          return `${t}  ${agentName(p.agentId)} stopped`;
        case GuildEvents.agentStateChanged:
          return `${t}  ${agentName(p.agentId)} → ${String(p.state)}`;
        case GuildEvents.taskStarted:
          return `${t}  ▸ ${taskTitle(p.taskId)} started`;
        case GuildEvents.taskBlocked:
          return `${t}  ⚠ ${taskTitle(p.taskId)} blocked`;
        case GuildEvents.taskCompleted:
          return `${t}  ✔ ${taskTitle(p.taskId)} completed`;
        case GuildEvents.taskFailed:
          return `${t}  ✖ ${taskTitle(p.taskId)} failed`;
        case GuildEvents.humanEscalationCreated:
          return `${t}  ⚑ needs decision: ${String(p.problem ?? "").slice(0, 60)}`;
        case GuildEvents.humanEscalationResolved:
          return `${t}  ⚑ decision ${String(p.status ?? "resolved")}`;
        case "runner.progress":
          return `${t}  ${String(p.message ?? "")}`;
        case "agent.activity":
          return `${t}  ${agentName(p.agentId)} ${String(p.action ?? "")}`;
        default:
          return undefined;
      }
    })
    .filter((l): l is string => typeof l === "string");
}

/** Live dashboard: org/project/task counts + agent roster + recent activity. */
export function formatLive(guild: Guild): string {
  const tasks = guild.tasks.list();
  const counts: Record<string, number> = {};
  for (const t of tasks) counts[t.state] = (counts[t.state] ?? 0) + 1;
  const taskSummary = Object.entries(counts)
    .map(([state, n]) => `${state}=${n}`)
    .join(" ") || "(none)";

  const lines = [
    "Pi Guild — live",
    `orgs=${guild.organization.list().length} projects=${guild.project.list().length} paused=${guild.paused}`,
    `tasks: ${taskSummary}`,
    "",
    formatAgents(guild.agents.list(), tasks),
  ];
  const activity = formatActivity(guild, getLiveFeed());
  if (activity.length > 0) lines.push("", "recent:", ...activity.slice(-10));
  return lines.join("\n");
}
