/**
 * BackgroundScheduler — the explicitly started component (spec §54).
 *
 * `/studio start` spawns a bounded loop that continuously runs ready work
 * across all projects; `/studio stop` halts it. Nothing runs until started, and
 * it is torn down on `session_shutdown`. `tick()` is public so tests can drive
 * one pass without sleeping.
 */
import type { StudioRepository } from "../repository.ts";
import type { RunSummary } from "./runner.ts";

const TERMINAL = new Set(["DONE", "CANCELLED", "FAILED"]);
const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export interface BackgroundOptions {
  pollMs?: number;
  paused?: () => boolean;
  [key: string]: unknown;
}

export type BackgroundRun = (projectId: string, opts: BackgroundOptions) => Promise<RunSummary>;

export class BackgroundScheduler {
  private running = false;

  constructor(
    private readonly repo: StudioRepository,
    private readonly runProject: BackgroundRun,
    private readonly opts: BackgroundOptions = {},
  ) {}

  isRunning(): boolean {
    return this.running;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    void this.loop();
  }

  stop(): void {
    this.running = false;
  }

  /** One pass: pick a project with non-terminal work and run it. */
  async tick(): Promise<boolean> {
    const projectId = this.pickProject();
    if (!projectId) return false;
    await this.runProject(projectId, this.opts);
    return true;
  }

  private async loop(): Promise<void> {
    const pollMs = this.opts.pollMs ?? 2000;
    while (this.running) {
      if (this.opts.paused?.()) {
        await sleep(pollMs);
        continue;
      }
      const ran = await this.tick();
      if (!ran) await sleep(pollMs);
    }
  }

  private pickProject(): string | undefined {
    for (const project of this.repo.listProjects()) {
      if (this.repo.listTasks({ projectId: project.id }).some((t) => !TERMINAL.has(t.state))) {
        return project.id;
      }
    }
    return undefined;
  }
}
