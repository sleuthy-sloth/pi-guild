/**
 * `/studio` command namespace (spec §6, §54).
 *
 * A single registered command that parses `subcommand rest…` and dispatches to
 * small handlers. Each handler returns a string that is surfaced via
 * `ctx.ui.notify`, or drives an interactive dialog when `ctx.hasUI`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { StudioEvents } from "../../core/events.ts";
import { defaultDbPath } from "../../database/db.ts";
import { ProjectRunner, type ReviewPolicy } from "../../core/orchestration/index.ts";
import { currentOrgId } from "../state.ts";
import type { Studio } from "../state.ts";
import { formatAgents, formatTasks } from "../ui/index.ts";

type Handler = (rest: string[], ctx: ExtensionCommandContext) => Promise<string>;

const HELP = [
  "usage: /studio <subcommand> [args]",
  "",
  "  run                           guided wizard: plan + run a job autonomously",
  "  status                        org/project/agent/task counts + paused flag",
  "  setup                         wizard: create org + seed default policies",
  "  org [create <name> | use <id>]",
  "  projects [create <name>]      list current org's projects",
  "  agents [spawn <role> [project] | stop <id>]",
  "  tasks [create <project> <title> | assign <taskId> <agentId>]",
  "  messages [send <recipient> <text>]",
  "  goals [create <title>]",
  "  policies                      list policies",
  "  doctor                        DB path, counts, integrations, settings",
  "  logs [N]                      last N audit entries",
  "  pause | resume                flip the scheduler pause flag",
  "  stop <agentId> | stop project <id>",
  "  approve <id> | reject <id>    resolve a human escalation",
  "  escalate                      create a human escalation",
  "  start                         (stub) background scheduler not implemented",
  "  plane | github                (stub) not configured / later milestone",
].join("\n");

export function registerStudioCommand(pi: ExtensionAPI, studio: Studio): void {
  const handlers: Record<string, Handler> = {
    async run(_rest, ctx): Promise<string> {
      if (!ctx.hasUI) return "run requires an interactive UI";

      const goal = await ctx.ui.input("What should we build?", "e.g. a command-line calculator with tests");
      if (!goal || goal.trim() === "") return "run cancelled";
      const goalText = goal.trim();

      const defaultName =
        goalText
          .split(/\s+/)
          .slice(0, 4)
          .join("-")
          .toLowerCase()
          .replace(/[^a-z0-9-]/g, "")
          .slice(0, 40) || "project";
      const projectName = (await ctx.ui.input("Project name:", defaultName))?.trim() || defaultName;

      const policyChoice = await ctx.ui.select("Approval policy:", [
        "review_and_tests_required (recommended)",
        "fully_autonomous",
        "review_required",
        "manual_merge",
      ]);
      const reviewPolicy: ReviewPolicy =
        policyChoice === "fully_autonomous"
          ? "fully_autonomous"
          : policyChoice === "review_required"
            ? "review_required"
            : policyChoice === "manual_merge"
              ? "manual_merge"
              : "review_and_tests_required";

      let orgId = currentOrgId(studio);
      if (!orgId) {
        const org = studio.organization.create("Default Organization");
        studio.policy.seedDefaults(org.id);
        studio.repo.setSettingJson("currentOrgId", org.id);
        orgId = org.id;
      }

      const project = studio.project.create(orgId, projectName);
      studio.goal.create(goalText, { organizationId: orgId, projectId: project.id });

      const runner = new ProjectRunner(studio.repo, studio.bus, studio.spawner);
      ctx.ui.notify(`Planning "${goalText}"…`, "info");
      const tasks = await runner.plan(project.id, goalText);
      ctx.ui.notify(`Planned ${tasks.length} task(s). Running…`, "info");

      const summary = await runner.runProject({
        projectId: project.id,
        reviewPolicy,
        paused: () => studio.paused,
        onProgress: (m) => ctx.ui.notify(m, "info"),
      });

      return `Done. Project "${project.name}" (${project.id}): ${summary.completed} completed, ${summary.failed} failed, ${summary.cancelled} cancelled (${summary.iterations} iterations).`;
    },

    async status(): Promise<string> {
      const orgs = studio.organization.list().length;
      const projects = studio.project.list().length;
      const agents = studio.agents.list().length;
      const tasks = studio.tasks.list().length;
      return `orgs=${orgs} projects=${projects} agents=${agents} tasks=${tasks} paused=${studio.paused}`;
    },

    async setup(_rest, ctx): Promise<string> {
      if (!ctx.hasUI) return "setup requires an interactive UI";
      const name = await ctx.ui.input("Organization name:", "Acme Software");
      if (!name || name.trim() === "") return "setup cancelled";
      const org = studio.organization.create(name.trim());
      studio.policy.seedDefaults(org.id);
      studio.repo.setSettingJson("currentOrgId", org.id);
      return `Created organization "${org.name}" (${org.id}) and seeded default policies.`;
    },

    async org(rest): Promise<string> {
      if (rest.length === 0) {
        const orgs = studio.organization.list();
        if (orgs.length === 0) return "No organizations. Run /studio setup.";
        const current = currentOrgId(studio);
        return orgs
          .map((o) => `${o.id}  ${o.name}${o.id === current ? "  (current)" : ""}`)
          .join("\n");
      }
      const [verb, ...args] = rest;
      if (verb === "create") {
        const name = args.join(" ").trim();
        if (!name) return "usage: /studio org create <name>";
        const org = studio.organization.create(name);
        return `Created ${org.id}  ${org.name}`;
      }
      if (verb === "use") {
        const id = args[0];
        if (!id) return "usage: /studio org use <id>";
        if (!studio.organization.get(id)) return `No organization with id ${id}`;
        studio.repo.setSettingJson("currentOrgId", id);
        return `Now using organization ${id}`;
      }
      return "usage: /studio org [create <name> | use <id>]";
    },

    async projects(rest): Promise<string> {
      if (rest[0] === "create") {
        const name = rest.slice(1).join(" ").trim();
        if (!name) return "usage: /studio projects create <name>";
        const orgId = currentOrgId(studio);
        if (!orgId) return "No current organization — run /studio setup or /studio org use <id>.";
        const project = studio.project.create(orgId, name);
        return `Created ${project.id}  ${project.name}`;
      }
      const orgId = currentOrgId(studio);
      const projects = studio.project.list(orgId);
      if (projects.length === 0) return "(no projects)";
      return projects.map((p) => `${p.id}  ${p.name}`).join("\n");
    },

    async agents(rest): Promise<string> {
      if (rest[0] === "spawn") {
        const role = rest[1];
        const projectId = rest[2];
        if (!role) return "usage: /studio agents spawn <role> [project]";
        const orgId = currentOrgId(studio);
        if (!orgId) return "No current organization — run /studio setup or /studio org use <id>.";
        const roles = studio.repo.listRoles();
        const roleDef = roles.find((r) => r.name.toLowerCase() === role.toLowerCase());
        if (!roleDef) {
          return `Unknown role "${role}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`;
        }
        const suffix = `${roleDef.name.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`;
        const agent = studio.agents.create({
          name: suffix,
          roleName: roleDef.name,
          roleId: roleDef.id,
          organizationId: orgId,
          projectId,
          state: "IDLE",
          kind: "persistent",
        });
        return `Spawned ${agent.id}  ${agent.name}  (${agent.roleName})`;
      }
      if (rest[0] === "stop") {
        const id = rest[1];
        if (!id) return "usage: /studio agents stop <id>";
        const agent = studio.agents.get(id);
        if (!agent) return `No agent with id ${id}`;
        studio.spawner.stop(id);
        return `Stopped agent ${agent.name} (${id})`;
      }
      return formatAgents(studio.agents.list());
    },

    async tasks(rest): Promise<string> {
      if (rest[0] === "create") {
        const [projectId, ...titleParts] = rest.slice(1);
        const title = titleParts.join(" ").trim();
        if (!projectId || !title) return "usage: /studio tasks create <project> <title>";
        const task = studio.tasks.create({ projectId, title });
        return `Created ${task.id}  [${task.state}] ${task.title}`;
      }
      if (rest[0] === "assign") {
        const [taskId, agentId] = rest.slice(1);
        if (!taskId || !agentId) return "usage: /studio tasks assign <taskId> <agentId>";
        studio.tasks.assign(taskId, agentId);
        return `Assigned task ${taskId} to agent ${agentId}`;
      }
      return formatTasks(studio.tasks.list());
    },

    async messages(rest): Promise<string> {
      if (rest[0] === "send") {
        const [recipient, ...textParts] = rest.slice(1);
        const text = textParts.join(" ").trim();
        if (!recipient || !text) return "usage: /studio messages send <recipient> <text>";
        const message = studio.messaging.send({
          senderName: "human",
          recipientId: recipient,
          content: text,
          messageType: "STATUS",
        });
        return `Sent message ${message.id} to ${recipient}`;
      }
      const messages = studio.messaging.list().slice(-20);
      if (messages.length === 0) return "(no messages)";
      return messages
        .map((m) => `${m.id}  ${m.senderName} -> ${m.recipientId}  [${m.messageType}] ${m.content.slice(0, 100)}`)
        .join("\n");
    },

    async goals(rest): Promise<string> {
      if (rest[0] === "create") {
        const title = rest.slice(1).join(" ").trim();
        if (!title) return "usage: /studio goals create <title>";
        const goal = studio.goal.create(title);
        return `Created ${goal.id}  [${goal.status}] ${goal.title}`;
      }
      const goals = studio.goal.list();
      if (goals.length === 0) return "(no goals)";
      return goals.map((g) => `${g.id}  [${g.status}] ${g.title}`).join("\n");
    },

    async policies(): Promise<string> {
      const policies = studio.policy.list();
      if (policies.length === 0) return "(no policies)";
      return policies.map((p) => `${p.id}  ${p.kind.toUpperCase()}  ${p.target}`).join("\n");
    },

    async doctor(): Promise<string> {
      const orgs = studio.repo.listOrganizations().length;
      const projects = studio.repo.listProjects().length;
      const agents = studio.repo.listAgents().length;
      const tasks = studio.repo.listTasks().length;
      const roles = studio.repo.listRoles().length;
      const integrations = studio.repo.listIntegrations();
      const settings = studio.repo.allSettings();
      return [
        `DB path: ${defaultDbPath()}`,
        `Organizations: ${orgs}`,
        `Projects: ${projects}`,
        `Agents: ${agents}`,
        `Tasks: ${tasks}`,
        `Roles seeded: ${roles > 0 ? `yes (${roles})` : "no"}`,
        `Integrations: ${
          integrations.length === 0
            ? "none"
            : integrations.map((i) => `${i.kind}${i.enabled ? "" : " (disabled)"}`).join(", ")
        }`,
        `Settings: ${
          Object.keys(settings).length === 0
            ? "none"
            : Object.entries(settings)
                .map(([k, v]) => `${k}=${v}`)
                .join(", ")
        }`,
      ].join("\n");
    },

    async logs(rest): Promise<string> {
      const parsed = rest[0] ? Number.parseInt(rest[0], 10) : 20;
      const n = Number.isFinite(parsed) && parsed > 0 ? parsed : 20;
      const entries = studio.repo.listAudit(n);
      if (entries.length === 0) return "No audit entries.";
      return entries
        .map(
          (e) =>
            `${new Date(e.createdAt).toISOString()}  ${e.actor}  ${e.action}  ${e.entityType ?? ""}${e.entityId ? ":" + e.entityId : ""}`,
        )
        .join("\n");
    },

    async pause(): Promise<string> {
      studio.paused = true;
      return "Scheduler paused.";
    },

    async resume(): Promise<string> {
      studio.paused = false;
      return "Scheduler resumed.";
    },

    async stop(rest): Promise<string> {
      if (rest.length === 0) return "usage: /studio stop <agentId> | stop project <id>";
      if (rest[0] === "project") {
        const id = rest[1];
        if (!id) return "usage: /studio stop project <id>";
        const targets = studio.agents
          .list({ projectId: id })
          .filter((a) => a.state !== "STOPPED" && a.state !== "COMPLETED");
        for (const a of targets) studio.spawner.stop(a.id);
        return `Stopped ${targets.length} agent(s) in project ${id}.`;
      }
      const id = rest[0];
      const agent = studio.agents.get(id);
      if (!agent) return `No agent with id ${id}`;
      studio.spawner.stop(id);
      return `Stopped agent ${agent.name} (${id})`;
    },

    async approve(rest): Promise<string> {
      return resolveEscalation(rest, "APPROVED");
    },

    async reject(rest): Promise<string> {
      return resolveEscalation(rest, "REJECTED");
    },

    async escalate(_rest, ctx): Promise<string> {
      if (!ctx.hasUI) return "escalate requires an interactive UI";
      const problem = await ctx.ui.input("Problem:", "Describe what needs human attention");
      if (!problem || problem.trim() === "") return "escalation cancelled";
      const escalation = studio.repo.createEscalation({ problem: problem.trim(), options: [] });
      studio.repo.audit({
        actor: "human",
        action: "escalation.create",
        entityType: "escalation",
        entityId: escalation.id,
        details: { problem: escalation.problem },
      });
      studio.repo.recordEvent(StudioEvents.humanEscalationCreated, {
        escalationId: escalation.id,
        problem: escalation.problem,
      });
      studio.bus.emit(StudioEvents.humanEscalationCreated, {
        escalationId: escalation.id,
        problem: escalation.problem,
      });
      return `Escalation ${escalation.id} created: ${escalation.problem}`;
    },

    async start(): Promise<string> {
      return "background scheduler not implemented yet";
    },

    async plane(): Promise<string> {
      return "not configured / later milestone";
    },

    async github(): Promise<string> {
      return "not configured / later milestone";
    },

    async help(): Promise<string> {
      return HELP;
    },
  };

  function resolveEscalation(rest: string[], status: "APPROVED" | "REJECTED"): string {
    const id = rest[0];
    if (!id) return `usage: /studio ${status === "APPROVED" ? "approve" : "reject"} <escalationId>`;
    const escalation = studio.repo.getEscalation(id);
    if (!escalation) return `No escalation with id ${id}`;
    studio.repo.resolveEscalation(id, status);
    studio.repo.audit({
      actor: "human",
      action: status === "APPROVED" ? "escalation.approve" : "escalation.reject",
      entityType: "escalation",
      entityId: id,
      details: { status },
    });
    studio.repo.recordEvent(StudioEvents.humanEscalationResolved, {
      escalationId: id,
      status,
    });
    studio.bus.emit(StudioEvents.humanEscalationResolved, { escalationId: id, status });
    return `Escalation ${id} ${status === "APPROVED" ? "approved" : "rejected"}.`;
  }

  pi.registerCommand("studio", {
    description: "Pi Studio: multi-agent software-development organization control",
    handler: async (args, ctx) => {
      const tokens = args.trim().split(/\s+/).filter(Boolean);
      const sub = tokens[0] ?? "run";
      const rest = tokens.slice(1);
      const handler = handlers[sub] ?? handlers.help;
      try {
        const out = await handler(rest, ctx);
        if (out) ctx.ui.notify(out, "info");
      } catch (err) {
        ctx.ui.notify(err instanceof Error ? err.message : String(err), "error");
      }
    },
  });
}
