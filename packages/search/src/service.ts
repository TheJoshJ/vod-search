import type { SearchHit, SearchRequest, SearchResponse } from "@vod-search/contracts"

export interface LexicalSearchRecord {
  chunkId: number
  mediaId: string
  title: string
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

export interface SearchRepository {
  lexicalSearch(query: string, includeMissing: boolean, limit: number): LexicalSearchRecord[]
  countSearchChunks(): number
  semanticSearch?(embedding: Float32Array, includeMissing: boolean, limit: number): LexicalSearchRecord[]
}

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  search(request: SearchRequest, semanticEmbedding?: Float32Array): SearchResponse {
    const startedAt = performance.now()
    const { toFtsQuery } = requireQueryHelpers()
    const lexical = this.repository.lexicalSearch(toFtsQuery(request.query), request.includeMissing, 100)
    const semantic = semanticEmbedding && this.repository.semanticSearch
      ? this.repository.semanticSearch(semanticEmbedding, request.includeMissing, 100)
      : []
    const queryLower = request.query.toLocaleLowerCase("en-US")

    const lexicalRanks = new Map(lexical.map((row, index) => [row.chunkId, index + 1]))
    const semanticRanks = new Map(semantic.map((row, index) => [row.chunkId, index + 1]))
    const candidates = new Map<number, LexicalSearchRecord>()
    for (const row of lexical) candidates.set(row.chunkId, row)
    for (const row of semantic) candidates.set(row.chunkId, row)

    const hits = [...candidates.values()].map((row): SearchHit => {
      const entities = parseStringValues(row.entitiesJson, "name")
      const events = parseStringValues(row.eventsJson, "type")
      const aliases = parseStringValues(row.aliasesJson)
      const searchable = [row.title, row.transcript, row.summary ?? "", ...entities, ...events, ...aliases]
        .join(" ")
        .toLocaleLowerCase("en-US")
      const exact = searchable.includes(queryLower)

      const lexicalRank = lexicalRanks.get(row.chunkId)
      const semanticRank = semanticRanks.get(row.chunkId)
      const score = (lexicalRank ? 1 / (60 + lexicalRank) : 0) +
        (semanticRank ? 0.8 / (60 + semanticRank) : 0) +
        (exact ? 0.02 : 0)
      const matchReasons: SearchHit["matchReasons"] = []
      if (exact) matchReasons.push("exact")
      if (lexicalRank) matchReasons.push("transcript")
      if (semanticRank) matchReasons.push("semantic")
      return {
        mediaId: row.mediaId,
        title: row.title,
        startMs: row.startMs,
        endMs: row.endMs,
        transcriptExcerpt: excerpt(row.transcript, request.query),
        summary: row.summary,
        entities,
        events,
        availability: row.availability,
        matchReasons,
        score
      }
    }).sort((a, b) => b.score - a.score)

    const merged = mergeNearbyHits(hits).slice(0, request.limit)
    return {
      hits: merged,
      elapsedMs: performance.now() - startedAt,
      indexedChunkCount: this.repository.countSearchChunks()
    }
  }
}

// Kept as a local indirection so SearchService remains easy to construct in
// tests without dependency injection ceremony.
function requireQueryHelpers(): typeof import("./query.js") {
  return queryHelpers
}

import * as queryHelpers from "./query.js"

function parseStringValues(json: string, objectKey?: string): string[] {
  try {
    const value: unknown = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return value.flatMap((item): string[] => {
      if (typeof item === "string") return [item]
      if (objectKey && item && typeof item === "object" && objectKey in item) {
        const candidate = (item as Record<string, unknown>)[objectKey]
        return typeof candidate === "string" ? [candidate] : []
      }
      return []
    })
  } catch {
    return []
  }
}

function excerpt(transcript: string, query: string): string {
  if (transcript.length <= 280) return transcript
  const matchAt = transcript.toLocaleLowerCase("en-US").indexOf(query.toLocaleLowerCase("en-US"))
  const start = Math.max(0, (matchAt >= 0 ? matchAt : 0) - 100)
  const end = Math.min(transcript.length, start + 280)
  return `${start > 0 ? "…" : ""}${transcript.slice(start, end).trim()}${end < transcript.length ? "…" : ""}`
}

function mergeNearbyHits(hits: SearchHit[]): SearchHit[] {
  const sorted = [...hits].sort((a, b) => b.score - a.score)
  const accepted: SearchHit[] = []
  for (const hit of sorted) {
    const duplicate = accepted.some(
      (candidate) => candidate.mediaId === hit.mediaId && Math.abs(candidate.startMs - hit.startMs) <= 15_000
    )
    if (!duplicate) accepted.push(hit)
  }
  return accepted
}
