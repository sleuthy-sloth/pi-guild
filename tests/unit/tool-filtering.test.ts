import { describe, it, expect } from "vitest";
import { resolveRoleTools } from "../../core/orchestration/pi-runner.ts";
import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type { AgentRole } from "../../core/types.ts";

const mkTool = (name: string): ToolDefinition =>
  ({
    name,
    label: name,
    description: name,
    parameters: {},
    execute: async () => ({ content: [{ type: "text", text: "ok" }], details: {} }),
  }) as unknown as ToolDefinition;

const ALL = [
  "studio_list_tasks",
  "studio_create_task",
  "studio_send_message",
  "studio_git_commit",
  "studio_council",
  "studio_report_verdict",
].map(mkTool);

function role(tools: string[]): AgentRole {
  return {
    id: "r",
    name: "Reviewer",
    description: "",
    responsibilities: [],
    tools,
    permissions: [],
    systemPrompt: "",
    createdAt: 0,
  };
}

describe("resolveRoleTools", () => {
  it("filters custom + built-in tools by the role's tool list", () => {
    const { customTools, builtinTools } = resolveRoleTools(
      role(["read", "grep", "find", "ls", "studio_list_tasks", "studio_report_verdict"]),
      ALL,
    );

    expect(customTools.map((t) => t.name)).toEqual(["studio_list_tasks", "studio_report_verdict"]);
    expect(builtinTools).toEqual(["read", "grep", "find", "ls"]);
  });

  it("keeps everything when the role has no tool restrictions", () => {
    const { customTools, builtinTools } = resolveRoleTools(role([]), ALL);

    expect(customTools).toHaveLength(ALL.length);
    expect(builtinTools).toBeUndefined();
  });
});
