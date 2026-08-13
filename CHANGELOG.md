# Changelog

All notable changes to Pi Guild are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.11.0] - unreleased

### Changed

- **Renamed to Pi Guild** (formerly "Pi Studio"). Package is now `pi-guild`; the
  data directory moved to `~/.pi/agent/pi-guild/`. The command namespace is now
  `/guild` and the agent-facing tools are `guild_*` (the old `studio_*` names
  no longer exist).

## [0.10.0] - unreleased

### Added

- **Model routing UX** — `/guild models` (`list`, `providers`, `auto`,
  `preset <provider>`, `set <role>`, `class <class>`, `clear`), and the setup
  wizard now offers auto-assign / choose-per-class / skip.
- **Class-based assignment** — models are assigned per model class
  (`modelRouterClasses`), so five choices cover every role; per-role overrides
  on top.
- **Auto-assign from the harness** — `ModelRouter.assignAuto` picks a model for
  every class from the models Pi reports as logged in, preferring capability
  hints (opus/sonnet → reasoning, haiku/mini/deepseek → cheap). No vendor
  names are hardcoded.
- **Custom-provider resolution** — the runner now resolves models via
  `ModelRuntime` (not just the static catalog), so providers like
  `opencode-go` from `models.json` work.

## [0.9.0] - unreleased

### Fixed / improved (pre-first-run hardening)

- **Role-based tool filtering** — spawned agents now get only the tools their
  role's `tools.json` allows (custom + built-in). Reviewers no longer get
  `bash`/`edit`/`write`; every agent carries a smaller, role-appropriate tool
  surface.
- **`LocalGitProvider.init`** makes an initial commit (so branching works on a
  fresh repo); **`push` skips silently when no remote exists** instead of
  failing the run.
- **`/guild` wizard** auto-initializes a local repository in the project
  workspace (non-fatal if git is unavailable).
- **`/guild setup`** is idempotent — re-running reuses the existing
  organization instead of duplicating it.
- Developer task prompt + role prompt note: commit locally; push/PR need a
  remote.

## [0.8.0] - unreleased

### Added

- **Browser dashboard** (`core/dashboard/server.ts` + `ui/dashboard/index.html`) —
  an optional, explicitly-started local web dashboard (`/guild dashboard`).
  Read-only snapshot of the SQLite DB (agents, tasks, escalations, PRs,
  messages, projects, usage) + pause/resume and approve/reject actions, served
  by Node's `http` with a self-contained dark UI and 2s auto-refresh.

## [0.7.0] - unreleased

### Added

- **Merge step** — `GitService.merge` + `guild_git_merge` + `/guild git merge`;
  the runner auto-merges PRs once tasks reach `DONE`, unless the review policy
  is `manual_merge`.
- **Background scheduler loop** — `BackgroundScheduler` + `/guild start`/`stop`,
  torn down on `session_shutdown`.
- **`/guild config`** — list / get / set / setjson of settings.
- **`/guild usage`** — org + per-project token/call/time stats.
- **Notifications** — config-driven TUI notifications for blocked / escalation /
  review-needed / failed (`notifications` setting).
- **GitHub adapter** — `GitHubClient` (PRs, CI runs, repo info via `gh`) +
  `/guild github [projectId]`.
- **Plane comments** — push task messages as Plane issue comments
  (`/guild plane comments <taskId>`).

## [0.6.0] - unreleased

### Added

- **Context assembler** (`core/context/assembler.ts`) — gathers parent task,
  dependencies, project memory, decisions, prior attempts, and related messages
  into the agent's task prompt; extensible via `ContextSource`.
- **Plane adapter** (`integrations/plane/`) — `HttpPlaneClient` (fetch seam) +
  `PlaneSyncService` (project mapping, task→issue push, state mapping), with
  `/guild plane setup|status|sync`. SQLite stays the source of truth.

## [0.5.0] - unreleased

### Added

- **Recovery** (`core/orchestration/recovery.ts`) — on startup (and via
  `/guild recover`), orphaned WORKING/STARTING/REVIEWING agents reset to IDLE
  and interrupted IN_PROGRESS tasks reopened to READY.
- **Budget enforcement** (`core/orchestration/budget.ts`) —
  `maxTokensPerTask`, `maxModelCallsPerTask`, `maxAgentMinutes` with `onLimit`
  continue/pause/escalate, enforced in the runner.

### Fixed

- SQL NULL columns now map to `undefined` (not `null`) so repository results
  match the TS types.
