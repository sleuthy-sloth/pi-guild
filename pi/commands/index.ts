/**
 * `/guild` command namespace (spec §6, §54).
 *
 * A single registered command that parses `subcommand rest…` and dispatches to
 * small handlers. Each handler returns a string that is surfaced via
 * `ctx.ui.notify`, or drives an interactive dialog when `ctx.hasUI`.
 */
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";
import { GuildEvents } from "../../core/events.ts";
import { defaultDbPath } from "../../database/db.ts";
import { BackgroundScheduler, ProjectRunner, RecoveryService, type ReviewPolicy } from "../../core/orchestration/index.ts";
import { GitHubProvider, LocalGitProvider } from "../../integrations/git/index.ts";
import { HttpPlaneClient, PlaneSyncService } from "../../integrations/plane/index.ts";
import { GitHubClient } from "../../integrations/github/index.ts";
import { startDashboard } from "../../core/dashboard/server.ts";
import { currentOrgId } from "../state.ts";
import type { Guild } from "../state.ts";
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

interface AvailModel {
  provider: string;
  id: string;
  name?: string;
}

/** Models with valid auth configured on the harness (logged in). */
function availableModels(ctx: ExtensionCommandContext): AvailModel[] {
  try {
    return ctx.modelRegistry.getAvailable().map((m) => ({ provider: m.provider, id: m.id, name: m.name }));
  } catch {
    return [];
  }
}

function parseModelRef(ref: string): { provider: string; model: string } | undefined {
  const slash = ref.lastIndexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return undefined;
  return { provider: ref.slice(0, slash), model: ref.slice(slash + 1) };
}

