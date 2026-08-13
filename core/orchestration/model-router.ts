/**
 * ModelRouter — provider-agnostic routing of roles to models (spec §15, §20, §28).
 *
 * Never hardcodes vendors. Models are assigned per model-CLASS (reasoning,
 * cheap-reasoning, coding, cheap-coding, research) so assigning five models
 * covers every role, with optional per-role overrides on top.
 *
 * Resolution order for a role:
 *   1. `modelRouter` setting (role -> { model, provider }) — explicit override.
 *   2. `modelRouterClasses` setting (class -> { model, provider }) — the
 *      class-assigned model for the role's class.
 *   3. The role's own `model` field (bare id, no provider).
 *
 * `assignAuto()` picks a concrete model for every class from the models the
 * harness reports as available (logged-in), using a best-effort capability
 * heuristic. Everything is user-overridable afterwards.
 */
import type { StudioRepository } from "../repository.ts";

const ROLE_KEY = "modelRouter";
const CLASS_KEY = "modelRouterClasses";

export interface RoleModelRef {
  model?: string;
  provider?: string;
}

export interface AvailableModel {
  provider: string;
  id: string;
  name?: string;
}

const CLASS_DEFAULTS: Record<string, string> = {
  CEO: "reasoning",
  Manager: "cheap-reasoning",
  Architect: "reasoning",
  Developer: "coding",
  Reviewer: "reasoning",
  QA: "cheap-coding",
  Researcher: "research",
  Designer: "coding",
  Librarian: "research",
};

/** Best-effort pick for a model class, preferring capability hints. */
export function pickForClass(pool: AvailableModel[], cls: string): AvailableModel | undefined {
  if (pool.length === 0) return undefined;
  const lower = (m: AvailableModel) => `${m.id} ${m.name ?? ""}`.toLowerCase();
  const firstMatching = (re: RegExp) => pool.find((m) => re.test(lower(m)));
  let pick: AvailableModel | undefined;
  if (cls === "reasoning") {
    pick =
      firstMatching(/opus|\bo3\b|\bo4\b|reasoning|thinking|\br1\b/) ??
      firstMatching(/sonnet|gpt-5/) ??
      firstMatching(/claude|\b4o\b/);
  } else if (cls === "coding") {
    pick = firstMatching(/code|coder/) ?? firstMatching(/claude|gpt|deepseek/);
  } else if (cls === "cheap-reasoning" || cls === "cheap-coding") {
    pick = firstMatching(/haiku|flash|\bmini\b|lite|deepseek|qwen|fast/);
  }
  return pick ?? pool[0];
}

export class ModelRouter {
  constructor(private readonly repo: StudioRepository) {}

  /** Model-CLASS labels by role. Never vendor names. */
  defaults(): Record<string, string> {
    return { ...CLASS_DEFAULTS };
  }

  roleClass(roleName: string): string | undefined {
    return CLASS_DEFAULTS[roleName];
  }

  byRole(): Record<string, RoleModelRef> {
    return this.repo.getSettingJson<Record<string, RoleModelRef>>(ROLE_KEY, {});
  }

  byClass(): Record<string, RoleModelRef> {
    return this.repo.getSettingJson<Record<string, RoleModelRef>>(CLASS_KEY, {});
  }

  setRoleModel(roleName: string, model: string, provider?: string): void {
    const mapping = this.byRole();
    mapping[roleName] = provider ? { model, provider } : { model };
    this.repo.setSettingJson(ROLE_KEY, mapping);
  }

  setClassModel(modelClass: string, model: string, provider?: string): void {
    const mapping = this.byClass();
    mapping[modelClass] = provider ? { model, provider } : { model };
    this.repo.setSettingJson(CLASS_KEY, mapping);
  }

  clear(): void {
    this.repo.setSettingJson(ROLE_KEY, {});
    this.repo.setSettingJson(CLASS_KEY, {});
  }

  resolve(roleName: string): RoleModelRef | undefined {
    const roleRef = this.byRole()[roleName];
    if (roleRef?.model) return { model: roleRef.model, provider: roleRef.provider };

    const cls = this.roleClass(roleName);
    if (cls) {
      const classRef = this.byClass()[cls];
      if (classRef?.model) return { model: classRef.model, provider: classRef.provider };
    }

    const role = this.repo.getRoleByName(roleName);
    if (role?.model) return { model: role.model };

    return undefined;
  }

  /** Assign a concrete model for every class from the available models. */
  assignAuto(available: AvailableModel[], opts: { provider?: string } = {}): number {
    const pool = opts.provider ? available.filter((m) => m.provider === opts.provider) : available;
    if (pool.length === 0) return 0;

    const classes = [...new Set(Object.values(CLASS_DEFAULTS))];
    let assigned = 0;
    for (const cls of classes) {
      const pick = pickForClass(pool, cls);
      if (pick) {
        this.setClassModel(cls, pick.id, pick.provider);
        assigned++;
      }
    }
    return assigned;
  }

  /** Human-readable summary of current assignments. */
  describe(): string {
    const classRefs = this.byClass();
    const roleRefs = this.byRole();
    const lines: string[] = [];
    for (const [cls, label] of Object.entries({
      reasoning: "reasoning",
      "cheap-reasoning": "cheap reasoning",
      coding: "coding",
      "cheap-coding": "cheap coding",
      research: "research",
    })) {
      const ref = classRefs[cls];
      lines.push(
        ref?.model
          ? `  ${label.padEnd(16)} -> ${ref.provider ? `${ref.provider}/` : ""}${ref.model}`
          : `  ${label.padEnd(16)} -> (unset — uses session default)`,
      );
    }
    const overrides = Object.entries(roleRefs);
    if (overrides.length > 0) {
      lines.push("  role overrides:");
      for (const [role, ref] of overrides) {
        lines.push(`    ${role} -> ${ref.provider ? `${ref.provider}/` : ""}${ref.model}`);
      }
    }
    return lines.join("\n");
  }
}
