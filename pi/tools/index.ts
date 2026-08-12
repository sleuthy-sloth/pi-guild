/**
 * Pi Studio LLM-callable tools (spec §6, §54).
 *
 * Every tool delegates to the domain services (never raw SQL) and returns a
 * compact text summary plus structured `details`. Enums use `StringEnum` from
 * `@earendil-works/pi-ai` (Google-compatible); schemas are strict TypeBox.
 */
import { StringEnum, Type } from "@earendil-works/pi-ai";
import type { Static, TSchema } from "@earendil-works/pi-ai";
import type { ExtensionAPI, ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { Task } from "../../core/types.ts";
import { StudioEvents } from "../../core/events.ts";
import { currentOrgId, getStudio } from "../state.ts";
import type { Studio } from "../state.ts";
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

/** Keep in sync with the `tool(...)` registrations below. */
export const STUDIO_TOOL_NAMES = [
  "studio_list_projects",
  "studio_get_project",
  "studio_create_project",
  "studio_list_tasks",
  "studio_get_task",
  "studio_create_task",
  "studio_update_task",
  "studio_assign_task",
  "studio_list_agents",
  "studio_spawn_agent",
  "studio_stop_agent",
  "studio_send_message",
  "studio_list_messages",
  "studio_get_project_memory",
  "studio_add_memory",
  "studio_record_decision",
  "studio_get_goal",
  "studio_create_goal",
  "studio_get_agent_status",
  "studio_escalate_to_human",
  "studio_list_escalations",
] as const;

interface ToolOutput {
  text: string;
  details: Record<string, unknown>;
}

export function registerStudioTools(pi: ExtensionAPI, studio: Studio): void {
  // Local helper: closes over `studio` so every execute() runs against the
  // shared lazy singleton.
  function tool<T extends TSchema>(
    name: string,
    label: string,
    description: string,
    parameters: T,
    run: (params: Static<T>) => ToolOutput,
  ): ToolDefinition<T, Record<string, unknown>> {
    return {
      name,
      label,
      description,
      parameters,
      async execute(_toolCallId, params, _signal, _onUpdate) {
        const { text, details } = run(params);
        return { content: [{ type: "text", text }], details };
      },
    };
  }

  const projectsText = (): string => {
    const projects = studio.project.list();
    if (projects.length === 0) return "(no projects)";
    return projects.map((p) => `${p.id}  ${p.name}  (org ${p.organizationId})`).join("\n");
  };

  const requireOrg = (organizationId?: string): string => {
    const id = organizationId ?? currentOrgId(studio);
    if (!id) throw new Error("No organization available — run /studio setup or pass organizationId.");
    return id;
  };

  const createEscalation = (input: {
    problem: string;
    projectId?: string;
    taskId?: string;
    options?: string[];
    recommendation?: string;
  }) => {
    const escalation = studio.repo.createEscalation({
      problem: input.problem,
      projectId: input.projectId,
      taskId: input.taskId,
      options: input.options ?? [],
      recommendation: input.recommendation,
    });
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
    return escalation;
  };

  // Projects
  pi.registerTool(
    tool("studio_list_projects", "List Projects", "List all Pi Studio projects.", Type.Object({}), () => {
      const projects = studio.project.list();
      return { text: projectsText(), details: { projects } };
    }),
  );

  pi.registerTool(
    tool(
      "studio_get_project",
      "Get Project",
      "Get a single project by id.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const project = studio.project.get(params.id);
        if (!project) return { text: `Project not found: ${params.id}`, details: { id: params.id } };
        return {
          text: `${project.id}  ${project.name}  (org ${project.organizationId})`,
          details: { project },
        };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_create_project",
      "Create Project",
      "Create a project in an organization.",
      Type.Object({
        name: Type.String(),
        organizationId: Type.Optional(Type.String()),
      }),
      (params) => {
        const organizationId = requireOrg(params.organizationId);
        const project = studio.project.create(organizationId, params.name);
        return { text: `Created project ${project.id} "${project.name}"`, details: { project } };
      },
    ),
  );

  // Tasks
  pi.registerTool(
    tool(
      "studio_list_tasks",
      "List Tasks",
      "List tasks, optionally scoped to a project.",
      Type.Object({ projectId: Type.Optional(Type.String()) }),
      (params) => {
        const tasks = studio.tasks.list({ projectId: params.projectId });
        return { text: formatTasks(tasks), details: { tasks } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_get_task",
      "Get Task",
      "Get a single task by id.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const task = studio.tasks.get(params.id);
        if (!task) return { text: `Task not found: ${params.id}`, details: { id: params.id } };
        return { text: `${task.id}  [${task.state}] ${task.title}`, details: { task } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_create_task",
      "Create Task",
      "Create a task in a project.",
      Type.Object({
        title: Type.String(),
        projectId: Type.String(),
        description: Type.Optional(Type.String()),
        acceptanceCriteria: Type.Optional(Type.Array(Type.String())),
      }),
      (params) => {
        const task = studio.tasks.create({
          title: params.title,
          projectId: params.projectId,
          description: params.description,
          acceptanceCriteria: params.acceptanceCriteria,
        });
        return { text: `Created task ${task.id} "${task.title}"`, details: { task } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_update_task",
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
        const existing = studio.tasks.get(params.id);
        if (!existing) throw new Error(`task not found: ${params.id}`);

        const patch: Partial<Task> = {};
        if (params.title !== undefined) patch.title = params.title;
        if (params.description !== undefined) patch.description = params.description;
        if (params.acceptanceCriteria !== undefined) patch.acceptanceCriteria = params.acceptanceCriteria;
        if (params.priority !== undefined) patch.priority = params.priority;
        if (params.labels !== undefined) patch.labels = params.labels;
        if (params.assigneeId !== undefined) patch.assigneeId = params.assigneeId;
        if (Object.keys(patch).length > 0) studio.tasks.update(params.id, patch);
        if (params.state !== undefined) studio.tasks.setState(params.id, params.state);

        const task = studio.tasks.get(params.id);
        return { text: `Updated task ${params.id}`, details: { task } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_assign_task",
      "Assign Task",
      "Assign a task to an agent.",
      Type.Object({ taskId: Type.String(), agentId: Type.String() }),
      (params) => {
        studio.tasks.assign(params.taskId, params.agentId);
        return { text: `Assigned task ${params.taskId} to agent ${params.agentId}`, details: { taskId: params.taskId, agentId: params.agentId } };
      },
    ),
  );

  // Agents
  pi.registerTool(
    tool(
      "studio_list_agents",
      "List Agents",
      "List agents, optionally scoped to a project.",
      Type.Object({ projectId: Type.Optional(Type.String()) }),
      (params) => {
        const agents = studio.agents.list({ projectId: params.projectId });
        return { text: formatAgents(agents), details: { agents } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_spawn_agent",
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
        const roles = studio.repo.listRoles();
        const role = roles.find(
          (r) => r.name.toLowerCase() === params.roleName.toLowerCase(),
        );
        if (!role) {
          throw new Error(
            `Unknown role "${params.roleName}". Available: ${roles.map((r) => r.name).join(", ") || "none"}`,
          );
        }
        const agent = studio.agents.create({
          name: params.name,
          roleName: role.name,
          roleId: role.id,
          organizationId,
          projectId: params.projectId,
          model: params.model,
          state: "IDLE",
          kind: "persistent",
        });
        return {
          text: `Spawned agent ${agent.id} "${agent.name}" (role ${agent.roleName})`,
          details: { agent },
        };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_stop_agent",
      "Stop Agent",
      "Abort an agent's current run and mark it stopped.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const agent = studio.agents.get(params.id);
        if (!agent) return { text: `Agent not found: ${params.id}`, details: { id: params.id } };
        studio.spawner.stop(params.id);
        return { text: `Stopped agent ${params.id}`, details: { agent: studio.agents.get(params.id) } };
      },
    ),
  );

  // Messaging
  pi.registerTool(
    tool(
      "studio_send_message",
      "Send Message",
      "Send a message to a recipient (agent id, \"human\", \"all\", or a group id).",
      Type.Object({
        recipientId: Type.String(),
        content: Type.String(),
        messageType: Type.Optional(StringEnum(MESSAGE_TYPES)),
        projectId: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
        priority: Type.Optional(StringEnum(PRIORITIES)),
      }),
      (params) => {
        const message = studio.messaging.send({
          senderName: "human",
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
  );

  pi.registerTool(
    tool(
      "studio_list_messages",
      "List Messages",
      "List messages, optionally filtered by recipient, project, or task.",
      Type.Object({
        recipientId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
      }),
      (params) => {
        const messages = studio.messaging.list({
          recipientId: params.recipientId,
          projectId: params.projectId,
          taskId: params.taskId,
        });
        const text =
          messages.length === 0
            ? "(no messages)"
            : messages
                .map(
                  (m) =>
                    `${m.id}  ${m.senderName} -> ${m.recipientId}  [${m.messageType}] ${m.content.slice(0, 120)}`,
                )
                .join("\n");
        return { text, details: { messages } };
      },
    ),
  );

  // Memory
  pi.registerTool(
    tool(
      "studio_get_project_memory",
      "Get Project Memory",
      "List memory entries for a project.",
      Type.Object({ projectId: Type.String() }),
      (params) => {
        const entries = studio.memory.list("project", params.projectId);
        const text =
          entries.length === 0
            ? "(no memory)"
            : entries.map((m) => `${m.id}  [${m.kind}] ${m.content}`).join("\n");
        return { text, details: { entries } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_add_memory",
      "Add Memory",
      "Add a memory entry to a scope.",
      Type.Object({
        scope: StringEnum(MEMORY_SCOPES),
        scopeId: Type.Optional(Type.String()),
        content: Type.String(),
        kind: Type.Optional(StringEnum(MEMORY_KINDS)),
      }),
      (params) => {
        const entry = studio.memory.add(params.scope, params.content, {
          scopeId: params.scopeId,
          kind: params.kind,
        });
        return { text: `Added memory ${entry.id}`, details: { entry } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_record_decision",
      "Record Decision",
      "Record a durable decision in a scope.",
      Type.Object({
        scope: StringEnum(MEMORY_SCOPES),
        scopeId: Type.Optional(Type.String()),
        content: Type.String(),
        alternatives: Type.Optional(Type.Array(Type.String())),
        owner: Type.Optional(Type.String()),
      }),
      (params) => {
        const entry = studio.memory.recordDecision(params.scope, params.content, {
          scopeId: params.scopeId,
          alternatives: params.alternatives,
          owner: params.owner,
        });
        return { text: `Recorded decision ${entry.id}`, details: { entry } };
      },
    ),
  );

  // Goals
  pi.registerTool(
    tool(
      "studio_get_goal",
      "Get Goal",
      "Get a single goal by id.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const goal = studio.goal.get(params.id);
        if (!goal) return { text: `Goal not found: ${params.id}`, details: { id: params.id } };
        return { text: `${goal.id}  [${goal.status}] ${goal.title}`, details: { goal } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_create_goal",
      "Create Goal",
      "Create a goal, optionally under an organization, project, or parent goal.",
      Type.Object({
        title: Type.String(),
        organizationId: Type.Optional(Type.String()),
        projectId: Type.Optional(Type.String()),
        parentId: Type.Optional(Type.String()),
      }),
      (params) => {
        const goal = studio.goal.create(params.title, {
          organizationId: params.organizationId,
          projectId: params.projectId,
          parentId: params.parentId,
        });
        return { text: `Created goal ${goal.id} "${goal.title}"`, details: { goal } };
      },
    ),
  );

  // Status + escalation
  pi.registerTool(
    tool(
      "studio_get_agent_status",
      "Get Agent Status",
      "Get an agent's current state and current task.",
      Type.Object({ id: Type.String() }),
      (params) => {
        const agent = studio.agents.get(params.id);
        if (!agent) return { text: `Agent not found: ${params.id}`, details: { id: params.id } };
        const task = agent.currentTaskId ? studio.tasks.get(agent.currentTaskId) : undefined;
        const text = `${agent.id}  ${agent.name}  state=${agent.state}  role=${agent.roleName}  currentTask=${agent.currentTaskId ?? "(none)"}`;
        return { text, details: { agent, currentTask: task } };
      },
    ),
  );

  pi.registerTool(
    tool(
      "studio_escalate_to_human",
      "Escalate To Human",
      "Create a human escalation for a decision or blocker.",
      Type.Object({
        problem: Type.String(),
        projectId: Type.Optional(Type.String()),
        taskId: Type.Optional(Type.String()),
        options: Type.Optional(Type.Array(Type.String())),
        recommendation: Type.Optional(Type.String()),
      }),
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
  );

  pi.registerTool(
    tool(
      "studio_list_escalations",
      "List Escalations",
      "List human escalations, optionally filtered by status.",
      Type.Object({ status: Type.Optional(StringEnum(ESCALATION_STATUSES)) }),
      (params) => {
        const escalations = studio.repo.listEscalations(params.status);
        const text =
          escalations.length === 0
            ? "(no escalations)"
            : escalations.map((e) => `${e.id}  [${e.status}] ${e.problem}`).join("\n");
        return { text, details: { escalations } };
      },
    ),
  );
}
