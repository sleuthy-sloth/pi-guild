# License & Dependency Review

Recorded 2025. Purpose: verify Pi Studio can be published under MIT with no
license-incompatible dependencies (spec §48).

## Runtime dependency surface

Pi Studio declares **zero runtime dependencies of its own**. Its only imports
at runtime are:

| Package | Role | License | Note |
|---------|------|---------|------|
| `@earendil-works/pi-coding-agent` | extension API + SDK | MIT | `peerDependency` (`*`), provided by Pi, not bundled |
| `@earendil-works/pi-ai` | `StringEnum`, AI utilities | MIT | `peerDependency`, provided by Pi |
| `@earendil-works/pi-tui` | TUI components | MIT | `peerDependency`, provided by Pi |
| `typebox` | tool schemas | MIT | `peerDependency`, provided by Pi |
| `node:sqlite` | local database | MIT (Node.js) | Node ≥ 22.5 built-in, no npm install |

No native modules, no copyleft (GPL/AGPL/SSPL) dependencies, no code copied
from Paperclip or pi-mail.

## Dev dependency surface (not shipped, not installed by `pi install`)

| Package | License |
|---------|---------|
| `typescript` | Apache-2.0 |
| `vitest` | MIT |
| `tsx` | MIT |
| `@types/node` | MIT |

`pi install` runs `npm install --omit=dev`, so none of these are present at
runtime.

## Conclusion

MIT is compatible with every dependency. Publication is unblocked. Re-run this
review before any dependency is added.
