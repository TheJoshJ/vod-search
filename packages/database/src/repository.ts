import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import type {
  IndexStage,
  Job,
  JobStage,
  LibraryStats,
  MediaAsset,
  MediaSummarySection,
  ResourceMode,
  SourceFolder,
  TranscriptSegment,
  EnrichedChunk,
  TranscriptSource
} from "@vod-search/contracts"

interface SourceFolderRow {
  id: string
  path: string
  added_at_ms: number
  last_scan_at_ms: number | null
  available_media_count: number
  missing_media_count: number
}

interface MediaRow {
  id: string
  source_folder_id: string
  display_name: string
  relative_path: string
  duration_ms: number | null
  size_bytes: number
  created_at_ms: number
  modified_at_ms: number
  quick_fingerprint: string
  availability: "available" | "missing"
  highest_completed_stage: IndexStage
}

interface JobRow {
  id: string
  media_id: string | null
  stage: JobStage
  status: Job["status"]
  priority: number
  progress: number
  attempts: number
  error: string | null
  created_at_ms: number
  updated_at_ms: number
}

export interface UpsertMediaInput {
  id?: string
  sourceFolderId: string
  relativePath: string
  canonicalPath: string
  displayName: string
  sizeBytes: number
  createdAtMs?: number
  modifiedAtMs: number
  quickFingerprint: string
  durationMs?: number | null
  container?: string | null
  videoCodec?: string | null
  audioCodec?: string | null
}

export interface NewTranscriptSegment {
  startMs: number
  endMs: number
  text: string
  confidence?: number | null
}

export interface NewSearchChunk {
  startMs: number
  endMs: number
  transcript: string
}

export interface SearchChunkForEmbedding {
  id: number
  mediaId: string
  transcript: string
  summary: string | null
  entitiesJson: string
  eventsJson: string
  aliasesJson: string
  searchPhrasesJson: string
}

export interface LexicalHitRow {
  chunkId: number
  mediaId: string
  title: string
  relativePath: string
  createdAtMs: number
  startMs: number
  endMs: number
  transcript: string
  summary: string | null
  entitiesJson: string
  eventsJson: string
  aliasesJson: string
  availability: "available" | "missing"
  rank: number
}

export class Repository {
  constructor(private readonly db: Database.Database) {}

