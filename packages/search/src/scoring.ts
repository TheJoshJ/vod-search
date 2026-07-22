import type { SearchMode, SearchScoreBreakdown } from "@vod-search/contracts"
import type { TextMatch } from "./relevance.js"
import { isCoherentTextMatch } from "./relevance.js"

export interface SearchScoreFactors {
  semantic: number
  lexical: number
  transcript: number
  summary: number
  metadata: number
}

type SearchScoreWeights = SearchScoreFactors

export const SEARCH_MODE_WEIGHTS: Record<SearchMode, SearchScoreWeights> = {
  semantic: { semantic: 0.65, lexical: 0, transcript: 0.30, summary: 0.03, metadata: 0.02 },
  hybrid: { semantic: 0.35, lexical: 0.15, transcript: 0.38, summary: 0.08, metadata: 0.04 },
  keyword: { semantic: 0, lexical: 0.20, transcript: 0.55, summary: 0.15, metadata: 0.10 }
}

export function scoreSearchResult(mode: SearchMode, factors: SearchScoreFactors): {
  score: number
  breakdown: SearchScoreBreakdown
} {
  const weights = SEARCH_MODE_WEIGHTS[mode]
  const breakdown: SearchScoreBreakdown = {
    semantic: contribution(factors.semantic, weights.semantic),
    lexical: contribution(factors.lexical, weights.lexical),
    transcript: contribution(factors.transcript, weights.transcript),
    summary: contribution(factors.summary, weights.summary),
    metadata: contribution(factors.metadata, weights.metadata)
  }
  return {
    score: roundScore(Object.values(breakdown).reduce((total, value) => total + value, 0)),
    breakdown
  }
}

export function semanticDistanceQuality(distance: number | undefined): number {
  if (distance === undefined || !Number.isFinite(distance)) return 0
  return clamp01((1.4 - distance) / 0.8)
}

export function lexicalRankQuality(rank: number | undefined): number {
  if (rank === undefined) return 0
  return 1 / (1 + Math.max(0, rank - 1) / 10)
}

export function textMatchQuality(match: TextMatch): number {
  if (!isCoherentTextMatch(match)) return 0
  const extraTerms = Math.max(0, (match.minimumWindow ?? match.queryTermCount) - match.queryTermCount)
  const proximity = 1 / (1 + extraTerms)
  return clamp01(0.78 + proximity * 0.12 + (match.exactPhrase ? 0.10 : 0))
}

function contribution(factor: number, weight: number): number {
  return roundScore(clamp01(factor) * weight * 100)
}

function roundScore(value: number): number {
  return Math.round(value * 10) / 10
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value))
}
