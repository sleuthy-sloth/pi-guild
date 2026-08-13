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
  "guild_list_tasks",
  "guild_create_task",
  "guild_send_message",
  "guild_git_commit",
  "guild_council",
  "guild_report_verdict",
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
      role(["read", "grep", "find", "ls", "guild_list_tasks", "guild_report_verdict"]),
      ALL,
    );

    expect(customTools.map((t) => t.name)).toEqual(["guild_list_tasks", "guild_report_verdict"]);
    expect(builtinTools).toEqual(["read", "grep", "find", "ls"]);
  });

  it("keeps everything when the role has no tool restrictions", () => {
    const { customTools, builtinTools } = resolveRoleTools(role([]), ALL);

    expect(customTools).toHaveLength(ALL.length);
    expect(builtinTools).toBeUndefined();
  });
});