  addSourceFolder(path: string, canonicalPath: string): SourceFolder {
    const existing = this.db.prepare("SELECT id FROM source_folders WHERE canonical_path = ?").get(canonicalPath) as
      | { id: string }
      | undefined
    if (existing) return this.getSourceFolder(existing.id)

    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO source_folders(id, path, canonical_path, added_at_ms)
       VALUES (?, ?, ?, ?)`
    ).run(id, path, canonicalPath, Date.now())
    return this.getSourceFolder(id)
  }

  getSourceFolder(id: string): SourceFolder {
    const row = this.db.prepare(
      `SELECT sf.id, sf.path, sf.added_at_ms, sf.last_scan_at_ms,
        COUNT(CASE WHEN ma.availability = 'available' THEN 1 END) AS available_media_count,
        COUNT(CASE WHEN ma.availability = 'missing' THEN 1 END) AS missing_media_count
       FROM source_folders sf
       LEFT JOIN media_assets ma ON ma.source_folder_id = sf.id
       WHERE sf.id = ?
       GROUP BY sf.id`
    ).get(id) as SourceFolderRow | undefined
    if (!row) throw new Error(`Unknown source folder: ${id}`)
    return mapSourceFolder(row)
  }

  listSourceFolders(): SourceFolder[] {
    const rows = this.db.prepare(
      `SELECT sf.id, sf.path, sf.added_at_ms, sf.last_scan_at_ms,
        COUNT(CASE WHEN ma.availability = 'available' THEN 1 END) AS available_media_count,
        COUNT(CASE WHEN ma.availability = 'missing' THEN 1 END) AS missing_media_count
       FROM source_folders sf
       LEFT JOIN media_assets ma ON ma.source_folder_id = sf.id
       GROUP BY sf.id
       ORDER BY sf.added_at_ms ASC`
    ).all() as SourceFolderRow[]
    return rows.map(mapSourceFolder)
  }

  finishSourceFolderScan(id: string): void {
    this.db.prepare("UPDATE source_folders SET last_scan_at_ms = ? WHERE id = ?").run(Date.now(), id)
  }

  upsertMedia(input: UpsertMediaInput): MediaAsset {
    const existing = this.db.prepare(
      `SELECT id, quick_fingerprint FROM media_assets
       WHERE canonical_path = ? OR (quick_fingerprint = ? AND availability = 'missing')
       ORDER BY canonical_path = ? DESC
       LIMIT 1`
    ).get(input.canonicalPath, input.quickFingerprint, input.canonicalPath) as
      | { id: string; quick_fingerprint: string }
      | undefined
    const id = existing?.id ?? input.id ?? randomUUID()
    const contentChanged = Boolean(existing && existing.quick_fingerprint !== input.quickFingerprint)
    const now = Date.now()

    this.db.prepare(
      `INSERT INTO media_assets(
        id, source_folder_id, relative_path, canonical_path, display_name,
        size_bytes, created_at_ms, modified_at_ms, quick_fingerprint, duration_ms,
        container, video_codec, audio_codec, availability,
        highest_completed_stage, discovered_at_ms, updated_at_ms
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'available', 'discovered', ?, ?)
      ON CONFLICT(id) DO UPDATE SET
        source_folder_id = excluded.source_folder_id,
        relative_path = excluded.relative_path,
        canonical_path = excluded.canonical_path,
        display_name = excluded.display_name,
        size_bytes = excluded.size_bytes,
        created_at_ms = excluded.created_at_ms,
        modified_at_ms = excluded.modified_at_ms,
        quick_fingerprint = excluded.quick_fingerprint,
        duration_ms = COALESCE(excluded.duration_ms, media_assets.duration_ms),
        container = COALESCE(excluded.container, media_assets.container),
        video_codec = COALESCE(excluded.video_codec, media_assets.video_codec),
        audio_codec = COALESCE(excluded.audio_codec, media_assets.audio_codec),
        availability = 'available',
        highest_completed_stage = CASE
          WHEN media_assets.quick_fingerprint <> excluded.quick_fingerprint THEN 'discovered'
          ELSE media_assets.highest_completed_stage
        END,
        updated_at_ms = excluded.updated_at_ms`
    ).run(
      id,
      input.sourceFolderId,
      input.relativePath,
      input.canonicalPath,
      input.displayName,
      input.sizeBytes,
      input.createdAtMs ?? input.modifiedAtMs,
      input.modifiedAtMs,
      input.quickFingerprint,
      input.durationMs ?? null,
      input.container ?? null,
      input.videoCodec ?? null,
      input.audioCodec ?? null,
      now,
      now
    )
    if (contentChanged) this.invalidateMediaContent(id)
    return this.getMedia(id)
  }

  private invalidateMediaContent(mediaId: string): void {
    const chunks = this.db.prepare("SELECT id FROM search_chunks WHERE media_id = ?").all(mediaId) as Array<{ id: number }>
    const removeVector = this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?")
    const removeFts = this.db.prepare("DELETE FROM search_chunks_fts WHERE chunk_id = ?")
    this.db.transaction(() => {
      for (const chunk of chunks) {
        removeVector.run(chunk.id)
        removeFts.run(chunk.id)
      }
      this.db.prepare("DELETE FROM search_chunks WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM transcript_segments WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM subtitle_tracks WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM processing_artifacts WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM preview_cache WHERE media_id = ?").run(mediaId)
      this.db.prepare(
        `UPDATE jobs SET status = CASE WHEN status = 'running' THEN status ELSE 'cancelled' END,
                         progress = 0, error = NULL, updated_at_ms = ?
         WHERE media_id = ?`
      ).run(Date.now(), mediaId)
    })()
  }

  updateMediaProbe(
    mediaId: string,
    metadata: { durationMs: number | null; container: string | null; videoCodec: string | null; audioCodec: string | null }
  ): void {
    this.db.prepare(
      `UPDATE media_assets
       SET duration_ms = ?, container = ?, video_codec = ?, audio_codec = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(metadata.durationMs, metadata.container, metadata.videoCodec, metadata.audioCodec, Date.now(), mediaId)
    this.setMediaStage(mediaId, "probed")
  }

