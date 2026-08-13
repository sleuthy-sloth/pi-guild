import { createDb } from "./database/db.ts";
import { StudioRepository } from "./core/repository.ts";

export function seedDemoRepo(): StudioRepository {
  const repo = new StudioRepository(createDb(":memory:"));
  const org = repo.createOrganization({ name: "Acme Game Studio" });
  const proj = repo.createProject({ name: "veil-of-secrets", organizationId: org.id });
  repo.createRepository({
    projectId: proj.id,
    kind: "github",
    path: "/tmp/veil",
    url: "https://github.com/acme/veil",
    defaultBranch: "main",
    protectedBranches: [],
  });

  // Agents first (tasks reference them via FK).
  const agents = new Map<string, string>();
  const roster: Array<[string, string, string]> = [
    ["ceo", "CEO", "IDLE"],
    ["manager", "Manager", "WORKING"],
    ["architect", "Architect", "IDLE"],
    ["dev-1", "Developer", "WORKING"],
    ["dev-2", "Developer", "BLOCKED"],
    ["reviewer", "Reviewer", "REVIEWING"],
    ["qa", "QA", "WAITING"],
    ["designer", "Designer", "IDLE"],
  ];
  for (const [name, roleName, state] of roster) {
    const a = repo.createAgent({ name, roleName, organizationId: org.id, projectId: proj.id, state: state as never });
    agents.set(name, a.id);
  }

  // Tasks with real assignee ids.
  const t1 = repo.createTask({ title: "Player movement", projectId: proj.id, state: "DONE", priority: "HIGH", assigneeId: agents.get("dev-1") });
  const t2 = repo.createTask({ title: "Combat system", projectId: proj.id, state: "IN_PROGRESS", priority: "CRITICAL", assigneeId: agents.get("dev-1") });
  const t3 = repo.createTask({ title: "Inventory UI", projectId: proj.id, state: "REVIEW", priority: "MEDIUM", assigneeId: agents.get("dev-2") });
  const t4 = repo.createTask({ title: "Boss fight", projectId: proj.id, state: "QA", priority: "HIGH", assigneeId: agents.get("dev-2") });
  const t5 = repo.createTask({ title: "Save system", projectId: proj.id, state: "BACKLOG", priority: "LOW" });

  // Wire current tasks onto working agents.
  repo.setAgentCurrentTask(agents.get("manager")!, t2.id);
  repo.setAgentCurrentTask(agents.get("dev-1")!, t2.id);
  repo.setAgentCurrentTask(agents.get("dev-2")!, t3.id);
  repo.setAgentCurrentTask(agents.get("reviewer")!, t3.id);
  repo.setAgentCurrentTask(agents.get("qa")!, t4.id);

  repo.createMessage({ senderName: "architect", recipientId: "dev-1", messageType: "DECISION", content: "Use an ECS for entity management", projectId: proj.id, taskId: t2.id });
  repo.createMessage({ senderName: "dev-2", recipientId: "manager", messageType: "BLOCKER", content: "Need boss sprite assets to finish", projectId: proj.id, taskId: t4.id });
  repo.createEscalation({ problem: "Cloud save vs local save?", projectId: proj.id, taskId: t5.id, options: ["Firebase", "Supabase", "Local"], recommendation: "Supabase" });
  repo.createPullRequest({ repositoryId: repo.listRepositories(proj.id)[0].id, title: "Add combat system", state: "open", branch: "feature/combat", url: "https://github.com/acme/veil/pull/12" });
  repo.recordUsage({ projectId: proj.id, taskId: t2.id, promptTokens: 150000, completionTokens: 45000, modelCalls: 32, elapsedMs: 3600000 });
  return repo;
}
