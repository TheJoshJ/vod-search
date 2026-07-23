# Contributing

## Setup

```bash
pnpm install
pnpm prepare:runtimes:win
pnpm dev
```

Read [the architecture guide](docs/architecture.md) before introducing a new process boundary or top-level folder.

## Working conventions

- Keep `App.tsx`, main-process entry points, and indexer entry points focused on orchestration.
- Prefer a feature folder over adding another unrelated component to a shared file.
- Extract pure calculations from UI and process code so they can be tested without Electron.
- Validate untrusted IPC input with the contracts package.
- Preserve local-first behavior: media, voice patterns, and embeddings stay on the device unless a feature explicitly documents otherwise.
- Keep migrations additive and test upgrades from an existing database.
- Avoid barrel files inside feature folders unless several external consumers need the same public surface.

## Validation

Run the checks that match your change, then run the complete surface before opening a pull request:

```bash
pnpm typecheck
pnpm test
pnpm build
```

Windows packaging can be verified with `pnpm package:win`. Native Electron modules may need to be rebuilt when switching between Node-based tests and Electron development.
