/**
 * Resolve the "current" organization — shared by state, tools, and commands.
 * Lives in its own module to avoid an import cycle (state.ts imports the tool
 * definitions, which import this).
 */
import type { Studio } from "./state.ts";

export function currentOrgId(studio: Studio): string | undefined {
  const configured = studio.repo.getSettingJson<string>("currentOrgId", "");
  if (configured && studio.repo.getOrganization(configured)) return configured;
  return studio.repo.listOrganizations()[0]?.id;
}
