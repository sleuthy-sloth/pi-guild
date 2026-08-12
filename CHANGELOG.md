# Changelog

All notable changes to Pi Studio are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [0.3.0] - unreleased

### Added

- **Designer + Librarian roles** — data-driven role definitions wired into the
  seed + spawn paths; Designer routes "design"-labeled tasks in the autonomous
  loop.
- **Council (multi-model synthesis)** — `Council` service + real model responder
  (`createCouncilResponder`), `studio_council` tool, and `/studio council`.
- **Skills** — `skills/` SKILL.md files, a loader, and per-role `skills.json`
  injected into the spawned session's system prompt.
- **Background workers** — `/studio bg <role> <prompt>` fire-and-forget runs
  with `/studio bg` to list in-flight jobs.
- **Live agent panel** — `formatLive` TUI widget refreshed on session start,
  `/studio live`, and during autonomous runs.

### Changed

- `Scheduler.tick`/`readyTasks` gain `label`/`excludeLabel` filters.
- `ProjectRunner` routes design-labeled tasks to the Designer role.

## [0.2.0] - unreleased

### Added

- **Guided autonomous run**: bare `/studio` (or `/studio run`) is an interactive
  wizard that asks what to build and the approval policy, then plans and runs
  the whole team itself — manager decomposition, developer execution, review,
  and QA — through to `DONE`.
- **ProjectRunner** (`core/orchestration/runner.ts`): the autonomous execution
  loop (dev → review → QA), with reuse-or-spawn agent pooling, verdict-driven
  review/QA via `studio_report_verdict`, pause/abort, and a deterministic
  plan fallback.
- **New tools**: `studio_decompose_task`, `studio_add_task_dependency`,
  `studio_list_task_dependencies`, `studio_list_goals`, `studio_set_goal_status`,
  `studio_report_verdict`, and `parentId` on `studio_create_task`.
- **Shared tool surface**: `createStudioToolDefinitions` feeds both the
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
  `StudioRepository` facade (no raw SQL outside the repository).
- **Orchestration** (`core/orchestration/`): dependency-gated scheduler,
  agent/task lifecycle transition graph, model router, agent spawner, and the
  Pi runtime runner adapter.
- **Event bus** (`core/events.ts`): in-process publish/subscribe with the
  canonical `StudioEvents` name map and a shared `bus` singleton.
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
