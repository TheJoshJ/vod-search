import type Database from "better-sqlite3"

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
  searchPhrasesJson: string
  availability: "available" | "missing"
  rank: number
}

export class SearchRepository {
  constructor(private readonly db: Database.Database) {}

  semanticSearch(
    embedding: Float32Array,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number,
    mediaIds?: string[]
  ): LexicalHitRow[] {
    const after = createdAfterMs ?? null
    const before = createdBeforeMs ?? null
    const selectedMedia = mediaIds?.filter(Boolean) ?? []
    const mediaCondition = selectedMedia.length > 0
      ? `AND ma.id IN (${selectedMedia.map(() => "?").join(", ")})`
      : ""
    const neighborCount = selectedMedia.length > 0 ? Math.max(limit, 1_000) : limit
    const rows = this.db.prepare(
      `SELECT sc.id AS chunk_id, sc.media_id, ma.display_name AS title,
              ma.relative_path, ma.created_at_ms,
              sc.start_ms, sc.end_ms, sc.transcript, sc.summary,
              sc.entities_json, sc.events_json, sc.aliases_json, sc.search_phrases_json,
              ma.availability, vec.distance AS rank
       FROM search_chunk_vectors vec
       JOIN search_chunks sc ON sc.id = vec.chunk_id
       JOIN media_assets ma ON ma.id = sc.media_id
       WHERE vec.embedding MATCH ? AND k = ?
         AND (? = 1 OR ma.availability = 'available')
         AND (? IS NULL OR ma.created_at_ms >= ?)
         AND (? IS NULL OR ma.created_at_ms < ?)
         ${mediaCondition}
       ORDER BY vec.distance
       LIMIT ?`
    ).all(
      Buffer.from(embedding.buffer, embedding.byteOffset, embedding.byteLength),
      neighborCount,
      includeMissing ? 1 : 0,
      after,
      after,
      before,
      before,
      ...selectedMedia,
      limit
    ) as Array<{
      chunk_id: number; media_id: string; title: string; relative_path: string; created_at_ms: number;
      start_ms: number; end_ms: number;
      transcript: string; summary: string | null; entities_json: string; events_json: string;
      aliases_json: string; search_phrases_json: string; availability: "available" | "missing"; rank: number
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
      searchPhrasesJson: row.search_phrases_json,
      availability: row.availability,
      rank: row.rank
    }))
  }

  lexicalSearch(
    ftsQuery: string,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number,
    mediaIds?: string[]
  ): LexicalHitRow[] {
    const after = createdAfterMs ?? null
    const before = createdBeforeMs ?? null
    const selectedMedia = mediaIds?.filter(Boolean) ?? []
    const mediaCondition = selectedMedia.length > 0
      ? `AND ma.id IN (${selectedMedia.map(() => "?").join(", ")})`
      : ""
    const rows = this.db.prepare(
      `SELECT sc.id AS chunk_id, sc.media_id, ma.display_name AS title,
              ma.relative_path, ma.created_at_ms,
              sc.start_ms, sc.end_ms, sc.transcript, sc.summary,
              sc.entities_json, sc.events_json, sc.aliases_json, sc.search_phrases_json,
              ma.availability, bm25(search_chunks_fts, 0.0, 3.0, 2.0, 1.5, 2.0) AS rank
       FROM search_chunks_fts
       JOIN search_chunks sc ON sc.id = search_chunks_fts.chunk_id
       JOIN media_assets ma ON ma.id = sc.media_id
       WHERE search_chunks_fts MATCH ?
         AND (? = 1 OR ma.availability = 'available')
         AND (? IS NULL OR ma.created_at_ms >= ?)
         AND (? IS NULL OR ma.created_at_ms < ?)
         ${mediaCondition}
       ORDER BY rank
       LIMIT ?`
    ).all(ftsQuery, includeMissing ? 1 : 0, after, after, before, before, ...selectedMedia, limit) as Array<{
      chunk_id: number; media_id: string; title: string; relative_path: string; created_at_ms: number;
      start_ms: number; end_ms: number;
      transcript: string; summary: string | null; entities_json: string; events_json: string;
      aliases_json: string; search_phrases_json: string; availability: "available" | "missing"; rank: number
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
      searchPhrasesJson: row.search_phrases_json,
      availability: row.availability,
      rank: row.rank
    }))
  }
}

