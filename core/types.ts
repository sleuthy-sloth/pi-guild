/**
 * Core domain types for Pi Studio.
 *
 * These types are the shared contract between the persistence layer
 * (core/repository.ts), the domain services (core/*), the orchestration
 * engine (core/orchestration), and the Pi extension (pi/).
 *
 * IDs are strings (UUIDs via crypto.randomUUID). Timestamps are epoch ms.
 * Enums are stored as TEXT in SQLite.
 */

// ---------------------------------------------------------------------------
// Lifecycle state enums
// ---------------------------------------------------------------------------

/** Agent lifecycle states (spec §15). */
export type AgentState =
  | "CREATED"
  | "STARTING"
  | "IDLE"
  | "WORKING"
  | "BLOCKED"
  | "WAITING"
  | "REVIEWING"
  | "FAILED"
  | "COMPLETED"
  | "STOPPED";

/** Default task workflow states (spec §22). Custom workflows are configurable. */
export type TaskState =
  | "BACKLOG"
  | "READY"
  | "PLANNING"
  | "IN_PROGRESS"
  | "BLOCKED"
  | "REVIEW"
  | "QA"
  | "DONE"
  | "CANCELLED";

/** Message types (spec §18). */
export type MessageType =
  | "TASK"
  | "STATUS"
  | "QUESTION"
  | "BLOCKER"
  | "DECISION"
  | "REVIEW"
  | "ESCALATION"
  | "ANNOUNCEMENT";

export type MessageStatus = "UNREAD" | "READ" | "REPLIED" | "RESOLVED";

export type Priority = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";

/** Agent execution kind (spec §20). */
export type AgentKind = "persistent" | "ephemeral" | "scheduled" | "event";

/** Scope of a memory entry (spec §26). */
export type MemoryScope = "global" | "organization" | "project" | "task" | "agent";

export type MemoryKind = "note" | "decision" | "fact" | "attempt";

export type GoalKind = "company" | "product" | "feature" | "task";

export type EscalationStatus = "OPEN" | "APPROVED" | "REJECTED" | "RESOLVED";

export type ReviewVerdict = "approve" | "request_changes" | "comment";

/** Repository provider kind (spec §8/§55). */
export type RepoKind = "local" | "github" | "gitlab" | "gitea" | "forgejo";

export type IntegrationKind = "plane" | "github" | "git";

// ---------------------------------------------------------------------------
// Entities
// ---------------------------------------------------------------------------

export interface Organization {
  id: string;
  name: string;
  description?: string;
  goals: string[]; // goal ids at the top level
  policies: string[]; // policy ids
  workflows: string[]; // workflow names
  budgets: BudgetPolicy;
  integrations: Record<string, string>; // integration id by kind
  createdAt: number;
  updatedAt: number;
}

export interface Project {
  id: string;
  organizationId: string;
  name: string;
  description?: string;
  goals: string[];
  roadmap: string[];
  repositoryId?: string;
  documentation: string;
  metrics: ProjectMetrics;
  settings: Record<string, unknown>;
  createdAt: number;
  updatedAt: number;
}

export interface ProjectMetrics {
  tasksTotal: number;
  tasksDone: number;
  tasksInProgress: number;
  tasksBlocked: number;
}

export interface AgentRole {
  id: string;
  name: string;
  description: string;
  responsibilities: string[];
  tools: string[];
  permissions: string[];
  model?: string;
  systemPrompt: string;
  createdAt: number;
}

export interface Agent {
  id: string;
  name: string;
  roleId?: string;
  roleName: string;
  model?: string;
  provider?: string;
  projectId?: string;
  organizationId: string;
  parentAgentId?: string;
  currentTaskId?: string;
  state: AgentState;
  /** Pi session id (reference, not full history — spec §9). */
  sessionId?: string;
  sessionFile?: string;
  kind: AgentKind;
  schedule?: string;
  triggerEvent?: string;
  settings: Record<string, unknown>;
  createdAt: number;
  lastActivityAt?: number;
}

