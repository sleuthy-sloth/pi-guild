/**
 * Pi Guild LLM-callable tools (spec §6, §54).
 *
 * `createGuildToolDefinitions(guild)` returns plain ToolDefinitions shared by
 * the extension (pi.registerTool) and by spawned agent sessions (customTools),
 * so every agent sees the same surface. Every tool delegates to the domain
 * services (never raw SQL) and returns a compact text summary plus structured
 * `details`. Enums use `StringEnum` (Google-compatible); schemas are strict TypeBox.
 */
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Task } from "../../core/types.ts";
import { GuildEvents } from "../../core/events.ts";
import { currentOrgId } from "../currentOrg.ts";
import type { Guild } from "../state.ts";
import { formatAgents, formatTasks } from "../ui/index.ts";

const PRIORITIES = ["LOW", "MEDIUM", "HIGH", "CRITICAL"] as const;
const MESSAGE_TYPES = [
  "TASK",
  "STATUS",
  "QUESTION",
  "BLOCKER",
  "DECISION",
  "REVIEW",
  "ESCALATION",
  "ANNOUNCEMENT",
] as const;
const MEMORY_SCOPES = ["global", "organization", "project", "task", "agent"] as const;
const MEMORY_KINDS = ["note", "decision", "fact", "attempt"] as const;
const ESCALATION_STATUSES = ["OPEN", "APPROVED", "REJECTED", "RESOLVED"] as const;
const TASK_STATES = [
  "BACKLOG",
  "READY",
  "PLANNING",
  "IN_PROGRESS",
  "BLOCKED",
  "REVIEW",
  "QA",
  "DONE",
  "CANCELLED",
] as const;
const GOAL_STATUSES = ["open", "in_progress", "done", "cancelled"] as const;
const VERDICTS = ["approve", "request_changes", "pass", "fail"] as const;

interface ToolOutput {
  text: string;
  details: Record<string, unknown>;
}

export const GUILD_TOOL_NAMES = [
  "guild_list_projects",
  "guild_get_project",
  "guild_create_project",
  "guild_list_tasks",
  "guild_get_task",
  "guild_create_task",
  "guild_update_task",
  "guild_assign_task",
  "guild_decompose_task",
  "guild_add_task_dependency",
  "guild_list_task_dependencies",
  "guild_list_agents",
  "guild_spawn_agent",
  "guild_stop_agent",
  "guild_send_message",
  "guild_list_messages",
  "guild_get_project_memory",
  "guild_add_memory",
  "guild_record_decision",
  "guild_get_goal",
  "guild_create_goal",
  "guild_list_goals",
  "guild_set_goal_status",
  "guild_get_agent_status",
  "guild_escalate_to_human",
  "guild_list_escalations",
  "guild_report_verdict",
  "guild_council",
  "guild_git_start",
  "guild_git_commit",
  "guild_git_push",
  "guild_git_pull_request",
  "guild_git_status",
  "guild_git_merge",
] as const;

function tool<T extends TSchema>(
  name: string,
  label: string,
  description: string,
  parameters: T,
  run: (params: Static<T>) => ToolOutput | Promise<ToolOutput>,
): ToolDefinition<any, any> {
  return {
    name,
    label,
    description,
    parameters,
    async execute(_toolCallId, params, _signal, _onUpdate) {
      const { text, details } = await run(params as Static<T>);
      return { content: [{ type: "text", text }], details };
    },
  };
}

