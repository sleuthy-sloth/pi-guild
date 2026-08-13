import type { NewPolicy, Policy } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import type { EventBus } from "../events.ts";
import { bus as defaultBus, GuildEvents } from "../events.ts";

const ACTOR = "system";
const ENTITY = "policy";

/**
 * Actions that are dangerous by default. When no policy explicitly allows a
 * matching target, these are DENIED. Everything else defaults to ALLOW.
 */
const DANGEROUS_ACTIONS = new Set([
  "merge into main",
  "delete repository",
  "deploy production",
  "push to protected branch",
  "delete organization",
  "delete project",
]);

export class PolicyService {
  private readonly bus: EventBus;

  constructor(private readonly repo: GuildRepository, bus?: EventBus) {
    this.bus = bus ?? defaultBus;
  }

  allow(name: string, target: string, opts: Partial<Policy> = {}): Policy {
    return this.create(name, "allow", target, opts);
  }

  deny(name: string, target: string, opts: Partial<Policy> = {}): Policy {
    return this.create(name, "deny", target, opts);
  }

  list(filter: { organizationId?: string; projectId?: string } = {}): Policy[] {
    return this.repo.listPolicies(filter);
  }

  remove(id: string): void {
    this.repo.deletePolicy(id);
    this.repo.audit({
      actor: ACTOR,
      action: "policy.remove",
      entityType: ENTITY,
      entityId: id,
    });
    this.repo.recordEvent(GuildEvents.policyChanged, { id, removed: true });
    this.bus.emit(GuildEvents.policyChanged, { id, removed: true });
  }

  /**
   * Decide whether `action` is permitted within `scope`. Collects org- and
   * project-scoped policies; an explicit deny beats an explicit allow.
   * Dangerous actions default to DENY unless explicitly allowed; everything
   * else defaults to ALLOW. Matching is an exact string match on target.
   */
  can(scope: { organizationId?: string; projectId?: string }, action: string): boolean {
    const policies: Policy[] = [];
    if (scope.organizationId) {
      policies.push(...this.repo.listPolicies({ organizationId: scope.organizationId }));
    }
    if (scope.projectId) {
      policies.push(...this.repo.listPolicies({ projectId: scope.projectId }));
    }

    const matching = policies.filter((p) => p.target === action);
    if (matching.some((p) => p.kind === "deny")) return false;
    if (matching.some((p) => p.kind === "allow")) return true;

    return !DANGEROUS_ACTIONS.has(action);
  }

  seedDefaults(organizationId: string): void {
    this.allow("read source code", "read source code", { organizationId });
    this.allow("create branches", "create branches", { organizationId });
    this.allow("run tests", "run tests", { organizationId });
    this.allow("create pull requests", "create pull requests", { organizationId });
    this.deny("merge into main", "merge into main", { organizationId });
    this.deny("delete repositories", "delete repositories", { organizationId });
    this.deny("deploy production", "deploy production", { organizationId });
  }

  private create(name: string, kind: "allow" | "deny", target: string, opts: Partial<Policy>): Policy {
    const input: NewPolicy = { ...opts, name, kind, target };
    const policy = this.repo.createPolicy(input);
    this.repo.audit({
      actor: ACTOR,
      action: `policy.${kind}`,
      entityType: ENTITY,
      entityId: policy.id,
      details: { name, kind, target },
    });
    this.repo.recordEvent(GuildEvents.policyChanged, {
      id: policy.id,
      name,
      kind,
      target,
    });
    this.bus.emit(GuildEvents.policyChanged, { id: policy.id, name, kind, target });
    return policy;
  }
}
