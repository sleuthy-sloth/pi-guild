/**
 * Council — multi-model synthesis (inspired by oh-my-opencode-slim's "Council").
 *
 * Runs one question through several models in parallel, then asks a moderator
 * model to reconcile the perspectives into a single consensus answer. The model
 * set is provider-agnostic and configured via the `councilModels` setting.
 *
 * The `respond` function is injected so tests can run without real model calls.
 */
import type { StudioRepository } from "../repository.ts";

export interface CouncilMember {
  provider: string;
  model: string;
}

export interface CouncilPerspective {
  member: CouncilMember;
  answer: string;
}

export interface CouncilResult {
  question: string;
  perspectives: CouncilPerspective[];
  consensus: string;
}

export type CouncilResponder = (member: CouncilMember, prompt: string) => Promise<string>;

export class Council {
  constructor(
    private readonly repo: StudioRepository,
    private readonly respond: CouncilResponder,
  ) {}

  members(): CouncilMember[] {
    return this.repo.getSettingJson<CouncilMember[]>("councilModels", []);
  }

  setMembers(members: CouncilMember[]): void {
    this.repo.setSettingJson("councilModels", members);
  }

  addMember(member: CouncilMember): void {
    const members = this.members();
    if (!members.some((m) => m.provider === member.provider && m.model === member.model)) {
      this.setMembers([...members, member]);
    }
  }

  async deliberate(question: string): Promise<CouncilResult> {
    const members = this.members();
    if (members.length === 0) {
      return { question, perspectives: [], consensus: "" };
    }

    const prompt = `Answer this question concisely and like an expert:\n${question}`;
    const perspectives = await Promise.all(
      members.map(async (member) => ({ member, answer: await this.respond(member, prompt) })),
    );

    const synthesis = [
      "You are a synthesis moderator. Several models answered the same question. Reconcile them.",
      `Question:\n${question}`,
      ...perspectives.map(
        (p, i) => `Perspective ${i + 1} (${p.member.provider}/${p.member.model}):\n${p.answer}`,
      ),
      "Produce one concise consensus answer, noting where perspectives disagree.",
    ].join("\n\n");

    const consensus = await this.respond(members[0], synthesis);

    return { question, perspectives, consensus };
  }
}
