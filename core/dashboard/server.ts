/**
 * Browser dashboard server (spec §37).
 *
 * An explicitly-started local HTTP server: a read-only JSON snapshot of the
 * SQLite DB plus a few human-control actions (pause/resume, approve/reject).
 * No framework — Node's `http` serves one self-contained HTML page.
 */
import { createServer, type IncomingMessage, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { GuildRepository } from "../repository.ts";

export interface DashboardDeps {
  repo: GuildRepository;
  isPaused: () => boolean;
  pause: () => void;
  resume: () => void;
  approveEscalation: (id: string) => void;
  rejectEscalation: (id: string) => void;
}

export interface DashboardServer {
  port: number;
  url: string;
  close(): Promise<void>;
}

export function buildState(repo: GuildRepository, paused: boolean) {
  const projects = repo.listProjects().map((p) => {
    const tasks = repo.listTasks({ projectId: p.id });
    return {
      ...p,
      metrics: {
        tasksTotal: tasks.length,
        tasksDone: tasks.filter((t) => t.state === "DONE").length,
        tasksInProgress: tasks.filter((t) => t.state === "IN_PROGRESS").length,
        tasksBlocked: tasks.filter((t) => t.state === "BLOCKED").length,
      },
    };
  });
  return {
    paused,
    organizations: repo.listOrganizations(),
    projects,
    agents: repo.listAgents(),
    tasks: repo.listTasks(),
    messages: repo.listMessages().slice(-50),
    pullRequests: repo.listPullRequests(),
    escalations: repo.listEscalations(),
    usage: repo.usageStats(),
    roles: repo.listRoles(),
  };
}

function readJsonBody(req: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve) => {
    let data = "";
    req.on("data", (chunk) => (data += chunk));
    req.on("end", () => {
      try {
        resolve(JSON.parse(data || "{}"));
      } catch {
        resolve({});
      }
    });
    req.on("error", () => resolve({}));
  });
}

export async function startDashboard(deps: DashboardDeps, opts: { port?: number } = {}): Promise<DashboardServer> {
  const htmlPath = fileURLToPath(new URL("../../ui/dashboard/index.html", import.meta.url));
  const html = readFileSync(htmlPath, "utf8");

  const server: Server = createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");
    const send = (status: number, body: string, type = "application/json; charset=utf-8") => {
      res.writeHead(status, { "Content-Type": type });
      res.end(body);
    };

    if (url.pathname === "/api/state" && req.method === "GET") {
      send(200, JSON.stringify(buildState(deps.repo, deps.isPaused())));
      return;
    }

    if (req.method === "POST") {
      const body = await readJsonBody(req);
      if (url.pathname === "/api/pause") {
        deps.pause();
        send(200, JSON.stringify({ paused: true }));
        return;
      }
      if (url.pathname === "/api/resume") {
        deps.resume();
        send(200, JSON.stringify({ paused: false }));
        return;
      }
      if (url.pathname === "/api/approve") {
        const id = String(body.id ?? "");
        if (id) deps.approveEscalation(id);
        send(200, JSON.stringify({ ok: true }));
        return;
      }
      if (url.pathname === "/api/reject") {
        const id = String(body.id ?? "");
        if (id) deps.rejectEscalation(id);
        send(200, JSON.stringify({ ok: true }));
        return;
      }
    }

    send(200, html, "text/html; charset=utf-8");
  });

  await new Promise<void>((resolve) => server.listen(opts.port ?? 0, "127.0.0.1", () => resolve()));
  const port = (server.address() as AddressInfo).port;

  return {
    port,
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
