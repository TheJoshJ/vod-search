import type { SearchHit, SearchRequest, SearchResponse } from "@vod-search/contracts"
import { analyzeTextMatch, findBestTimedText, isCoherentTextMatch, type TimedText } from "./relevance.js"
import { lexicalRankQuality, scoreSearchResult, semanticDistanceQuality, textMatchQuality } from "./scoring.js"

export interface LexicalSearchRecord {
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

export interface SearchRepository {
  lexicalSearch(
    query: string,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number,
    mediaIds?: string[]
  ): LexicalSearchRecord[]
  countSearchChunks(): number
  getTranscriptSegmentsInRange?(mediaId: string, startMs: number, endMs: number): TimedText[]
  semanticSearch?(
    embedding: Float32Array,
    includeMissing: boolean,
    limit: number,
    createdAfterMs?: number,
    createdBeforeMs?: number,
    mediaIds?: string[]
  ): LexicalSearchRecord[]
}

export class SearchService {
  constructor(private readonly repository: SearchRepository) {}

  search(request: SearchRequest, semanticEmbedding?: Float32Array): SearchResponse {
    const startedAt = performance.now()
    const { toFtsQuery } = requireQueryHelpers()
    const lexical = request.mode === "semantic" ? [] : this.repository.lexicalSearch(
      toFtsQuery(request.query),
      request.includeMissing,
      100,
      request.createdAfterMs,
      request.createdBeforeMs,
      request.mediaIds
    )
    const semantic = request.mode !== "keyword" && semanticEmbedding && this.repository.semanticSearch
      ? this.repository.semanticSearch(
          semanticEmbedding,
          request.includeMissing,
          100,
          request.createdAfterMs,
          request.createdBeforeMs,
          request.mediaIds
        )
      : []
    const lexicalRanks = new Map(lexical.map((row, index) => [row.chunkId, index + 1]))
    const semanticDistances = new Map(semantic.map((row) => [row.chunkId, row.rank]))
    const candidates = new Map<number, LexicalSearchRecord>()
    for (const row of lexical) candidates.set(row.chunkId, row)
    for (const row of semantic) candidates.set(row.chunkId, row)

    const hits = [...candidates.values()].flatMap((row): SearchHit[] => {
      const entities = parseStringValues(row.entitiesJson, "name")
      const events = parseStringValues(row.eventsJson, "type")
      const aliases = parseStringValues(row.aliasesJson)
      const searchPhrases = parseStringValues(row.searchPhrasesJson)
      const transcriptMatch = analyzeTextMatch(row.transcript, request.query)
      const summaryMatch = analyzeTextMatch(row.summary ?? "", request.query)
      const tagMatches = [...entities, ...events, ...aliases, ...searchPhrases]
        .map((value) => analyzeTextMatch(value, request.query))
      const transcriptEvidence = isCoherentTextMatch(transcriptMatch)
      const summaryEvidence = isCoherentTextMatch(summaryMatch)
      const tagEvidence = tagMatches.some(isCoherentTextMatch)
      const hasFieldEvidence = transcriptEvidence || summaryEvidence || tagEvidence
      const lexicalRank = hasFieldEvidence ? lexicalRanks.get(row.chunkId) : undefined
      const semanticDistance = semanticDistances.get(row.chunkId)
      if (request.mode === "keyword" && !hasFieldEvidence) return []

      const scored = scoreSearchResult(request.mode, {
        semantic: semanticDistanceQuality(semanticDistance),
        lexical: lexicalRankQuality(lexicalRank),
        transcript: textMatchQuality(transcriptMatch),
        summary: textMatchQuality(summaryMatch),
        metadata: Math.max(0, ...tagMatches.map(textMatchQuality))
      })
      const matchReasons: SearchHit["matchReasons"] = []
      if (transcriptMatch.exactPhrase || summaryMatch.exactPhrase || tagMatches.some((match) => match.exactPhrase)) matchReasons.push("exact")
      if (transcriptEvidence) matchReasons.push("transcript")
      if (!transcriptEvidence && (summaryEvidence || tagEvidence)) matchReasons.push("tag")
      if (semanticDistance !== undefined) matchReasons.push("semantic")
      return [{
        mediaId: row.mediaId,
        title: row.title,
        relativePath: row.relativePath,
        createdAtMs: row.createdAtMs,
        startMs: row.startMs,
        endMs: row.endMs,
        transcriptExcerpt: excerpt(row.transcript, request.query),
        summary: row.summary,
        entities,
        events,
        availability: row.availability,
        matchReasons,
        score: scored.score,
        scoreBreakdown: scored.breakdown
      }]
    }).sort((a, b) => b.score - a.score)

    const merged = mergeNearbyHits(hits).slice(0, request.limit)
    const refined = merged.map((hit) => this.refineTimestamp(hit, request.query))
    return {
      hits: refined,
      elapsedMs: performance.now() - startedAt,
      indexedChunkCount: this.repository.countSearchChunks()
    }
  }

  private refineTimestamp(hit: SearchHit, query: string): SearchHit {
    const segments = this.repository.getTranscriptSegmentsInRange?.(hit.mediaId, hit.startMs, hit.endMs)
    if (!segments?.length) return hit
    const best = findBestTimedText(segments, query)
    if (!best) return hit
    return {
      ...hit,
      startMs: best.startMs,
      endMs: best.endMs,
      transcriptExcerpt: best.text.trim()
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
