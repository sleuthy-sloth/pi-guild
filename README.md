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

---

## Features

- **Guided autonomous runs** — `/studio` asks what to build, then plans and runs
  the whole team through to `DONE` — no manual spawning or assigning.
- **Nine data-driven roles** — CEO, Manager, Architect, Developer, Reviewer, QA,
  Researcher, Designer, Librarian — editable without touching code.
- **Dependency-gated scheduler** — tasks only run when their dependencies are
  done; cycle detection rejects invalid graphs; design-labeled tasks route to a
  Designer.
- **Review → QA pipeline** — dev → review → QA with a configurable approval
  policy, and **auto-merge** of PRs (unless `manual_merge`).
- **Git workflow** — branches, commits, push, PRs, and merges with
  protected-branch defaults, behind one `RepositoryProvider` abstraction
  (local git + GitHub).
- **Model routing** — assign models per role or per model class, auto-assign
  from whatever's logged in on the harness, or preset to one provider
  (e.g. OpenCode Go).
- **Council (multi-model synthesis)** — run one question through several models
  and reconcile a consensus.
- **Skills & context assembly** — per-role `SKILL.md` injection, plus a context
  assembler that gathers relevant memory, decisions, and prior attempts into
  each agent's prompt.
- **Background workers** — fire-and-forget jobs via `/studio bg`, and an
  explicitly-started background scheduler (`/studio start`).
- **Live TUI panel + browser dashboard** — watch the agent roster in the TUI or
  in a local web dashboard.
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
| UI | `ui/` | the optional browser dashboard |

**Runtime model.** Each agent is a genuine in-process agent loop created with
Pi's SDK `createAgentSession()` — its own `cwd` (project workspace), `model`,
`tools`, and `SessionManager`. Multiple sessions can run concurrently; the
scheduler decides *which* run, *when*, and *why*. There are no persistent
manager processes: management runs in ephemeral sessions triggered by events.
Each agent receives **only the tools its role allows** (a Reviewer cannot edit
code; a Developer gets the git workflow).

**No background daemon.** Nothing is started from the extension factory. The
background scheduler is an explicit, started component — `/studio start` spawns
a bounded loop that continuously runs ready work across projects, and
`/studio stop` (or `session_shutdown`) tears it down.

---

## Installation

Requires **Node ≥ 22.5** (for the built-in `node:sqlite`). Install the package
from npm:

```bash
pi install npm:pi-studio
```

For local development, install straight from a checkout:

```bash
git clone <your-fork> pi-studio && cd pi-studio
npm install
pi install .            # local-path install; reloads pick up source changes
```

There are no native modules and no runtime dependencies beyond Pi's own peer
packages. The database is `node:sqlite`, part of the Node standard library.

---

## First-run walkthrough

**1. Set up the organization and models**

```text
/studio setup
```

This creates the local database at `~/.pi/agent/pi-studio/studio.db`, seeds the
nine agent roles and the default policy set, then asks how you want to route
models:

- **Auto-assign from logged-in models** (recommended) — reads what the harness
  reports as authenticated and assigns all five model classes.
- **Choose per class** — walks you through five pickers (reasoning, cheap
  reasoning, coding, cheap coding, research).
- **Skip** — assign later with `/studio models`.

