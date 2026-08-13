import { seedDemoRepo } from "./seed-demo.ts";
import { formatLive, formatAgents, formatTasks } from "./pi/ui/index.ts";
import { ModelRouter } from "./core/orchestration/model-router.ts";
import { TaskService } from "./core/tasks/index.ts";
import { AgentRegistryService } from "./core/agents/index.ts";
import { OrganizationService } from "./core/organization/index.ts";
import { ProjectService } from "./core/projects/index.ts";

const repo = seedDemoRepo();
const router = new ModelRouter(repo);
router.assignAuto([
  { provider: "opencode-go", id: "deepseek-v4-pro", name: "DeepSeek V4 Pro" },
  { provider: "anthropic", id: "claude-sonnet-4-5", name: "Sonnet" },
  { provider: "openai", id: "gpt-4o-mini", name: "GPT-4o Mini" },
]);
const proj = repo.listProjects()[0];
const studio = {
  tasks: new TaskService(repo),
  agents: new AgentRegistryService(repo),
  organization: new OrganizationService(repo),
  project: new ProjectService(repo),
  paused: false,
} as never;

console.log("=== LIVE PANEL ===");
console.log(formatLive(studio));
console.log("\n=== /studio agents ===");
console.log(formatAgents(repo.listAgents()));
console.log("\n=== /studio tasks ===");
console.log(formatTasks(repo.listTasks({ projectId: proj.id })));
console.log("\n=== /studio models ===");
console.log(router.describe());
