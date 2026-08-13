import type { NewOrganization, Organization } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import type { EventBus } from "../events.ts";
import { bus as defaultBus } from "../events.ts";

const ACTOR = "system";
const ENTITY = "organization";

export class OrganizationService {
  private readonly bus: EventBus;

  constructor(private readonly repo: GuildRepository, bus?: EventBus) {
    this.bus = bus ?? defaultBus;
  }

  create(name: string, opts: Partial<Organization> = {}): Organization {
    const input: NewOrganization = { ...opts, name };
    const org = this.repo.createOrganization(input);
    this.repo.audit({
      actor: ACTOR,
      action: "organization.create",
      entityType: ENTITY,
      entityId: org.id,
      details: { name: org.name },
    });
    this.repo.recordEvent("organization.created", { id: org.id, name: org.name });
    return org;
  }

  get(id: string): Organization | undefined {
    return this.repo.getOrganization(id);
  }

  list(): Organization[] {
    return this.repo.listOrganizations();
  }

  update(id: string, patch: Partial<Organization>): void {
    this.repo.updateOrganization(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "organization.update",
      entityType: ENTITY,
      entityId: id,
      details: { ...patch },
    });
    this.repo.recordEvent("organization.updated", { id, ...patch });
  }

  remove(id: string): void {
    this.repo.deleteOrganization(id);
    this.repo.audit({
      actor: ACTOR,
      action: "organization.remove",
      entityType: ENTITY,
      entityId: id,
    });
    this.repo.recordEvent("organization.removed", { id });
  }
}
