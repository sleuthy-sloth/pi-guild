/**
 * Pi Guild extension entry point (spec §6, §54).
 *
 * The factory only wires lifecycle handlers — it never opens the database or
 * starts background work. The database and services are constructed lazily on
 * `session_start` via `getGuild()`; the command and tools are registered once
 * there (where the shared singleton is available), and torn down on
 * `session_shutdown`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getGuild, resetGuild } from "./state.ts";
import { registerGuildCommand } from "./commands/index.ts";
import { registerGuildTools, GUILD_TOOL_NAMES } from "./tools/index.ts";
import { formatLive } from "./ui/index.ts";
import { installNotifications } from "./notifications.ts";

let wired = false;
let removeNotifications: (() => void) | undefined;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const guild = getGuild();

    if (!wired) {
      registerGuildCommand(pi, guild);
      registerGuildTools(pi, guild);
      wired = true;
    }

    const active = pi.getActiveTools();
    pi.setActiveTools([...new Set([...active, ...GUILD_TOOL_NAMES])]);

    if (ctx.hasUI) ctx.ui.setWidget("guild-live", formatLive(guild).split("\n"));

    removeNotifications?.();
    removeNotifications = installNotifications({ repo: guild.repo, bus: guild.bus }, (message, kind) =>
      ctx.ui.notify(message, kind),
    );
  });

  pi.on("session_shutdown", () => {
    removeNotifications?.();
    removeNotifications = undefined;
    resetGuild();
  });
}
