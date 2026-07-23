# Architecture guide

CutScout is a local-first Electron application organized as a small workspace. Shared contracts define the process boundaries; feature code lives next to the process that owns it.

## Runtime processes

1. The Electron main process owns windows, native dialogs, external media actions, updates, and IPC registration.
2. The preload exposes the validated `VodSearchApi` surface to the renderer.
3. The React renderer owns presentation and user interaction. It never opens the database or invokes native executables directly.
4. The indexer utility process owns library scans, durable jobs, search, and inference orchestration.
5. Package modules own reusable domain logic and do not depend on Electron UI code.

## Renderer layout

`apps/desktop/src/renderer/src/App.tsx` is an application coordinator. It loads shared state, subscribes to process events, and selects the current feature workspace.

- `features/library`: library browsing, filtering, search results, and first-run state.
- `features/speakers`: the cross-library speaker review workflow.
- `features/activity`: job activity and retry controls.
- `features/settings`: source, model, schedule, and privacy settings.
- `components/app-shell.tsx`: navigation and shared page framing.
- `components/media-workspace.tsx`: playback, timeline, and transcript coordination.
- `components/media-speaker-panel.tsx`: speaker editing inside one video.
- `components/clip-composer.tsx`: clip-range selection and export entry points.
- `components/short-form-*`: short-form project state, canvas rendering, UI, and export helpers.
- `lib/format.ts`: presentation-only formatting shared by renderer features.

Feature-specific components should stay under their feature folder. Move a component to `components` only when more than one feature genuinely uses it.

## Database layout

`packages/database/src/repository.ts` is the stable public facade used by the indexer and search service.

- `job-repository.ts` owns durable jobs, processing schedules, and aggregate library stats.
- `search-repository.ts` owns FTS and vector retrieval queries.
- `repository-helpers.ts` owns SQLite row mapping and speaker-vector math.
- `migrations.ts` owns schema evolution.

Keep SQL close to the domain that owns it. The facade may delegate, but callers should not reach into specialized repositories directly.

## Adding a feature

1. Add or update a Zod contract in `packages/contracts` when data crosses a process boundary.
2. Add the IPC channel and typed API method in the contracts package.
3. Implement the operation in the owning process and expose it through preload when the renderer needs it.
4. Put renderer code in a focused feature folder and keep `App.tsx` limited to orchestration.
5. Add unit tests beside pure logic and integration tests beside the process boundary they exercise.

## Dependency direction

Dependencies should flow in this direction:

```text
renderer -> preload contract -> main/indexer -> database/search/inference
                         all layers -> contracts
```

Packages must not import from `apps/desktop`. Renderer modules must not import database or inference implementations.
