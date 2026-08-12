import { beforeEach, describe, expect, it } from "vitest";
import { PolicyService } from "../../core/policies/index.ts";
import { StudioRepository } from "../../core/repository.ts";
import { newTestRepo } from "../helpers.ts";

describe("PolicyService", () => {
  let repo: StudioRepository;
  let policies: PolicyService;

  beforeEach(() => {
    repo = newTestRepo();
    policies = new PolicyService(repo);
  });

  it("an explicit deny beats an explicit allow", () => {
    const orgId = "org-1";
    policies.allow("allow merge", "merge into main", { organizationId: orgId });
    expect(policies.can({ organizationId: orgId }, "merge into main")).toBe(true);

    policies.deny("block merge", "merge into main", { organizationId: orgId });
    expect(policies.can({ organizationId: orgId }, "merge into main")).toBe(false);
  });

  it("denies dangerous actions by default and allows everything else", () => {
    expect(policies.can({}, "merge into main")).toBe(false);
    expect(policies.can({}, "deploy production")).toBe(false);
    expect(policies.can({}, "delete repository")).toBe(false);
    expect(policies.can({}, "read source code")).toBe(true);
    expect(policies.can({}, "run tests")).toBe(true);
  });

  it("seedDefaults grants safe actions and blocks dangerous ones", () => {
    const orgId = "org-1";
    policies.seedDefaults(orgId);

    expect(policies.can({ organizationId: orgId }, "read source code")).toBe(true);
    expect(policies.can({ organizationId: orgId }, "create branches")).toBe(true);
    expect(policies.can({ organizationId: orgId }, "run tests")).toBe(true);
    expect(policies.can({ organizationId: orgId }, "create pull requests")).toBe(true);

    expect(policies.can({ organizationId: orgId }, "merge into main")).toBe(false);
    expect(policies.can({ organizationId: orgId }, "deploy production")).toBe(false);
    expect(policies.can({ organizationId: orgId }, "delete repositories")).toBe(false);
  });
});