  setMediaStage(mediaId: string, stage: IndexStage): void {
    const current = this.getMedia(mediaId).highestCompletedStage
    if (indexStageOrder[current] >= indexStageOrder[stage]) return
    this.db.prepare(
      "UPDATE media_assets SET highest_completed_stage = ?, updated_at_ms = ? WHERE id = ?"
    ).run(stage, Date.now(), mediaId)
  }

  getMedia(id: string): MediaAsset {
    const row = this.db.prepare(
      `SELECT id, source_folder_id, display_name, relative_path, duration_ms,
              size_bytes, created_at_ms, modified_at_ms, quick_fingerprint, availability,
              highest_completed_stage
       FROM media_assets WHERE id = ?`
    ).get(id) as MediaRow | undefined
    if (!row) throw new Error(`Unknown media asset: ${id}`)
    return mapMedia(row)
  }

  getMediaPath(id: string): string | null {
    const row = this.db.prepare(
      "SELECT canonical_path, availability FROM media_assets WHERE id = ?"
    ).get(id) as { canonical_path: string; availability: string } | undefined
    return row?.availability === "available" ? row.canonical_path : null
  }

  listMedia(input: { sourceFolderId?: string | undefined; offset: number; limit: number }): MediaAsset[] {
    const condition = input.sourceFolderId ? "WHERE source_folder_id = ?" : ""
    const params = input.sourceFolderId
      ? [input.sourceFolderId, input.limit, input.offset]
      : [input.limit, input.offset]
    const rows = this.db.prepare(
      `SELECT id, source_folder_id, display_name, relative_path, duration_ms,
              size_bytes, created_at_ms, modified_at_ms, quick_fingerprint, availability,
              highest_completed_stage
       FROM media_assets ${condition}
       ORDER BY created_at_ms DESC, modified_at_ms DESC
       LIMIT ? OFFSET ?`
    ).all(...params) as MediaRow[]
    return rows.map(mapMedia)
  }

  markMissingExcept(sourceFolderId: string, canonicalPaths: string[]): void {
    if (canonicalPaths.length === 0) {
      this.db.prepare(
        "UPDATE media_assets SET availability = 'missing', updated_at_ms = ? WHERE source_folder_id = ?"
      ).run(Date.now(), sourceFolderId)
      return
    }

    const seen = new Set(canonicalPaths)
    const rows = this.db.prepare(
      "SELECT id, canonical_path FROM media_assets WHERE source_folder_id = ?"
    ).all(sourceFolderId) as Array<{ id: string; canonical_path: string }>
    const mark = this.db.prepare(
      "UPDATE media_assets SET availability = 'missing', updated_at_ms = ? WHERE id = ?"
    )
    this.db.transaction(() => {
      for (const row of rows) {
        if (!seen.has(row.canonical_path)) mark.run(Date.now(), row.id)
      }
    })()
  }

