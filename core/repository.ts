/**
 * StudioRepository — the single persistence facade over SQLite (spec §9).
 *
 * Domain services and the Pi extension operate exclusively through this class
 * (agents never touch raw SQL). SQLite itself works in-memory (":memory:") or
 * on-disk, so tests can use an in-memory instance with zero setup.
 */
import { randomUUID } from "node:crypto";
import type { Db } from "../database/db.ts";
import type {
  Agent,
  AgentRole,
  AgentState,
  AuditEntry,
  Escalation,
  Goal,
  Integration,
  MemoryEntry,
  Message,
  NewAgent,
  NewGoal,
  NewMemory,
  NewMessage,
  NewOrganization,
  NewPolicy,
  NewProject,
  NewTask,
  Organization,
  Policy,
  Priority,
  Project,
  Repository,
  ReviewVerdict,
  Task,
  TaskState,
  UsageRecord,
} from "./types.ts";

function jparse<T>(s: string | null | undefined, fallback: T): T {
  if (!s) return fallback;
  try {
    return JSON.parse(s) as T;
  } catch {
    return fallback;
  }
}

function now(): number {
  return Date.now();
}

type SQLInputValue = null | number | bigint | string | NodeJS.ArrayBufferView;

function uuid(): string {
  return randomUUID();
}

export class StudioRepository {
  constructor(readonly db: Db) {}

  close(): void {
    this.db.close();
  }

  // -------------------------------------------------------------------------
  // Organizations
  // -------------------------------------------------------------------------