export function createGuildToolDefinitions(guild: Guild): ToolDefinition[] {
  const projectsText = (): string => {
    const projects = guild.project.list();
    if (projects.length === 0) return "(no projects)";
    return projects.map((p) => `${p.id}  ${p.name}  (org ${p.organizationId})`).join("\n");
  };

  const requireOrg = (organizationId?: string): string => {
    const id = organizationId ?? currentOrgId(guild);
    if (!id) throw new Error("No organization available — run /guild setup or pass organizationId.");
    return id;
  };

  const createEscalation = (input: {
    problem: string;
    projectId?: string;
    taskId?: string;
    options?: string[];
    recommendation?: string;
  }) => {
    const escalation = guild.repo.createEscalation({
      problem: input.problem,
      projectId: input.projectId,
      taskId: input.taskId,
      options: input.options ?? [],
      recommendation: input.recommendation,
    });
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
    return escalation;
  };

  const defs: ToolDefinition<any, any>[] = [];

  // Projects
  defs.push(
    tool("guild_list_projects", "List Projects", "List all Pi Guild projects.", Type.Object({}), () => {
      const projects = guild.project.list();
      return { text: projectsText(), details: { projects } };
    }),
    tool("guild_get_project", "Get Project", "Get a single project by id.", Type.Object({ id: Type.String() }), (params) => {
      const project = guild.project.get(params.id);
      if (!project) return { text: `Project not found: ${params.id}`, details: { id: params.id } };
      return { text: `${project.id}  ${project.name}  (org ${project.organizationId})`, details: { project } };
    }),
    tool(
      "guild_create_project",
      "Create Project",
      "Create a project in an organization.",
      Type.Object({ name: Type.String(), organizationId: Type.Optional(Type.String()) }),
      (params) => {
        const organizationId = requireOrg(params.organizationId);
        const project = guild.project.create(organizationId, params.name);
        return { text: `Created project ${project.id} "${project.name}"`, details: { project } };
      },
    ),
  );

  // Tasks
  defs.push(
    tool(
      "guild_list_tasks",
      "List Tasks",
      "List tasks, optionally scoped to a project.",
      Type.Object({ projectId: Type.Optional(Type.String()) }),
      (params) => {
        const tasks = guild.tasks.list({ projectId: params.projectId });
        return { text: formatTasks(tasks), details: { tasks } };
      },
    ),
    tool("guild_get_task", "Get Task", "Get a single task by id.", Type.Object({ id: Type.String() }), (params) => {
      const task = guild.tasks.get(params.id);
      if (!task) return { text: `Task not found: ${params.id}`, details: { id: params.id } };
      return { text: `${task.id}  [${task.state}] ${task.title}`, details: { task } };
    }),
    tool(
      "guild_create_task",
      "Create Task",
      "Create a task in a project, optionally under a parent task.",
      Type.Object({
        title: Type.String(),
        projectId: Type.String(),
        description: Type.Optional(Type.String()),
        acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
        parentId: Type.Optional(Type.String()),
      }),
      (params) => {
        const task = guild.tasks.create({
          title: params.title,
          projectId: params.projectId,
          description: params.description,
          acceptanceCriteria: params.acceptanceCriteria,
          parentId: params.parentId,
        });
        return { text: `Created task ${task.id} "${task.title}"`, details: { task } };
      },
    ),
    tool(
      "guild_update_task",
      "Update Task",
      "Update a task's mutable fields.",
      Type.Object({
        id: Type.String(),
        title: Type.Optional(Type.String()),
        description: Type.Optional(Type.String()),
        acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
        priority: Type.Optional(StringEnum(PRIORITIES)),
        state: Type.Optional(StringEnum(TASK_STATES)),
        labels: Type.Optional(Type.Array(Type.String())),
        assigneeId: Type.Optional(Type.String()),
      }),
      (params) => {
        const existing = guild.tasks.get(params.id);
        if (!existing) throw new Error(`task not found: ${params.id}`);

        const patch: Partial<Task> = {};
        if (params.title !== undefined) patch.title = params.title;
        if (params.description !== undefined) patch.description = params.description;
        if (params.acceptanceCriteria !== undefined) patch.acceptanceCriteria = params.acceptanceCriteria;
        if (params.priority !== undefined) patch.priority = params.priority;
        if (params.labels !== undefined) patch.labels = params.labels;
        if (params.assigneeId !== undefined) patch.assigneeId = params.assigneeId;
        if (Object.keys(patch).length > 0) guild.tasks.update(params.id, patch);
        if (params.state !== undefined) guild.tasks.setState(params.id, params.state);

        const task = guild.tasks.get(params.id);
        return { text: `Updated task ${params.id}`, details: { task } };
      },
    ),
    tool("guild_assign_task", "Assign Task", "Assign a task to an agent.", Type.Object({ taskId: Type.String(), agentId: Type.String() }), (params) => {
      guild.tasks.assign(params.taskId, params.agentId);
      return { text: `Assigned task ${params.taskId} to agent ${params.agentId}`, details: { taskId: params.taskId, agentId: params.agentId } };
    }),
    tool(
      "guild_decompose_task",
      "Decompose Task",
      "Break a task into child subtasks.",
      Type.Object({
        id: Type.String(),
        children: Type.Array(Type.Object({ title: Type.String(), description: Type.Optional(Type.String()) })),
      }),
      (params) => {
        const children = guild.tasks.decompose(params.id, params.children);
        return { text: `Created ${children.length} subtask(s) under ${params.id}`, details: { children } };
      },
    ),
    tool(
      "guild_add_task_dependency",
      "Add Task Dependency",
      "Make a task depend on another task (rejects cycles).",
      Type.Object({ taskId: Type.String(), dependsOnId: Type.String() }),
      (params) => {
        guild.tasks.addDependency(params.taskId, params.dependsOnId);
        return { text: `Task ${params.taskId} now depends on ${params.dependsOnId}`, details: { taskId: params.taskId, dependsOnId: params.dependsOnId } };
      },
    ),
    tool(
      "guild_list_task_dependencies",
      "List Task Dependencies",
      "List the tasks a given task depends on.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const deps = guild.tasks.dependencies(params.id);
        const text = deps.length === 0 ? "(no dependencies)" : deps.map((d) => `${d.id}  [${d.state}] ${d.title}`).join("\n");
        return { text, details: { dependencies: deps } };
      },
    ),
  );

  // Agents
  defs.push(
    tool(
      "guild_list_agents",
      "List Agents",
      "List agents, optionally scoped to a project.",
      Type.Object({ projectId: Type.Optional(Type.String()) }),
      (params) => {
        const agents = guild.agents.list({ projectId: params.projectId });
        return { text: formatAgents(agents), details: { agents } };
      },
    ),
    tool(
      "guild_spawn_agent",
      "Spawn Agent",
      "Create an idle agent ready for work in a role.",
      Type.Object({
        name: Type.String(),
        roleName: Type.String(),
        organizationId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        model: Type.Optional(Type.String()),
      }),
      (params) => {
        const organizationId = requireOrg(params.organizationId);
        const roles = guild.repo.listRoles();
        const role = roles.find((r) => r.name.toLowerCase() === params.roleName.toLowerCase());
        if (!role) {
          throw new Error(`Unknown role "${params.roleName}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`);
        }
        const agent = guild.agents.create({
          name: params.name,
          roleName: role.name,
          roleId: role.id,
          organizationId,
          projectId: params.projectId,
          model: params.model,
          state: "IDLE",
          kind: "persistent",
        });
        return { text: `Spawned agent ${agent.id} "${agent.name}" (role ${agent.roleName})`, details: { agent } };
      },
    ),
    tool("guild_stop_agent", "Stop Agent", "Abort an agent's current run and mark it stopped.", Type.Object({ id: Type.String() }), (params) => {
      const agent = guild.agents.get(params.id);
      if (!agent) return { text: `Agent not found: ${params.id}`, details: { id: params.id } };
      guild.spawner.stop(params.id);
      return { text: `Stopped agent ${params.id}`, details: { agent: guild.agents.get(params.id) } };
    }),
  );

  // Messaging
  defs.push(
    tool(
      "guild_send_message",
      "Send Message",
      'Send a message to a recipient (agent id, "human", "all", or a group id).',
      Type.Object({
        recipientId: Type.String(),
        content: Type.String(),
        messageType: Type.Optional(StringEnum(MESSAGE_TYPES)),
        projectId: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
        priority: Type.Optional(StringEnum(PRIORITIES)),
      }),
      (params) => {
        const message = guild.messaging.send({
          senderName: "agent",
          recipientId: params.recipientId,
          content: params.content,
          messageType: params.messageType ?? "STATUS",
          projectId: params.projectId,
          taskId: params.taskId,
          priority: params.priority ?? "MEDIUM",
        });
        return { text: `Sent message ${message.id} to ${message.recipientId}`, details: { message } };
      },
    ),
    tool(
      "guild_list_messages",
      "List Messages",
      "List messages, optionally filtered by recipient, project, or task.",
      Type.Object({ recipientId: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()) }),
      (params) => {
        const messages = guild.messaging.list({ recipientId: params.recipientId, projectId: params.projectId, taskId: params.taskId });
        const text =
          messages.length === 0
            ? "(no messages)"
            : messages.map((m) => `${m.id}  ${m.senderName} -> ${m.recipientId}  [${m.messageType}] ${m.content.slice(0, 120)}`).join("\n");
        return { text, details: { messages } };
      },
    ),
  );

  // Memory
  defs.push(
    tool("guild_get_project_memory", "Get Project Memory", "List memory entries for a project.", Type.Object({ projectId: Type.String() }), (params) => {
      const entries = guild.memory.list("project", params.projectId);
      const text = entries.length === 0 ? "(no memory)" : entries.map((m) => `${m.id}  [${m.kind}] ${m.content}`).join("\n");
      return { text, details: { entries } };
    }),
    tool(
      "guild_add_memory",
      "Add Memory",
      "Add a memory entry to a scope.",
      Type.Object({ scope: StringEnum(MEMORY_SCOPES), scopeId: Type.Optional(Type.String()), content: Type.String(), kind: Type.Optional(StringEnum(MEMORY_KINDS)) }),
      (params) => {
        const entry = guild.memory.add(params.scope, params.content, { scopeId: params.scopeId, kind: params.kind });
        return { text: `Added memory ${entry.id}`, details: { entry } };
      },
    ),
    tool(
      "guild_record_decision",
      "Record Decision",
      "Record a durable decision in a scope.",
      Type.Object({ scope: StringEnum(MEMORY_SCOPES), scopeId: Type.Optional(Type.String()), content: Type.String(), alternatives: Type.Optional(Type.Array(Type.String())), owner: Type.Optional(Type.String()) }),
      (params) => {
        const entry = guild.memory.recordDecision(params.scope, params.content, {
          scopeId: params.scopeId,
          alternatives: params.alternatives,
          owner: params.owner,
        });
        return { text: `Recorded decision ${entry.id}`, details: { entry } };
      },
    ),
  );

  // Goals
  defs.push(
    tool("guild_get_goal", "Get Goal", "Get a single goal by id.", Type.Object({ id: Type.String() }), (params) => {
      const goal = guild.goal.get(params.id);
      if (!goal) return { text: `Goal not found: ${params.id}`, details: { id: params.id } };
      return { text: `${goal.id}  [${goal.status}] ${goal.title}`, details: { goal } };
    }),
    tool(
      "guild_create_goal",
      "Create Goal",
      "Create a goal, optionally under an organization, project, or parent goal.",
      Type.Object({ title: Type.String(), organizationId: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()), parentId: Type.Optional(Type.String()) }),
      (params) => {
        const goal = guild.goal.create(params.title, { organizationId: params.organizationId, projectId: params.projectId, parentId: params.parentId });
        return { text: `Created goal ${goal.id} "${goal.title}"`, details: { goal } };
      },
    ),
    tool(
      "guild_list_goals",
      "List Goals",
      "List goals, optionally scoped to an organization or project.",
      Type.Object({ organizationId: Type.Optional(Type.String()), projectId: Type.Optional(Type.String()) }),
      (params) => {
        const goals = guild.goal.list({ organizationId: params.organizationId, projectId: params.projectId });
        const text = goals.length === 0 ? "(no goals)" : goals.map((g) => `${g.id}  [${g.status}] ${g.title}`).join("\n");
        return { text, details: { goals } };
      },
    ),
    tool(
      "guild_set_goal_status",
      "Set Goal Status",
      "Update a goal's status.",
      Type.Object({ id: Type.String(), status: StringEnum(GOAL_STATUSES) }),
      (params) => {
        guild.goal.setStatus(params.id, params.status);
        return { text: `Goal ${params.id} -> ${params.status}`, details: { id: params.id, status: params.status } };
      },
    ),
  );

  // Git
  defs.push(
    tool("guild_git_start", "Start Git Branch", "Create a feature/bugfix branch for a task.", Type.Object({ taskId: Type.String() }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      const branch = await guild.git.startBranch(task);
      return { text: `Started branch ${branch}`, details: { branch } };
    }),
    tool("guild_git_commit", "Git Commit", "Stage and commit changes for a task.", Type.Object({ taskId: Type.String(), message: Type.String() }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      const commit = await guild.git.commit(task, params.message);
      return { text: `Committed ${commit.sha ?? ""} on ${commit.branch}`, details: { commit } };
    }),
    tool("guild_git_push", "Git Push", "Push a task's branch to its remote.", Type.Object({ taskId: Type.String() }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      await guild.git.push(task);
      return { text: `Pushed ${task.branch ?? "branch"}`, details: { branch: task.branch } };
    }),
    tool("guild_git_pull_request", "Open Pull Request", "Open a pull request for a task's branch.", Type.Object({ taskId: Type.String(), title: Type.Optional(Type.String()), body: Type.Optional(Type.String()) }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      const pr = await guild.git.openPullRequest(task, { title: params.title, body: params.body });
      return { text: `Opened PR ${pr.url ?? pr.number}`, details: { pr } };
    }),
    tool("guild_git_status", "Git Status", "Show the working tree status for a task.", Type.Object({ taskId: Type.String() }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      const status = await guild.git.status(task);
      return { text: `branch=${status.branch} clean=${status.clean}`, details: status };
    }),
    tool("guild_git_merge", "Merge Pull Request", "Merge a task's pull request into its base branch.", Type.Object({ taskId: Type.String() }), async (params) => {
      const task = guild.tasks.get(params.taskId);
      if (!task) throw new Error(`task not found: ${params.taskId}`);
      await guild.git.merge(task);
      return { text: `Merged ${task.branch ?? "branch"}`, details: { branch: task.branch } };
    }),
  );

  // Status + escalation + verdict + council
  defs.push(
    tool("guild_get_agent_status", "Get Agent Status", "Get an agent's current state and current task.", Type.Object({ id: Type.String() }), (params) => {
      const agent = guild.agents.get(params.id);
      if (!agent) return { text: `Agent not found: ${params.id}`, details: { id: params.id } };
      const task = agent.currentTaskId ? guild.tasks.get(agent.currentTaskId) : undefined;
      const text = `${agent.id}  ${agent.name}  state=${agent.state}  role=${agent.roleName}  currentTask=${agent.currentTaskId ?? "(none)"}`;
      return { text, details: { agent, currentTask: task } };
    }),
    tool(
      "guild_escalate_to_human",
      "Escalate To Human",
      "Create a human escalation for a decision or blocker.",
      Type.Object({ problem: Type.String(), projectId: Type.Optional(Type.String()), taskId: Type.Optional(Type.String()), options: Type.Optional(Type.Array(Type.String())), recommendation: Type.Optional(Type.String()) }),
      (params) => {
        const escalation = createEscalation({
          problem: params.problem,
          projectId: params.projectId,
          taskId: params.taskId,
          options: params.options,
          recommendation: params.recommendation,
        });
        return { text: `Escalation ${escalation.id} created: ${escalation.problem}`, details: { escalation } };
      },
    ),
    tool("guild_list_escalations", "List Escalations", "List human escalations, optionally filtered by status.", Type.Object({ status: Type.Optional(StringEnum(ESCALATION_STATUSES)) }), (params) => {
      const escalations = guild.repo.listEscalations(params.status);
      const text = escalations.length === 0 ? "(no escalations)" : escalations.map((e) => `${e.id}  [${e.status}] ${e.problem}`).join("\n");
      return { text, details: { escalations } };
    }),
    tool(
      "guild_report_verdict",
      "Report Verdict",
      "Record a review/QA verdict for a task. Reviewers use approve/request_changes; QA uses pass/fail.",
      Type.Object({ taskId: Type.String(), verdict: StringEnum(VERDICTS), comments: Type.Optional(Type.String()) }),
      (params) => {
        const entry = guild.memory.add("task", JSON.stringify({ verdict: params.verdict, comments: params.comments }), {
          scopeId: params.taskId,
          kind: "review",
          source: "verdict",
        });
        return { text: `Recorded verdict ${params.verdict} for task ${params.taskId}`, details: { entry } };
      },
    ),
    tool(
      "guild_council",
      "Council",
      "Ask several configured models a question and synthesize a consensus answer.",
      Type.Object({ question: Type.String() }),
      async (params) => {
        const result = await guild.council.deliberate(params.question);
        const text =
          result.consensus ||
          "(no council models configured — set councilModels, e.g. /guild council add provider/model)";
        return { text, details: { result } };
      },
    ),
  );

  return defs;
}

export function registerGuildTools(pi: ExtensionAPI, guild: Guild): void {
  for (const definition of createGuildToolDefinitions(guild)) {
    pi.registerTool(definition);
  }
}
