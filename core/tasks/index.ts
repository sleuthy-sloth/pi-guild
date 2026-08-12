import type { NewTask, Task, TaskState } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import { bus as defaultBus, StudioEvents } from "../events.ts";
import type { EventBus } from "../events.ts";

export type { NewTask, Task, TaskState } from "../types.ts";

const ACTOR = "system";

/**
 * TaskService — task lifecycle, dependency graph, and readiness (spec §22–§24).
 *
 * Dependencies gate readiness: a task is READY only when every dependency is
 * DONE. Cycle detection rejects invalid dependency edges up front, and task
 * decomposition is capped by maxDepth.
 */
export class TaskService {
  constructor(
    private readonly repo: StudioRepository,
    private readonly bus: EventBus = defaultBus,
  ) {}

  create(input: NewTask): Task {
    const task = this.repo.createTask(input);
    this.repo.audit({
      actor: ACTOR,
      action: "task.create",
      entityType: "task",
      entityId: task.id,
      details: { title: task.title, projectId: task.projectId, parentId: task.parentId, depth: task.depth },
    });
    this.repo.recordEvent(StudioEvents.taskCreated, { taskId: task.id, task });
    this.bus.emit(StudioEvents.taskCreated, { taskId: task.id, task });
    return task;
  }

  get(id: string): Task | undefined {
    return this.repo.getTask(id);
  }

  list(filter?: { projectId?: string; state?: TaskState; assigneeId?: string; parentId?: string }): Task[] {
    return this.repo.listTasks(filter);
  }

  children(id: string): Task[] {
    return this.repo.listChildren(id);
  }

  update(id: string, patch: Partial<Task>): void {
    this.repo.updateTask(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "task.update",
      entityType: "task",
      entityId: id,
      details: { patch },
    });
    this.repo.recordEvent("task.updated", { taskId: id, patch });
  }

  setState(id: string, state: TaskState): void {
    const existing = this.repo.getTask(id);
    const previous = existing?.state;
    this.repo.setTaskState(id, state);
    this.repo.audit({
      actor: ACTOR,
      action: "task.setState",
      entityType: "task",
      entityId: id,
      details: { state, previous },
    });
    this.repo.recordEvent(StudioEvents.taskStateChanged, { taskId: id, state, previous });
    this.bus.emit(StudioEvents.taskStateChanged, { taskId: id, state, previous });

    if (state === "DONE") {
      this.repo.recordEvent(StudioEvents.taskCompleted, { taskId: id, state, previous });
      this.bus.emit(StudioEvents.taskCompleted, { taskId: id, state, previous });
    } else if (state === "BLOCKED") {
      this.repo.recordEvent(StudioEvents.taskBlocked, { taskId: id, state, previous });
      this.bus.emit(StudioEvents.taskBlocked, { taskId: id, state, previous });
    } else if ((state as string) === "FAILED") {
      this.repo.recordEvent(StudioEvents.taskFailed, { taskId: id, state, previous });
      this.bus.emit(StudioEvents.taskFailed, { taskId: id, state, previous });
    }
  }

  assign(taskId: string, agentId: string): void {
    this.repo.updateTask(taskId, { assigneeId: agentId, state: "READY" });
    this.repo.audit({
      actor: ACTOR,
      action: "task.assign",
      entityType: "task",
      entityId: taskId,
      details: { agentId, state: "READY" },
    });
    this.repo.recordEvent(StudioEvents.taskAssigned, { taskId, agentId });
    this.bus.emit(StudioEvents.taskAssigned, { taskId, agentId });
  }

  decompose(id: string, children: Array<{ title: string; description?: string }>, maxDepth: number = 4): Task[] {
    const parent = this.repo.getTask(id);
    if (!parent) throw new Error(`task not found: ${id}`);
    if (parent.depth >= maxDepth) throw new Error("max decomposition depth reached");

    const created = children.map((child) =>
      this.repo.createTask({
        title: child.title,
        description: child.description,
        parentId: id,
        projectId: parent.projectId,
      }),
    );

    this.repo.audit({
      actor: ACTOR,
      action: "task.decompose",
      entityType: "task",
      entityId: id,
      details: { childIds: created.map((t) => t.id), depth: parent.depth },
    });
    this.repo.recordEvent("task.decomposed", {
      taskId: id,
      childIds: created.map((t) => t.id),
      count: created.length,
    });
    return created;
  }

  addDependency(taskId: string, dependsOnId: string): void {
    if (taskId === dependsOnId) throw new Error("task cannot depend on itself");
    if (!this.repo.getTask(taskId)) throw new Error(`task not found: ${taskId}`);
    if (!this.repo.getTask(dependsOnId)) throw new Error(`task not found: ${dependsOnId}`);
    if (this.wouldCreateCycle(taskId, dependsOnId)) throw new Error("dependency would create a cycle");

    this.repo.addDependency(taskId, dependsOnId);
    this.repo.audit({
      actor: ACTOR,
      action: "task.addDependency",
      entityType: "task",
      entityId: taskId,
      details: { dependsOnId },
    });
    this.repo.recordEvent("task.dependency_added", { taskId, dependsOnId });
  }

  removeDependency(taskId: string, dependsOnId: string): void {
    this.repo.removeDependency(taskId, dependsOnId);
    this.repo.audit({
      actor: ACTOR,
      action: "task.removeDependency",
      entityType: "task",
      entityId: taskId,
      details: { dependsOnId },
    });
    this.repo.recordEvent("task.dependency_removed", { taskId, dependsOnId });
  }

  dependencies(id: string): Task[] {
    return this.repo.listDependencies(id);
  }

  dependents(id: string): Task[] {
    return this.repo.listDependents(id);
  }

  isReady(id: string): boolean {
    const task = this.repo.getTask(id);
    if (!task) return false;
    if (task.state !== "BACKLOG" && task.state !== "READY") return false;
    return this.repo.listDependencies(id).every((dep) => dep.state === "DONE");
  }

  /**
   * Adding "taskId depends on dependsOnId" would create a cycle iff dependsOnId
   * already (transitively) depends on taskId. We walk the dependency
   * (prerequisite) graph from dependsOnId and look for taskId.
   */
  wouldCreateCycle(taskId: string, dependsOnId: string): boolean {
    if (taskId === dependsOnId) return true;

    const seen = new Set<string>();
    const stack: string[] = [dependsOnId];
    while (stack.length > 0) {
      const id = stack.pop() as string;
      if (seen.has(id)) continue;
      seen.add(id);
      for (const dep of this.repo.listDependencies(id)) {
        if (dep.id === taskId) return true;
        stack.push(dep.id);
      }
    }
    return false;
  }
}
