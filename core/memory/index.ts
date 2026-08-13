import type { MemoryEntry, MemoryScope, NewMemory } from "../types.ts";
import type { GuildRepository } from "../repository.ts";

const ACTOR = "system";
const ENTITY = "memory";

export class MemoryService {
  constructor(private readonly repo: GuildRepository) {}

  add(scope: MemoryScope, content: string, opts: Partial<MemoryEntry> = {}): MemoryEntry {
    const input: NewMemory = { ...opts, scope, content };
    const entry = this.repo.addMemory(input);
    this.repo.audit({
      actor: ACTOR,
      action: "memory.add",
      entityType: ENTITY,
      entityId: entry.id,
      details: { scope, kind: entry.kind },
    });
    this.repo.recordEvent("memory.added", { id: entry.id, scope, kind: entry.kind });
    return entry;
  }

  get(id: string): MemoryEntry | undefined {
    return this.repo.getMemory(id);
  }

  list(scope: MemoryScope, scopeId?: string): MemoryEntry[] {
    return this.repo.listMemory(scope, scopeId);
  }

  update(id: string, patch: Partial<MemoryEntry>): void {
    this.repo.updateMemory(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "memory.update",
      entityType: ENTITY,
      entityId: id,
      details: { ...patch },
    });
    this.repo.recordEvent("memory.updated", { id, ...patch });
  }

  remove(id: string): void {
    this.repo.deleteMemory(id);
    this.repo.audit({
      actor: ACTOR,
      action: "memory.remove",
      entityType: ENTITY,
      entityId: id,
    });
    this.repo.recordEvent("memory.removed", { id });
  }

  recordDecision(
    scope: MemoryScope,
    content: string,
    opts: { scopeId?: string; author?: string; alternatives?: string[]; owner?: string } = {},
  ): MemoryEntry {
    const lines: string[] = [content];
    if (opts.alternatives && opts.alternatives.length > 0) {
      lines.push("Alternatives considered:" + opts.alternatives.map((a) => `\n- ${a}`).join(""));
    }
    if (opts.owner) {
      lines.push(`Decision owner: ${opts.owner}`);
    }

    const input: NewMemory = {
      scope,
      content: lines.join("\n"),
      scopeId: opts.scopeId,
      kind: "decision",
      source: "decision",
      author: opts.author,
    };
    const entry = this.repo.addMemory(input);
    this.repo.audit({
      actor: ACTOR,
      action: "memory.record_decision",
      entityType: ENTITY,
      entityId: entry.id,
      details: { scope, scopeId: opts.scopeId, owner: opts.owner },
    });
    this.repo.recordEvent("memory.decision_recorded", {
      id: entry.id,
      scope,
      scopeId: opts.scopeId,
    });
    return entry;
  }

  decisions(scope: MemoryScope, scopeId?: string): MemoryEntry[] {
    return this.list(scope, scopeId).filter((m) => m.kind === "decision");
  }
}