  replaceTranscript(
    mediaId: string,
    source: TranscriptSource,
    version: string,
    segments: NewTranscriptSegment[]
  ): void {
    const remove = this.db.prepare("DELETE FROM transcript_segments WHERE media_id = ?")
    const insert = this.db.prepare(
      `INSERT INTO transcript_segments(media_id, start_ms, end_ms, text, source, confidence, transcript_version)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    )
    this.db.transaction(() => {
      remove.run(mediaId)
      for (const segment of segments) {
        insert.run(
          mediaId,
          segment.startMs,
          segment.endMs,
          segment.text,
          source,
          segment.confidence ?? null,
          version
        )
      }
    })()
  }

  getTranscript(mediaId: string): TranscriptSegment[] {
    return this.db.prepare(
      `SELECT id, media_id, start_ms, end_ms, text, source, confidence
       FROM transcript_segments WHERE media_id = ? ORDER BY start_ms`
    ).all(mediaId).map((row) => {
      const item = row as {
        id: number; media_id: string; start_ms: number; end_ms: number; text: string;
        source: TranscriptSource; confidence: number | null
      }
      return {
        id: item.id,
        mediaId: item.media_id,
        startMs: item.start_ms,
        endMs: item.end_ms,
        text: item.text,
        source: item.source,
        confidence: item.confidence
      }
    })
  }

  getTranscriptVersion(mediaId: string): string | null {
    const row = this.db.prepare(
      "SELECT transcript_version FROM transcript_segments WHERE media_id = ? LIMIT 1"
    ).get(mediaId) as { transcript_version: string } | undefined
    return row?.transcript_version ?? null
  }

  replaceChunks(mediaId: string, version: string, chunks: NewSearchChunk[]): void {
    const existing = this.db.prepare("SELECT id FROM search_chunks WHERE media_id = ?").all(mediaId) as Array<{ id: number }>
    const removeVector = this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?")
    const removeFts = this.db.prepare("DELETE FROM search_chunks_fts WHERE chunk_id = ?")
    const removeChunks = this.db.prepare("DELETE FROM search_chunks WHERE media_id = ?")
    const insertChunk = this.db.prepare(
      `INSERT INTO search_chunks(media_id, start_ms, end_ms, transcript, chunk_version)
       VALUES (?, ?, ?, ?, ?)`
    )
    const insertFts = this.db.prepare(
      `INSERT INTO search_chunks_fts(chunk_id, title, transcript, summary, tags)
       SELECT ?, display_name, ?, '', '' FROM media_assets WHERE id = ?`
    )
    this.db.transaction(() => {
      for (const row of existing) {
        removeVector.run(row.id)
        removeFts.run(row.id)
      }
      removeChunks.run(mediaId)
      for (const chunk of chunks) {
        const result = insertChunk.run(mediaId, chunk.startMs, chunk.endMs, chunk.transcript, version)
        insertFts.run(Number(result.lastInsertRowid), chunk.transcript, mediaId)
      }
      this.db.prepare(
        "UPDATE media_assets SET highest_completed_stage = 'chunked', updated_at_ms = ? WHERE id = ?"
      ).run(Date.now(), mediaId)
    })()
  }

  countSearchChunks(): number {
    return (this.db.prepare("SELECT COUNT(*) AS count FROM search_chunks").get() as { count: number }).count
  }

  getChunksForEmbedding(mediaId: string): SearchChunkForEmbedding[] {
    return this.db.prepare(
      `SELECT id, media_id, transcript, summary, entities_json, events_json, aliases_json, search_phrases_json
       FROM search_chunks WHERE media_id = ? ORDER BY start_ms`
    ).all(mediaId).map((row) => {
      const item = row as {
        id: number; media_id: string; transcript: string; summary: string | null;
        entities_json: string; events_json: string; aliases_json: string; search_phrases_json: string
      }
      return {
        id: item.id,
        mediaId: item.media_id,
        transcript: item.transcript,
        summary: item.summary,
        entitiesJson: item.entities_json,
        eventsJson: item.events_json,
        aliasesJson: item.aliases_json,
        searchPhrasesJson: item.search_phrases_json
      }
    })
  }

  areCurrentChunks(mediaId: string, chunkIds: number[]): boolean {
    const current = this.db.prepare(
      "SELECT id FROM search_chunks WHERE media_id = ? ORDER BY id"
    ).all(mediaId) as Array<{ id: number }>
    if (current.length !== chunkIds.length) return false
    const expected = [...chunkIds].sort((left, right) => left - right)
    return current.every((chunk, index) => chunk.id === expected[index])
  }

  storeEmbeddings(items: Array<{ chunkId: number; embedding: Float32Array }>, version: string): void {
    const remove = this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?")
    const insert = this.db.prepare(
      "INSERT INTO search_chunk_vectors(chunk_id, embedding) VALUES (?, ?)"
    )
    const update = this.db.prepare("UPDATE search_chunks SET embedding_version = ? WHERE id = ?")
    const exists = this.db.prepare("SELECT 1 FROM search_chunks WHERE id = ?")
    this.db.transaction(() => {
      for (const item of items) {
        if (!exists.get(item.chunkId)) continue
        remove.run(item.chunkId)
        insert.run(BigInt(item.chunkId), Buffer.from(item.embedding.buffer, item.embedding.byteOffset, item.embedding.byteLength))
        update.run(version, item.chunkId)
      }
    })()
  }

  finishEmbedding(mediaId: string): void {
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN enrichment_version IS NOT NULL THEN 1 END) AS enriched
       FROM search_chunks WHERE media_id = ?`
    ).get(mediaId) as { total: number; enriched: number }
    this.setMediaStage(mediaId, row.total > 0 && row.enriched === row.total ? "ready" : "embedded")
  }

