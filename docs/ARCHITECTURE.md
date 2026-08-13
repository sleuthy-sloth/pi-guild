# Pi Guild — Architecture

Public name: **Pi Guild** (formerly developed under the internal name "Pi Guild").
The package name is `pi-guild`.

Pi Guild turns Pi into an autonomous software-development organization: a
configurable hierarchy of AI agents (CEO → managers → workers), persistent
local state, event-driven coordination, and optional integrations (GitHub,
Plane). **Pi remains the runtime** — there is no external daemon, no parallel
agent runtime, no separate dashboard that matters.

---

## 1. Architecture proposal

```
                        Pi (runtime)
                            │
                   ┌────────┴─────────────────────────┐
                   │   Pi Guild extension (pi/)      │   ← TUI, commands, tools
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

Layering (spec §10):

| Layer | Directory | Role |
|-------|-----------|------|
| Pi adapter | `pi/` | extension entry, `/guild` commands, `guild_*` tools, TUI |
| Core engine | `core/` | domain logic, orchestration, scheduler, event bus |
| Persistence | `database/` | SQLite schema, migrations, `GuildRepository` |
| Agent definitions | `agents/` | data-driven role files (role.md, policy.json, tools.json, prompt.md) |
| Integrations | `integrations/` | git / github / plane adapters (all optional) |
| UI | `ui/`, `pi/ui/` | TUI views + optional browser dashboard |

**Runtime model.** Each agent is a genuine in-process agent loop created with
Pi's SDK `createAgentSession()` — its own `cwd` (project workspace), `model`,
`tools`, and `SessionManager`. Multiple sessions can run concurrently; the
scheduler decides *which* run, *when*, and *why* (spec §20). There are no
persistent manager processes; management runs in ephemeral sessions triggered
by events (spec §15).

**No background daemon** (spec §54). Nothing is started from the extension
factory. Background scheduling, if enabled, is an explicit `/guild start`
that spawns a bounded scheduler loop and is torn down on `/guild stop` and
`session_shutdown` (spec §12).

---

## 2. Core data model

SQLite tables (spec §9), mirroring `core/types.ts`:

`organizations`, `projects`, `agent_roles`, `agents`, `sessions` (Pi session
references only — full history stays in Pi's JSONL session store), `tasks`,
`task_dependencies`, `messages`, `goals`, `policies`, `repositories`,
`commits`, `pull_requests`, `reviews`, `events`, `memory`, `integrations`,
`settings`, `audit_log`, `escalations`, `usage_log`.

Key design points:

- **IDs** are UUIDs (`crypto.randomUUID`). **Timestamps** are epoch ms.
- **Enums** stored as TEXT; the schema is permissive, the TS types are strict.
- **JSON columns** (`goals`, `labels`, `acceptance_criteria`, `budgets`, …)
  use `JSON.stringify` / `JSON.parse` through `GuildRepository`.
- **Conversation history is not in the DB.** Agents store `session_id` /
  `session_file` pointing at Pi's session store (spec §9). Only durable
  *facts* (decisions, memory, task state, messages) live in SQLite.
- **Source of truth is local SQLite.** Plane/GitHub mirror state through
  adapters and never define the internal shape (spec §7, §8).

---

## 3. Pi extension architecture

Entry point `pi/index.ts` exports the default extension factory. It:

1. Opens + migrates SQLite lazily (first command/tool that needs it), never
   during the factory.
2. Registers `/guild` command namespace + direct aliases.
3. Registers `guild_*` tools (TypeBox schemas) on first use.
4. Subscribes to Pi events (`session_start` → restore in-memory state,
   `session_shutdown` → stop scheduler loop, close DB).
5. Wires the shared `EventBus` to a Pi-notification adapter (`ctx.ui.notify`).

Extension API surface used (verified against Pi 0.84.1 docs):

- `pi.registerCommand`, `pi.registerTool`, `pi.on(...)`, `pi.sendMessage`,
  `pi.sendUserMessage`, `pi.appendEntry`, `pi.exec`, `pi.setModel`,
  `pi.events`, `pi.getActiveTools`/`setActiveTools`.
- `ctx.ui` (select / confirm / input / notify / setWidget / setStatus),
  `ctx.cwd`, `ctx.mode`, `ctx.hasUI`, `ctx.signal`, `ctx.waitForIdle`.
- `createAgentSession`, `ModelRuntime`, `SessionManager`,
  `DefaultResourceLoader` from the SDK for spawning agent loops.

---

## 4. Agent lifecycle design

States (spec §15): `CREATED → STARTING → IDLE ⇄ WORKING → … → COMPLETED/STOPPED`,
plus `BLOCKED`, `WAITING`, `REVIEWING`, `FAILED`.

Transitions are explicit (`core/orchestration/lifecycle.ts`) and always emit a
`agent.state_changed` event + an audit record. Invariants:

- Only the scheduler moves an agent into `STARTING`/`WORKING`.
- A `WORKING` agent owns exactly one `AgentSession`; the scheduler `await`s it
  or aborts it via `session.abort()` on `/guild stop`.
- `FAILED` is terminal for that attempt and records the error; retries are a
  scheduler decision, not automatic.
- Agents are *registry records* + *transient sessions*. Stopping an agent
  does not kill a persistent process — there is none.

**Spawning** (`createAgentSession` with a role-specific system prompt, model
from the model router, tools from the role definition, and `cwd` scoped to the
project workspace).

---

## 5. Scheduler design

`core/orchestration/scheduler.ts`. Inputs: task dependencies, agent
availability, budget/concurrency limits, project policy. Output: which
`READY` task gets assigned to which `IDLE` agent.

- **Concurrency is real** (spec §53): independent `READY` tasks run in
  parallel across distinct agents with non-overlapping workspaces. Tasks that
  share a filesystem/repo are serialized by the workspace lock.
- **Dependencies gate readiness** (spec §24): a task is `READY` only when all
  `task_dependencies` are `DONE`. Cycle detection rejects the edge up front.
- **Depth limits** cap task decomposition (spec §23, default max depth 4).
- **Trigger modes** (spec §20): `persistent` (registered, idle until assigned),
  `ephemeral` (spawned for one task then discarded), `scheduled` (cron/interval
  via `/guild start`), `event` (spawned on a matching `EventBus` event).
- **Managers don't poll.** Completion of a task emits `task.completed`, which
  wakes any agent `WAITING` on that task or on review (spec §15).
- **`ProjectRunner`** (spec §60) sits on top of the scheduler: it reuses-or-spawns
  role agents, drives each task through developer → review → QA → done according
  to the project's review policy, reads review verdicts from task memory, and
  honors pause/abort. The `/guild` wizard drives it end-to-end.

---

## 6. Package structure

```
pi-guild/
├── package.json          # "pi" manifest → extensions: ["./pi/index.ts"]
├── tsconfig.json
├── README.md  LICENSE  CHANGELOG.md  CONTRIBUTING.md  SECURITY.md  CODE_OF_CONDUCT.md
├── pi/                   # Pi adapter (index, commands, tools, ui)
├── core/                 # engine (org, projects, agents, tasks, messaging,
│                         #   orchestration, workflows, policies, memory, events)
├── database/             # schema.sql, db.ts, repository.ts
├── agents/               # data-driven role definitions (7 defaults)
├── integrations/         # git, github, plane (all optional)
├── ui/                   # optional browser dashboard (later milestone)
├── skills/               # package skills (later)
├── tests/                # unit / integration / e2e (mocked runtimes)
└── docs/
```

---

## 7. Phase 1 implementation plan

Milestone 1 (this phase): create organization → project → agents → task →
spawn developer → send message → complete task → **persist everything**. No
Plane, no GitHub, no web UI, no Docker.

| # | Deliverable | Files |
|---|-------------|-------|
| 1 | Foundation + contracts | `core/types.ts`, `core/events.ts`, `core/repository.ts`, `database/*`, package scaffold |
| 2 | Domain services | `core/organization`, `core/projects`, `core/goals`, `core/policies`, `core/memory` |
| 3 | Work domain | `core/agents`, `core/tasks`, `core/messaging` |
| 4 | Orchestration | `core/orchestration` (scheduler, lifecycle, spawner, model router) |
| 5 | Role definitions | `agents/{ceo,manager,architect,developer,reviewer,qa,researcher}` |
| 6 | Pi extension | `pi/index.ts`, commands, `guild_*` tools, TUI |
| 7 | Tests | unit + mocked end-to-end (calculator project) |

Milestones 2–5 (later): Git/PR workflow → Plane sync → GitHub adapter →
optional browser dashboard.

---

## 8. Known Pi API constraints (verified against Pi 0.84.1)

- **Extension factory must not start long-lived resources** (processes,
  sockets, watchers, timers). Defer DB open, scheduler loop, etc. to
  `session_start` or the command/tool that needs them; clean up in
  `session_shutdown`.
- **`createAgentSession()` is the sub-agent primitive.** It returns an
  `AgentSession` with `prompt()`, `subscribe()`, `abort()`, `dispose()`, and
  per-session `cwd`/`model`/`tools`/`SessionManager`. Multiple sessions can
  run concurrently in-process. This is the correct spawn primitive — do not
  shell out to `pi` as a subprocess.
- **Tools must truncate output** (~50KB / 2000 lines) or blow the context.
- **Use `StringEnum` from `@earendil-works/pi-ai`** for tool enum params;
  `Type.Union`/`Type.Literal` break Google's API.
- **Custom tools mutating files must use `withFileMutationQueue()`** to avoid
  parallel-write clobbering.
- **`pi.exec`** is the shell primitive; `createLocalBashOperations`/`createBashTool`
  are available if we need sandboxed bash with a spawn hook (project isolation).
- **Packages**: declare `pi.extensions` in `package.json`, list bundled pi
  packages as `peerDependencies` (`*`), never bundle them. `pi install npm:…`
  runs `npm install --omit=dev`, so runtime deps live in `dependencies`.
- **Node ≥ 22.5** provides `node:sqlite` (experimental). Zero native-module
  cost; acceptable for a local-first single-user store.
- Extensions run with **full system permissions** — see security model.

---

## 9. Licensing / dependency review plan

- License: **MIT** (permissive FOSS, spec §48).
- Runtime deps: **none beyond Pi's own peer packages** (`@earendil-works/pi-*`,
  `typebox` — all MIT). DB is `node:sqlite` (Node stdlib). No native modules,
  no copyleft dependencies.
- Before publishing: run a full dependency audit (advisory + license scan) and
  record results in `docs/LICENSE-REVIEW.md`. Any GPL/AGPL/SSPL dependency
  discovered later blocks publication until replaced.
- No code copied from Paperclip or pi-mail; both are explicitly out of scope.
