import { randomUUID } from "node:crypto"
import type Database from "better-sqlite3"
import {
  type ProcessingSchedule,
  type IndexStage,
  type Job,
  type JobStage,
  type LibraryStats,
  type MediaAsset,
  type MediaSummarySection,
  type MediaSpeaker,
  type ResourceMode,
  type SharedTranscriptTopic,
  type SourceFolder,
  type SpeakerProfile,
  type SpeakerReviewQueue,
  type TranscriptSegment,
  type TranscriptTopic,
  type EnrichedChunk,
  type TranscriptSource
} from "@vod-search/contracts"
import { JobRepository } from "./job-repository.js"
import { SearchRepository, type LexicalHitRow } from "./search-repository.js"

export type { LexicalHitRow } from "./search-repository.js"
import {
  averageEmbeddings,
  bestProfileMatch,
  bestSuggestion,
  bufferToEmbedding,
  embeddingToBuffer,
  enrichmentTags,
  fallbackSpeakerName,
  indexStageOrder,
  jsonStringField,
  mapMedia,
  mapSourceFolder,
  mapSpeakerProfile,
  normalizeEmbedding,
  type MediaRow,
  type SourceFolderRow,
  type SpeakerProfileRow,
  type SpeakerProfileWithEmbedding
} from "./repository-helpers.js"

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
export interface NewTopicSearchChunk extends NewSearchChunk, Omit<TranscriptTopic, "startSegmentId"> {}

export interface NewDiarizedSpeaker {
  label: string
  embedding: number[]
}

export interface NewSpeakerTurn {
  label: string
  startMs: number
  endMs: number
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

export class Repository {
  private readonly jobs: JobRepository
  private readonly search: SearchRepository

  constructor(private readonly db: Database.Database) {
    this.jobs = new JobRepository(db)
    this.search = new SearchRepository(db)
  }

  addSourceFolder(path: string, canonicalPath: string, publishSharedMetadata = false): SourceFolder {
    const existing = this.db.prepare("SELECT id FROM source_folders WHERE canonical_path = ?").get(canonicalPath) as
      | { id: string }
      | undefined
    if (existing) {
      if (publishSharedMetadata) this.setSourceFolderSharing(existing.id, true)
      return this.getSourceFolder(existing.id)
    }

    const id = randomUUID()
    this.db.prepare(
      `INSERT INTO source_folders(id, path, canonical_path, added_at_ms, publish_shared_metadata)
       VALUES (?, ?, ?, ?, ?)`
    ).run(id, path, canonicalPath, Date.now(), publishSharedMetadata ? 1 : 0)
    return this.getSourceFolder(id)
  }

