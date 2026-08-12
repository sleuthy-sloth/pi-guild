/**
 * Context assembler (spec §25).
 *
 * Gathers only the relevant context for a task — parent, dependencies, project
 * memory, decisions, prior attempts, and messages — so agents aren't flooded
 * with the whole project. Sources are extensible: register more with
 * `addSource()`.
 */
import type { Task } from "../types.ts";
import type { StudioRepository } from "../repository.ts";

export interface ContextSource {
  name: string;
  gather(task: Task): Promise<string>;
}

function section(title: string, lines: string[]): string {
  if (lines.length === 0) return "";
  return `## ${title}\n${lines.join("\n")}`;
}

export class ContextAssembler {
  private readonly sources: ContextSource[] = [];

  constructor(repo: StudioRepository) {
    this.sources.push(
      {
        name: "parent",
        gather: async (task) => {
          if (!task.parentId) return "";
          const parent = repo.getTask(task.parentId);
          if (!parent) return "";
          const lines = [`- ${parent.title} [${parent.state}]`];
          if (parent.description) lines.push(`  ${parent.description}`);
          if (parent.acceptanceCriteria.length > 0) {
            lines.push("  Acceptance:");
            for (const c of parent.acceptanceCriteria) lines.push(`  - ${c}`);
          }
          return section("Parent task", lines);
        },
      },
      {
        name: "dependencies",
        gather: async (task) => {
          const deps = repo.listDependencies(task.id);
          if (deps.length === 0) return "";
          return section(
            "Dependencies",
            deps.map((d) => `- ${d.title} [${d.state}]`),
          );
        },
      },
      {
        name: "project-memory",
        gather: async (task) => {
          const entries = repo.listMemory("project", task.projectId).filter((m) => m.kind !== "decision");
          if (entries.length === 0) return "";
          return section(
            "Project context",
            entries.map((m) => `- ${m.content}`),
          );
        },
      },
      {
        name: "decisions",
        gather: async (task) => {
          const decisions = repo.listMemory("project", task.projectId).filter((m) => m.kind === "decision");
          if (decisions.length === 0) return "";
          return section(
            "Decisions",
            decisions.map((m) => `- ${m.content.replace(/\n/g, "\n  ")}`),
          );
        },
      },
      {
        name: "prior-attempts",
        gather: async (task) => {
          const attempts = repo.listMemory("task", task.id).filter((m) => m.kind === "attempt");
          if (attempts.length === 0) return "";
          return section(
            "Prior attempts",
            attempts.map((m) => `- ${m.content.slice(0, 300)}`),
          );
        },
      },
      {
        name: "messages",
        gather: async (task) => {
          const messages = repo.listMessages({ taskId: task.id });
          if (messages.length === 0) return "";
          return section(
            "Related messages",
            messages.map((m) => `- ${m.senderName} [${m.messageType}]: ${m.content.slice(0, 300)}`),
          );
        },
      },
    );
  }

  addSource(source: ContextSource): void {
    this.sources.push(source);
  }

  async assemble(task: Task): Promise<string> {
    const sections: string[] = [];
    for (const source of this.sources) {
      const text = (await source.gather(task)).trim();
      if (text) sections.push(text);
    }
    return sections.join("\n\n");
  }
}