  createOrganization(input: NewOrganization): Organization {
    const org: Organization = {
      id: uuid(),
      name: input.name,
      description: input.description,
      goals: input.goals ?? [],
      policies: input.policies ?? [],
      workflows: input.workflows ?? [],
      budgets: input.budgets ?? { onLimit: "continue" },
      integrations: input.integrations ?? {},
      createdAt: now(),
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO organizations (id, name, description, goals, policies, workflows, budgets, integrations, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        org.id,
        org.name,
        org.description ?? null,
        JSON.stringify(org.goals),
        JSON.stringify(org.policies),
        JSON.stringify(org.workflows),
        JSON.stringify(org.budgets),
        JSON.stringify(org.integrations),
        org.createdAt,
        org.updatedAt,
      );
    return org;
  }

  getOrganization(id: string): Organization | undefined {
    const row = this.db.prepare("SELECT * FROM organizations WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToOrg(row) : undefined;
  }

  listOrganizations(): Organization[] {
    return (this.db.prepare("SELECT * FROM organizations ORDER BY name").all() as Record<
      string,
      unknown
    >[]).map((r) => this.rowToOrg(r));
  }

  updateOrganization(id: string, patch: Partial<Organization>): void {
    const existing = this.getOrganization(id);
    if (!existing) throw new Error(`organization not found: ${id}`);
    const next = { ...existing, ...patch, id, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE organizations SET name=?, description=?, goals=?, policies=?, workflows=?, budgets=?, integrations=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.description ?? null,
        JSON.stringify(next.goals),
        JSON.stringify(next.policies),
        JSON.stringify(next.workflows),
        JSON.stringify(next.budgets),
        JSON.stringify(next.integrations),
        next.updatedAt,
        id,
      );
  }

  deleteOrganization(id: string): void {
    this.db.prepare("DELETE FROM organizations WHERE id = ?").run(id);
  }

  private rowToOrg(r: Record<string, unknown>): Organization {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string | undefined,
      goals: jparse(r.goals as string, [] as string[]),
      policies: jparse(r.policies as string, [] as string[]),
      workflows: jparse(r.workflows as string, [] as string[]),
      budgets: jparse(r.budgets as string, { onLimit: "continue" }),
      integrations: jparse(r.integrations as string, {}),
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Projects
  // -------------------------------------------------------------------------

  createProject(input: NewProject): Project {
    const project: Project = {
      id: uuid(),
      organizationId: input.organizationId,
      name: input.name,
      description: input.description,
      goals: input.goals ?? [],
      roadmap: input.roadmap ?? [],
      repositoryId: input.repositoryId,
      documentation: input.documentation ?? "",
      metrics: input.metrics ?? { tasksTotal: 0, tasksDone: 0, tasksInProgress: 0, tasksBlocked: 0 },
      settings: input.settings ?? {},
      createdAt: now(),
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO projects (id, organization_id, name, description, goals, roadmap, repository_id, documentation, metrics, settings, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        project.id,
        project.organizationId,
        project.name,
        project.description ?? null,
        JSON.stringify(project.goals),
        JSON.stringify(project.roadmap),
        project.repositoryId ?? null,
        project.documentation,
        JSON.stringify(project.metrics),
        JSON.stringify(project.settings),
        project.createdAt,
        project.updatedAt,
      );
    return project;
  }

  getProject(id: string): Project | undefined {
    const row = this.db.prepare("SELECT * FROM projects WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToProject(row) : undefined;
  }

  listProjects(organizationId?: string): Project[] {
    const rows = organizationId
      ? (this.db.prepare("SELECT * FROM projects WHERE organization_id = ? ORDER BY name").all(organizationId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM projects ORDER BY name").all() as Record<string, unknown>[]);
    return rows.map((r) => this.rowToProject(r));
  }

  updateProject(id: string, patch: Partial<Project>): void {
    const existing = this.getProject(id);
    if (!existing) throw new Error(`project not found: ${id}`);
    const next = { ...existing, ...patch, id, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE projects SET name=?, description=?, goals=?, roadmap=?, repository_id=?, documentation=?, metrics=?, settings=?, updated_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.description ?? null,
        JSON.stringify(next.goals),
        JSON.stringify(next.roadmap),
        next.repositoryId ?? null,
        next.documentation,
        JSON.stringify(next.metrics),
        JSON.stringify(next.settings),
        next.updatedAt,
        id,
      );
  }

  deleteProject(id: string): void {
    this.db.prepare("DELETE FROM projects WHERE id = ?").run(id);
  }

  private rowToProject(r: Record<string, unknown>): Project {
    return {
      id: r.id as string,
      organizationId: r.organization_id as string,
      name: r.name as string,
      description: r.description as string | undefined,
      goals: jparse(r.goals as string, [] as string[]),
      roadmap: jparse(r.roadmap as string, [] as string[]),
      repositoryId: r.repository_id as string | undefined,
      documentation: r.documentation as string,
      metrics: jparse(r.metrics as string, { tasksTotal: 0, tasksDone: 0, tasksInProgress: 0, tasksBlocked: 0 }),
      settings: jparse(r.settings as string, {}),
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Agent roles
  // -------------------------------------------------------------------------

  createRole(role: Omit<AgentRole, "id" | "createdAt">): AgentRole {
    const full: AgentRole = { ...role, id: uuid(), createdAt: now() };
    this.db
      .prepare(
        `INSERT INTO agent_roles (id, name, description, responsibilities, tools, permissions, model, system_prompt, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        full.id,
        full.name,
        full.description,
        JSON.stringify(full.responsibilities),
        JSON.stringify(full.tools),
        JSON.stringify(full.permissions),
        full.model ?? null,
        full.systemPrompt,
        full.createdAt,
      );
    return full;
  }

  getRole(id: string): AgentRole | undefined {
    const row = this.db.prepare("SELECT * FROM agent_roles WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRole(row) : undefined;
  }

  getRoleByName(name: string): AgentRole | undefined {
    const row = this.db.prepare("SELECT * FROM agent_roles WHERE name = ?").get(name) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRole(row) : undefined;
  }

  listRoles(): AgentRole[] {
    return (this.db.prepare("SELECT * FROM agent_roles ORDER BY name").all() as Record<string, unknown>[]).map((r) =>
      this.rowToRole(r),
    );
  }

  private rowToRole(r: Record<string, unknown>): AgentRole {
    return {
      id: r.id as string,
      name: r.name as string,
      description: r.description as string,
      responsibilities: jparse(r.responsibilities as string, [] as string[]),
      tools: jparse(r.tools as string, [] as string[]),
      permissions: jparse(r.permissions as string, [] as string[]),
      model: r.model as string | undefined,
      systemPrompt: r.system_prompt as string,
      createdAt: r.created_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Agents
  // -------------------------------------------------------------------------

  createAgent(input: NewAgent): Agent {
    const agent: Agent = {
      id: uuid(),
      name: input.name,
      roleId: input.roleId,
      roleName: input.roleName,
      model: input.model,
      provider: input.provider,
      projectId: input.projectId,
      organizationId: input.organizationId,
      parentAgentId: input.parentAgentId,
      currentTaskId: input.currentTaskId,
      state: input.state ?? "CREATED",
      sessionId: input.sessionId,
      sessionFile: input.sessionFile,
      kind: input.kind ?? "persistent",
      schedule: input.schedule,
      triggerEvent: input.triggerEvent,
      settings: input.settings ?? {},
      createdAt: now(),
      lastActivityAt: input.lastActivityAt,
    };
    this.db
      .prepare(
        `INSERT INTO agents (id, name, role_id, role_name, model, provider, project_id, organization_id, parent_agent_id, current_task_id, state, session_id, session_file, kind, schedule, trigger_event, settings, created_at, last_activity_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        agent.id,
        agent.name,
        agent.roleId ?? null,
        agent.roleName,
        agent.model ?? null,
        agent.provider ?? null,
        agent.projectId ?? null,
        agent.organizationId,
        agent.parentAgentId ?? null,
        agent.currentTaskId ?? null,
        agent.state,
        agent.sessionId ?? null,
        agent.sessionFile ?? null,
        agent.kind,
        agent.schedule ?? null,
        agent.triggerEvent ?? null,
        JSON.stringify(agent.settings),
        agent.createdAt,
        agent.lastActivityAt ?? null,
      );
    return agent;
  }

  getAgent(id: string): Agent | undefined {
    const row = this.db.prepare("SELECT * FROM agents WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToAgent(row) : undefined;
  }

  listAgents(filter: { organizationId?: string; projectId?: string; state?: AgentState } = {}): Agent[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.organizationId) {
      clauses.push("organization_id = ?");
      params.push(filter.organizationId);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.state) {
      clauses.push("state = ?");
      params.push(filter.state);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM agents ${where} ORDER BY name`).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToAgent(r));
  }

  updateAgent(id: string, patch: Partial<Agent>): void {
    const existing = this.getAgent(id);
    if (!existing) throw new Error(`agent not found: ${id}`);
    const next = { ...existing, ...patch, id };
    this.db
      .prepare(
        `UPDATE agents SET name=?, role_id=?, role_name=?, model=?, provider=?, project_id=?, organization_id=?, parent_agent_id=?, current_task_id=?, state=?, session_id=?, session_file=?, kind=?, schedule=?, trigger_event=?, settings=?, last_activity_at=? WHERE id=?`,
      )
      .run(
        next.name,
        next.roleId ?? null,
        next.roleName,
        next.model ?? null,
        next.provider ?? null,
        next.projectId ?? null,
        next.organizationId,
        next.parentAgentId ?? null,
        next.currentTaskId ?? null,
        next.state,
        next.sessionId ?? null,
        next.sessionFile ?? null,
        next.kind,
        next.schedule ?? null,
        next.triggerEvent ?? null,
        JSON.stringify(next.settings),
        next.lastActivityAt ?? null,
        id,
      );
  }

  setAgentState(id: string, state: AgentState): void {
    this.db
      .prepare("UPDATE agents SET state = ?, last_activity_at = ? WHERE id = ?")
      .run(state, now(), id);
  }

  setAgentCurrentTask(id: string, taskId: string | undefined): void {
    this.db.prepare("UPDATE agents SET current_task_id = ?, last_activity_at = ? WHERE id = ?").run(
      taskId ?? null,
      now(),
      id,
    );
  }

  deleteAgent(id: string): void {
    this.db.prepare("DELETE FROM agents WHERE id = ?").run(id);
  }

  private rowToAgent(r: Record<string, unknown>): Agent {
    return {
      id: r.id as string,
      name: r.name as string,
      roleId: r.role_id as string | undefined,
      roleName: r.role_name as string,
      model: r.model as string | undefined,
      provider: r.provider as string | undefined,
      projectId: r.project_id as string | undefined,
      organizationId: r.organization_id as string,
      parentAgentId: r.parent_agent_id as string | undefined,
      currentTaskId: r.current_task_id as string | undefined,
      state: r.state as AgentState,
      sessionId: r.session_id as string | undefined,
      sessionFile: r.session_file as string | undefined,
      kind: r.kind as Agent["kind"],
      schedule: r.schedule as string | undefined,
      triggerEvent: r.trigger_event as string | undefined,
      settings: jparse(r.settings as string, {}),
      createdAt: r.created_at as number,
      lastActivityAt: r.last_activity_at as number | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Tasks
  // -------------------------------------------------------------------------

  createTask(input: NewTask): Task {
    const parent = input.parentId ? this.getTask(input.parentId) : undefined;
    const depth = parent ? parent.depth + 1 : 0;
    const task: Task = {
      id: uuid(),
      title: input.title,
      description: input.description,
      acceptanceCriteria: input.acceptanceCriteria ?? [],
      priority: input.priority ?? "MEDIUM",
      assigneeId: input.assigneeId,
      creatorId: input.creatorId,
      projectId: input.projectId,
      parentId: input.parentId,
      labels: input.labels ?? [],
      state: input.state ?? "BACKLOG",
      repository: input.repository,
      branch: input.branch,
      pr: input.pr,
      artifacts: input.artifacts ?? [],
      depth,
      createdAt: now(),
      updatedAt: now(),
      startedAt: input.startedAt,
      completedAt: input.completedAt,
    };
    this.db
      .prepare(
        `INSERT INTO tasks (id, title, description, acceptance_criteria, priority, assignee_id, creator_id, project_id, parent_id, labels, state, repository, branch, pr, artifacts, depth, created_at, updated_at, started_at, completed_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        task.id,
        task.title,
        task.description ?? null,
        JSON.stringify(task.acceptanceCriteria),
        task.priority,
        task.assigneeId ?? null,
        task.creatorId ?? null,
        task.projectId,
        task.parentId ?? null,
        JSON.stringify(task.labels),
        task.state,
        task.repository ?? null,
        task.branch ?? null,
        task.pr ?? null,
        JSON.stringify(task.artifacts),
        task.depth,
        task.createdAt,
        task.updatedAt,
        task.startedAt ?? null,
        task.completedAt ?? null,
      );
    return task;
  }

  getTask(id: string): Task | undefined {
    const row = this.db.prepare("SELECT * FROM tasks WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToTask(row) : undefined;
  }

  listTasks(filter: { projectId?: string; state?: TaskState; assigneeId?: string; parentId?: string } = {}): Task[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.state) {
      clauses.push("state = ?");
      params.push(filter.state);
    }
    if (filter.assigneeId) {
      clauses.push("assignee_id = ?");
      params.push(filter.assigneeId);
    }
    if (filter.parentId !== undefined) {
      clauses.push(filter.parentId === null ? "parent_id IS NULL" : "parent_id = ?");
      if (filter.parentId !== null) params.push(filter.parentId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM tasks ${where} ORDER BY created_at`).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToTask(r));
  }

  listChildren(taskId: string): Task[] {
    return this.listTasks({ parentId: taskId });
  }

  updateTask(id: string, patch: Partial<Task>): void {
    const existing = this.getTask(id);
    if (!existing) throw new Error(`task not found: ${id}`);
    const next = { ...existing, ...patch, id, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE tasks SET title=?, description=?, acceptance_criteria=?, priority=?, assignee_id=?, creator_id=?, project_id=?, parent_id=?, labels=?, state=?, repository=?, branch=?, pr=?, artifacts=?, depth=?, updated_at=?, started_at=?, completed_at=? WHERE id=?`,
      )
      .run(
        next.title,
        next.description ?? null,
        JSON.stringify(next.acceptanceCriteria),
        next.priority,
        next.assigneeId ?? null,
        next.creatorId ?? null,
        next.projectId,
        next.parentId ?? null,
        JSON.stringify(next.labels),
        next.state,
        next.repository ?? null,
        next.branch ?? null,
        next.pr ?? null,
        JSON.stringify(next.artifacts),
        next.depth,
        next.updatedAt,
        next.startedAt ?? null,
        next.completedAt ?? null,
        id,
      );
  }

  setTaskState(id: string, state: TaskState): void {
    const patch: Partial<Task> = { state };
    if (state === "IN_PROGRESS" && !this.getTask(id)?.startedAt) patch.startedAt = now();
    if (state === "DONE") patch.completedAt = now();
    this.updateTask(id, patch);
  }

  deleteTask(id: string): void {
    this.db.prepare("DELETE FROM tasks WHERE id = ?").run(id);
  }

  addDependency(taskId: string, dependsOnId: string): void {
    this.db
      .prepare("INSERT OR IGNORE INTO task_dependencies (task_id, depends_on_id) VALUES (?, ?)")
      .run(taskId, dependsOnId);
  }

  removeDependency(taskId: string, dependsOnId: string): void {
    this.db.prepare("DELETE FROM task_dependencies WHERE task_id = ? AND depends_on_id = ?").run(
      taskId,
      dependsOnId,
    );
  }

  listDependencies(taskId: string): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t JOIN task_dependencies d ON t.id = d.depends_on_id WHERE d.task_id = ?`,
      )
      .all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  listDependents(taskId: string): Task[] {
    const rows = this.db
      .prepare(
        `SELECT t.* FROM tasks t JOIN task_dependencies d ON t.id = d.task_id WHERE d.depends_on_id = ?`,
      )
      .all(taskId) as Record<string, unknown>[];
    return rows.map((r) => this.rowToTask(r));
  }

  private rowToTask(r: Record<string, unknown>): Task {
    return {
      id: r.id as string,
      title: r.title as string,
      description: r.description as string | undefined,
      acceptanceCriteria: jparse(r.acceptance_criteria as string, [] as string[]),
      priority: r.priority as Priority,
      assigneeId: r.assignee_id as string | undefined,
      creatorId: r.creator_id as string | undefined,
      projectId: r.project_id as string,
      parentId: r.parent_id as string | undefined,
      labels: jparse(r.labels as string, [] as string[]),
      state: r.state as TaskState,
      repository: r.repository as string | undefined,
      branch: r.branch as string | undefined,
      pr: r.pr as string | undefined,
      artifacts: jparse(r.artifacts as string, [] as string[]),
      depth: r.depth as number,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
      startedAt: r.started_at as number | undefined,
      completedAt: r.completed_at as number | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Messages
  // -------------------------------------------------------------------------

  createMessage(input: NewMessage): Message {
    const message: Message = {
      senderId: input.senderId,
      senderName: input.senderName,
      recipientId: input.recipientId,
      projectId: input.projectId,
      taskId: input.taskId,
      priority: input.priority ?? "MEDIUM",
      messageType: input.messageType,
      content: input.content,
      parentMessageId: input.parentMessageId,
      status: input.status ?? "UNREAD",
      id: input.id ?? uuid(),
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO messages (id, sender_id, sender_name, recipient_id, project_id, task_id, priority, message_type, content, parent_message_id, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        message.id,
        message.senderId ?? null,
        message.senderName,
        message.recipientId,
        message.projectId ?? null,
        message.taskId ?? null,
        message.priority,
        message.messageType,
        message.content,
        message.parentMessageId ?? null,
        message.status,
        message.createdAt,
      );
    return message;
  }

  getMessage(id: string): Message | undefined {
    const row = this.db.prepare("SELECT * FROM messages WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMessage(row) : undefined;
  }

  listMessages(filter: { recipientId?: string; senderId?: string; projectId?: string; taskId?: string } = {}): Message[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    for (const key of ["recipientId", "senderId", "projectId", "taskId"] as const) {
      if (filter[key]) {
        clauses.push(`${key === "recipientId" ? "recipient_id" : key === "senderId" ? "sender_id" : key === "projectId" ? "project_id" : "task_id"} = ?`);
        params.push(filter[key]);
      }
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM messages ${where} ORDER BY created_at`).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToMessage(r));
  }

  /** Full thread: a message plus all its replies (recursive). */
  listThread(rootId: string): Message[] {
    const out: Message[] = [];
    const visit = (id: string) => {
      const msg = this.getMessage(id);
      if (!msg) return;
      out.push(msg);
      for (const child of this.listMessages().filter((m) => m.parentMessageId === id)) visit(child.id);
    };
    visit(rootId);
    return out;
  }

  markMessageStatus(id: string, status: Message["status"]): void {
    this.db.prepare("UPDATE messages SET status = ? WHERE id = ?").run(status, id);
  }

  searchMessages(query: string): Message[] {
    const like = `%${query}%`;
    const rows = this.db
      .prepare("SELECT * FROM messages WHERE content LIKE ? OR sender_name LIKE ? ORDER BY created_at DESC LIMIT 100")
      .all(like, like) as Record<string, unknown>[];
    return rows.map((r) => this.rowToMessage(r));
  }

  private rowToMessage(r: Record<string, unknown>): Message {
    return {
      id: r.id as string,
      senderId: r.sender_id as string | undefined,
      senderName: r.sender_name as string,
      recipientId: r.recipient_id as string,
      projectId: r.project_id as string | undefined,
      taskId: r.task_id as string | undefined,
      priority: r.priority as Priority,
      messageType: r.message_type as Message["messageType"],
      content: r.content as string,
      parentMessageId: r.parent_message_id as string | undefined,
      status: r.status as Message["status"],
      createdAt: r.created_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Goals
  // -------------------------------------------------------------------------

  createGoal(input: NewGoal): Goal {
    const parent = input.parentId ? this.getGoal(input.parentId) : undefined;
    const depth = parent ? parent.depth + 1 : 0;
    const goal: Goal = {
      id: uuid(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      parentId: input.parentId,
      title: input.title,
      description: input.description,
      kind: input.kind ?? (depth === 0 ? "company" : "feature"),
      status: input.status ?? "open",
      depth,
      createdAt: now(),
      updatedAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO goals (id, organization_id, project_id, parent_id, title, description, kind, status, depth, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        goal.id,
        goal.organizationId ?? null,
        goal.projectId ?? null,
        goal.parentId ?? null,
        goal.title,
        goal.description ?? null,
        goal.kind,
        goal.status,
        goal.depth,
        goal.createdAt,
        goal.updatedAt,
      );
    return goal;
  }

  getGoal(id: string): Goal | undefined {
    const row = this.db.prepare("SELECT * FROM goals WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToGoal(row) : undefined;
  }

  listGoals(filter: { organizationId?: string; projectId?: string; parentId?: string } = {}): Goal[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.organizationId) {
      clauses.push("organization_id = ?");
      params.push(filter.organizationId);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.parentId !== undefined) {
      clauses.push(filter.parentId === null ? "parent_id IS NULL" : "parent_id = ?");
      if (filter.parentId !== null) params.push(filter.parentId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM goals ${where} ORDER BY depth, created_at`).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToGoal(r));
  }

  updateGoal(id: string, patch: Partial<Goal>): void {
    const existing = this.getGoal(id);
    if (!existing) throw new Error(`goal not found: ${id}`);
    const next = { ...existing, ...patch, id, updatedAt: now() };
    this.db
      .prepare(
        `UPDATE goals SET title=?, description=?, kind=?, status=?, depth=?, updated_at=? WHERE id=?`,
      )
      .run(next.title, next.description ?? null, next.kind, next.status, next.depth, next.updatedAt, id);
  }

  private rowToGoal(r: Record<string, unknown>): Goal {
    return {
      id: r.id as string,
      organizationId: r.organization_id as string | undefined,
      projectId: r.project_id as string | undefined,
      parentId: r.parent_id as string | undefined,
      title: r.title as string,
      description: r.description as string | undefined,
      kind: r.kind as Goal["kind"],
      status: r.status as Goal["status"],
      depth: r.depth as number,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Policies
  // -------------------------------------------------------------------------

  createPolicy(input: NewPolicy): Policy {
    const policy: Policy = {
      id: uuid(),
      organizationId: input.organizationId,
      projectId: input.projectId,
      name: input.name,
      kind: input.kind,
      target: input.target,
      scope: input.scope ?? "all",
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO policies (id, organization_id, project_id, name, kind, target, scope, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        policy.id,
        policy.organizationId ?? null,
        policy.projectId ?? null,
        policy.name,
        policy.kind,
        policy.target,
        policy.scope,
        policy.createdAt,
      );
    return policy;
  }

  listPolicies(filter: { organizationId?: string; projectId?: string } = {}): Policy[] {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.organizationId) {
      clauses.push("organization_id = ?");
      params.push(filter.organizationId);
    }
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.db.prepare(`SELECT * FROM policies ${where} ORDER BY name`).all(...params) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => this.rowToPolicy(r));
  }

  deletePolicy(id: string): void {
    this.db.prepare("DELETE FROM policies WHERE id = ?").run(id);
  }

  private rowToPolicy(r: Record<string, unknown>): Policy {
    return {
      id: r.id as string,
      organizationId: r.organization_id as string | undefined,
      projectId: r.project_id as string | undefined,
      name: r.name as string,
      kind: r.kind as "allow" | "deny",
      target: r.target as string,
      scope: r.scope as string,
      createdAt: r.created_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Memory
  // -------------------------------------------------------------------------

  addMemory(input: NewMemory): MemoryEntry {
    const entry: MemoryEntry = {
      id: uuid(),
      scope: input.scope,
      scopeId: input.scopeId,
      kind: input.kind ?? "note",
      content: input.content,
      source: input.source,
      author: input.author,
      confidence: input.confidence ?? 1.0,
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO memory (id, scope, scope_id, kind, content, source, author, confidence, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        entry.id,
        entry.scope,
        entry.scopeId ?? null,
        entry.kind,
        entry.content,
        entry.source ?? null,
        entry.author ?? null,
        entry.confidence,
        entry.createdAt,
      );
    return entry;
  }

  listMemory(scope: MemoryEntry["scope"], scopeId?: string): MemoryEntry[] {
    const rows = this.db
      .prepare("SELECT * FROM memory WHERE scope = ? AND (scope_id = ? OR scope_id IS NULL) ORDER BY created_at")
      .all(scope, scopeId ?? null) as Record<string, unknown>[];
    return rows.map((r) => this.rowToMemory(r));
  }

  getMemory(id: string): MemoryEntry | undefined {
    const row = this.db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToMemory(row) : undefined;
  }

  updateMemory(id: string, patch: Partial<MemoryEntry>): void {
    const existing = this.db.prepare("SELECT * FROM memory WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    if (!existing) throw new Error(`memory not found: ${id}`);
    const next = { ...this.rowToMemory(existing), ...patch, id };
    this.db
      .prepare("UPDATE memory SET content=?, kind=?, confidence=?, author=? WHERE id=?")
      .run(next.content, next.kind, next.confidence, next.author ?? null, id);
  }

  deleteMemory(id: string): void {
    this.db.prepare("DELETE FROM memory WHERE id = ?").run(id);
  }

  private rowToMemory(r: Record<string, unknown>): MemoryEntry {
    return {
      id: r.id as string,
      scope: r.scope as MemoryEntry["scope"],
      scopeId: r.scope_id as string | undefined,
      kind: r.kind as MemoryEntry["kind"],
      content: r.content as string,
      source: r.source as string | undefined,
      author: r.author as string | undefined,
      confidence: r.confidence as number,
      createdAt: r.created_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Events
  // -------------------------------------------------------------------------

  recordEvent(type: string, payload: Record<string, unknown> = {}): void {
    this.db
      .prepare("INSERT INTO events (type, payload, created_at) VALUES (?, ?, ?)")
      .run(type, JSON.stringify(payload), now());
  }

  listEvents(limit = 100): Array<{ id: number; type: string; payload: Record<string, unknown>; createdAt: number }> {
    const rows = this.db.prepare("SELECT * FROM events ORDER BY id DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as number,
      type: r.type as string,
      payload: jparse(r.payload as string, {}),
      createdAt: r.created_at as number,
    }));
  }

  // -------------------------------------------------------------------------
  // Audit log
  // -------------------------------------------------------------------------

  audit(input: { actor: string; action: string; entityType?: string; entityId?: string; details?: Record<string, unknown> }): void {
    this.db
      .prepare(
        "INSERT INTO audit_log (actor, action, entity_type, entity_id, details, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        input.actor,
        input.action,
        input.entityType ?? null,
        input.entityId ?? null,
        input.details ? JSON.stringify(input.details) : null,
        now(),
      );
  }

  listAudit(limit = 200): AuditEntry[] {
    const rows = this.db.prepare("SELECT * FROM audit_log ORDER BY id DESC LIMIT ?").all(limit) as Record<
      string,
      unknown
    >[];
    return rows.map((r) => ({
      id: r.id as number,
      actor: r.actor as string,
      action: r.action as string,
      entityType: r.entity_type as string | undefined,
      entityId: r.entity_id as string | undefined,
      details: jparse(r.details as string, undefined as unknown) as Record<string, unknown> | undefined,
      createdAt: r.created_at as number,
    }));
  }

  // -------------------------------------------------------------------------
  // Settings
  // -------------------------------------------------------------------------

  getSetting(key: string): string | undefined {
    const row = this.db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as
      | { value: string }
      | undefined;
    return row?.value;
  }

  getSettingJson<T>(key: string, fallback: T): T {
    return jparse(this.getSetting(key), fallback);
  }

  setSetting(key: string, value: string): void {
    this.db
      .prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value")
      .run(key, value);
  }

  setSettingJson(key: string, value: unknown): void {
    this.setSetting(key, JSON.stringify(value));
  }

  allSettings(): Record<string, string> {
    const rows = this.db.prepare("SELECT * FROM settings").all() as Array<{ key: string; value: string }>;
    return Object.fromEntries(rows.map((r) => [r.key, r.value]));
  }

  // -------------------------------------------------------------------------
  // Integrations
  // -------------------------------------------------------------------------

  upsertIntegration(integration: Omit<Integration, "createdAt" | "updatedAt">): Integration {
    const existing = this.db.prepare("SELECT id FROM integrations WHERE kind = ?").get(integration.kind) as
      | { id: string }
      | undefined;
    if (existing) {
      this.db
        .prepare("UPDATE integrations SET config = ?, enabled = ?, updated_at = ? WHERE kind = ?")
        .run(JSON.stringify(integration.config), integration.enabled ? 1 : 0, now(), integration.kind);
      return { ...integration, id: existing.id, createdAt: 0, updatedAt: now() };
    }
    const full: Integration = { ...integration, id: uuid(), createdAt: now(), updatedAt: now() };
    this.db
      .prepare(
        "INSERT INTO integrations (id, kind, config, enabled, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(full.id, full.kind, JSON.stringify(full.config), full.enabled ? 1 : 0, full.createdAt, full.updatedAt);
    return full;
  }

  getIntegration(kind: Integration["kind"]): Integration | undefined {
    const row = this.db.prepare("SELECT * FROM integrations WHERE kind = ?").get(kind) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToIntegration(row) : undefined;
  }

  listIntegrations(): Integration[] {
    const rows = this.db.prepare("SELECT * FROM integrations").all() as Record<string, unknown>[];
    return rows.map((r) => this.rowToIntegration(r));
  }

  private rowToIntegration(r: Record<string, unknown>): Integration {
    return {
      id: r.id as string,
      kind: r.kind as Integration["kind"],
      config: jparse(r.config as string, {}),
      enabled: (r.enabled as number) === 1,
      createdAt: r.created_at as number,
      updatedAt: r.updated_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Repositories
  // -------------------------------------------------------------------------

  createRepository(input: Omit<Repository, "id" | "createdAt">): Repository {
    const repo: Repository = { ...input, id: uuid(), createdAt: now() };
    this.db
      .prepare(
        `INSERT INTO repositories (id, project_id, kind, url, path, default_branch, protected_branches, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        repo.id,
        repo.projectId,
        repo.kind,
        repo.url ?? null,
        repo.path ?? null,
        repo.defaultBranch,
        JSON.stringify(repo.protectedBranches),
        repo.createdAt,
      );
    return repo;
  }

  getRepository(id: string): Repository | undefined {
    const row = this.db.prepare("SELECT * FROM repositories WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToRepository(row) : undefined;
  }

  listRepositories(projectId?: string): Repository[] {
    const rows = projectId
      ? (this.db.prepare("SELECT * FROM repositories WHERE project_id = ?").all(projectId) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM repositories").all() as Record<string, unknown>[]);
    return rows.map((r) => this.rowToRepository(r));
  }

  private rowToRepository(r: Record<string, unknown>): Repository {
    return {
      id: r.id as string,
      projectId: r.project_id as string,
      kind: r.kind as Repository["kind"],
      url: r.url as string | undefined,
      path: r.path as string | undefined,
      defaultBranch: r.default_branch as string,
      protectedBranches: jparse(r.protected_branches as string, [] as string[]),
      createdAt: r.created_at as number,
    };
  }

  // -------------------------------------------------------------------------
  // Escalations
  // -------------------------------------------------------------------------

  createEscalation(input: Omit<Escalation, "id" | "createdAt" | "status"> & { status?: Escalation["status"] }): Escalation {
    const esc: Escalation = {
      id: uuid(),
      status: "OPEN",
      ...input,
      createdAt: now(),
    };
    this.db
      .prepare(
        `INSERT INTO escalations (id, project_id, task_id, problem, context, options, recommendation, risk, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        esc.id,
        esc.projectId ?? null,
        esc.taskId ?? null,
        esc.problem,
        esc.context ?? null,
        JSON.stringify(esc.options),
        esc.recommendation ?? null,
        esc.risk ?? null,
        esc.status,
        esc.createdAt,
      );
    return esc;
  }

  getEscalation(id: string): Escalation | undefined {
    const row = this.db.prepare("SELECT * FROM escalations WHERE id = ?").get(id) as
      | Record<string, unknown>
      | undefined;
    return row ? this.rowToEscalation(row) : undefined;
  }

  listEscalations(status?: Escalation["status"]): Escalation[] {
    const rows = status
      ? (this.db.prepare("SELECT * FROM escalations WHERE status = ? ORDER BY created_at").all(status) as Record<string, unknown>[])
      : (this.db.prepare("SELECT * FROM escalations ORDER BY created_at").all() as Record<string, unknown>[]);
    return rows.map((r) => this.rowToEscalation(r));
  }

  resolveEscalation(id: string, status: "APPROVED" | "REJECTED" | "RESOLVED"): void {
    this.db
      .prepare("UPDATE escalations SET status = ?, resolved_at = ? WHERE id = ?")
      .run(status, now(), id);
  }

  private rowToEscalation(r: Record<string, unknown>): Escalation {
    return {
      id: r.id as string,
      projectId: r.project_id as string | undefined,
      taskId: r.task_id as string | undefined,
      problem: r.problem as string,
      context: r.context as string | undefined,
      options: jparse(r.options as string, [] as string[]),
      recommendation: r.recommendation as string | undefined,
      risk: r.risk as string | undefined,
      status: r.status as Escalation["status"],
      createdAt: r.created_at as number,
      resolvedAt: r.resolved_at as number | undefined,
    };
  }

  // -------------------------------------------------------------------------
  // Usage
  // -------------------------------------------------------------------------

  recordUsage(input: Omit<UsageRecord, "id" | "createdAt">): void {
    this.db
      .prepare(
        `INSERT INTO usage_log (organization_id, project_id, agent_id, task_id, model, provider, prompt_tokens, completion_tokens, model_calls, elapsed_ms, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        input.organizationId ?? null,
        input.projectId ?? null,
        input.agentId ?? null,
        input.taskId ?? null,
        input.model ?? null,
        input.provider ?? null,
        input.promptTokens,
        input.completionTokens,
        input.modelCalls,
        input.elapsedMs,
        now(),
      );
  }

  usageStats(filter: { projectId?: string; organizationId?: string } = {}): {
    totalCalls: number;
    totalPromptTokens: number;
    totalCompletionTokens: number;
    totalElapsedMs: number;
  } {
    const clauses: string[] = [];
    const params: SQLInputValue[] = [];
    if (filter.projectId) {
      clauses.push("project_id = ?");
      params.push(filter.projectId);
    }
    if (filter.organizationId) {
      clauses.push("organization_id = ?");
      params.push(filter.organizationId);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const row = this.db
      .prepare(
        `SELECT COUNT(*) AS calls, COALESCE(SUM(prompt_tokens),0) AS pt, COALESCE(SUM(completion_tokens),0) AS ct, COALESCE(SUM(elapsed_ms),0) AS ms FROM usage_log ${where}`,
      )
      .get(...params) as { calls: number; pt: number; ct: number; ms: number };
    return {
      totalCalls: row.calls,
      totalPromptTokens: row.pt,
      totalCompletionTokens: row.ct,
      totalElapsedMs: row.ms,
    };
  }

  // -------------------------------------------------------------------------
  // Reviews (PR reviews)
  // -------------------------------------------------------------------------

  createReview(input: { pullRequestId: string; reviewerId?: string; verdict: ReviewVerdict; comments?: string }): void {
    this.db
      .prepare(
        "INSERT INTO reviews (id, pull_request_id, reviewer_id, verdict, comments, created_at) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(uuid(), input.pullRequestId, input.reviewerId ?? null, input.verdict, input.comments ?? null, now());
  }
}
