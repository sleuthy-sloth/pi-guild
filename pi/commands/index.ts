/**
 * `/studio` command namespace (spec §6, §54).
 *
 * A single registered command that parses `subcommand rest…` and dispatches to
 * small handlers. Each handler returns a string that is surfaced via
 * `ctx.ui.notify`, or drives an interactive dialog when `ctx.hasUI`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { join } from "node:path";
import { homedir } from "node:os";
import { StudioEvents } from "../../core/events.ts";
import { defaultDbPath } from "../../database/db.ts";
import { BackgroundScheduler, ProjectRunner, RecoveryService, type ReviewPolicy } from "../../core/orchestration/index.ts";
import { GitHubProvider, LocalGitProvider } from "../../integrations/git/index.ts";
import { HttpPlaneClient, PlaneSyncService } from "../../integrations/plane/index.ts";
import { GitHubClient } from "../../integrations/github/index.ts";
import { startDashboard } from "../../core/dashboard/server.ts";
import { currentOrgId } from "../state.ts";
import type { Studio } from "../state.ts";
import { formatAgents, formatLive, formatTasks } from "../ui/index.ts";

type Handler = (rest: string[], ctx: ExtensionCommandContext) => Promise<string>;

function formatUsage(s: {
  totalCalls: number;
  totalPromptTokens: number;
  totalCompletionTokens: number;
  totalElapsedMs: number;
}): string {
  return `${s.totalCalls} calls, ${s.totalPromptTokens + s.totalCompletionTokens} tokens, ${Math.round(s.totalElapsedMs / 1000)}s`;
}

const HELP = [
  "usage: /studio <subcommand> [args]",
  "",
  "  run                           guided wizard: plan + run a job autonomously",
  "  council [question | members | add <provider>/<model>]",
  "  bg [<role> <prompt>]           fire-and-forget background job",
  "  live                          refresh the live agent panel",
  "  git setup <project> local <path> | github <url>",
  "  git branch|commit|push|pr|merge|log <taskId>",
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
  "  config [get <key> | set <key> <value> | setjson <key> <json>]",
  "  usage [projectId]             token/call/time usage",
  "  dashboard [status | stop]     start/stop the browser dashboard",
  "  pause | resume                flip the scheduler pause flag",
  "  recover                       reset orphaned agents/tasks (also runs on start)",
  "  stop <agentId> | stop project <id> | stop",
  "  approve <id> | reject <id>    resolve a human escalation",
  "  escalate                      create a human escalation",
  "  start                         start the background scheduler loop",
  "  plane setup <baseUrl> <slug> <apiKey> | status | sync [project] | comments <taskId>",
  "  github [projectId]            PR / CI status via gh",
].join("\n");

export function registerStudioCommand(pi: ExtensionAPI, studio: Studio): void {
  function refreshLive(ctx: ExtensionCommandContext): void {
    if (ctx.hasUI) ctx.ui.setWidget("studio-live", formatLive(studio).split("\n"));
  }

  async function deliberateCouncil(question: string, ctx: ExtensionCommandContext): Promise<string> {
    ctx.ui.notify("Consulting the council…", "info");
    const result = await studio.council.deliberate(question);
    if (!result.consensus) {
      return "No council models configured. Use /studio council add <provider>/<model>.";
    }
    return `Consensus: ${result.consensus}`;
  }

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
      refreshLive(ctx);

      const summary = await runner.runProject({
        projectId: project.id,
        reviewPolicy,
        paused: () => studio.paused,
        merge: (t) => studio.git.merge(t),
        autoMerge: reviewPolicy !== "manual_merge",
        onProgress: (m) => {
          ctx.ui.notify(m, "info");
          refreshLive(ctx);
        },
      });
      refreshLive(ctx);

      return `Done. Project "${project.name}" (${project.id}): ${summary.completed} completed, ${summary.failed} failed, ${summary.cancelled} cancelled (${summary.iterations} iterations).`;
    },

    async live(_rest, ctx): Promise<string> {
      refreshLive(ctx);
      return formatLive(studio);
    },

    async git(rest): Promise<string> {
      const [verb, ...args] = rest;
      const requireTask = (id: string) => {
        const task = studio.tasks.get(id);
        if (!task) throw new Error(`task not found: ${id}`);
        return task;
      };

      if (verb === "setup") {
        const [projectId, kind, target] = args;
        if (!projectId || !kind || !target) return "usage: /studio git setup <project> local <path> | github <url>";
        const project = studio.project.get(projectId);
        if (!project) return `No project with id ${projectId}`;
        if (kind === "github") {
          const path = join(homedir(), ".pi", "agent", "pi-studio", "workspaces", projectId);
          const provider = new GitHubProvider(target, path);
          await provider.clone();
          studio.git.register(projectId, { kind: "github", path, url: target });
          return `Cloned ${target} → ${path} and registered as a GitHub repository.`;
        }
        if (kind === "local") {
          const provider = new LocalGitProvider(target);
          await provider.init();
          studio.git.register(projectId, { kind: "local", path: target });
          return `Initialized local repository at ${target}.`;
        }
        return "usage: /studio git setup <project> local <path> | github <url>";
      }

      if (verb === "branch") {
        const branch = await studio.git.startBranch(requireTask(args[0]));
        return `Branch ${branch}`;
      }
      if (verb === "commit") {
        const task = requireTask(args[0]);
        const message = args.slice(1).join(" ").trim();
        if (!message) return "usage: /studio git commit <taskId> <message>";
        const commit = await studio.git.commit(task, message);
        return `Committed ${commit.sha ?? ""}`;
      }
      if (verb === "push") {
        const task = requireTask(args[0]);
        await studio.git.push(task);
        return `Pushed ${task.branch ?? "branch"}`;
      }
      if (verb === "pr") {
        const task = requireTask(args[0]);
        const pr = await studio.git.openPullRequest(task);
        return `PR ${pr.url ?? pr.number}`;
      }
      if (verb === "merge") {
        const task = requireTask(args[0]);
        await studio.git.merge(task);
        return `Merged ${task.branch ?? "branch"}`;
      }
      if (verb === "log") {
        const task = requireTask(args[0]);
        const repository = studio.git.repositoryFor(task.projectId);
        if (!repository) return "No repository configured for this task's project.";
        const commits = studio.repo.listCommits(repository.id);
        return commits.length === 0
          ? "(no commits)"
          : commits.map((c) => `${c.sha?.slice(0, 7) ?? ""}  ${c.branch ?? ""}  ${c.message}`).join("\n");
      }

      const repos = studio.repo.listRepositories();
      return repos.length === 0
        ? "(no repositories — /studio git setup <project> local <path> | github <url>)"
        : repos.map((r) => `${r.id}  [${r.kind}] ${r.path ?? r.url}  (project ${r.projectId})`).join("\n");
    },

    async council(rest, ctx): Promise<string> {
      if (rest[0] === "members") {
        const members = studio.council.members();
        return members.length === 0
          ? "(no council models — use /studio council add <provider>/<model>)"
          : members.map((m) => `${m.provider}/${m.model}`).join("\n");
      }
      if (rest[0] === "add") {
        const [provider, model] = (rest[1] ?? "").split("/");
        if (!provider || !model) return "usage: /studio council add <provider>/<model>";
        studio.council.addMember({ provider, model });
        return `Council: ${studio.council.members().map((m) => `${m.provider}/${m.model}`).join(", ") || "(none)"}`;
      }
      if (rest[0] === "reset") {
        studio.council.setMembers([]);
        return "Council cleared.";
      }
      const question = rest.join(" ").trim();
      if (!question) {
        if (!ctx.hasUI) return "usage: /studio council <question>";
        const q = await ctx.ui.input("Question for the council:", "Which library should we use?");
        if (!q || !q.trim()) return "council cancelled";
        return deliberateCouncil(q.trim(), ctx);
      }
      return deliberateCouncil(question, ctx);
    },

    async bg(rest): Promise<string> {
      if (rest.length === 0) {
        const running = studio.agents.list().filter((a) => a.state === "WORKING" || a.state === "STARTING");
        return running.length === 0
          ? "(no background jobs running)"
          : running.map((a) => `${a.id}  ${a.name}  [${a.state}] ${a.roleName}`).join("\n");
      }
      const role = rest[0];
      const prompt = rest.slice(1).join(" ").trim();
      if (!prompt) return "usage: /studio bg <role> <prompt>";

      const orgId = currentOrgId(studio);
      if (!orgId) return "No current organization — run /studio setup.";
      const roles = studio.repo.listRoles();
      const roleDef = roles.find((r) => r.name.toLowerCase() === role.toLowerCase());
      if (!roleDef) return `Unknown role "${role}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`;

      let project = studio.project.list(orgId)[0];
      if (!project) project = studio.project.create(orgId, "Inbox");

      const agent = studio.agents.create({
        name: `${roleDef.name.toLowerCase()}-bg-${Date.now().toString(36).slice(-4)}`,
        roleName: roleDef.name,
        roleId: roleDef.id,
        organizationId: orgId,
        projectId: project.id,
        state: "IDLE",
        kind: "ephemeral",
      });
      const task = studio.tasks.create({
        title: `${roleDef.name}: ${prompt}`,
        description: prompt,
        projectId: project.id,
        labels: ["background"],
      });

      // Fire-and-forget: the spawner records the attempt + result to task memory.
      void studio.spawner.run(agent, task).catch(() => {});
      return `Started background ${roleDef.name} job — task ${task.id} (agent ${agent.id}).`;
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

    async config(rest): Promise<string> {
      if (rest.length === 0) {
        const settings = studio.repo.allSettings();
        return Object.keys(settings).length === 0
          ? "(no settings)"
          : Object.entries(settings)
              .map(([k, v]) => `${k} = ${v}`)
              .join("\n");
      }
      if (rest[0] === "get") {
        const value = studio.repo.getSetting(rest[1]);
        return value === undefined ? `(unset) ${rest[1]}` : `${rest[1]} = ${value}`;
      }
      if (rest[0] === "set") {
        const [key, ...valueParts] = rest.slice(1);
        const value = valueParts.join(" ");
        if (!key || !value) return "usage: /studio config set <key> <value>";
        studio.repo.setSetting(key, value);
        return `Set ${key}.`;
      }
      if (rest[0] === "setjson") {
        const [key, ...jsonParts] = rest.slice(1);
        const json = jsonParts.join(" ");
        if (!key || !json) return "usage: /studio config setjson <key> <json>";
        try {
          studio.repo.setSettingJson(key, JSON.parse(json));
        } catch {
          return `Invalid JSON for ${key}.`;
        }
        return `Set ${key} (json).`;
      }
      return "usage: /studio config [get <key> | set <key> <value> | setjson <key> <json>]";
    },

    async usage(rest): Promise<string> {
      if (rest[0]) {
        return formatUsage(studio.repo.usageStats({ projectId: rest[0] }));
      }
      const lines = [`Total: ${formatUsage(studio.repo.usageStats())}`];
      for (const p of studio.project.list()) {
        lines.push(`${p.name}: ${formatUsage(studio.repo.usageStats({ projectId: p.id }))}`);
      }
      return lines.join("\n");
    },

    async dashboard(rest): Promise<string> {
      if (rest[0] === "stop") {
        if (!studio.dashboard) return "Dashboard not running.";
        await studio.dashboard.close();
        studio.dashboard = undefined;
        return "Dashboard stopped.";
      }
      if (rest[0] === "status") {
        return studio.dashboard ? `Dashboard running at ${studio.dashboard.url}` : "Dashboard not running.";
      }
      if (studio.dashboard) return `Dashboard already running at ${studio.dashboard.url}`;

      const resolveEscalation = (id: string, status: "APPROVED" | "REJECTED") => {
        studio.repo.resolveEscalation(id, status);
        studio.repo.audit({
          actor: "human",
          action: status === "APPROVED" ? "escalation.approve" : "escalation.reject",
          entityType: "escalation",
          entityId: id,
        });
        studio.repo.recordEvent(StudioEvents.humanEscalationResolved, { escalationId: id, status });
        studio.bus.emit(StudioEvents.humanEscalationResolved, { escalationId: id, status });
      };

      studio.dashboard = await startDashboard({
        repo: studio.repo,
        isPaused: () => studio.paused,
        pause: () => {
          studio.paused = true;
        },
        resume: () => {
          studio.paused = false;
        },
        approveEscalation: (id) => resolveEscalation(id, "APPROVED"),
        rejectEscalation: (id) => resolveEscalation(id, "REJECTED"),
      });
      return `Dashboard running at ${studio.dashboard.url}`;
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

    async recover(): Promise<string> {
      const report = new RecoveryService(studio.repo).reconcile();
      return `Recovery: reset ${report.agentsReset} agent(s), reopened ${report.tasksReopened} task(s).`;
    },

    async resume(): Promise<string> {
      studio.paused = false;
      return "Scheduler resumed.";
    },

    async stop(rest): Promise<string> {
      if (rest.length === 0) {
        if (!studio.background?.isRunning()) return "Background scheduler not running.";
        studio.background.stop();
        studio.background = undefined;
        return "Background scheduler stopped.";
      }
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
      if (studio.background?.isRunning()) return "Background scheduler already running.";
      studio.background = new BackgroundScheduler(
        studio.repo,
        (projectId) => {
          const runner = new ProjectRunner(studio.repo, studio.bus, studio.spawner);
          return runner.runProject({
            projectId,
            reviewPolicy: "review_and_tests_required",
            paused: () => studio.paused,
            merge: (t) => studio.git.merge(t),
          });
        },
        { pollMs: 2000, paused: () => studio.paused },
      );
      studio.background.start();
      return "Background scheduler started. /studio stop to halt.";
    },

    async plane(rest): Promise<string> {
      const [verb, ...args] = rest;
      if (verb === "setup") {
        const [baseUrl, workspaceSlug, apiKey] = args;
        if (!baseUrl || !workspaceSlug || !apiKey) {
          return "usage: /studio plane setup <baseUrl> <workspaceSlug> <apiKey>";
        }
        const sync = new PlaneSyncService(studio.repo, new HttpPlaneClient({ baseUrl, apiKey, workspaceSlug }));
        sync.saveConfig({ baseUrl, apiKey, workspaceSlug });
        return `Plane configured (${baseUrl}, workspace ${workspaceSlug}).`;
      }
      if (verb === "status") {
        const config = PlaneSyncService.readConfig(studio.repo);
        return config
          ? `Plane configured: ${config.baseUrl} workspace=${config.workspaceSlug}`
          : "Plane not configured. /studio plane setup <baseUrl> <workspaceSlug> <apiKey>";
      }
      if (verb === "sync") {
        const config = PlaneSyncService.readConfig(studio.repo);
        if (!config) return "Plane not configured. /studio plane setup <baseUrl> <workspaceSlug> <apiKey>";
        const sync = new PlaneSyncService(studio.repo, new HttpPlaneClient(config));
        const projectIds = args.length > 0 ? args : studio.project.list().map((p) => p.id);
        const lines: string[] = [];
        for (const projectId of projectIds) {
          const result = await sync.pushProject(projectId);
          lines.push(`project ${projectId}: ${result.created} created, ${result.updated} updated`);
        }
        return lines.join("\n");
      }
      if (verb === "comments") {
        const config = PlaneSyncService.readConfig(studio.repo);
        if (!config) return "Plane not configured.";
        const sync = new PlaneSyncService(studio.repo, new HttpPlaneClient(config));
        const count = await sync.pushComments(args[0]);
        return `Pushed ${count} comment(s).`;
      }
      return "usage: /studio plane setup|status|sync [projectId]|comments <taskId>";
    },

    async github(rest): Promise<string> {
      const projectId = rest[0];
      const repos = projectId ? studio.repo.listRepositories(projectId) : studio.repo.listRepositories();
      const ghRepos = repos.filter((r) => r.kind === "github");
      if (ghRepos.length === 0) {
        return "No GitHub repositories configured. /studio git setup <project> github <url>";
      }
      const lines: string[] = [];
      for (const repo of ghRepos) {
        if (!repo.path) continue;
        const client = new GitHubClient(repo.path);
        const info = await client.repoInfo();
        const prs = await client.listPullRequests();
        const runs = await client.listRuns();
        lines.push(`${info.nameWithOwner ?? "unknown"} (project ${repo.projectId})`);
        lines.push(
          `  PRs: ${prs.length ? prs.map((p) => `#${p.number} ${p.state} ${p.headRefName}`).join(", ") : "none"}`,
        );
        lines.push(
          `  CI: ${runs.length ? runs.map((r) => `${r.name}:${r.status}${r.conclusion ? "/" + r.conclusion : ""}`).join(", ") : "none"}`,
        );
      }
      return lines.join("\n");
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
