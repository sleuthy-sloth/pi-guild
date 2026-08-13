import { describe, it, expect } from "vitest";
import { newTestRepo } from "../helpers.ts";
import { startDashboard } from "../../core/dashboard/server.ts";

describe("dashboard server", () => {
  it("serves the snapshot HTML + JSON and handles actions", async () => {
    const repo = newTestRepo();
    const org = repo.createOrganization({ name: "o" });
    const proj = repo.createProject({ name: "p", organizationId: org.id });
    const task = repo.createTask({ title: "build it", projectId: proj.id });
    const esc = repo.createEscalation({ problem: "need a decision", projectId: proj.id, taskId: task.id, options: [] });

    let paused = false;
    const server = await startDashboard({
      repo,
      isPaused: () => paused,
      pause: () => {
        paused = true;
      },
      resume: () => {
        paused = false;
      },
      approveEscalation: (id) => repo.resolveEscalation(id, "APPROVED"),
      rejectEscalation: (id) => repo.resolveEscalation(id, "REJECTED"),
    });

    try {
      const html = await (await fetch(`${server.url}/`)).text();
      expect(html).toContain("Pi Studio");

      const state = (await (await fetch(`${server.url}/api/state`)).json()) as {
        paused: boolean;
        organizations: unknown[];
        projects: unknown[];
        tasks: unknown[];
        escalations: unknown[];
        usage: { totalCalls: number };
      };
      expect(state.paused).toBe(false);
      expect(state.organizations).toHaveLength(1);
      expect(state.projects).toHaveLength(1);
      expect(state.tasks).toHaveLength(1);
      expect(state.escalations).toHaveLength(1);
      expect(state.usage.totalCalls).toBe(0);

      await fetch(`${server.url}/api/pause`, { method: "POST" });
      expect(paused).toBe(true);

      await fetch(`${server.url}/api/approve`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ id: esc.id }),
      });
      expect(repo.getEscalation(esc.id)!.status).toBe("APPROVED");
    } finally {
      await server.close();
    }
  });
});