const HELP = [
  "usage: /guild <subcommand> [args]",
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
  "  models [list|providers|auto [provider]|preset <provider>|set <role> p/m|class <c> p/m|clear]",
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

export function registerGuildCommand(pi: ExtensionAPI, guild: Guild): void {
  function refreshLive(ctx: ExtensionCommandContext): void {
    if (ctx.hasUI) ctx.ui.setWidget("guild-live", formatLive(guild).split("\n"));
  }

  async function deliberateCouncil(question: string, ctx: ExtensionCommandContext): Promise<string> {
    ctx.ui.notify("Consulting the council…", "info");
    const result = await guild.council.deliberate(question);
    if (!result.consensus) {
      return "No council models configured. Use /guild council add <provider>/<model>.";
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

      let orgId = currentOrgId(guild);
      if (!orgId) {
        const org = guild.organization.create("Default Organization");
        guild.policy.seedDefaults(org.id);
        guild.repo.setSettingJson("currentOrgId", org.id);
        orgId = org.id;
      }

      const project = guild.project.create(orgId, projectName);
      guild.goal.create(goalText, { organizationId: orgId, projectId: project.id });

      // Give the team a real local repo to work in (branch + commit work locally;
      // push/PR need a remote configured later via /guild git setup). Non-fatal:
      // if git isn't available, the team still works in the workspace.
      try {
        const workspaceDir = join(homedir(), ".pi", "agent", "pi-guild", "workspaces", project.id);
        mkdirSync(workspaceDir, { recursive: true });
        writeFileSync(
          join(workspaceDir, "README.md"),
          `# ${projectName}\n\nAutonomous workspace for: ${goalText}\n`,
        );
        const gitProvider = new LocalGitProvider(workspaceDir);
        await gitProvider.init();
        guild.git.register(project.id, { kind: "local", path: workspaceDir });
      } catch {
        ctx.ui.notify("Could not initialize a git repository — the team will work without one.", "warning");
      }

      const runner = new ProjectRunner(guild.repo, guild.bus, guild.spawner);
      ctx.ui.notify(`Planning "${goalText}"…`, "info");
      const tasks = await runner.plan(project.id, goalText);
      ctx.ui.notify(`Planned ${tasks.length} task(s). Running…`, "info");
      refreshLive(ctx);

      const summary = await runner.runProject({
        projectId: project.id,
        reviewPolicy,
        paused: () => guild.paused,
        merge: (t) => guild.git.merge(t),
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
      return formatLive(guild);
    },

    async git(rest): Promise<string> {
      const [verb, ...args] = rest;
      const requireTask = (id: string) => {
        const task = guild.tasks.get(id);
        if (!task) throw new Error(`task not found: ${id}`);
        return task;
      };

      if (verb === "setup") {
        const [projectId, kind, target] = args;
        if (!projectId || !kind || !target) return "usage: /guild git setup <project> local <path> | github <url>";
        const project = guild.project.get(projectId);
        if (!project) return `No project with id ${projectId}`;
        if (kind === "github") {
          const path = join(homedir(), ".pi", "agent", "pi-guild", "workspaces", projectId);
          const provider = new GitHubProvider(target, path);
          await provider.clone();
          guild.git.register(projectId, { kind: "github", path, url: target });
          return `Cloned ${target} → ${path} and registered as a GitHub repository.`;
        }
        if (kind === "local") {
          const provider = new LocalGitProvider(target);
          await provider.init();
          guild.git.register(projectId, { kind: "local", path: target });
          return `Initialized local repository at ${target}.`;
        }
        return "usage: /guild git setup <project> local <path> | github <url>";
      }

      if (verb === "branch") {
        const branch = await guild.git.startBranch(requireTask(args[0]));
        return `Branch ${branch}`;
      }
      if (verb === "commit") {
        const task = requireTask(args[0]);
        const message = args.slice(1).join(" ").trim();
        if (!message) return "usage: /guild git commit <taskId> <message>";
        const commit = await guild.git.commit(task, message);
        return `Committed ${commit.sha ?? ""}`;
      }
      if (verb === "push") {
        const task = requireTask(args[0]);
        await guild.git.push(task);
        return `Pushed ${task.branch ?? "branch"}`;
      }
      if (verb === "pr") {
        const task = requireTask(args[0]);
        const pr = await guild.git.openPullRequest(task);
        return `PR ${pr.url ?? pr.number}`;
      }
      if (verb === "merge") {
        const task = requireTask(args[0]);
        await guild.git.merge(task);
        return `Merged ${task.branch ?? "branch"}`;
      }
      if (verb === "log") {
        const task = requireTask(args[0]);
        const repository = guild.git.repositoryFor(task.projectId);
        if (!repository) return "No repository configured for this task's project.";
        const commits = guild.repo.listCommits(repository.id);
        return commits.length === 0
          ? "(no commits)"
          : commits.map((c) => `${c.sha?.slice(0, 7) ?? ""}  ${c.branch ?? ""}  ${c.message}`).join("\n");
      }

      const repos = guild.repo.listRepositories();
      return repos.length === 0
        ? "(no repositories — /guild git setup <project> local <path> | github <url>)"
        : repos.map((r) => `${r.id}  [${r.kind}] ${r.path ?? r.url}  (project ${r.projectId})`).join("\n");
    },

    async council(rest, ctx): Promise<string> {
      if (rest[0] === "members") {
        const members = guild.council.members();
        return members.length === 0
          ? "(no council models — use /guild council add <provider>/<model>)"
          : members.map((m) => `${m.provider}/${m.model}`).join("\n");
      }
      if (rest[0] === "add") {
        const [provider, model] = (rest[1] ?? "").split("/");
        if (!provider || !model) return "usage: /guild council add <provider>/<model>";
        guild.council.addMember({ provider, model });
        return `Council: ${guild.council.members().map((m) => `${m.provider}/${m.model}`).join(", ") || "(none)"}`;
      }
      if (rest[0] === "reset") {
        guild.council.setMembers([]);
        return "Council cleared.";
      }
      const question = rest.join(" ").trim();
      if (!question) {
        if (!ctx.hasUI) return "usage: /guild council <question>";
        const q = await ctx.ui.input("Question for the council:", "Which library should we use?");
        if (!q || !q.trim()) return "council cancelled";
        return deliberateCouncil(q.trim(), ctx);
      }
      return deliberateCouncil(question, ctx);
    },

    async bg(rest): Promise<string> {
      if (rest.length === 0) {
        const running = guild.agents.list().filter((a) => a.state === "WORKING" || a.state === "STARTING");
        return running.length === 0
          ? "(no background jobs running)"
          : running.map((a) => `${a.id}  ${a.name}  [${a.state}] ${a.roleName}`).join("\n");
      }
      const role = rest[0];
      const prompt = rest.slice(1).join(" ").trim();
      if (!prompt) return "usage: /guild bg <role> <prompt>";

      const orgId = currentOrgId(guild);
      if (!orgId) return "No current organization — run /guild setup.";
      const roles = guild.repo.listRoles();
      const roleDef = roles.find((r) => r.name.toLowerCase() === role.toLowerCase());
      if (!roleDef) return `Unknown role "${role}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`;

      let project = guild.project.list(orgId)[0];
      if (!project) project = guild.project.create(orgId, "Inbox");

      const agent = guild.agents.create({
        name: `${roleDef.name.toLowerCase()}-bg-${Date.now().toString(36).slice(-4)}`,
        roleName: roleDef.name,
        roleId: roleDef.id,
        organizationId: orgId,
        projectId: project.id,
        state: "IDLE",
        kind: "ephemeral",
      });
      const task = guild.tasks.create({
        title: `${roleDef.name}: ${prompt}`,
        description: prompt,
        projectId: project.id,
        labels: ["background"],
      });

      // Fire-and-forget: the spawner records the attempt + result to task memory.
      void guild.spawner.run(agent, task).catch(() => {});
      return `Started background ${roleDef.name} job — task ${task.id} (agent ${agent.id}).`;
    },

    async status(): Promise<string> {
      const orgs = guild.organization.list().length;
      const projects = guild.project.list().length;
      const agents = guild.agents.list().length;
      const tasks = guild.tasks.list().length;
      return `orgs=${orgs} projects=${projects} agents=${agents} tasks=${tasks} paused=${guild.paused}`;
    },

    async setup(_rest, ctx): Promise<string> {
      if (!ctx.hasUI) return "setup requires an interactive UI";
      const existing = guild.organization.list();
      if (existing.length > 0) {
        const current = currentOrgId(guild) ?? existing[0].id;
        const org = existing.find((o) => o.id === current) ?? existing[0];
        return `Already set up — organization "${org.name}". Run /guild to start a job.`;
      }
      const name = await ctx.ui.input("Organization name:", "Acme Software");
      if (!name || name.trim() === "") return "setup cancelled";
      const org = guild.organization.create(name.trim());
      guild.policy.seedDefaults(org.id);
      guild.repo.setSettingJson("currentOrgId", org.id);

      const route = await ctx.ui.select("Model routing:", [
        "Auto-assign from logged-in models (Recommended)",
        "Choose per model class",
        "Skip — assign later with /guild models",
      ]);
      if (route?.startsWith("Auto")) {
        const assigned = guild.router.assignAuto(availableModels(ctx));
        ctx.ui.notify(
          assigned > 0 ? `Assigned ${assigned} model class(es).` : "No logged-in models found — assign later with /guild models.",
          "info",
        );
        return `Created organization "${org.name}" (${org.id}) and seeded default policies.`;
      }
      if (route?.startsWith("Choose")) {
        const models = availableModels(ctx);
        if (models.length === 0) {
          return "Created organization but found no logged-in models. Assign models later with /guild models.";
        }
        const classes: Array<[string, string]> = [
          ["reasoning", "Reasoning"],
          ["cheap-reasoning", "Cheap reasoning"],
          ["coding", "Coding"],
          ["cheap-coding", "Cheap coding"],
          ["research", "Research"],
        ];
        for (const [cls, label] of classes) {
          const choice = await ctx.ui.select(`${label} model:`, models.map((m) => `${m.provider}/${m.id}`));
          if (choice) {
            const parsed = parseModelRef(choice);
            if (parsed) guild.router.setClassModel(cls, parsed.model, parsed.provider);
          }
        }
        return `Created organization "${org.name}" and configured model routing.\n${guild.router.describe()}`;
      }
      return `Created organization "${org.name}" (${org.id}) and seeded default policies.`;
    },

    async org(rest): Promise<string> {
      if (rest.length === 0) {
        const orgs = guild.organization.list();
        if (orgs.length === 0) return "No organizations. Run /guild setup.";
        const current = currentOrgId(guild);
        return orgs
          .map((o) => `${o.id}  ${o.name}${o.id === current ? "  (current)" : ""}`)
          .join("\n");
      }
      const [verb, ...args] = rest;
      if (verb === "create") {
        const name = args.join(" ").trim();
        if (!name) return "usage: /guild org create <name>";
        const org = guild.organization.create(name);
        return `Created ${org.id}  ${org.name}`;
      }
      if (verb === "use") {
        const id = args[0];
        if (!id) return "usage: /guild org use <id>";
        if (!guild.organization.get(id)) return `No organization with id ${id}`;
        guild.repo.setSettingJson("currentOrgId", id);
        return `Now using organization ${id}`;
      }
      return "usage: /guild org [create <name> | use <id>]";
    },

    async projects(rest): Promise<string> {
      if (rest[0] === "create") {
        const name = rest.slice(1).join(" ").trim();
        if (!name) return "usage: /guild projects create <name>";
        const orgId = currentOrgId(guild);
        if (!orgId) return "No current organization — run /guild setup or /guild org use <id>.";
        const project = guild.project.create(orgId, name);
        return `Created ${project.id}  ${project.name}`;
      }
      const orgId = currentOrgId(guild);
      const projects = guild.project.list(orgId);
      if (projects.length === 0) return "(no projects)";
      return projects.map((p) => `${p.id}  ${p.name}`).join("\n");
    },

    async agents(rest): Promise<string> {
      if (rest[0] === "spawn") {
        const role = rest[1];
        const projectId = rest[2];
        if (!role) return "usage: /guild agents spawn <role> [project]";
        const orgId = currentOrgId(guild);
        if (!orgId) return "No current organization — run /guild setup or /guild org use <id>.";
        const roles = guild.repo.listRoles();
        const roleDef = roles.find((r) => r.name.toLowerCase() === role.toLowerCase());
        if (!roleDef) {
          return `Unknown role "${role}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`;
        }
        const suffix = `${roleDef.name.toLowerCase()}-${Math.random().toString(36).slice(2, 6)}`;
        const agent = guild.agents.create({
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
        if (!id) return "usage: /guild agents stop <id>";
        const agent = guild.agents.get(id);
        if (!agent) return `No agent with id ${id}`;
        guild.spawner.stop(id);
        return `Stopped agent ${agent.name} (${id})`;
      }
      return formatAgents(guild.agents.list());
    },

    async tasks(rest): Promise<string> {
      if (rest[0] === "create") {
        const [projectId, ...titleParts] = rest.slice(1);
        const title = titleParts.join(" ").trim();
        if (!projectId || !title) return "usage: /guild tasks create <project> <title>";
        const task = guild.tasks.create({ projectId, title });
        return `Created ${task.id}  [${task.state}] ${task.title}`;
      }
      if (rest[0] === "assign") {
        const [taskId, agentId] = rest.slice(1);
        if (!taskId || !agentId) return "usage: /guild tasks assign <taskId> <agentId>";
        guild.tasks.assign(taskId, agentId);
        return `Assigned task ${taskId} to agent ${agentId}`;
      }
      return formatTasks(guild.tasks.list());
    },

    async messages(rest): Promise<string> {
      if (rest[0] === "send") {
        const [recipient, ...textParts] = rest.slice(1);
        const text = textParts.join(" ").trim();
        if (!recipient || !text) return "usage: /guild messages send <recipient> <text>";
        const message = guild.messaging.send({
          senderName: "human",
          recipientId: recipient,
          content: text,
          messageType: "STATUS",
        });
        return `Sent message ${message.id} to ${recipient}`;
      }
      const messages = guild.messaging.list().slice(-20);
      if (messages.length === 0) return "(no messages)";
      return messages
        .map((m) => `${m.id}  ${m.senderName} -> ${m.recipientId}  [${m.messageType}] ${m.content.slice(0, 100)}`)
        .join("\n");
    },

    async goals(rest): Promise<string> {
      if (rest[0] === "create") {
        const title = rest.slice(1).join(" ").trim();
        if (!title) return "usage: /guild goals create <title>";
        const goal = guild.goal.create(title);
        return `Created ${goal.id}  [${goal.status}] ${goal.title}`;
      }
      const goals = guild.goal.list();
      if (goals.length === 0) return "(no goals)";
      return goals.map((g) => `${g.id}  [${g.status}] ${g.title}`).join("\n");
    },

    async policies(): Promise<string> {
      const policies = guild.policy.list();
      if (policies.length === 0) return "(no policies)";
      return policies.map((p) => `${p.id}  ${p.kind.toUpperCase()}  ${p.target}`).join("\n");
    },

    async config(rest): Promise<string> {
      if (rest.length === 0) {
        const settings = guild.repo.allSettings();
        return Object.keys(settings).length === 0
          ? "(no settings)"
          : Object.entries(settings)
              .map(([k, v]) => `${k} = ${v}`)
              .join("\n");
      }
      if (rest[0] === "get") {
        const value = guild.repo.getSetting(rest[1]);
        return value === undefined ? `(unset) ${rest[1]}` : `${rest[1]} = ${value}`;
      }
      if (rest[0] === "set") {
        const [key, ...valueParts] = rest.slice(1);
        const value = valueParts.join(" ");
        if (!key || !value) return "usage: /guild config set <key> <value>";
        guild.repo.setSetting(key, value);
        return `Set ${key}.`;
      }
      if (rest[0] === "setjson") {
        const [key, ...jsonParts] = rest.slice(1);
        const json = jsonParts.join(" ");
        if (!key || !json) return "usage: /guild config setjson <key> <json>";
        try {
          guild.repo.setSettingJson(key, JSON.parse(json));
        } catch {
          return `Invalid JSON for ${key}.`;
        }
        return `Set ${key} (json).`;
      }
      return "usage: /guild config [get <key> | set <key> <value> | setjson <key> <json>]";
    },

    async usage(rest): Promise<string> {
      if (rest[0]) {
        return formatUsage(guild.repo.usageStats({ projectId: rest[0] }));
      }
      const lines = [`Total: ${formatUsage(guild.repo.usageStats())}`];
      for (const p of guild.project.list()) {
        lines.push(`${p.name}: ${formatUsage(guild.repo.usageStats({ projectId: p.id }))}`);
      }
      return lines.join("\n");
    },

    async dashboard(rest): Promise<string> {
      if (rest[0] === "stop") {
        if (!guild.dashboard) return "Dashboard not running.";
        await guild.dashboard.close();
        guild.dashboard = undefined;
        return "Dashboard stopped.";
      }
      if (rest[0] === "status") {
        return guild.dashboard ? `Dashboard running at ${guild.dashboard.url}` : "Dashboard not running.";
      }
      if (guild.dashboard) return `Dashboard already running at ${guild.dashboard.url}`;

      const resolveEscalation = (id: string, status: "APPROVED" | "REJECTED") => {
        guild.repo.resolveEscalation(id, status);
        guild.repo.audit({
          actor: "human",
          action: status === "APPROVED" ? "escalation.approve" : "escalation.reject",
          entityType: "escalation",
          entityId: id,
        });
        guild.repo.recordEvent(GuildEvents.humanEscalationResolved, { escalationId: id, status });
        guild.bus.emit(GuildEvents.humanEscalationResolved, { escalationId: id, status });
      };

      guild.dashboard = await startDashboard({
        repo: guild.repo,
        isPaused: () => guild.paused,
        pause: () => {
          guild.paused = true;
        },
        resume: () => {
          guild.paused = false;
        },
        approveEscalation: (id) => resolveEscalation(id, "APPROVED"),
        rejectEscalation: (id) => resolveEscalation(id, "REJECTED"),
      });
      return `Dashboard running at ${guild.dashboard.url}`;
    },

    async models(rest, ctx): Promise<string> {
      if (rest[0] === "list") {
        const models = availableModels(ctx);
        return models.length === 0
          ? "(no logged-in models)"
          : models.map((m) => `${m.provider}/${m.id}${m.name ? `  (${m.name})` : ""}`).join("\n");
      }
      if (rest[0] === "providers") {
        const models = availableModels(ctx);
        const byProvider = new Map<string, number>();
        for (const m of models) byProvider.set(m.provider, (byProvider.get(m.provider) ?? 0) + 1);
        return byProvider.size === 0
          ? "(no logged-in providers)"
          : [...byProvider.entries()].map(([p, n]) => `${p} (${n} model${n > 1 ? "s" : ""})`).join("\n");
      }
      if (rest[0] === "auto") {
        const assigned = guild.router.assignAuto(availableModels(ctx), { provider: rest[1] });
        return assigned > 0
          ? `Assigned ${assigned} model class(es).\n${guild.router.describe()}`
          : "(no logged-in models to assign)";
      }
      if (rest[0] === "preset") {
        const provider = rest[1];
        if (!provider) return "usage: /guild models preset <provider> — e.g. opencode-go";
        const assigned = guild.router.assignAuto(availableModels(ctx), { provider });
        return assigned > 0
          ? `Assigned ${assigned} model class(es) from ${provider}.\n${guild.router.describe()}`
          : `No logged-in models for provider ${provider}.`;
      }
      if (rest[0] === "set") {
        const parsed = parseModelRef(rest[2]);
        if (!rest[1] || !parsed) return "usage: /guild models set <role> <provider>/<model>";
        guild.router.setRoleModel(rest[1], parsed.model, parsed.provider);
        return `Role ${rest[1]} -> ${parsed.provider}/${parsed.model}`;
      }
      if (rest[0] === "class") {
        const parsed = parseModelRef(rest[2]);
        if (!rest[1] || !parsed) return "usage: /guild models class <reasoning|cheap-reasoning|coding|cheap-coding|research> <provider>/<model>";
        guild.router.setClassModel(rest[1], parsed.model, parsed.provider);
        return `Class ${rest[1]} -> ${parsed.provider}/${parsed.model}`;
      }
      if (rest[0] === "clear") {
        guild.router.clear();
        return "Model routing cleared.";
      }
      return guild.router.describe();
    },

    async doctor(): Promise<string> {
      const orgs = guild.repo.listOrganizations().length;
      const projects = guild.repo.listProjects().length;
      const agents = guild.repo.listAgents().length;
      const tasks = guild.repo.listTasks().length;
      const roles = guild.repo.listRoles().length;
      const integrations = guild.repo.listIntegrations();
      const settings = guild.repo.allSettings();
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
      const entries = guild.repo.listAudit(n);
      if (entries.length === 0) return "No audit entries.";
      return entries
        .map(
          (e) =>
            `${new Date(e.createdAt).toISOString()}  ${e.actor}  ${e.action}  ${e.entityType ?? ""}${e.entityId ? ":" + e.entityId : ""}`,
        )
        .join("\n");
    },

    async pause(): Promise<string> {
      guild.paused = true;
      return "Scheduler paused.";
    },

    async recover(): Promise<string> {
      const report = new RecoveryService(guild.repo).reconcile();
      return `Recovery: reset ${report.agentsReset} agent(s), reopened ${report.tasksReopened} task(s).`;
    },

    async resume(): Promise<string> {
      guild.paused = false;
      return "Scheduler resumed.";
    },

    async stop(rest): Promise<string> {
      if (rest.length === 0) {
        if (!guild.background?.isRunning()) return "Background scheduler not running.";
        guild.background.stop();
        guild.background = undefined;
        return "Background scheduler stopped.";
      }
      if (rest[0] === "project") {
        const id = rest[1];
        if (!id) return "usage: /guild stop project <id>";
        const targets = guild.agents
          .list({ projectId: id })
          .filter((a) => a.state !== "STOPPED" && a.state !== "COMPLETED");
        for (const a of targets) guild.spawner.stop(a.id);
        return `Stopped ${targets.length} agent(s) in project ${id}.`;
      }
      const id = rest[0];
      const agent = guild.agents.get(id);
      if (!agent) return `No agent with id ${id}`;
      guild.spawner.stop(id);
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
      const escalation = guild.repo.createEscalation({ problem: problem.trim(), options: [] });
      guild.repo.audit({
        actor: "human",
        action: "escalation.create",
        entityType: "escalation",
        entityId: escalation.id,
        details: { problem: escalation.problem },
      });
      guild.repo.recordEvent(GuildEvents.humanEscalationCreated, {
        escalationId: escalation.id,
        problem: escalation.problem,
      });
      guild.bus.emit(GuildEvents.humanEscalationCreated, {
        escalationId: escalation.id,
        problem: escalation.problem,
      });
      return `Escalation ${escalation.id} created: ${escalation.problem}`;
    },

    async start(): Promise<string> {
      if (guild.background?.isRunning()) return "Background scheduler already running.";
      guild.background = new BackgroundScheduler(
        guild.repo,
        (projectId) => {
          const runner = new ProjectRunner(guild.repo, guild.bus, guild.spawner);
          return runner.runProject({
            projectId,
            reviewPolicy: "review_and_tests_required",
            paused: () => guild.paused,
            merge: (t) => guild.git.merge(t),
          });
        },
        { pollMs: 2000, paused: () => guild.paused },
      );
      guild.background.start();
      return "Background scheduler started. /guild stop to halt.";
    },

    async plane(rest): Promise<string> {
      const [verb, ...args] = rest;
      if (verb === "setup") {
        const [baseUrl, workspaceSlug, apiKey] = args;
        if (!baseUrl || !workspaceSlug || !apiKey) {
          return "usage: /guild plane setup <baseUrl> <workspaceSlug> <apiKey>";
        }
        const sync = new PlaneSyncService(guild.repo, new HttpPlaneClient({ baseUrl, apiKey, workspaceSlug }));
        sync.saveConfig({ baseUrl, apiKey, workspaceSlug });
        return `Plane configured (${baseUrl}, workspace ${workspaceSlug}).`;
      }
      if (verb === "status") {
        const config = PlaneSyncService.readConfig(guild.repo);
        return config
          ? `Plane configured: ${config.baseUrl} workspace=${config.workspaceSlug}`
          : "Plane not configured. /guild plane setup <baseUrl> <workspaceSlug> <apiKey>";
      }
      if (verb === "sync") {
        const config = PlaneSyncService.readConfig(guild.repo);
        if (!config) return "Plane not configured. /guild plane setup <baseUrl> <workspaceSlug> <apiKey>";
        const sync = new PlaneSyncService(guild.repo, new HttpPlaneClient(config));
        const projectIds = args.length > 0 ? args : guild.project.list().map((p) => p.id);
        const lines: string[] = [];
        for (const projectId of projectIds) {
          const result = await sync.pushProject(projectId);
          lines.push(`project ${projectId}: ${result.created} created, ${result.updated} updated`);
        }
        return lines.join("\n");
      }
      if (verb === "comments") {
        const config = PlaneSyncService.readConfig(guild.repo);
        if (!config) return "Plane not configured.";
        const sync = new PlaneSyncService(guild.repo, new HttpPlaneClient(config));
        const count = await sync.pushComments(args[0]);
        return `Pushed ${count} comment(s).`;
      }
      return "usage: /guild plane setup|status|sync [projectId]|comments <taskId>";
    },

    async github(rest): Promise<string> {
      const projectId = rest[0];
      const repos = projectId ? guild.repo.listRepositories(projectId) : guild.repo.listRepositories();
      const ghRepos = repos.filter((r) => r.kind === "github");
      if (ghRepos.length === 0) {
        return "No GitHub repositories configured. /guild git setup <project> github <url>";
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
    if (!id) return `usage: /guild ${status === "APPROVED" ? "approve" : "reject"} <escalationId>`;
    const escalation = guild.repo.getEscalation(id);
    if (!escalation) return `No escalation with id ${id}`;
    guild.repo.resolveEscalation(id, status);
    guild.repo.audit({
      actor: "human",
      action: status === "APPROVED" ? "escalation.approve" : "escalation.reject",
      entityType: "escalation",
      entityId: id,
      details: { status },
    });
    guild.repo.recordEvent(GuildEvents.humanEscalationResolved, {
      escalationId: id,
      status,
    });
    guild.bus.emit(GuildEvents.humanEscalationResolved, { escalationId: id, status });
    return `Escalation ${id} ${status === "APPROVED" ? "approved" : "rejected"}.`;
  }

  pi.registerCommand("guild", {
    description: "Pi Guild: multi-agent software-development organization control",
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
