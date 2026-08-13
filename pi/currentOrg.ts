/**
 * Resolve the "current" organization — shared by state, tools, and commands.
 * Lives in its own module to avoid an import cycle (state.ts imports the tool
 * definitions, which import this).
 */
import type { Guild } from "./state.ts";

export function currentOrgId(guild: Guild): string | undefined {
  const configured = guild.repo.getSettingJson<string>("currentOrgId", "");
  if (configured && guild.repo.getOrganization(configured)) return configured;
  return guild.repo.listOrganizations()[0]?.id;
}
