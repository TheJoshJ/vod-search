import type Database from "better-sqlite3"

interface Migration {
  version: number
  name: string
  sql: string
}

const migrations: Migration[] = [
  {
    version: 1,
    name: "initial_schema",
    sql: `
      CREATE TABLE source_folders (
        id TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        added_at_ms INTEGER NOT NULL,
        last_scan_at_ms INTEGER
      );

      CREATE TABLE media_assets (
        id TEXT PRIMARY KEY,
        source_folder_id TEXT NOT NULL REFERENCES source_folders(id) ON DELETE CASCADE,
        relative_path TEXT NOT NULL,
        canonical_path TEXT NOT NULL UNIQUE,
        display_name TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        modified_at_ms INTEGER NOT NULL,
        quick_fingerprint TEXT NOT NULL,
        duration_ms INTEGER,
        container TEXT,
        video_codec TEXT,
        audio_codec TEXT,
        availability TEXT NOT NULL DEFAULT 'available' CHECK (availability IN ('available', 'missing')),
        highest_completed_stage TEXT NOT NULL DEFAULT 'discovered',
        discovered_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE INDEX media_assets_source_folder_idx ON media_assets(source_folder_id);
      CREATE INDEX media_assets_fingerprint_idx ON media_assets(quick_fingerprint);
      CREATE INDEX media_assets_availability_idx ON media_assets(availability);

      CREATE TABLE subtitle_tracks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        source TEXT NOT NULL CHECK (source IN ('sidecar', 'embedded')),
        language TEXT,
        title TEXT,
        path TEXT,
        stream_index INTEGER,
        is_active INTEGER NOT NULL DEFAULT 0,
        UNIQUE(media_id, source, path, stream_index)
      );

      CREATE TABLE transcript_segments (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        text TEXT NOT NULL,
        source TEXT NOT NULL CHECK (source IN ('sidecar', 'embedded', 'whisper')),
        confidence REAL,
        transcript_version TEXT NOT NULL
      );

      CREATE INDEX transcript_segments_media_time_idx
        ON transcript_segments(media_id, start_ms, end_ms);

      CREATE TABLE search_chunks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        start_ms INTEGER NOT NULL,
        end_ms INTEGER NOT NULL,
        transcript TEXT NOT NULL,
        summary TEXT,
        entities_json TEXT NOT NULL DEFAULT '[]',
        events_json TEXT NOT NULL DEFAULT '[]',
        aliases_json TEXT NOT NULL DEFAULT '[]',
        search_phrases_json TEXT NOT NULL DEFAULT '[]',
        enrichment_confidence REAL,
        chunk_version TEXT NOT NULL,
        embedding_version TEXT,
        enrichment_version TEXT
      );

      CREATE INDEX search_chunks_media_time_idx ON search_chunks(media_id, start_ms, end_ms);

      CREATE VIRTUAL TABLE search_chunks_fts USING fts5(
        chunk_id UNINDEXED,
        title,
        transcript,
        summary,
        tags,
        tokenize='unicode61 remove_diacritics 2'
      );

      CREATE TABLE processing_artifacts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        version TEXT NOT NULL,
        input_hash TEXT NOT NULL,
        model_hash TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'running', 'succeeded', 'failed')),
        details_json TEXT NOT NULL DEFAULT '{}',
        completed_at_ms INTEGER,
        UNIQUE(media_id, stage)
      );

      CREATE TABLE jobs (
        id TEXT PRIMARY KEY,
        media_id TEXT REFERENCES media_assets(id) ON DELETE CASCADE,
        stage TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('queued', 'running', 'paused', 'succeeded', 'failed', 'cancelled')),
        priority INTEGER NOT NULL DEFAULT 0,
        progress REAL NOT NULL DEFAULT 0 CHECK (progress >= 0 AND progress <= 1),
        attempts INTEGER NOT NULL DEFAULT 0,
        error TEXT,
        payload_json TEXT NOT NULL DEFAULT '{}',
        created_at_ms INTEGER NOT NULL,
        updated_at_ms INTEGER NOT NULL,
        UNIQUE(media_id, stage)
      );

      CREATE INDEX jobs_dispatch_idx ON jobs(status, priority DESC, created_at_ms);

      CREATE TABLE model_installations (
        model_id TEXT PRIMARY KEY,
        version TEXT NOT NULL,
        role TEXT NOT NULL,
        status TEXT NOT NULL CHECK (status IN ('missing', 'downloading', 'installed', 'invalid')),
        bytes_downloaded INTEGER NOT NULL DEFAULT 0,
        size_bytes INTEGER NOT NULL,
        path TEXT,
        sha256 TEXT,
        error TEXT,
        updated_at_ms INTEGER NOT NULL
      );

      CREATE TABLE preview_cache (
        cache_key TEXT PRIMARY KEY,
        media_id TEXT NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
        path TEXT NOT NULL,
        size_bytes INTEGER NOT NULL,
        last_accessed_at_ms INTEGER NOT NULL,
        created_at_ms INTEGER NOT NULL
      );

      CREATE TABLE settings (
        key TEXT PRIMARY KEY,
        value_json TEXT NOT NULL,
        updated_at_ms INTEGER NOT NULL
      );
    `
  }
]

export function migrate(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      applied_at_ms INTEGER NOT NULL
    );
  `)

  const applied = new Set(
    db.prepare("SELECT version FROM schema_migrations").all().map((row) => (row as { version: number }).version)
  )

  for (const migration of migrations) {
    if (applied.has(migration.version)) continue

    db.transaction(() => {
      db.exec(migration.sql)
      db.prepare(
        "INSERT INTO schema_migrations(version, name, applied_at_ms) VALUES (?, ?, ?)"
      ).run(migration.version, migration.name, Date.now())
    })()
  }
}