  getChunksForEnrichment(mediaId: string): Array<{ id: number; startMs: number; endMs: number; transcript: string }> {
    return this.db.prepare(
      `SELECT id, start_ms, end_ms, transcript FROM search_chunks
       WHERE media_id = ? ORDER BY start_ms`
    ).all(mediaId).map((row) => {
      const item = row as { id: number; start_ms: number; end_ms: number; transcript: string }
      return { id: item.id, startMs: item.start_ms, endMs: item.end_ms, transcript: item.transcript }
    })
  }

  getMediaSummaries(mediaId: string): MediaSummarySection[] {
    const rows = this.db.prepare(
      `SELECT start_ms, end_ms, summary, entities_json, events_json
       FROM search_chunks
       WHERE media_id = ? AND summary IS NOT NULL AND TRIM(summary) <> ''
       ORDER BY start_ms`
    ).all(mediaId) as Array<{
      start_ms: number
      end_ms: number
      summary: string
      entities_json: string
      events_json: string
    }>
    return rows.map((row) => ({
      startMs: row.start_ms,
      endMs: row.end_ms,
      summary: row.summary,
      entities: jsonStringField(row.entities_json, "name"),
      events: jsonStringField(row.events_json, "type")
    }))
  }

  applyEnrichments(mediaId: string, enrichments: EnrichedChunk[], version: string): void {
    const update = this.db.prepare(
      `UPDATE search_chunks SET summary = ?, entities_json = ?, events_json = ?, aliases_json = ?,
                                search_phrases_json = ?, enrichment_confidence = ?, enrichment_version = ?
       WHERE id = ? AND media_id = ?`
    )
    const removeFts = this.db.prepare("DELETE FROM search_chunks_fts WHERE chunk_id = ?")
    const insertFts = this.db.prepare(
      `INSERT INTO search_chunks_fts(chunk_id, title, transcript, summary, tags)
       SELECT sc.id, ma.display_name, sc.transcript, COALESCE(sc.summary, ''), ?
       FROM search_chunks sc JOIN media_assets ma ON ma.id = sc.media_id
       WHERE sc.id = ? AND sc.media_id = ?`
    )
    this.db.transaction(() => {
      for (const enrichment of enrichments) {
        const entities = JSON.stringify(enrichment.entities)
        const events = JSON.stringify(enrichment.events)
        const aliases = JSON.stringify(enrichment.aliases)
        const phrases = JSON.stringify(enrichment.searchPhrases)
        const result = update.run(
          enrichment.summary,
          entities,
          events,
          aliases,
          phrases,
          enrichment.confidence,
          version,
          enrichment.chunkId,
          mediaId
        )
        if (result.changes !== 1) throw new Error(`Enrichment referenced an unknown chunk: ${enrichment.chunkId}`)
        const tags = [
          ...enrichment.entities.flatMap((entity) => [entity.name, entity.type]),
          ...enrichment.events.flatMap((event) => [event.type, event.subject ?? "", event.object ?? ""]),
          ...enrichment.aliases,
          ...enrichment.searchPhrases
        ].filter(Boolean).join(" ")
        removeFts.run(enrichment.chunkId)
        insertFts.run(tags, enrichment.chunkId, mediaId)
      }
    })()
  }

