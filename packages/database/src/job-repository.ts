import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import {
  defaultProcessingSchedule,
  processingScheduleSchema,
  type Job,
  type JobStage,
  type LibraryStats,
  type ProcessingSchedule,
  type ResourceMode,
  type SharedTranscriptTopic
} from "@vod-search/contracts"
import { mapJob, type JobRow } from "./repository-helpers.js"

export class JobRepository {
  constructor(private readonly db: Database.Database) {}

  private requeueJob(mediaId: string, stage: JobStage, priority = 0): Job {
    const existing = this.db.prepare("SELECT id FROM jobs WHERE media_id = ? AND stage = ?").get(mediaId, stage) as { id: string } | undefined
    if (!existing) return this.enqueueJob(mediaId, stage, priority)
    this.db.prepare(
      `UPDATE jobs SET status = 'queued', priority = MAX(priority, ?), progress = 0,
                       error = NULL, updated_at_ms = ? WHERE id = ?`
    ).run(priority, Date.now(), existing.id)
    return this.getJob(existing.id)
  }

  enqueueJob(mediaId: string | null, stage: JobStage, priority = 0): Job {
    const existing = mediaId
      ? this.db.prepare("SELECT id, status FROM jobs WHERE media_id = ? AND stage = ?").get(mediaId, stage) as
          | { id: string; status: Job["status"] }
          | undefined
      : undefined
    if (existing) {
      this.db.prepare(
        `UPDATE jobs SET status = CASE WHEN status = 'cancelled' THEN 'queued' ELSE status END,
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

  isEnrichmentComplete(mediaId: string, requiredVersion?: string): boolean {
    const staleCondition = requiredVersion
      ? "enrichment_version IS NULL OR enrichment_version <> ?"
      : "enrichment_version IS NULL"
    const row = this.db.prepare(
      `SELECT COUNT(*) AS total,
              COUNT(CASE WHEN ${staleCondition} THEN 1 END) AS pending
       FROM search_chunks WHERE media_id = ?`
    ).get(...(requiredVersion ? [requiredVersion, mediaId] : [mediaId])) as { total: number; pending: number }
    return row.total > 0 && row.pending === 0
  }

  getTopicsForSharing(mediaId: string): { enrichmentVersion: string; topics: SharedTranscriptTopic[] } | null {
    const rows = this.db.prepare(
      `SELECT start_ms, end_ms, summary, entities_json, events_json, aliases_json,
              search_phrases_json, enrichment_confidence, enrichment_version
       FROM search_chunks
       WHERE media_id = ?
       ORDER BY start_ms`
    ).all(mediaId) as Array<{
      start_ms: number
      end_ms: number
      summary: string | null
      entities_json: string
      events_json: string
      aliases_json: string
      search_phrases_json: string
      enrichment_confidence: number | null
      enrichment_version: string | null
    }>
    if (rows.length === 0 || rows.some((row) => !row.summary || !row.enrichment_version || row.enrichment_confidence === null)) {
      return null
    }
    const versions = new Set(rows.map((row) => row.enrichment_version!))
    if (versions.size !== 1) return null
    return {
      enrichmentVersion: rows[0]!.enrichment_version!,
      topics: rows.map((row) => ({
        startMs: row.start_ms,
        endMs: row.end_ms,
        summary: row.summary!,
        entities: JSON.parse(row.entities_json) as SharedTranscriptTopic["entities"],
        events: JSON.parse(row.events_json) as SharedTranscriptTopic["events"],
        aliases: JSON.parse(row.aliases_json) as string[],
        searchPhrases: JSON.parse(row.search_phrases_json) as string[],
        confidence: row.enrichment_confidence!
      }))
    }
  }

  ensureEnrichmentJobs(requiredVersion?: string): number {
    const staleCondition = requiredVersion
      ? "sc.enrichment_version IS NULL OR sc.enrichment_version <> ?"
      : "sc.enrichment_version IS NULL"
    return this.ensureDerivedJobs(
      "enrich",
      `EXISTS (
         SELECT 1 FROM search_chunks sc
         WHERE sc.media_id = ma.id AND (${staleCondition})
       )`,
      requiredVersion ? [requiredVersion] : []
    )
  }

  ensureDiarizationJobs(version: string): number {
    return this.ensureDerivedJobs(
      "diarize",
      `EXISTS (SELECT 1 FROM transcript_segments ts WHERE ts.media_id = ma.id)
       AND NOT EXISTS (
         SELECT 1 FROM speaker_diarization_runs sdr
         WHERE sdr.media_id = ma.id AND sdr.version = ?
       )`,
      [version]
    )
  }

  ensureEmbeddingJobs(requiredEnrichmentVersion?: string, requiredEmbeddingVersion?: string): number {
    const staleCondition = requiredEnrichmentVersion
      ? "sc.enrichment_version IS NULL OR sc.enrichment_version <> ?"
      : "sc.enrichment_version IS NULL"
    const staleEmbeddingCondition = requiredEmbeddingVersion
      ? "sc.embedding_version IS NULL OR sc.embedding_version <> ?"
      : "sc.embedding_version IS NULL"
    return this.ensureDerivedJobs(
      "embed",
      `EXISTS (SELECT 1 FROM search_chunks sc WHERE sc.media_id = ma.id)
       AND NOT EXISTS (
         SELECT 1 FROM search_chunks sc
         WHERE sc.media_id = ma.id AND (${staleCondition})
       )
       AND EXISTS (
         SELECT 1 FROM search_chunks sc
         WHERE sc.media_id = ma.id AND (${staleEmbeddingCondition})
       )`,
      [
        ...(requiredEnrichmentVersion ? [requiredEnrichmentVersion] : []),
        ...(requiredEmbeddingVersion ? [requiredEmbeddingVersion] : [])
      ]
    )
  }

  private ensureDerivedJobs(stage: "diarize" | "embed" | "enrich", prerequisiteSql: string, parameters: unknown[] = []): number {
    const rows = this.db.prepare(
      `SELECT ma.id AS media_id, ma.modified_at_ms
       FROM media_assets ma
       WHERE ma.availability = 'available' AND ${prerequisiteSql}`
    ).all(...parameters) as Array<{ media_id: string; modified_at_ms: number }>
    let queued = 0
    for (const row of rows) {
      const existing = this.db.prepare(
        "SELECT status FROM jobs WHERE media_id = ? AND stage = ?"
      ).get(row.media_id, stage) as { status: Job["status"] } | undefined
      if (!existing || existing.status === "cancelled" || existing.status === "succeeded") {
        this.requeueJob(row.media_id, stage, Math.round(row.modified_at_ms / 1000))
        queued += 1
      }
    }
    return queued
  }

  cancelEmbeddingsBlockedByEnrichment(requiredVersion?: string): number {
    const staleCondition = requiredVersion
      ? "sc.enrichment_version IS NULL OR sc.enrichment_version <> ?"
      : "sc.enrichment_version IS NULL"
    return this.db.prepare(
      `UPDATE jobs AS embedding
       SET status = 'cancelled', progress = 0, error = NULL, updated_at_ms = ?
       WHERE embedding.stage = 'embed'
         AND embedding.status IN ('queued', 'paused')
         AND (
           NOT EXISTS (SELECT 1 FROM search_chunks sc WHERE sc.media_id = embedding.media_id)
           OR EXISTS (
             SELECT 1 FROM search_chunks sc
             WHERE sc.media_id = embedding.media_id AND (${staleCondition})
           )
         )`
    ).run(Date.now(), ...(requiredVersion ? [requiredVersion] : [])).changes
  }

  cancelPendingJobsByStage(stage: "diarize" | "embed" | "enrich"): number {
    return this.db.prepare(
      `UPDATE jobs SET status = 'cancelled', progress = 0, error = NULL, updated_at_ms = ?
       WHERE stage = ? AND status IN ('queued', 'paused')`
    ).run(Date.now(), stage).changes
  }

  cancelTranscriptionsBlockedByFailedProbe(): number {
    return this.db.prepare(
      `UPDATE jobs AS transcription
       SET status = 'cancelled', progress = 0, error = NULL, updated_at_ms = ?
       WHERE transcription.stage = 'transcribe'
         AND transcription.status IN ('queued', 'paused', 'failed')
         AND EXISTS (
           SELECT 1 FROM jobs AS probe
           WHERE probe.media_id = transcription.media_id
             AND probe.stage = 'probe'
             AND probe.status = 'failed'
         )`
    ).run(Date.now()).changes
  }

  getJob(id: string): Job {
    const row = this.db.prepare(
      `SELECT id, media_id, stage, status, priority, progress, attempts, error, created_at_ms, updated_at_ms
       FROM jobs WHERE id = ?`
    ).get(id) as JobRow | undefined
    if (!row) throw new Error(`Unknown job: ${id}`)
    return mapJob(row)
  }

  getMediaJob(mediaId: string, stage: JobStage): Job | null {
    const row = this.db.prepare(
      `SELECT id, media_id, stage, status, priority, progress, attempts, error, created_at_ms, updated_at_ms
       FROM jobs WHERE media_id = ? AND stage = ?`
    ).get(mediaId, stage) as JobRow | undefined
    return row ? mapJob(row) : null
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

  retryJob(id: string): Job {
    const current = this.getJob(id)
    if (current.status !== "failed" && current.status !== "cancelled") return current
    this.db.prepare(
      `UPDATE jobs SET status = 'queued', progress = 0, error = NULL, updated_at_ms = ?
       WHERE id = ?`
    ).run(Date.now(), id)
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

  getClipOutputFolder(): string | null {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'clip_output_folder'").get() as
      | { value_json: string }
      | undefined
    if (!row) return null
    try {
      const value: unknown = JSON.parse(row.value_json)
      return typeof value === "string" && value.length > 0 ? value : null
    } catch {
      return null
    }
  }

  setClipOutputFolder(path: string): string {
    this.db.prepare(
      `INSERT INTO settings(key, value_json, updated_at_ms) VALUES ('clip_output_folder', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`
    ).run(JSON.stringify(path), Date.now())
    return path
  }

  getProcessingSchedule(): ProcessingSchedule {
    const row = this.db.prepare("SELECT value_json FROM settings WHERE key = 'processing_schedule'").get() as
      | { value_json: string }
      | undefined
    if (!row) return processingScheduleSchema.parse(defaultProcessingSchedule)
    try {
      return processingScheduleSchema.parse(JSON.parse(row.value_json))
    } catch {
      return processingScheduleSchema.parse(defaultProcessingSchedule)
    }
  }

  setProcessingSchedule(schedule: ProcessingSchedule): ProcessingSchedule {
    const parsed = processingScheduleSchema.parse(schedule)
    this.db.prepare(
      `INSERT INTO settings(key, value_json, updated_at_ms) VALUES ('processing_schedule', ?, ?)
       ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at_ms = excluded.updated_at_ms`
    ).run(JSON.stringify(parsed), Date.now())
    return parsed
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
