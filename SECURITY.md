# Security Policy

## Supported versions

Pi Studio is in early development (0.1.x). Only the latest release receives
security fixes.

## Reporting a vulnerability

Please **do not** open a public issue for a suspected security vulnerability.
Report it privately by email to the maintainer, with:

- A short description of the issue.
- Steps to reproduce, or a proof of concept if possible.
- The affected version and any relevant environment details.

The maintainer will acknowledge receipt and coordinate a fix and disclosure
timeline with you.

## Security model

**Agents run with full system permissions.** Pi Studio is not a sandbox. An
agent spawned by Pi Studio can read, write, and execute anything the host user
can. Before installing or granting model access, ensure you trust:

1. the workspace and repositories you point agents at, and
2. the model provider you route agent roles to.

The policy engine (`core/policies`) is a **decision guardrail, not an OS
sandbox**. It default-denies dangerous actions (`merge into main`,
`deploy production`, `delete repository`, …) and lets an explicit `deny` beat
an explicit `allow`, but it cannot constrain what an agent's underlying tools
can do at the OS level.

## Safe defaults

- **Dangerous actions default to DENY** until explicitly allowed.
- **No background daemon** starts from the extension factory; the scheduler loop
  only runs after an explicit `/studio start`.
- **Local-first**: state is stored in a local SQLite database
  (`~/.pi/agent/pi-studio/studio.db`). Nothing is uploaded unless you enable an
  integration.
- **No secrets in the repo**: keys, tokens, and `.env` files must never be
  committed.

## Recommendations for operators

- Run Pi Studio in a workspace you have reviewed.
- Keep the local database and Pi session files private.
- Never paste credentials or secrets into tasks, messages, or memory entries.
- Review the agent roles' permissions in `agents/<role>/policy.json` before
  granting dangerous tooling to a role.
