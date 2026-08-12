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

let wired = false;

export default function (pi: ExtensionAPI) {
  pi.on("session_start", () => {
    const studio = getStudio();

    if (!wired) {
      registerStudioCommand(pi, studio);
      registerStudioTools(pi, studio);
      wired = true;
    }

    const active = pi.getActiveTools();
    pi.setActiveTools([...new Set([...active, ...STUDIO_TOOL_NAMES])]);
  });

  pi.on("session_shutdown", () => {
    resetStudio();
  });
}
