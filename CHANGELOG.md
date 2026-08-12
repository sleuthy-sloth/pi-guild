# Changelog

All notable changes to Pi Studio are documented in this file.
The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

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
