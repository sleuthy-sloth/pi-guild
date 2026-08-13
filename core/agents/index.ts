import type { Agent, AgentState, NewAgent } from "../types.ts";
import type { GuildRepository } from "../repository.ts";
import { bus as defaultBus, GuildEvents } from "../events.ts";
import type { EventBus } from "../events.ts";

export type { Agent, AgentState, NewAgent } from "../types.ts";

const ACTOR = "system";

/**
 * AgentRegistryService — lifecycle and registry operations for agents (spec §15).
 *
 * Agents are registry records + transient sessions. This service owns the
 * record side: create, query, update, remove, and explicit state transitions.
 * Spawning/stopping sessions is the scheduler's job, not this service's.
 */
export class AgentRegistryService {
  constructor(
    private readonly repo: GuildRepository,
    private readonly bus: EventBus = defaultBus,
  ) {}

  create(input: NewAgent): Agent {
    const agent = this.repo.createAgent(input);
    this.repo.audit({
      actor: ACTOR,
      action: "agent.create",
      entityType: "agent",
      entityId: agent.id,
      details: { name: agent.name, roleName: agent.roleName, organizationId: agent.organizationId },
    });
    this.repo.recordEvent(GuildEvents.agentCreated, { agentId: agent.id, agent });
    this.bus.emit(GuildEvents.agentCreated, { agentId: agent.id, agent });
    return agent;
  }

  get(id: string): Agent | undefined {
    return this.repo.getAgent(id);
  }

  list(filter?: { organizationId?: string; projectId?: string; state?: AgentState }): Agent[] {
    return this.repo.listAgents(filter);
  }

  update(id: string, patch: Partial<Agent>): void {
    this.repo.updateAgent(id, patch);
    this.repo.audit({
      actor: ACTOR,
      action: "agent.update",
      entityType: "agent",
      entityId: id,
      details: { patch },
    });
    this.repo.recordEvent("agent.updated", { agentId: id, patch });
  }

  remove(id: string): void {
    const existing = this.repo.getAgent(id);
    this.repo.deleteAgent(id);
    this.repo.audit({
      actor: ACTOR,
      action: "agent.remove",
      entityType: "agent",
      entityId: id,
      details: { name: existing?.name },
    });
    this.repo.recordEvent("agent.removed", { agentId: id });
  }

  setState(id: string, state: AgentState): void {
    const existing = this.repo.getAgent(id);
    const previous = existing?.state;
    this.repo.setAgentState(id, state);
    this.repo.audit({
      actor: ACTOR,
      action: "agent.setState",
      entityType: "agent",
      entityId: id,
      details: { state, previous },
    });
    this.repo.recordEvent(GuildEvents.agentStateChanged, { agentId: id, state, previous });
    this.bus.emit(GuildEvents.agentStateChanged, { agentId: id, state, previous });
  }

  setCurrentTask(id: string, taskId?: string): void {
    this.repo.setAgentCurrentTask(id, taskId);
    this.repo.audit({
      actor: ACTOR,
      action: "agent.setCurrentTask",
      entityType: "agent",
      entityId: id,
      details: { taskId },
    });
    this.repo.recordEvent("agent.current_task_changed", { agentId: id, taskId });
  }

  children(parentAgentId: string): Agent[] {
    return this.repo.listAgents().filter((a) => a.parentAgentId === parentAgentId);
  }
}
