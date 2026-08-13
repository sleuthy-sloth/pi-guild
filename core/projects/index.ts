import type { NewProject, Project, ProjectMetrics } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import type { EventBus } from "../events.ts";
import { bus as defaultBus } from "../events.ts";

const ACTOR = "system";
const ENTITY = "project";

export class ProjectService {
  private readonly bus: EventBus;

  constructor(private readonly repo: GuildRepository, bus?: EventBus) {
    this.bus = bus ?? defaultBus;
  }

  create(organizationId: string, name: string, opts: Partial<Project> = {}): Project {
    const input: NewProject = { ...opts, organizationId, name };
    const project = this.repo.createProject(input);
    this.repo.audit({
      actor: ACTOR,
      action: "project.create",
      entityType: ENTITY,
      entityId: project.id,
      details: { organizationId, name: project.name },
    });
    this.repo.recordEvent("project.created", {
      id: project.id,
      organizationId,
      name: project.name,
    });
    return project;
  }

  get(id: string): Project | undefined {
    return this.repo.getProject(id);
  }

  list(organizationId?: string): Project[] {
    return this.repo.listProjects(organizationId);
  }

  update(id: string, patch: Partial<Project>): void {
    this.repo.updateProject(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "project.update",
      entityType: ENTITY,
      entityId: id,
      details: { ...patch },
    });
    this.repo.recordEvent("project.updated", { id, ...patch });
  }

  remove(id: string): void {
    this.repo.deleteProject(id);
    this.repo.audit({
      actor: ACTOR,
      action: "project.remove",
      entityType: ENTITY,
      entityId: id,
    });
    this.repo.recordEvent("project.removed", { id });
  }

  refreshMetrics(projectId: string): ProjectMetrics {
    const tasks = this.repo.listTasks({ projectId });
    const metrics: ProjectMetrics = {
      tasksTotal: tasks.length,
      tasksDone: tasks.filter((t) => t.state === "DONE").length,
      tasksInProgress: tasks.filter((t) => t.state === "IN_PROGRESS").length,
      tasksBlocked: tasks.filter((t) => t.state === "BLOCKED").length,
    };
    this.repo.updateProject(projectId, { metrics });
    this.repo.audit({
      actor: ACTOR,
      action: "project.refresh_metrics",
      entityType: ENTITY,
      entityId: projectId,
      details: { metrics },
    });
    this.repo.recordEvent("project.metrics_refreshed", { id: projectId, metrics });
    return metrics;
  }
}