  requeueJob(mediaId: string, stage: JobStage, priority = 0): Job {
    const existing = this.db.prepare("SELECT id FROM jobs WHERE media_id = ? AND stage = ?").get(mediaId, stage) as
      | { id: string }
      | undefined
    if (!existing) return this.enqueueJob(mediaId, stage, priority)
    this.db.prepare(
      `UPDATE jobs SET status = 'queued', priority = MAX(priority, ?), progress = 0,
                       error = NULL, updated_at_ms = ? WHERE id = ?`
    ).run(priority, Date.now(), existing.id)
    return this.getJob(existing.id)
  }

  semanticSearch(
    embedding: Float32Array,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number
  ): LexicalHitRow[] {
    const after = createdAfterMs ?? null
    const before = createdBeforeMs ?? null
    try {
      const rows = this.db.prepare(
        `SELECT sc.id AS chunk_id, sc.media_id, ma.display_name AS title,
                ma.relative_path, ma.created_at_ms,
                sc.start_ms, sc.end_ms, sc.transcript, sc.summary,
                sc.entities_json, sc.events_json, sc.aliases_json,
                ma.availability, vec.distance AS rank
         FROM search_chunk_vectors vec
         JOIN search_chunks sc ON sc.id = vec.chunk_id
         JOIN media_assets ma ON ma.id = sc.media_id
         WHERE vec.embedding MATCH ? AND k = ?
           AND (? = 1 OR ma.availability = 'available')
           AND (? IS NULL OR ma.created_at_ms >= ?)
           AND (? IS NULL OR ma.created_at_ms < ?)
         ORDER BY vec.distance`
      ).all(
        Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
        limit,
        includeMissing ? 1 : 0,
        after,
        after,
        before,
        before
      ) as Array<{
        chunk_id: number; media_id: string; title: string; relative_path: string; created_at_ms: number;
        start_ms: number; end_ms: number;
        transcript: string; summary: string | null; entities_json: string; events_json: string;
        aliases_json: string; availability: "available" | "missing"; rank: number
      }>
      return rows.map((row) => ({
        chunkId: row.chunk_id,
        mediaId: row.media_id,
        title: row.title,
        relativePath: row.relative_path,
        createdAtMs: row.created_at_ms,
        startMs: row.start_ms,
        endMs: row.end_ms,
        transcript: row.transcript,
        summary: row.summary,
        entitiesJson: row.entities_json,
        eventsJson: row.events_json,
        aliasesJson: row.aliases_json,
        availability: row.availability,
        rank: row.rank
      }))
    } catch {
      return []
    }
  }

  lexicalSearch(
    ftsQuery: string,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number
  ): LexicalHitRow[] {
    const after = createdAfterMs ?? null
    const before = createdBeforeMs ?? null
    const rows = this.db.prepare(
      `SELECT sc.id AS chunk_id, sc.media_id, ma.display_name AS title,
              ma.relative_path, ma.created_at_ms,
              sc.start_ms, sc.end_ms, sc.transcript, sc.summary,
              sc.entities_json, sc.events_json, sc.aliases_json,
              ma.availability, bm25(search_chunks_fts, 0.0, 3.0, 2.0, 1.5, 2.0) AS rank
       FROM search_chunks_fts
       JOIN search_chunks sc ON sc.id = search_chunks_fts.chunk_id
       JOIN media_assets ma ON ma.id = sc.media_id
       WHERE search_chunks_fts MATCH ?
         AND (? = 1 OR ma.availability = 'available')
         AND (? IS NULL OR ma.created_at_ms >= ?)
         AND (? IS NULL OR ma.created_at_ms < ?)
       ORDER BY rank
       LIMIT ?`
    ).all(ftsQuery, includeMissing ? 1 : 0, after, after, before, before, limit) as Array<{
      chunk_id: number; media_id: string; title: string; relative_path: string; created_at_ms: number;
      start_ms: number; end_ms: number;
      transcript: string; summary: string | null; entities_json: string; events_json: string;
      aliases_json: string; availability: "available" | "missing"; rank: number
    }>
    return rows.map((row) => ({
      chunkId: row.chunk_id,
      mediaId: row.media_id,
      title: row.title,
      relativePath: row.relative_path,
      createdAtMs: row.created_at_ms,
      startMs: row.start_ms,
      endMs: row.end_ms,
      transcript: row.transcript,
      summary: row.summary,
      entitiesJson: row.entities_json,
      eventsJson: row.events_json,
      aliasesJson: row.aliases_json,
      availability: row.availability,
      rank: row.rank
    }))
  }

