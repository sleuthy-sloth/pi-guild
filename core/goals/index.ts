import type { Goal, NewGoal } from "../types.ts";
import type { StudioRepository } from "../repository.ts";
import type { EventBus } from "../events.ts";
import { bus as defaultBus, StudioEvents } from "../events.ts";

const ACTOR = "system";
const ENTITY = "goal";

export class GoalService {
  private readonly bus: EventBus;

  constructor(private readonly repo: StudioRepository, bus?: EventBus) {
    this.bus = bus ?? defaultBus;
  }

  create(title: string, opts: Partial<Goal> = {}): Goal {
    const input: NewGoal = { ...opts, title };
    const goal = this.repo.createGoal(input);
    this.repo.audit({
      actor: ACTOR,
      action: "goal.create",
      entityType: ENTITY,
      entityId: goal.id,
      details: { title: goal.title },
    });
    this.repo.recordEvent(StudioEvents.goalCreated, { id: goal.id, title: goal.title });
    this.bus.emit(StudioEvents.goalCreated, { id: goal.id, title: goal.title });
    return goal;
  }

  get(id: string): Goal | undefined {
    return this.repo.getGoal(id);
  }

  list(filter: { organizationId?: string; projectId?: string; parentId?: string } = {}): Goal[] {
    return this.repo.listGoals(filter);
  }

  children(id: string): Goal[] {
    return this.repo.listGoals({ parentId: id });
  }

  update(id: string, patch: Partial<Goal>): void {
    this.repo.updateGoal(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "goal.update",
      entityType: ENTITY,
      entityId: id,
      details: { ...patch },
    });
    this.repo.recordEvent("goal.updated", { id, ...patch });
  }

  setStatus(id: string, status: Goal["status"]): void {
    this.repo.updateGoal(id, { status });
    this.repo.audit({
      actor: ACTOR,
      action: "goal.set_status",
      entityType: ENTITY,
      entityId: id,
      details: { status },
    });
    this.repo.recordEvent("goal.status_changed", { id, status });
  }
}
