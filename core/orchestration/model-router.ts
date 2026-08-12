import type { StudioRepository } from "../repository.ts";

/**
 * ModelRouter — provider-agnostic routing of roles to models (spec §15, §20).
 *
 * The router never hardcodes vendors. It resolves a role to a model reference
 * (`{ model, provider }`) from two sources, in priority order:
 *
 *   1. The persisted `modelRouter` setting, which maps role name -> reference.
 *      Values here may be concrete model ids or model-CLASS labels (see
 *      `defaults()`); the concrete mapping is applied downstream by the runtime.
 *   2. The role's own `model` field (a bare model id, no provider).
 *
 * `defaults()` returns model-CLASS labels only (never vendor names), so a fresh
 * install has a sensible, portable baseline that a user can later override via
 * `setRoleModel`.
 */

const SETTINGS_KEY = "modelRouter";

export interface RoleModelRef {
  model?: string;
  provider?: string;
}

export class ModelRouter {
  constructor(private readonly repo: StudioRepository) {}

  resolve(roleName: string): RoleModelRef | undefined {
    const mapping = this.repo.getSettingJson<Record<string, RoleModelRef>>(SETTINGS_KEY, {});
    const configured = mapping[roleName];
    if (configured?.model) {
      return { model: configured.model, provider: configured.provider };
    }

    const role = this.repo.getRoleByName(roleName);
    if (role?.model) {
      return { model: role.model };
    }

    return undefined;
  }

  setRoleModel(roleName: string, model: string, provider?: string): void {
    const mapping = this.repo.getSettingJson<Record<string, RoleModelRef>>(SETTINGS_KEY, {});
    mapping[roleName] = provider ? { model, provider } : { model };
    this.repo.setSettingJson(SETTINGS_KEY, mapping);
  }

  /** Model-CLASS labels by role. Never vendor names. */
  defaults(): Record<string, string> {
    return {
      CEO: "reasoning",
      Manager: "cheap-reasoning",
      Architect: "reasoning",
      Developer: "coding",
      Reviewer: "reasoning",
      QA: "cheap-coding",
      Researcher: "research",
    };
  }
}
