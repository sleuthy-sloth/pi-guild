# Contributing

Thanks for your interest in Pi Studio. Keep contributions small and focused.

## Setup

- Node ≥ 22.5 (required for `node:sqlite`).
- `npm install` to pull dev dependencies.
- `npm test` runs the vitest suite; `npm run build` typechecks with `tsc --noEmit`.

## Guidelines

- **Stack**: TypeScript strict + ESM. Use explicit `.ts` extensions in relative
  imports, e.g. `import { bus } from "../events.ts"`.
- **Node built-ins only** (`node:crypto`, `node:sqlite`, `node:fs`, `node:path`,
  `node:os`). No new npm dependencies without discussion.
- **Data access goes through `StudioRepository`** (`core/repository.ts`). Never
  write raw SQL outside it.
- **State changes follow the contract**: call the repo, `repo.audit(...)`,
  `repo.recordEvent(...)`, and `bus.emit(...)` where a matching `StudioEvents`
  name exists.
- **Tests**: add tests for new logic in `tests/`. Unit tests use an in-memory
  DB (`createDb(":memory:")`); the e2e test uses a mocked `AgentRunner` and
  never calls a real LLM.

## Pull requests

1. Run `npm test` and `npm run build` and confirm both are green.
2. Keep commits meaningful with a clean history (no "wip" noise).
3. Never commit secrets, tokens, or `.env` files.

## License

By contributing, you agree that your contributions are licensed under the
project's [MIT license](./LICENSE).
