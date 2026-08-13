/**
 * Pi Studio extension entry point (spec §6, §54).
 *
 * The factory only wires lifecycle handlers — it never opens the database or
 * starts background work. The database and services are constructed lazily on
 * `session_start` via `getStudio()`; the command and tools are registered once
 * there (where the shared singleton is available), and torn down on
 * `session_shutdown`.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { getStudio, resetStudio } from "./state.ts";
import { registerStudioCommand } from "./commands/index.ts";
import { registerStudioTools, STUDIO_TOOL_NAMES } from "./tools/index.ts";
import { formatLive } from "./ui/index.ts";
import { installNotifications } from "./notifications.ts";

let wired = false;
let removeNotifications: (() => void) | undefined;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", (_event, ctx) => {
    const studio = getStudio();

    if (!wired) {
      registerStudioCommand(pi, studio);
      registerStudioTools(pi, studio);
      wired = true;
    }

    const active = pi.getActiveTools();
    pi.setActiveTools([...new Set([...active, ...STUDIO_TOOL_NAMES])]);

    if (ctx.hasUI) ctx.ui.setWidget("studio-live", formatLive(studio).split("\n"));

    removeNotifications?.();
    removeNotifications = installNotifications({ repo: studio.repo, bus: studio.bus }, (message, kind) =>
      ctx.ui.notify(message, kind),
    );
  });

  pi.on("session_shutdown", () => {
    removeNotifications?.();
    removeNotifications = undefined;
    resetStudio();
  });
}