export interface Task {
  id: string;
  title: string;
  description?: string;
  acceptanceCriteria: string[];
  priority: Priority;
  assigneeId?: string;
  creatorId?: string;
  projectId: string;
  parentId?: string;
  labels: string[];
  state: TaskState;
  repository?: string;
  branch?: string;
  pr?: string;
  artifacts: string[];
  depth: number;
  createdAt: number;
  updatedAt: number;
  startedAt?: number;
  completedAt?: number;
}

export interface TaskDependency {
  taskId: string;
  dependsOnId: string;
}

export interface Message {
  id: string;
  senderId?: string; // agent id, or undefined for "human"
  senderName: string;
  /** agent id, "human", "all", or a group/project id — spec §5. */
  recipientId: string;
  projectId?: string;
  taskId?: string;
  priority: Priority;
  messageType: MessageType;
  content: string;
  parentMessageId?: string;
  status: MessageStatus;
  createdAt: number;
}

export interface Goal {
  id: string;
  organizationId?: string;
  projectId?: string;
  parentId?: string;
  title: string;
  description?: string;
  kind: GoalKind;
  status: "open" | "in_progress" | "done" | "cancelled";
  depth: number;
  createdAt: number;
  updatedAt: number;
}

export interface Policy {
  id: string;
  organizationId?: string;
  projectId?: string;
  name: string;
  kind: "allow" | "deny";
  target: string; // e.g. "read source code", "create branches", "merge into main"
  scope: string;
  createdAt: number;
}

export interface MemoryEntry {
  id: string;
  scope: MemoryScope;
  scopeId?: string;
  kind: MemoryKind;
  content: string;
  source?: string;
  author?: string;
  confidence: number;
  createdAt: number;
}

export interface AuditEntry {
  id: number;
  actor: string;
  action: string;
  entityType?: string;
  entityId?: string;
  details?: Record<string, unknown>;
  createdAt: number;
}

export interface Escalation {
  id: string;
  projectId?: string;
  taskId?: string;
  problem: string;
  context?: string;
  options: string[];
  recommendation?: string;
  risk?: string;
  status: EscalationStatus;
  createdAt: number;
  resolvedAt?: number;
}

export interface Repository {
  id: string;
  projectId: string;
  kind: RepoKind;
  url?: string;
  path?: string;
  defaultBranch: string;
  protectedBranches: string[];
  createdAt: number;
}

export interface Integration {
  id: string;
  kind: IntegrationKind;
  config: Record<string, unknown>;
  enabled: boolean;
  createdAt: number;
  updatedAt: number;
}

export interface UsageRecord {
  id: number;
  organizationId?: string;
  projectId?: string;
  agentId?: string;
  taskId?: string;
  model?: string;
  provider?: string;
  promptTokens: number;
  completionTokens: number;
  modelCalls: number;
  elapsedMs: number;
  createdAt: number;
}

/** Budget limits and the policy when a limit is reached (spec §32). */
export interface BudgetPolicy {
  maxTokensPerTask?: number;
  maxModelCallsPerTask?: number;
  maxAgentMinutes?: number;
  maxConcurrentAgents?: number;
  maxRetries?: number;
  /** "continue" | "pause" | "escalate" */
  onLimit: "continue" | "pause" | "escalate";
}

/** Event payloads for the internal event bus (spec §19). */
export interface StudioEvent {
  type: string;
  payload: Record<string, unknown>;
  at: number;
}

// ---------------------------------------------------------------------------
// Domain input types (create/update payloads)
// ---------------------------------------------------------------------------

export type NewOrganization = Partial<Organization> & { name: string };
export type NewProject = Partial<Project> & { name: string; organizationId: string };
export type NewAgent = Partial<Agent> & {
  name: string;
  organizationId: string;
  roleName: string;
  roleId?: string;
};
export type NewTask = Partial<Task> & { title: string; projectId: string };
export type NewMessage = Partial<Message> & {
  senderName: string;
  recipientId: string;
  messageType: MessageType;
  content: string;
};
export type NewGoal = Partial<Goal> & { title: string };
export type NewPolicy = Partial<Policy> & { name: string; kind: "allow" | "deny"; target: string };
export type NewMemory = Partial<MemoryEntry> & {
  scope: MemoryScope;
  content: string;
  kind?: MemoryKind;
};
export type NewEscalation = Partial<Escalation> & { problem: string };