  enqueueJob(mediaId: string | null, stage: JobStage, priority = 0): Job {
    const existing = mediaId
      ? this.db.prepare("SELECT id FROM jobs WHERE media_id = ? AND stage = ?").get(mediaId, stage) as
          | { id: string }
          | undefined
      : undefined
    if (existing) {
      this.db.prepare(
        `UPDATE jobs SET status = CASE WHEN status IN ('succeeded', 'running') THEN status ELSE 'queued' END,
                         priority = MAX(priority, ?), updated_at_ms = ?
         WHERE id = ?`
      ).run(priority, Date.now(), existing.id)
      return this.getJob(existing.id)
    }

    const id = randomUUID()
    const now = Date.now()
    this.db.prepare(
      `INSERT INTO jobs(id, media_id, stage, status, priority, created_at_ms, updated_at_ms)
       VALUES (?, ?, ?, 'queued', ?, ?, ?)`
    ).run(id, mediaId, stage, priority, now, now)
    return this.getJob(id)
  }

  getJob(id: string): Job {
    const row = this.db.prepare(
      `SELECT id, media_id, stage, status, priority, progress, attempts, error, created_at_ms, updated_at_ms
       FROM jobs WHERE id = ?`
    ).get(id) as JobRow | undefined
    if (!row) throw new Error(`Unknown job: ${id}`)
    return mapJob(row)
  }

  listJobs(limit = 500): Job[] {
    return (this.db.prepare(
      `SELECT id, media_id, stage, status, priority, progress, attempts, error, created_at_ms, updated_at_ms
       FROM jobs
       ORDER BY CASE status WHEN 'running' THEN 0 WHEN 'failed' THEN 1 WHEN 'queued' THEN 2 ELSE 3 END,
                priority DESC, updated_at_ms DESC
       LIMIT ?`
    ).all(limit) as JobRow[]).map(mapJob)
  }

  claimNextJob(allowedStages?: JobStage[]): Job | null {
    const stageClause = allowedStages?.length
      ? `AND stage IN (${allowedStages.map(() => "?").join(",")})`
      : ""
    const row = this.db.prepare(
      `SELECT id FROM jobs
       WHERE status = 'queued' ${stageClause}
       ORDER BY priority DESC, created_at_ms ASC LIMIT 1`
    ).get(...(allowedStages ?? [])) as { id: string } | undefined
    if (!row) return null
    const now = Date.now()
    const changed = this.db.prepare(
      `UPDATE jobs SET status = 'running', attempts = attempts + 1, updated_at_ms = ?
       WHERE id = ? AND status = 'queued'`
    ).run(now, row.id)
    return changed.changes === 1 ? this.getJob(row.id) : null
  }

  updateJob(id: string, update: { status?: Job["status"]; progress?: number; error?: string | null }): Job {
    const current = this.getJob(id)
    this.db.prepare(
      "UPDATE jobs SET status = ?, progress = ?, error = ?, updated_at_ms = ? WHERE id = ?"
    ).run(
      update.status ?? current.status,
      update.progress ?? current.progress,
      update.error === undefined ? current.error : update.error,
      Date.now(),
      id
    )
    return this.getJob(id)
  }

  cancelJob(mediaId: string, stage: JobStage): void {
    this.db.prepare(
      `UPDATE jobs SET status = 'cancelled', error = NULL, updated_at_ms = ?
       WHERE media_id = ? AND stage = ? AND status IN ('queued', 'paused', 'failed')`
    ).run(Date.now(), mediaId, stage)
  }

  recoverRunningJobs(): number {
    return this.db.prepare(
      `UPDATE jobs SET status = 'queued', error = 'Recovered after an interrupted application session',
                       updated_at_ms = ?
       WHERE status = 'running'`
    ).run(Date.now()).changes
  }

