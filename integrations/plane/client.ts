/**
 * Plane REST client (spec §35).
 *
 * Thin fetch wrapper over Plane's `/api/v1` API. The `fetch` function is
 * injectable so tests can substitute a mock without a live Plane instance.
 */
export interface PlaneConfig {
  baseUrl: string; // e.g. https://api.plane.so or http://localhost:8090
  apiKey: string; // plane_api_...
  workspaceSlug: string;
}

export interface PlaneProject {
  id: string;
  name: string;
  identifier?: string;
  [key: string]: unknown;
}

export interface PlaneIssue {
  id: string;
  name: string;
  state?: string;
  priority?: string;
  sequence_id?: number;
  [key: string]: unknown;
}

export interface PlaneState {
  id: string;
  name: string;
  group: string;
  [key: string]: unknown;
}

export interface PlaneClient {
  listProjects(): Promise<PlaneProject[]>;
  createProject(name: string, identifier: string): Promise<PlaneProject>;
  listIssues(projectId: string): Promise<PlaneIssue[]>;
  createIssue(
    projectId: string,
    input: { name: string; descriptionHtml?: string; state?: string; priority?: string },
  ): Promise<PlaneIssue>;
  updateIssue(projectId: string, issueId: string, patch: Record<string, unknown>): Promise<PlaneIssue>;
  listStates(projectId: string): Promise<PlaneState[]>;
  addComment(projectId: string, issueId: string, commentHtml: string): Promise<unknown>;
}

export class HttpPlaneClient implements PlaneClient {
  constructor(
    private readonly config: PlaneConfig,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private url(path: string): string {
    return `${this.config.baseUrl.replace(/\/+$/, "")}/api/v1/workspaces/${this.config.workspaceSlug}${path}`;
  }

  private async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await this.fetchFn(this.url(path), {
      method,
      headers: { "X-API-Key": this.config.apiKey, "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) {
      throw new Error(`Plane API ${res.status}: ${await res.text()}`);
    }
    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  listProjects(): Promise<PlaneProject[]> {
    return this.request("GET", "/projects/");
  }

  createProject(name: string, identifier: string): Promise<PlaneProject> {
    return this.request("POST", "/projects/", { name, identifier });
  }

  listIssues(projectId: string): Promise<PlaneIssue[]> {
    return this.request("GET", `/projects/${projectId}/issues/`);
  }

  createIssue(
    projectId: string,
    input: { name: string; descriptionHtml?: string; state?: string; priority?: string },
  ): Promise<PlaneIssue> {
    return this.request("POST", `/projects/${projectId}/issues/`, {
      name: input.name,
      description_html: input.descriptionHtml,
      state: input.state,
      priority: input.priority,
    });
  }

  updateIssue(projectId: string, issueId: string, patch: Record<string, unknown>): Promise<PlaneIssue> {
    return this.request("PATCH", `/projects/${projectId}/issues/${issueId}/`, patch);
  }

  listStates(projectId: string): Promise<PlaneState[]> {
    return this.request("GET", `/projects/${projectId}/states/`);
  }

  addComment(projectId: string, issueId: string, commentHtml: string): Promise<unknown> {
    return this.request("POST", `/projects/${projectId}/issues/${issueId}/comments/`, { comment_html: commentHtml });
  }
}
