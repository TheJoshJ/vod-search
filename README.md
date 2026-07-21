# VOD Search

VOD Search is a Windows-first, local video transcript search application. It indexes existing subtitles or local Whisper transcripts, enriches timestamped chunks with a locked-down local OpenCode model, and combines full-text and semantic search.

Source videos are referenced in place and are never modified. Transcripts, tags,
embeddings, and the search index stay under the application's local data folder.

## What works

- Recursively watches selected folders for common video and subtitle formats.
- Prefers SRT, VTT, ASS, or embedded captions before transcribing audio.
- Runs `whisper.cpp` locally with the free, open-source Whisper small.en model.
- Creates overlapping timestamped chunks and an SQLite FTS5 search index.
- Optionally adds local BGE embeddings for meaning-based retrieval.
- Optionally asks a local Qwen model through an isolated OpenCode server for
  summaries, entities, events, aliases, and likely search phrases.
- Opens a matching video at the approximate timestamp from a search result.
- Persists background jobs, resumes interrupted work, pauses on battery, and
  keeps moved-file identity through content fingerprints.

The enrichment model only sees transcript text. It cannot reliably describe a
purely visual event that nobody says aloud; computer-vision indexing is a later
extension.

## First run

1. Open **Settings** and install Whisper small.en. Install BGE for semantic
   search and Qwen for richer event/tag search if desired.
2. Open **Library**, add one or more folders, and leave the app running while
   the Activity queue processes them.
3. Search for spoken words, names, or descriptions such as “death to Kalphite
   King,” then open a result at its timestamp.

Model downloads are pinned and SHA-256 verified. Whisper is about 465 MB, BGE
is about 128 MB, and Qwen is about 2.3 GB. Basic full-text search only requires
Whisper (or existing subtitles); the other models are optional.

## Development

```bash
corepack pnpm install
corepack pnpm prepare:runtimes:win
corepack pnpm dev
```

Run validation with:

```bash
corepack pnpm typecheck
corepack pnpm test
corepack pnpm build
```

The bundled Windows runtimes are checksum-pinned builds of FFmpeg, whisper.cpp,
and llama.cpp. They are downloaded into an ignored `resources/runtime/windows`
directory. Developers can override them with `VOD_SEARCH_FFMPEG_PATH`,
`VOD_SEARCH_FFPROBE_PATH`, `VOD_SEARCH_WHISPER_PATH`, and
`VOD_SEARCH_LLAMA_PATH`.

## Windows installer

Run this on Windows:

```bash
corepack pnpm package:win
```

The NSIS installer is written to `release/`. Native Electron modules must be
rebuilt on Windows, so cross-packaging from Linux is intentionally unsupported.
The included `Windows installer` GitHub Actions workflow builds and uploads the
installer artifact on a Windows runner.

## Architecture

- `apps/desktop`: Electron main process, sandboxed preload, React UI, utility
  indexer process, filesystem watcher, and durable job scheduler.
- `packages/database`: SQLite schema, FTS5/`sqlite-vec`, and repositories.
- `packages/search`: subtitle parsing, chunking, lexical/semantic rank fusion.
- `packages/inference`: verified models, FFmpeg/Whisper adapters, local BGE,
  llama.cpp, and the restricted OpenCode enrichment client.
- `packages/contracts`: validated domain and IPC contracts shared by processes.