- `taskUsage` sums `model_calls` instead of counting rows.

## [0.4.0] - unreleased

### Added

- **Git workflow** (`core/git/service.ts`, `integrations/git/`) — developers
  create branches (`feature/<taskId>-<slug>`, `bugfix/`, `refactor/`), commit,
  push, and open pull requests, with protected-branch defaults and DB recording
  of commits and PRs.
- **RepositoryProvider abstraction** — `LocalGitProvider` (git CLI) and
  `GitHubProvider` (`gh` CLI), plus a testable `CommandRunner` seam.
- **Git tools** — `guild_git_start/commit/push/pull_request/status`, wired into
  the Developer role.
- **`/guild git` command** — setup (local/github), branch, commit, push, pr, log.

### Changed

- Reviewer task prompts include the linked pull request.

## [0.3.0] - unreleased

### Added

- **Designer + Librarian roles** — data-driven role definitions wired into the
  seed + spawn paths; Designer routes "design"-labeled tasks in the autonomous
  loop.
- **Council (multi-model synthesis)** — `Council` service + real model responder
  (`createCouncilResponder`), `guild_council` tool, and `/guild council`.
- **Skills** — `skills/` SKILL.md files, a loader, and per-role `skills.json`
  injected into the spawned session's system prompt.
- **Background workers** — `/guild bg <role> <prompt>` fire-and-forget runs
  with `/guild bg` to list in-flight jobs.
- **Live agent panel** — `formatLive` TUI widget refreshed on session start,
  `/guild live`, and during autonomous runs.

### Changed

- `Scheduler.tick`/`readyTasks` gain `label`/`excludeLabel` filters.
- `ProjectRunner` routes design-labeled tasks to the Designer role.

## [0.2.0] - unreleased

### Added

- **Guided autonomous run**: bare `/guild` (or `/guild run`) is an interactive
  wizard that asks what to build and the approval policy, then plans and runs
  the whole team itself — manager decomposition, developer execution, review,
  and QA — through to `DONE`.
- **ProjectRunner** (`core/orchestration/runner.ts`): the autonomous execution
  loop (dev → review → QA), with reuse-or-spawn agent pooling, verdict-driven
  review/QA via `guild_report_verdict`, pause/abort, and a deterministic
  plan fallback.
- **New tools**: `guild_decompose_task`, `guild_add_task_dependency`,
  `guild_list_task_dependencies`, `guild_list_goals`, `guild_set_goal_status`,
  `guild_report_verdict`, and `parentId` on `guild_create_task`.
- **Shared tool surface**: `createGuildToolDefinitions` feeds both the
  extension and spawned agent sessions, so agents can self-organize with the
  same tools the user sees.
- **Role-aware scheduling** and configurable review policy
  (`manual_merge`, `review_required`, `review_and_tests_required`,
  `fully_autonomous`).
- **Attempt memory**: every agent run is recorded as task-scoped memory.

### Changed

- `AgentSpawner.run` accepts per-run success/failure transitions.
- `Scheduler.tick` accepts a `roleName` filter.
- Role data files (manager/reviewer/QA) updated to drive the new verdict and
  decomposition tools.

## [0.1.0] - unreleased

### Added

- **Core engine** (`core/`): organization, project, goal, policy, memory,
  agent, task, and messaging domain services, each with audit + event
  recording.
- **Persistence** (`database/`): SQLite schema + migrations and the
  `GuildRepository` facade (no raw SQL outside the repository).
- **Orchestration** (`core/orchestration/`): dependency-gated scheduler,
  agent/task lifecycle transition graph, model router, agent spawner, and the
  Pi runtime runner adapter.
- **Event bus** (`core/events.ts`): in-process publish/subscribe with the
  canonical `GuildEvents` name map and a shared `bus` singleton.
- **Data-driven roles** (`agents/`): CEO, Manager, Architect, Developer,
  Reviewer, QA, and Researcher definitions with `seedRoles`.
- **Policy engine** (`core/policies/`): allow/deny with deny-wins semantics,
  dangerous-action default-deny, and `seedDefaults`.
- **Tests** (`tests/`): unit suite plus a mocked end-to-end "calculator" run
  that drives the full pipeline with no real LLM calls.
- **Docs**: README, CONTRIBUTING, SECURITY, and CODE_OF_CONDUCT.

### Notes

- Plane, GitHub, and the browser dashboard are **later milestones** and not
  part of this release.
