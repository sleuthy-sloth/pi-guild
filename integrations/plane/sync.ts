/**
 * PlaneSyncService — mirrors Pi Guild project/task state into Plane (spec §35).
 *
 * SQLite remains the source of truth; Plane is an optional mirror. Project and
 * issue mappings are stored in the settings table (no schema change). State is
 * mapped from Pi Guild task states to Plane's default state names.
 */
import type { GuildRepository } from "../../core/repository.ts";
import type { TaskState } from "../../core/types.ts";
import type { PlaneClient, PlaneConfig, PlaneProject } from "./client.ts";

const PLANE_CONFIG_KEY = "planeConfig";

export class PlaneSyncService {
  constructor(
    private readonly repo: GuildRepository,
    private readonly client: PlaneClient,
  ) {}

  static readConfig(repo: GuildRepository): PlaneConfig | undefined {
    return repo.getSettingJson<PlaneConfig | undefined>(PLANE_CONFIG_KEY, undefined);
  }

  saveConfig(config: PlaneConfig): void {
    this.repo.setSettingJson(PLANE_CONFIG_KEY, config);
    this.repo.upsertIntegration({ kind: "plane", config: config as unknown as Record<string, unknown>, enabled: true });
  }

  isConfigured(): boolean {
    return PlaneSyncService.readConfig(this.repo) !== undefined;
  }

  /** Map a Pi Guild task state to a Plane state name (default Plane groups). */
  mapState(state: TaskState): string {
    switch (state) {
      case "BACKLOG":
        return "Backlog";
      case "READY":
      case "PLANNING":
        return "Unstarted";
      case "IN_PROGRESS":
      case "BLOCKED":
      case "REVIEW":
      case "QA":
        return "Started";
      case "DONE":
        return "Completed";
      case "CANCELLED":
        return "Cancelled";
      default:
        return "Backlog";
    }
  }

  private projectMap(): Record<string, string> {
    return this.repo.getSettingJson<Record<string, string>>("planeProjects", {});
  }

  private saveProjectMap(map: Record<string, string>): void {
    this.repo.setSettingJson("planeProjects", map);
  }

  private issueMap(projectId: string): Record<string, string> {
    return this.repo.getSettingJson<Record<string, string>>(`planeIssues:${projectId}`, {});
  }

  private saveIssueMap(projectId: string, map: Record<string, string>): void {
    this.repo.setSettingJson(`planeIssues:${projectId}`, map);
  }

  /** Find (by name) or create the Plane project for a Pi Guild project. */
  async ensureProject(projectId: string): Promise<PlaneProject> {
    const mapping = this.projectMap();
    const mapped = mapping[projectId];
    if (mapped) return { id: mapped, name: "" };

    const project = this.repo.getProject(projectId);
    if (!project) throw new Error(`project not found: ${projectId}`);

    const existing = (await this.client.listProjects()).find((p) => p.name === project.name);
    const planeProject = existing ?? (await this.client.createProject(project.name, project.id.slice(0, 5)));

    mapping[projectId] = planeProject.id;
    this.saveProjectMap(mapping);
    return planeProject;
  }

  /** Push all of a project's tasks to Plane as issues (create or update). */
  async pushProject(projectId: string): Promise<{ created: number; updated: number }> {
    const planeProject = await this.ensureProject(projectId);
    const issues = this.issueMap(projectId);
    let created = 0;
    let updated = 0;

    for (const task of this.repo.listTasks({ projectId })) {
      const patch = {
        name: task.title,
        description_html: task.description,
        state: this.mapState(task.state),
        priority: task.priority.toLowerCase(),
      };
      if (issues[task.id]) {
        await this.client.updateIssue(planeProject.id, issues[task.id], patch);
        updated++;
      } else {
        const issue = await this.client.createIssue(planeProject.id, patch);
        issues[task.id] = issue.id;
        created++;
      }
    }

    this.saveIssueMap(projectId, issues);
    this.repo.audit({
      actor: "plane",
      action: "plane.pushProject",
      entityType: "project",
      entityId: projectId,
      details: { created, updated },
    });
    return { created, updated };
  }

  /** Push a single task's state to Plane (no-op if it has no mapped issue). */
  async syncTask(taskId: string): Promise<void> {
    const task = this.repo.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const issueId = this.issueMap(task.projectId)[taskId];
    if (!issueId) return;
    const planeProject = await this.ensureProject(task.projectId);
    await this.client.updateIssue(planeProject.id, issueId, { state: this.mapState(task.state) });
  }

  /** Push a task's messages to Plane as issue comments. */
  async pushComments(taskId: string): Promise<number> {
    const task = this.repo.getTask(taskId);
    if (!task) throw new Error(`task not found: ${taskId}`);
    const issueId = this.issueMap(task.projectId)[taskId];
    if (!issueId) return 0;
    const planeProject = await this.ensureProject(task.projectId);
    const messages = this.repo.listMessages({ taskId });
    for (const message of messages) {
      await this.client.addComment(planeProject.id, issueId, `[${message.senderName}] ${message.content}`);
    }
    return messages.length;
  }
}
