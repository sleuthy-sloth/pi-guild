# Pi Studio

> **Turn Pi into an autonomous multi-agent software-development organization.**

Pi Studio is a TypeScript extension package for the [Pi coding agent] that models
your work the way a small software company does: a configurable hierarchy of AI
agents (CEO → managers → workers), persistent local state, event-driven
coordination, and dependency-gated task scheduling. **Pi remains the runtime** —
there is no external daemon, no parallel agent runtime, and no separate
dashboard that matters. Everything runs inside Pi, and every durable fact lives
in a local SQLite database.

Pi Studio is **local-first** and **offline by default**. Agents run with full
system permissions (see [Security](#security-model)); treat the workspace and
model providers you grant as trusted boundaries.

## Features

- **Guided autonomous runs** — `/studio` asks what to build, then plans and runs
  the whole team through to `DONE`.
- **Nine data-driven roles** — CEO, Manager, Architect, Developer, Reviewer, QA,
  Researcher, Designer, Librarian — editable without touching code.
- **Dependency-gated scheduler** — tasks only run when their dependencies are
  done; cycle detection rejects invalid graphs.
- **Git workflow** — branches, commits, push, and PRs, with protected-branch
  defaults, behind one `RepositoryProvider` abstraction (local git + GitHub).
- **Review & QA pipeline** — dev → review → QA with configurable approval policy.
- **Council (multi-model synthesis)** — run one question through several models
  and reconcile a consensus.
- **Skills** — per-role `SKILL.md` injection; **context assembly** gathers
  relevant memory, decisions, and prior attempts into each agent's prompt.
- **Background workers** — fire-and-forget jobs via `/studio bg`.
- **Live TUI panel** — watch the agent roster as it works.
- **Recovery & budgets** — restart reconciliation, plus token/call/time limits
  with `continue` / `pause` / `escalate`.
- **Optional Plane adapter** — mirror projects/tasks into a Plane workspace.
- **Persistent & auditable** — everything in local SQLite, with an audit log.

---

## Architecture

```
                        Pi (runtime)
                            │
                   ┌────────┴─────────────────────────┐
                   │   Pi Studio extension (pi/)      │   ← /studio commands, studio_* tools
                   │                                  │
                   │   ┌──────────────────────────┐   │
                   │   │  Core engine (core/)     │   │
                   │   │  org · projects · agents │   │
                   │   │  tasks · messaging ·     │   │
                   │   │  policies · memory ·     │   │
                   │   │  orchestration · events  │   │
                   │   └──────────┬───────────────┘   │
                   │              │                    │
                   │   ┌──────────▼───────────────┐   │
                   │   │  SQLite (database/)       │   │  ← local source of truth
                   │   └──────────────────────────┘   │
                   │                                  │
                   │   ┌──────────────────────────┐   │
                   │   │  Integrations (opt-in)   │   │
                   │   │  git · github · plane    │   │
                   │   └──────────────────────────┘   │
                   └──────────────────────────────────┘
```

| Layer | Directory | Role |
|-------|-----------|------|
| Pi adapter | `pi/` | extension entry, `/studio` commands, `studio_*` tools, TUI |
| Core engine | `core/` | domain services, orchestration, scheduler, event bus |
| Persistence | `database/` | SQLite schema, migrations, `StudioRepository` |
| Agent definitions | `agents/` | data-driven role files (`role.md`, `policy.json`, `tools.json`, `prompt.md`, `skills.json`) |
| Skills | `skills/` | `SKILL.md` files injected into role prompts |
| Integrations | `integrations/` | git / github / plane adapters (all optional) |
| UI | `ui/` | optional browser dashboard (later milestone) |

**Runtime model.** Each agent is a genuine in-process agent loop created with
Pi's SDK `createAgentSession()` — its own `cwd` (project workspace), `model`,
`tools`, and `SessionManager`. Multiple sessions can run concurrently; the
scheduler decides *which* run, *when*, and *why*. There are no persistent
manager processes: management runs in ephemeral sessions triggered by events.

**No background daemon.** Nothing is started from the extension factory.
Background scheduling, if enabled, is an explicit `/studio start` that spawns a
bounded scheduler loop and is torn down on `/studio stop` and `session_shutdown`.

---

## Installation

Requires **Node ≥ 22.5** (for the built-in `node:sqlite`). Install the package
from npm:

```bash
pi install npm:pi-studio
```

There are no native modules and no runtime dependencies beyond Pi's own peer
packages. The database is `node:sqlite`, part of the Node standard library.

## Setup

After installing, run the one-time setup from inside Pi:

```text
/studio setup
```

This creates the local database at `~/.pi/agent/pi-studio/studio.db`, seeds the
nine default agent roles, and seeds the default policy set (safe actions
allowed, dangerous actions denied).

## Quick start

Just run `/studio` and answer the prompts — Pi Studio plans and runs the
whole team itself:

```text
/studio
```

It asks what to build, the project name, and the approval policy, then creates
the organization/project/goal, spawns a manager to decompose the work into
tasks, and runs developers → reviewers → QA through to `DONE`, reporting
progress as it goes. Hold it anytime with `/studio pause`, resume with
`/studio resume`, and check where things stand with `/studio status`.

Prefer the manual controls? They still work:

```text
/studio setup
/studio org create "Acme"
/studio projects create "calculator"
/studio agents spawn Developer
/studio tasks create <project-id> "Build a four-function calculator"
/studio tasks assign <task-id> <agent-id>
```

Tasks flow through the dependency-aware scheduler: a task becomes `READY` only
when every dependency is `DONE`, and the scheduler pairs `READY` tasks with
`IDLE` agents up to the configured concurrency limit. Managers never poll —
task completion emits `task.completed`, which wakes any agent `WAITING` on that
work.

## Configuration

Configuration lives in the SQLite `settings` table. Model routing is read by
`ModelRouter` (`core/orchestration/model-router.ts`), which maps role names to a
model and provider. A `/studio config` command is a planned follow-up.

| Key | Description | Default |
|-----|-------------|---------|
| `modelRouter` | role → `{ model, provider }` (or a model-CLASS label) mapping | `{}` |
| budgets (`organizations.budgets`) | token/call/minute/retry limits and `onLimit` behavior | `{ "onLimit": "continue" }` |
| `maxConcurrentAgents` | scheduler concurrency bound | `4` |
| `councilModels` | `[{ provider, model }]` members for multi-model synthesis | `[]` |

Model classes (never vendor names) route roles to models: `reasoning`,
`cheap-reasoning`, `coding`, `cheap-coding`, `research`.

## Commands

All commands live under the `/studio` namespace:

| Command | Purpose |
|---------|---------|
| `/studio` / `run` | guided wizard: plan + run a job autonomously |
| `/studio setup` | wizard: create DB, seed roles + default policies |
| `/studio status` | org/project/agent/task counts + pause flag |
| `/studio org` / `org create <name>` / `org use <id>` | list / create / select organizations |
| `/studio projects` / `projects create <name>` | list / create projects in the current org |
| `/studio agents` / `agents spawn <role>` / `agents stop <id>` | list / spawn / stop agents |
| `/studio tasks` / `tasks create <project> <title>` / `tasks assign <taskId> <agentId>` | list / create / assign tasks |
| `/studio messages` / `messages send <recipient> <text>` | list / send messages |
| `/studio goals` / `goals create <title>` | list / create goals |
| `/studio policies` | list policies |
| `/studio escalate` / `approve <id>` / `reject <id>` | create / resolve human escalations |
| `/studio pause` / `resume` | pause / resume the scheduler |
| `/studio recover` | reset orphaned agents/tasks (also runs on start) |
| `/studio stop <agentId>` / `stop project <id>` | stop an agent or a project's agents |
| `/studio council [question]` / `members` / `add <provider>/<model>` / `reset` | multi-model synthesis |
| `/studio bg <role> <prompt>` | fire-and-forget background job |
| `/studio live` | refresh the live agent panel |
| `/studio git setup <project> local <path>` / `github <url>` | register a repository |
| `/studio git branch` / `commit` / `push` / `pr` / `log <taskId>` | the git workflow |
| `/studio plane setup <baseUrl> <slug> <apiKey>` / `status` / `sync [projectId]` | Plane mirror |
| `/studio doctor` | DB path, counts, integrations, settings |
| `/studio logs [N]` | last N audit entries |
| `/studio github` | stub — deeper GitHub sync (later milestone) |
| `/studio start` | stub — background scheduler loop (later milestone) |

The same surface is available to agents as 33 `studio_*` tools
(`studio_list_tasks`, `studio_create_task`, `studio_decompose_task`,
`studio_add_task_dependency`, `studio_send_message`, `studio_record_decision`,
`studio_report_verdict`, `studio_git_*`, `studio_council`,
`studio_escalate_to_human`, …).

## Agent roles

Nine data-driven roles ship in `agents/` (each with `role.md`, `policy.json`,
`tools.json`, `prompt.md`, and optionally `skills.json`):

| Role | Responsibilities | Notable permissions |
|------|------------------|---------------------|
| **CEO** | strategy, goals, priorities, budget, escalation | read-only + strategy; never writes code |
| **Manager** | decompose goals into tasks, assign, monitor, escalate | create/decompose/assign tasks |
| **Architect** | system design, technical decisions, task breakdowns | design + create tasks |
| **Developer** | implement code, write tests, fix bugs | edit code, run bash, git workflow |
| **Reviewer** | review code against acceptance criteria | read + approve/request changes |
| **QA** | write/run tests, report bugs, verify fixes | run tests, write tests, report bugs |
| **Researcher** | investigate unknowns, produce sourced findings | read + search the web |
| **Designer** | UI/UX: layout, typography, color, motion; produces working markup/styles | edit code, create branches |
| **Librarian** | find authoritative answers from docs/GitHub/web, with sources | read-only + web search |

Roles are **data-driven**: edit the files in `agents/<role>/` to change a role's
tools, permissions, or system prompt without touching code. `seedRoles()` is
idempotent and falls back to built-in defaults when files are missing.

## Git workflow

Developer agents create branches, commit, push, and open pull requests via the
`studio_git_*` tools (or `/studio git ...`), with protected-branch defaults and
branch naming (`feature/<taskId>-<slug>`, `bugfix/`, `refactor/`). Local git and
GitHub (`gh` CLI) sit behind one `RepositoryProvider` abstraction.

```text
/studio git setup <project> github https://github.com/you/repo
/studio git branch <taskId>      # create feature/<taskId>-<slug>
/studio git commit <taskId> "Implement X"
/studio git push <taskId>
/studio git pr <taskId>          # open a pull request
```

Commits and pull requests are recorded in the local database; the reviewer's
prompt includes the PR link. Pushing directly to protected branches is refused
by default.

## Plane adapter

An optional adapter mirrors project/task state into a Plane workspace:

```text
/studio plane setup https://api.plane.so <workspace-slug> <api-key>
/studio plane sync <project-id>
```

SQLite stays the source of truth; Plane is a mirror. State maps to Plane's
default groups (Backlog / Unstarted / Started / Completed / Cancelled).
Assignees, labels, cycles, modules, comments, and webhook ingestion are
follow-ups.

## Council (multi-model synthesis)

Pi Studio can run one question through several models in parallel and synthesize
a consensus — inspired by oh-my-opencode-slim's "Council". Configure the
member list, then deliberate:

```text
/studio council add anthropic/claude-sonnet-4-5
/studio council add openai/gpt-5
/studio council "Which persistence layer should this project use?"
```

The same capability is available to agents as `studio_council`. Models are
provider-agnostic — any model Pi can see works.

## Skills & context assembly

Roles reference lightweight skills from the `skills/` directory (each a
`SKILL.md`). Add `skills.json` to a role directory to inject those skills into
that role's system prompt at run time. Two ship by default: `ui-design` and
`web-research`. Add your own without touching code.

Before a task runs, the context assembler gathers only what's relevant — the
parent task, dependencies, project memory, decisions, prior attempts, and
related messages — and injects it into the agent's prompt. Extensible via
`ContextSource`.

## Live panel

Pi Studio surfaces a live agent panel in the TUI (org/project/task counts plus
the agent roster). It refreshes on session start, on `/studio live`, and during
an autonomous run.

## Recovery & budgets

Pi Studio reconciles on startup: agents left `WORKING`/`STARTING`/`REVIEWING`
from a previous session are reset to `IDLE`, and interrupted `IN_PROGRESS` tasks
are reopened to `READY` — work is never blindly resumed. Run `/studio recover`
to reconcile manually.

Per-organization budget limits are enforced during autonomous runs:
`maxTokensPerTask`, `maxModelCallsPerTask`, and `maxAgentMinutes`, with `onLimit`
of `continue`, `pause`, or `escalate`.

## Security model

Agents in Pi Studio run with the **same full system permissions as Pi itself**:
they can read, write, and execute anything the host user can. Pi Studio does not
sandbox agents.

What that means in practice:

- Only install Pi Studio and grant it model access if you trust the workspace
  and the model provider.
- **Policies are a guardrail, not a sandbox.** The policy engine
  (`PolicyService.can`) blocks *dangerous-by-default* actions (`merge into
  main`, `deploy production`, `delete repository`, …) unless explicitly
  allowed, and an explicit `deny` always beats an `allow`. But policies gate
  *decisions*, not OS permissions.
- Never paste secrets into tasks, messages, or memory — they are persisted to
  the local SQLite database. Never store API keys in prompts.
- The local database is the source of truth; treat
  `~/.pi/agent/pi-studio/studio.db` as sensitive (it contains task content,
  messages, and decisions). Plane/GitHub credentials are stored in the local
  settings table, not in code.

Report vulnerabilities as described in [SECURITY.md](./SECURITY.md).

## Development

```bash
npm install        # install dev dependencies
npm test           # run the vitest suite
npm run build      # typecheck (tsc --noEmit)
npm run test:watch # watch mode
```

## Testing

The suite runs against an in-memory SQLite database (`createDb(":memory:")`)
with **mocked runtimes — no real LLM calls**. 58 tests across 18 files cover:

- **Unit** — repository CRUD, task engine (decomposition, cycle rejection,
  readiness), scheduler (role + label filters), messaging, event bus, policies,
  memory, lifecycle transitions, runner (dev → review → QA, design routing,
  budget pause), recovery, budget, git service (branch naming, protected
  branches), council, skills, context assembler, Plane sync (fake client).
- **End-to-end** — a full mocked pipeline (org → project → roles → agents →
  plan → dependencies → scheduler loop → review → QA → `DONE`).

The real `createAgentSession` runtime is wired but exercised only when you run
Pi Studio live with a configured model.

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `FOREIGN KEY constraint failed` | Create the parent entity first (org → project → agent/task). |
| Scheduler never runs | Agents must be `IDLE` and `persistent`/`ephemeral`; tasks must be `READY` with all dependencies `DONE`. |
| Task stays `BACKLOG` | It has an unfinished dependency (`TaskService.isReady` gates on `DONE`). |
| `node:sqlite` missing | Upgrade to Node ≥ 22.5. |
| Role not found | Run `/studio setup` to seed roles. |
| Agent won't start | Check `canTransition` — state changes must follow the legal transition graph in `core/orchestration/lifecycle.ts`. |
| `/studio git pr` fails | A remote + pushed branch are required; local repos have no PRs. |
| `/studio plane sync` errors | Verify base URL, workspace slug, and API key against your Plane instance (see the Plane adapter caveat in `CHANGELOG`). |

## License

[MIT](./LICENSE)

[Pi coding agent]: https://www.npmjs.com/package/@earendil-works/pi-coding-agent