Skip nothing — model routing takes a minute and decides the whole team's cost
and quality profile (see [Model routing](#model-routing)).

**2. Run a job**

```text
/studio
```

Answer the prompts: what to build, the project name, and the approval policy.
Pi Studio then:

1. Creates the organization/project/goal.
2. Initializes a local git repository in the project workspace.
3. Spawns a **Manager** agent that decomposes the goal into tasks via the
   `studio_*` tools (falling back to a deterministic plan if the model yields
   nothing).
4. Runs the dependency-gated loop: **Developers** implement (branch + commit
   locally) → **Reviewer** approves/requests changes → **QA** passes/fails →
   `DONE`, merging the PR automatically unless you chose `manual_merge`.

Progress streams as TUI notifications. Hold it with `/studio pause`, resume
with `/studio resume`, inspect with `/studio status` / `/studio agents` /
`/studio tasks`.

**3. Watch it work**

```text
/studio live                          # live agent panel in the TUI
/studio dashboard                     # browser dashboard at http://127.0.0.1:<port>
```

The dashboard auto-refreshes every 2 seconds and lets you pause/resume and
approve/reject escalations from the browser.

**4. Wire up real infrastructure (optional)**

```text
/studio git setup <project> github https://github.com/you/repo   # push + PRs
/studio plane setup <base-url> <workspace-slug> <api-key>        # Plane mirror
/studio plane sync <project-id>
/studio github <project-id>                                      # PR/CI status
```

Everything works without these — they're mirrors on top of the local source of
truth.

---

## Model routing

Models are assigned per **model class** — `reasoning`, `cheap-reasoning`,
`coding`, `cheap-coding`, `research` — so five choices cover every role, with
per-role overrides on top. No vendor names are hardcoded.

```text
/studio models list                  # what's logged in on the harness
/studio models providers             # which providers have models
/studio models auto                  # best-effort auto-assign all classes
/studio models preset opencode-go    # auto-assign using only one provider
/studio models class coding opencode-go/deepseek-v4-pro
/studio models set Developer anthropic/claude-sonnet-4-5   # per-role override
/studio models clear                 # reset routing
/studio models                       # show current assignments
```

Auto-assign reads the models the harness reports as logged in
(`ctx.modelRegistry.getAvailable()`) and prefers capability hints — `opus` /
`sonnet` / `o3` / `o4` → reasoning, `code` / `claude` / `gpt` / `deepseek` →
coding, `haiku` / `mini` / `flash` / `deepseek` → cheap classes. The runner
resolves assigned models through Pi's `ModelRuntime`, so custom providers (like
`opencode-go` from `models.json`) work, not just the static catalog.

## Commands

All commands live under the `/studio` namespace:

| Command | Purpose |
|---------|---------|
| `/studio` / `run` | guided wizard: plan + run a job autonomously |
| `/studio setup` | wizard: create DB, seed roles + policies, configure model routing |
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
| `/studio stop <agentId>` / `stop project <id>` / `stop` | stop an agent, a project's agents, or the background scheduler |
| `/studio council [question]` / `members` / `add <provider>/<model>` / `reset` | multi-model synthesis |
| `/studio bg <role> <prompt>` | fire-and-forget background job |
| `/studio live` | refresh the live agent panel |
| `/studio start` | start the background scheduler loop |
| `/studio git setup <project> local <path>` / `github <url>` | register a repository |
| `/studio git branch` / `commit` / `push` / `pr` / `merge` / `log <taskId>` | the git workflow |
| `/studio plane setup <baseUrl> <slug> <apiKey>` / `status` / `sync [projectId]` / `comments <taskId>` | Plane mirror |
| `/studio github [projectId]` | PR / CI status via `gh` |
| `/studio config [get <key>` / `set <key> <value>` / `setjson <key> <json>]` | read/write settings |
| `/studio usage [projectId]` | token/call/time usage |
| `/studio models [list` / `providers` / `auto` / `preset <provider>` / `set` / `class` / `clear]` | model routing |
| `/studio dashboard [status` / `stop]` | start/stop the browser dashboard |
| `/studio doctor` | DB path, counts, integrations, settings |
| `/studio logs [N]` | last N audit entries |

The same surface is available to agents as **34 `studio_*` tools**
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
| **Reviewer** | review code against acceptance criteria | read + approve/request changes; never edits code |
| **QA** | write/run tests, report bugs, verify fixes | run tests, write tests, report bugs |
| **Researcher** | investigate unknowns, produce sourced findings | read + search the web |
| **Designer** | UI/UX: layout, typography, color, motion; produces working markup/styles | edit code, create branches |
| **Librarian** | find authoritative answers from docs/GitHub/web, with sources | read-only + web search |

Roles are **data-driven**: edit the files in `agents/<role>/` to change a role's
tools, permissions, or system prompt without touching code. `seedRoles()` is
idempotent and falls back to built-in defaults when files are missing. The
runner **enforces** each role's tool list at session build time.

## Git workflow

Developer agents create branches, commit, push, and open pull requests via the
`studio_git_*` tools (or `/studio git ...`), with protected-branch defaults
(`main`/`master`) and branch naming (`feature/<taskId>-<slug>`, `bugfix/`,
`refactor/`). Local git and GitHub (`gh` CLI) sit behind one
`RepositoryProvider` abstraction — GitLab/Gitea/Forgejo slot in behind the same
interface.

```text
/studio git setup <project> github https://github.com/you/repo
/studio git branch <taskId>      # create feature/<taskId>-<slug>
/studio git commit <taskId> "Implement X"
/studio git push <taskId>
/studio git pr <taskId>          # open a pull request
/studio git merge <taskId>       # merge the PR (auto unless manual_merge)
```

Commits and pull requests are recorded in the local database; the reviewer's
prompt includes the PR link. Pushing directly to protected branches is refused
by default. On a fresh local repo with no remote, `push` skips gracefully rather
than failing the task.

## Plane adapter

An optional adapter mirrors project/task state into a Plane workspace:

```text
/studio plane setup https://api.plane.so <workspace-slug> <api-key>
/studio plane sync <project-id>
/studio plane comments <task-id>   # push task messages as issue comments
```

SQLite stays the source of truth; Plane is a mirror. State maps to Plane's
default groups (Backlog / Unstarted / Started / Completed / Cancelled).
Assignees, labels, cycles, modules, and webhook ingestion are follow-ups.

## GitHub adapter

`/studio github [projectId]` reads PR and CI status for the project's GitHub
repositories via the `gh` CLI (`GitHubClient`), and the Git provider uses `gh`
for PR creation and merging.

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

## Live panel & browser dashboard

**Live TUI panel** — org/project/task counts plus the agent roster, refreshed on
session start, `/studio live`, and during autonomous runs.

**Browser dashboard** — an optional local web dashboard:

```text
/studio dashboard          # prints http://127.0.0.1:<port>
/studio dashboard status
/studio dashboard stop
```

It shows stat cards, color-coded agent and task tables, escalations (with
approve/reject buttons), pull requests, recent messages, and per-project
progress. It auto-refreshes every 2 seconds and offers pause/resume. One
self-contained HTML page + Node's built-in `http` — no framework, no build step,
no Docker. The Pi TUI remains primary.

## Notifications

Human-relevant events surface as TUI notifications: task blocked, human decision
needed, review needed, and task failed. Toggle them via the `notifications`
setting:

```text
/studio config setjson notifications '{"onBlocked":false}'
```

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
- **Role tool lists are enforced** — spawned agents only get the tools their
  role allows; read-only roles cannot edit code or run bash.
- **Protected branches are refused** by the git service, and secrets should
  never be pasted into tasks, messages, or memory — they are persisted to the
  local SQLite database.
- The local database is the source of truth; treat
  `~/.pi/agent/pi-studio/studio.db` as sensitive. Plane/GitHub credentials are
  stored in the local settings table, not in code.

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
with **mocked runtimes — no real LLM calls**. 74 tests across 25 files cover:

- **Unit** — repository CRUD, task engine (decomposition, cycle rejection,
  readiness), scheduler (role + label filters), messaging, event bus, policies,
  memory, lifecycle transitions, runner (dev → review → QA, design routing,
  budget pause, auto-merge), recovery, budget, git service (branch naming,
  protected branches, merge) and providers, council, skills, context assembler,
  Plane sync (fake client), dashboard server (snapshot + actions), model router
  (auto-assign, presets, resolve fallback), tool filtering, background scheduler.
- **End-to-end** — full mocked pipelines (org → project → roles → agents →
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
| Agents fail with no model | Run `/studio models auto` (or `/studio models list` to confirm what's logged in). |
| `/studio git pr` fails | A remote + pushed branch are required; local repos have no PRs. |
| `/studio plane sync` errors | Verify base URL, workspace slug, and API key against your Plane instance (see the Plane adapter caveat in `CHANGELOG`). |

## License

[MIT](./LICENSE)

[Pi coding agent]: https://www.npmjs.com/package/@earendil-works/pi-coding-agent