  getSourceFolder(id: string): SourceFolder {
    const row = this.db.prepare(
      `SELECT sf.id, sf.path, sf.added_at_ms, sf.last_scan_at_ms, sf.publish_shared_metadata,
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
      `SELECT sf.id, sf.path, sf.added_at_ms, sf.last_scan_at_ms, sf.publish_shared_metadata,
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

  removeSourceFolder(id: string): void {
    this.getSourceFolder(id)
    const affectedProfiles = this.db.prepare(
      `SELECT DISTINCT ms.profile_id
       FROM media_speakers ms
       JOIN media_assets ma ON ma.id = ms.media_id
       WHERE ma.source_folder_id = ? AND ms.profile_id IS NOT NULL`
    ).all(id) as Array<{ profile_id: string }>
    const chunkRows = this.db.prepare(
      `SELECT sc.id
       FROM search_chunks sc
       JOIN media_assets ma ON ma.id = sc.media_id
       WHERE ma.source_folder_id = ?`
    ).all(id) as Array<{ id: number }>
    const vectorTable = this.db.prepare(
      "SELECT 1 FROM sqlite_master WHERE name = 'search_chunk_vectors'"
    ).get() as { 1: number } | undefined
    const removeVector = vectorTable ? this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?") : null
    const removeFts = this.db.prepare("DELETE FROM search_chunks_fts WHERE chunk_id = ?")
    this.db.transaction(() => {
      for (const row of chunkRows) {
        removeVector?.run(row.id)
        removeFts.run(row.id)
      }
      this.db.prepare("DELETE FROM source_folders WHERE id = ?").run(id)
      for (const profile of affectedProfiles) this.recomputeSpeakerProfile(profile.profile_id)
    })()
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
      const affectedProfiles = this.db.prepare(
        "SELECT DISTINCT profile_id FROM media_speakers WHERE media_id = ? AND profile_id IS NOT NULL"
      ).all(mediaId) as Array<{ profile_id: string }>
      this.db.prepare("DELETE FROM speaker_diarization_runs WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM media_speakers WHERE media_id = ?").run(mediaId)
      for (const profile of affectedProfiles) this.recomputeSpeakerProfile(profile.profile_id)
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
      `SELECT ts.id, ts.media_id, ts.start_ms, ts.end_ms, ts.text, ts.source, ts.confidence,
              (
                SELECT st.media_speaker_id
                FROM speaker_turns st
                WHERE st.media_id = ts.media_id
                  AND st.end_ms > ts.start_ms
                  AND st.start_ms < ts.end_ms
                ORDER BY MIN(st.end_ms, ts.end_ms) - MAX(st.start_ms, ts.start_ms) DESC
                LIMIT 1
              ) AS media_speaker_id
       FROM transcript_segments ts WHERE ts.media_id = ? ORDER BY ts.start_ms`
    ).all(mediaId).map((row) => {
      const item = row as {
        id: number; media_id: string; start_ms: number; end_ms: number; text: string;
        source: TranscriptSource; confidence: number | null; media_speaker_id: number | null
      }
      return {
        id: item.id,
        mediaId: item.media_id,
        startMs: item.start_ms,
        endMs: item.end_ms,
        text: item.text,
        source: item.source,
        confidence: item.confidence,
        mediaSpeakerId: item.media_speaker_id
      }
    })
  }

  replaceSpeakerDiarization(
    mediaId: string,
    version: string,
    speakers: NewDiarizedSpeaker[],
    turns: NewSpeakerTurn[]
  ): void {
    const previous = this.db.prepare(
      `SELECT profile_id, embedding FROM media_speakers
       WHERE media_id = ? AND profile_id IS NOT NULL`
    ).all(mediaId) as Array<{ profile_id: string; embedding: Buffer }>
    const affectedProfiles = new Set(previous.map((speaker) => speaker.profile_id))
    const stats = new Map<string, { speechMs: number; turnCount: number; firstStartMs: number }>()
    for (const turn of turns) {
      if (turn.endMs <= turn.startMs) continue
      const current = stats.get(turn.label) ?? { speechMs: 0, turnCount: 0, firstStartMs: turn.startMs }
      current.speechMs += turn.endMs - turn.startMs
      current.turnCount += 1
      current.firstStartMs = Math.min(current.firstStartMs, turn.startMs)
      stats.set(turn.label, current)
    }

    this.db.transaction(() => {
      this.db.prepare("DELETE FROM speaker_diarization_runs WHERE media_id = ?").run(mediaId)
      this.db.prepare("DELETE FROM media_speakers WHERE media_id = ?").run(mediaId)
      const insertSpeaker = this.db.prepare(
        `INSERT INTO media_speakers(
          media_id, diarization_label, profile_id, embedding, speech_ms, turn_count, first_start_ms
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`
      )
      const speakerIds = new Map<string, number>()
      for (const speaker of speakers) {
        const embedding = normalizeEmbedding(speaker.embedding)
        const preserved = bestProfileMatch(embedding, previous, 0.8)
        const speakerStats = stats.get(speaker.label) ?? { speechMs: 0, turnCount: 0, firstStartMs: 0 }
        const result = insertSpeaker.run(
          mediaId,
          speaker.label,
          preserved,
          embeddingToBuffer(embedding),
          speakerStats.speechMs,
          speakerStats.turnCount,
          speakerStats.firstStartMs
        )
        speakerIds.set(speaker.label, Number(result.lastInsertRowid))
        if (preserved) affectedProfiles.add(preserved)
      }
      const insertTurn = this.db.prepare(
        `INSERT INTO speaker_turns(media_id, media_speaker_id, start_ms, end_ms)
         VALUES (?, ?, ?, ?)`
      )
      for (const turn of turns) {
        const speakerId = speakerIds.get(turn.label)
        if (speakerId && turn.endMs > turn.startMs) insertTurn.run(mediaId, speakerId, turn.startMs, turn.endMs)
      }
      this.db.prepare(
        `INSERT INTO speaker_diarization_runs(media_id, version, completed_at_ms) VALUES (?, ?, ?)`
      ).run(mediaId, version, Date.now())
      for (const profileId of affectedProfiles) this.recomputeSpeakerProfile(profileId)
    })()
  }

  getDiarizationVersion(mediaId: string): string | null {
    const row = this.db.prepare(
      "SELECT version FROM speaker_diarization_runs WHERE media_id = ?"
    ).get(mediaId) as { version: string } | undefined
    return row?.version ?? null
  }

  getMediaSpeakers(mediaId: string): MediaSpeaker[] {
    const profiles = this.listSpeakerProfilesWithEmbeddings()
    const rows = this.db.prepare(
      `SELECT ms.id, ms.media_id, ms.diarization_label, ms.profile_id, ms.embedding,
              ms.speech_ms, ms.turn_count, ms.first_start_ms, sp.name AS profile_name
       FROM media_speakers ms
       LEFT JOIN speaker_profiles sp ON sp.id = ms.profile_id
       WHERE ms.media_id = ?
       ORDER BY ms.speech_ms DESC, ms.first_start_ms ASC`
    ).all(mediaId) as Array<{
      id: number; media_id: string; diarization_label: string; profile_id: string | null;
      embedding: Buffer; speech_ms: number; turn_count: number; first_start_ms: number;
      profile_name: string | null
    }>
    return rows.map((row, index) => {
      const embedding = bufferToEmbedding(row.embedding)
      const suggestion = row.profile_id ? null : bestSuggestion(embedding, profiles, 0.72)
      return {
        id: row.id,
        mediaId: row.media_id,
        diarizationLabel: row.diarization_label,
        profileId: row.profile_id,
        displayName: row.profile_name ?? `Speaker ${index + 1}`,
        speechMs: row.speech_ms,
        turnCount: row.turn_count,
        firstStartMs: row.first_start_ms,
        suggestedProfileId: suggestion?.profile.id ?? null,
        suggestionScore: suggestion?.score ?? null
      }
    })
  }

  getSpeakerReviewQueue(limit = 500): SpeakerReviewQueue {
    const candidates = this.listSpeakerProfilesWithEmbeddings()
    const rows = this.db.prepare(
      `SELECT ms.id, ms.media_id, ms.diarization_label, ms.embedding,
              ms.speech_ms, ms.turn_count, ms.first_start_ms,
              ma.display_name AS media_title, ma.relative_path, ma.created_at_ms,
              COALESCE((
                SELECT sample_turn.start_ms
                FROM speaker_turns sample_turn
                JOIN transcript_segments ts ON ts.media_id = sample_turn.media_id
                  AND ts.end_ms > sample_turn.start_ms
                  AND ts.start_ms < sample_turn.end_ms
                WHERE sample_turn.media_speaker_id = ms.id
                ORDER BY sample_turn.start_ms, ts.start_ms
                LIMIT 1
              ), ms.first_start_ms) AS sample_start_ms,
              COALESCE((
                SELECT sample_turn.end_ms
                FROM speaker_turns sample_turn
                JOIN transcript_segments ts ON ts.media_id = sample_turn.media_id
                  AND ts.end_ms > sample_turn.start_ms
                  AND ts.start_ms < sample_turn.end_ms
                WHERE sample_turn.media_speaker_id = ms.id
                ORDER BY sample_turn.start_ms, ts.start_ms
                LIMIT 1
              ), ms.first_start_ms + MAX(1, MIN(ms.speech_ms, 12000))) AS sample_end_ms,
              (
                SELECT ts.text
                FROM speaker_turns sample_turn
                JOIN transcript_segments ts ON ts.media_id = sample_turn.media_id
                  AND ts.end_ms > sample_turn.start_ms
                  AND ts.start_ms < sample_turn.end_ms
                WHERE sample_turn.media_speaker_id = ms.id
                ORDER BY sample_turn.start_ms, ts.start_ms
                LIMIT 1
              ) AS sample_text
       FROM media_speakers ms
       JOIN media_assets ma ON ma.id = ms.media_id
       WHERE ms.profile_id IS NULL AND ma.availability = 'available'
       ORDER BY ma.created_at_ms DESC, ms.speech_ms DESC
       LIMIT ?`
    ).all(Math.max(1, Math.min(500, limit))) as Array<{
      id: number; media_id: string; diarization_label: string; embedding: Buffer;
      speech_ms: number; turn_count: number; first_start_ms: number;
      media_title: string; relative_path: string; created_at_ms: number;
      sample_start_ms: number; sample_end_ms: number; sample_text: string | null
    }>
    const items = rows.map((row) => {
      const suggestion = bestSuggestion(bufferToEmbedding(row.embedding), candidates, 0.72)
      return {
        id: row.id,
        mediaId: row.media_id,
        diarizationLabel: row.diarization_label,
        profileId: null,
        displayName: fallbackSpeakerName(row.diarization_label),
        speechMs: row.speech_ms,
        turnCount: row.turn_count,
        firstStartMs: row.first_start_ms,
        suggestedProfileId: suggestion?.profile.id ?? null,
        suggestionScore: suggestion?.score ?? null,
        mediaTitle: row.media_title,
        relativePath: row.relative_path,
        mediaCreatedAtMs: row.created_at_ms,
        sampleStartMs: row.sample_start_ms,
        sampleEndMs: row.sample_end_ms,
        sampleText: row.sample_text
      }
    }).sort((left, right) =>
      Number(Boolean(right.suggestedProfileId)) - Number(Boolean(left.suggestedProfileId)) ||
      right.mediaCreatedAtMs - left.mediaCreatedAtMs ||
      right.speechMs - left.speechMs
    )
    return { items, profiles: this.listSpeakerProfiles() }
  }

  listSpeakerProfiles(): SpeakerProfile[] {
    return this.db.prepare(
      `SELECT id, name, sample_count, created_at_ms, updated_at_ms
       FROM speaker_profiles ORDER BY name COLLATE NOCASE`
    ).all().map((row) => mapSpeakerProfile(row as SpeakerProfileRow))
  }

  createSpeakerProfile(mediaSpeakerId: number, name: string): SpeakerProfile {
    const id = randomUUID()
    const now = Date.now()
    this.db.transaction(() => {
      this.db.prepare(
        `INSERT INTO speaker_profiles(id, name, sample_count, created_at_ms, updated_at_ms)
         VALUES (?, ?, 0, ?, ?)`
      ).run(id, name.trim(), now, now)
      this.assignMediaSpeakerProfile(mediaSpeakerId, id)
    })()
    return this.getSpeakerProfile(id)
  }

  assignMediaSpeakerProfile(mediaSpeakerId: number, profileId: string | null): void {
    const current = this.db.prepare(
      "SELECT profile_id FROM media_speakers WHERE id = ?"
    ).get(mediaSpeakerId) as { profile_id: string | null } | undefined
    if (!current) throw new Error(`Unknown detected speaker: ${mediaSpeakerId}`)
    if (profileId) this.getSpeakerProfile(profileId)
    this.db.prepare("UPDATE media_speakers SET profile_id = ? WHERE id = ?").run(profileId, mediaSpeakerId)
    if (current.profile_id) this.recomputeSpeakerProfile(current.profile_id)
    if (profileId) this.recomputeSpeakerProfile(profileId)
  }

  renameSpeakerProfile(profileId: string, name: string): SpeakerProfile {
    const result = this.db.prepare(
      "UPDATE speaker_profiles SET name = ?, updated_at_ms = ? WHERE id = ?"
    ).run(name.trim(), Date.now(), profileId)
    if (result.changes !== 1) throw new Error(`Unknown speaker profile: ${profileId}`)
    return this.getSpeakerProfile(profileId)
  }

  private getSpeakerProfile(profileId: string): SpeakerProfile {
    const row = this.db.prepare(
      `SELECT id, name, sample_count, created_at_ms, updated_at_ms
       FROM speaker_profiles WHERE id = ?`
    ).get(profileId) as SpeakerProfileRow | undefined
    if (!row) throw new Error(`Unknown speaker profile: ${profileId}`)
    return mapSpeakerProfile(row)
  }

  private listSpeakerProfilesWithEmbeddings(): SpeakerProfileWithEmbedding[] {
    const rows = this.db.prepare(
      `SELECT id, name, embedding, sample_count, created_at_ms, updated_at_ms
       FROM speaker_profiles WHERE embedding IS NOT NULL
       ORDER BY name COLLATE NOCASE`
    ).all() as Array<SpeakerProfileRow & { embedding: Buffer }>
    return rows.map((row) => ({
      profile: mapSpeakerProfile(row),
      embedding: bufferToEmbedding(row.embedding)
    }))
  }

  private recomputeSpeakerProfile(profileId: string): void {
    const rows = this.db.prepare(
      "SELECT embedding FROM media_speakers WHERE profile_id = ? ORDER BY id"
    ).all(profileId) as Array<{ embedding: Buffer }>
    const embeddings = rows.map((row) => bufferToEmbedding(row.embedding)).filter((embedding) => embedding.length > 0)
    const centroid = averageEmbeddings(embeddings)
    this.db.prepare(
      `UPDATE speaker_profiles
       SET embedding = ?, sample_count = ?, updated_at_ms = ?
       WHERE id = ?`
    ).run(centroid ? embeddingToBuffer(centroid) : null, embeddings.length, Date.now(), profileId)
  }

  ensureDiarizationJobs(version: string): number {
    return this.jobs.ensureDiarizationJobs(version)
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

  getTranscriptSegmentsInRange(mediaId: string, startMs: number, endMs: number): Array<Pick<TranscriptSegment, "startMs" | "endMs" | "text">> {
    return this.db.prepare(
      `SELECT start_ms, end_ms, text
       FROM transcript_segments
       WHERE media_id = ? AND end_ms >= ? AND start_ms <= ?
       ORDER BY start_ms`
    ).all(mediaId, startMs, endMs).map((row) => {
      const item = row as { start_ms: number; end_ms: number; text: string }
      return { startMs: item.start_ms, endMs: item.end_ms, text: item.text }
    })
  }

  setSourceFolderSharing(id: string, publishSharedMetadata: boolean): void {
    const result = this.db.prepare(
      "UPDATE source_folders SET publish_shared_metadata = ? WHERE id = ?"
    ).run(publishSharedMetadata ? 1 : 0, id)
    if (result.changes !== 1) throw new Error(`Unknown source folder: ${id}`)
  }

  replaceChunksWithTopics(mediaId: string, chunks: NewTopicSearchChunk[], enrichmentVersion: string): void {
    if (chunks.length === 0) throw new Error("At least one topic is required")
    const existing = this.db.prepare("SELECT id FROM search_chunks WHERE media_id = ?").all(mediaId) as Array<{ id: number }>
    const removeVector = this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?")
    const removeFts = this.db.prepare("DELETE FROM search_chunks_fts WHERE chunk_id = ?")
    const removeChunks = this.db.prepare("DELETE FROM search_chunks WHERE media_id = ?")
    const insertChunk = this.db.prepare(
      `INSERT INTO search_chunks(
         media_id, start_ms, end_ms, transcript, summary, entities_json, events_json,
         aliases_json, search_phrases_json, enrichment_confidence, chunk_version, enrichment_version
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    const insertFts = this.db.prepare(
      `INSERT INTO search_chunks_fts(chunk_id, title, transcript, summary, tags)
       SELECT ?, display_name, ?, ?, ? FROM media_assets WHERE id = ?`
    )
    this.db.transaction(() => {
      for (const row of existing) {
        removeVector.run(row.id)
        removeFts.run(row.id)
      }
      removeChunks.run(mediaId)
      for (const chunk of chunks) {
        const result = insertChunk.run(
          mediaId,
          chunk.startMs,
          chunk.endMs,
          chunk.transcript,
          chunk.summary,
          JSON.stringify(chunk.entities),
          JSON.stringify(chunk.events),
          JSON.stringify(chunk.aliases),
          JSON.stringify(chunk.searchPhrases),
          chunk.confidence,
          "topic-v2",
          enrichmentVersion
        )
        const chunkId = Number(result.lastInsertRowid)
        insertFts.run(chunkId, chunk.transcript, chunk.summary, enrichmentTags(chunk), mediaId)
      }
      this.db.prepare(
        "UPDATE media_assets SET highest_completed_stage = 'enriched', updated_at_ms = ? WHERE id = ?"
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
                                search_phrases_json = ?, enrichment_confidence = ?, enrichment_version = ?,
                                embedding_version = NULL
       WHERE id = ? AND media_id = ?`
    )
    const removeVector = this.db.prepare("DELETE FROM search_chunk_vectors WHERE chunk_id = ?")
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
        removeVector.run(enrichment.chunkId)
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

  semanticSearch(embedding: Float32Array, includeMissing: boolean, limit: number, createdAfterMs?: number, createdBeforeMs?: number, mediaIds?: string[]): LexicalHitRow[] {
    return this.search.semanticSearch(embedding, includeMissing, limit, createdAfterMs, createdBeforeMs, mediaIds)
  }

  lexicalSearch(ftsQuery: string, includeMissing: boolean, limit: number, createdAfterMs?: number, createdBeforeMs?: number, mediaIds?: string[]): LexicalHitRow[] {
    return this.search.lexicalSearch(ftsQuery, includeMissing, limit, createdAfterMs, createdBeforeMs, mediaIds)
  }

  enqueueJob(mediaId: string | null, stage: JobStage, priority = 0): Job { return this.jobs.enqueueJob(mediaId, stage, priority) }
  isEnrichmentComplete(mediaId: string, requiredVersion?: string): boolean { return this.jobs.isEnrichmentComplete(mediaId, requiredVersion) }
  getTopicsForSharing(mediaId: string): { enrichmentVersion: string; topics: SharedTranscriptTopic[] } | null { return this.jobs.getTopicsForSharing(mediaId) }
  ensureEnrichmentJobs(requiredVersion?: string): number { return this.jobs.ensureEnrichmentJobs(requiredVersion) }
  ensureEmbeddingJobs(requiredEnrichmentVersion?: string, requiredEmbeddingVersion?: string): number { return this.jobs.ensureEmbeddingJobs(requiredEnrichmentVersion, requiredEmbeddingVersion) }
  cancelEmbeddingsBlockedByEnrichment(requiredVersion?: string): number { return this.jobs.cancelEmbeddingsBlockedByEnrichment(requiredVersion) }
  cancelPendingJobsByStage(stage: "diarize" | "embed" | "enrich"): number { return this.jobs.cancelPendingJobsByStage(stage) }
  cancelTranscriptionsBlockedByFailedProbe(): number { return this.jobs.cancelTranscriptionsBlockedByFailedProbe() }
  getJob(id: string): Job { return this.jobs.getJob(id) }
  getMediaJob(mediaId: string, stage: JobStage): Job | null { return this.jobs.getMediaJob(mediaId, stage) }
  listJobs(limit = 500): Job[] { return this.jobs.listJobs(limit) }
  claimNextJob(allowedStages?: JobStage[]): Job | null { return this.jobs.claimNextJob(allowedStages) }
  updateJob(id: string, update: { status?: Job["status"]; progress?: number; error?: string | null }): Job { return this.jobs.updateJob(id, update) }
  retryJob(id: string): Job { return this.jobs.retryJob(id) }
  cancelJob(mediaId: string, stage: JobStage): void { this.jobs.cancelJob(mediaId, stage) }
  recoverRunningJobs(): number { return this.jobs.recoverRunningJobs() }
  pauseAllJobs(): void { this.jobs.pauseAllJobs() }
  resumeAllJobs(): void { this.jobs.resumeAllJobs() }
  getResourceMode(): ResourceMode { return this.jobs.getResourceMode() }
  setResourceMode(mode: ResourceMode): void { this.jobs.setResourceMode(mode) }
  getClipOutputFolder(): string | null { return this.jobs.getClipOutputFolder() }
  setClipOutputFolder(path: string): string { return this.jobs.setClipOutputFolder(path) }
  getProcessingSchedule(): ProcessingSchedule { return this.jobs.getProcessingSchedule() }
  setProcessingSchedule(schedule: ProcessingSchedule): ProcessingSchedule { return this.jobs.setProcessingSchedule(schedule) }
  getStats(): LibraryStats { return this.jobs.getStats() }
}