  pauseAllJobs(): void {
    this.db.prepare("UPDATE jobs SET status = 'paused', updated_at_ms = ? WHERE status = 'queued'").run(Date.now())
  }

  resumeAllJobs(): void {
    this.db.prepare("UPDATE jobs SET status = 'queued', updated_at_ms = ? WHERE status = 'paused'").run(Date.now())
  }

  getResourceMode(): ResourceMode {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'resource_mode'").get() as
      | { value_json: string }
      | undefined
    return row ? JSON.parse(row.value_json) as ResourceMode : "normal"
  }

  setResourceMode(mode: ResourceMode): void {
    this.db.prepare(
      `INSERT INTO settings(key, value_json, updated_at_ms) VALUES ('resource_mode', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`
    ).run(JSON.stringify(mode), Date.now())
  }

  getStats(): LibraryStats {
    const row = this.db.prepare(
      `SELECT
         (SELECT COUNT(*) FROM source_folders) AS source_folders,
         COUNT(*) AS total_media,
         COUNT(CASE WHEN availability = 'available' THEN 1 END) AS available_media,
         COUNT(CASE WHEN availability = 'missing' THEN 1 END) AS missing_media,
         COALESCE(SUM(duration_ms), 0) AS total_duration_ms,
         (SELECT COUNT(*) FROM search_chunks) AS searchable_chunks,
         (SELECT COUNT(*) FROM jobs WHERE status IN ('queued', 'paused')) AS queued_jobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'running') AS running_jobs,
         (SELECT COUNT(*) FROM jobs WHERE status = 'failed') AS failed_jobs
       FROM media_assets`
    ).get() as {
      source_folders: number; total_media: number; available_media: number; missing_media: number;
      total_duration_ms: number; searchable_chunks: number; queued_jobs: number; running_jobs: number;
      failed_jobs: number
    }
    return {
      sourceFolders: row.source_folders,
      totalMedia: row.total_media,
      availableMedia: row.available_media,
      missingMedia: row.missing_media,
      totalDurationMs: row.total_duration_ms,
      searchableChunks: row.searchable_chunks,
      queuedJobs: row.queued_jobs,
      runningJobs: row.running_jobs,
      failedJobs: row.failed_jobs
    }
  }
}

const indexStageOrder: Record<IndexStage, number> = {
  discovered: 0,
  probed: 1,
  subtitled: 2,
  transcribed: 2,
  chunked: 3,
  embedded: 4,
  enriched: 5,
  ready: 6
}

function mapSourceFolder(row: SourceFolderRow): SourceFolder {
  return {
    id: row.id,
    path: row.path,
    addedAtMs: row.added_at_ms,
    lastScanAtMs: row.last_scan_at_ms,
    availableMediaCount: row.available_media_count,
    missingMediaCount: row.missing_media_count
  }
}

function mapMedia(row: MediaRow): MediaAsset {
  return {
    id: row.id,
    sourceFolderId: row.source_folder_id,
    displayName: row.display_name,
    relativePath: row.relative_path,
    durationMs: row.duration_ms,
    sizeBytes: row.size_bytes,
    createdAtMs: row.created_at_ms,
    modifiedAtMs: row.modified_at_ms,
    quickFingerprint: row.quick_fingerprint,
    availability: row.availability,
    highestCompletedStage: row.highest_completed_stage
  }
}

function jsonStringField(json: string, field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): string[] => {
      if (typeof item === "string") return [item]
      if (!item || typeof item !== "object") return []
      const value = (item as Record<string, unknown>)[field]
      return typeof value === "string" ? [value] : []
    })
  } catch {
    return []
  }
}

function mapJob(row: JobRow): Job {
  return {
    id: row.id,
    mediaId: row.media_id,
    stage: row.stage,
    status: row.status,
    priority: row.priority,
    progress: row.progress,
    attempts: row.attempts,
    error: row.error,
    createdAtMs: row.created_at_ms,
    updatedAtMs: row.updated_at_ms
  }
}
