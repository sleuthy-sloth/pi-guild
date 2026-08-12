/**
 * createCouncilResponder — the real model responder for the Council.
 *
 * Each call spins up a tool-less, in-memory AgentSession bound to a specific
 * model and captures its final text. Sessions are created lazily per call and
 * disposed immediately.
 */
import { homedir } from "node:os";
import {
  createAgentSession,
  DefaultResourceLoader,
  getAgentDir,
  SessionManager,
} from "@earendil-works/pi-coding-agent";
import { getModel } from "@earendil-works/pi-ai/compat";
import type { Model } from "@earendil-works/pi-ai/compat";
import type { CouncilResponder } from "./council.ts";

const resolveModel = getModel as unknown as (
  provider: string,
  modelId: string,
) => Model<any> | undefined;

export function createCouncilResponder(opts: { cwd?: string } = {}): CouncilResponder {
  const cwd = opts.cwd ?? homedir();
  return async (member, prompt) => {
    const model = resolveModel(member.provider, member.model);

    const loader = new DefaultResourceLoader({
      cwd,
      agentDir: getAgentDir(),
      systemPrompt: "Answer the user's question directly and concisely. Do not use tools.",
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      noThemes: true,
      noContextFiles: true,
    });
    await loader.reload();

    const { session } = await createAgentSession({
      cwd,
      model,
      sessionManager: SessionManager.inMemory(cwd),
      resourceLoader: loader,
      noTools: "all",
    });

    let text = "";
    const unsubscribe = session.subscribe((event) => {
      if (event.type === "message_update" && event.assistantMessageEvent.type === "text_delta") {
        text += event.assistantMessageEvent.delta;
      }
    });

    try {
      await session.prompt(prompt);
      return text.trim();
    } finally {
      unsubscribe();
      session.dispose();
    }
  };
}
