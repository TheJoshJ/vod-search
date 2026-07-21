# VOD Search

VOD Search is a Windows-first video transcript search application. It indexes existing subtitles or local Whisper transcripts, asks Codex to enrich timestamped chunks, and combines full-text and semantic search.

Source videos are referenced in place and are never modified. Transcripts, tags,
embeddings, and the search index stay under the application's local data folder.
Only transcript batches are sent to OpenAI when Codex creates summaries and
search metadata; video and audio files are never uploaded by VOD Search.

## What works

- Recursively watches selected folders for common video and subtitle formats.
- Prefers SRT, VTT, ASS, or embedded captions before transcribing audio.
- Runs `whisper.cpp` locally with the free, open-source Whisper small.en model.
- Creates overlapping timestamped chunks and an SQLite FTS5 search index.
- Adds local BGE embeddings for meaning-based retrieval.
- Runs `codex exec` with a bundled transcript-enrichment skill and a strict JSON
  schema to create summaries, entities, events, aliases, and likely search
  phrases.
- Opens matching videos in a full-width player with timestamp markers plus
  transcript and summary tabs.
- Persists background jobs, resumes interrupted work, pauses on battery, and
  keeps moved-file identity through content fingerprints.

The enrichment model only sees transcript text. It cannot reliably describe a
purely visual event that nobody says aloud; computer-vision indexing is a later
extension.

## First run

1. Open **Settings** and install Codex, then select **Sign in** to authenticate
   with ChatGPT or an OpenAI account. If Codex is already installed, VOD Search
   detects it.
2. Install Whisper small.en and the semantic search index. Both are downloaded
   and managed inside the app.
3. Open **Library**, add one or more folders, and leave the app running while
   the Activity queue processes them.
4. Search for spoken words, names, or descriptions such as “death to Kalphite
   King,” then open a result at its timestamp.

Model downloads are pinned and SHA-256 verified. Whisper is about 465 MB, BGE
is about 128 MB, and no local generative model is downloaded. Basic full-text
search only requires Whisper (or existing subtitles); BGE supplies semantic
similarity, while Codex supplies richer summaries and event metadata.

The packaged Windows application includes Electron, FFmpeg, and `whisper.cpp`.
End users do not need Node.js, Python, pnpm, or a terminal. The Settings page
uses OpenAI's official standalone Windows installer for Codex, which downloads
checksum-verified release assets into Codex's standard per-user storage and
places the app-managed command under the VOD Search application-data folder.

## Development

Install the pinned package manager once if `pnpm` is not already available:

```bash
npm install --global pnpm@11.15.1
```

```bash
pnpm install
pnpm prepare:runtimes:win
pnpm dev
```

Run validation with:

```bash
pnpm typecheck
pnpm test
pnpm build
```

The bundled Windows runtimes are checksum-pinned builds of FFmpeg and
`whisper.cpp`. They are downloaded into an ignored `resources/runtime/windows`
directory. Developers can override them with `VOD_SEARCH_FFMPEG_PATH`,
`VOD_SEARCH_FFPROBE_PATH`, `VOD_SEARCH_WHISPER_PATH`, and
`VOD_SEARCH_CODEX_PATH`.

## Windows installer

Run this on Windows:

```bash
pnpm package:win
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
  and the schema-validated Codex enrichment client and skill.
- `packages/contracts`: validated domain and IPC contracts shared by processes.
