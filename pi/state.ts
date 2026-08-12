/**
 * Lazy singleton for the Pi Studio extension (spec §54).
 *
 * Commands and tools share one in-memory instance: a single SQLite connection,
 * one repository, one set of domain services, and the shared event bus. Nothing
 * is opened at import time — `getStudio()` opens + migrates the database on
 * first use, seeds default roles and policies, and memoizes the result.
 * `resetStudio()` closes the database and clears the memo (called on
 * `session_shutdown`).
 */
import { fileURLToPath } from "node:url";
import type { Db } from "../database/db.ts";
import { createDb } from "../database/db.ts";
import { StudioRepository } from "../core/repository.ts";
import { bus } from "../core/events.ts";
import type { EventBus } from "../core/events.ts";
import { OrganizationService } from "../core/organization/index.ts";
import { ProjectService } from "../core/projects/index.ts";
import { GoalService } from "../core/goals/index.ts";
import { PolicyService } from "../core/policies/index.ts";
import { MemoryService } from "../core/memory/index.ts";
import { AgentRegistryService } from "../core/agents/index.ts";
import { TaskService } from "../core/tasks/index.ts";
import { MessagingService } from "../core/messaging/index.ts";
import {
  AgentSpawner,
  Council,
  createCouncilResponder,
  createPiRunner,
  ModelRouter,
  Scheduler,
} from "../core/orchestration/index.ts";
import { seedRoles } from "../agents/roles.ts";
import { createStudioToolDefinitions } from "./tools/index.ts";

export { currentOrgId } from "./currentOrg.ts";

export interface Studio {
  db: Db;
  repo: StudioRepository;
  bus: EventBus;
  organization: OrganizationService;
  project: ProjectService;
  goal: GoalService;
  policy: PolicyService;
  memory: MemoryService;
  agents: AgentRegistryService;
  tasks: TaskService;
  messaging: MessagingService;
  scheduler: Scheduler;
  router: ModelRouter;
  spawner: AgentSpawner;
  council: Council;
  paused: boolean;
}

let memo: Studio | undefined;

/** Absolute path to the data-driven role definitions (../agents). */
function agentsDir(): string {
  return fileURLToPath(new URL("../agents", import.meta.url));
}

export function getStudio(): Studio {
  if (memo) return memo;

  const db = createDb();
  const repo = new StudioRepository(db);
  const organization = new OrganizationService(repo, bus);
  const project = new ProjectService(repo, bus);
  const goal = new GoalService(repo, bus);
  const policy = new PolicyService(repo, bus);
  const memory = new MemoryService(repo);
  const agents = new AgentRegistryService(repo, bus);
  const tasks = new TaskService(repo, bus);
  const messaging = new MessagingService(repo, bus);
  const scheduler = new Scheduler(repo, bus);
  const router = new ModelRouter(repo);
  const council = new Council(repo, createCouncilResponder());

  const studio: Studio = {
    db,
    repo,
    bus,
    organization,
    project,
    goal,
    policy,
    memory,
    agents,
    tasks,
    messaging,
    scheduler,
    router,
    // Assigned below so the spawner's customTools closure can reference `studio`.
    spawner: null as unknown as AgentSpawner,
    council,
    paused: false,
  };

  studio.spawner = new AgentSpawner(
    repo,
    bus,
    createPiRunner({
      repo,
      router,
      customTools: () => createStudioToolDefinitions(studio),
    }),
  );

  // Idempotent lazy seeding: roles (skips existing) and default policies for
  // any organization that has none yet.
  seedRoles(repo, agentsDir());
  for (const org of repo.listOrganizations()) {
    if (repo.listPolicies({ organizationId: org.id }).length === 0) {
      policy.seedDefaults(org.id);
    }
  }

  memo = studio;
  return studio;
}

export function resetStudio(): void {
  if (!memo) return;
  try {
    memo.db.close();
  } catch {
    // Already closed or otherwise unavailable — nothing to do.
  }
  memo = undefined;
}
