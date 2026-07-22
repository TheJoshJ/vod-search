import type { SearchHit } from "@vod-search/contracts"

export interface SearchResultCluster {
  id: string
  primary: SearchHit
  nearby: SearchHit[]
}

export interface SearchVideoGroup {
  mediaId: string
  title: string
  relativePath: string
  createdAtMs: number
  clusters: SearchResultCluster[]
  bestScore: number
}

export interface OrganizedSearchResults {
  groups: SearchVideoGroup[]
  visibleHitCount: number
  lowerConfidenceCount: number
  threshold: number
  strongHits: SearchHit[]
}

export interface HighlightedTextPart {
  text: string
  match: boolean
}

const nearbyWindowMs = 45_000
const initialStrongLimit = 12

export function organizeSearchHits(hits: SearchHit[], includeLowerConfidence = false): OrganizedSearchResults {
  if (hits.length === 0) {
    return { groups: [], visibleHitCount: 0, lowerConfidenceCount: 0, threshold: 0, strongHits: [] }
  }

  const sorted = [...hits].sort((left, right) => right.score - left.score || left.startMs - right.startMs)
  const threshold = Math.max(12, sorted[0]!.score * 0.45)
  const strongHits = sorted.filter((hit) => hit.score >= threshold).slice(0, initialStrongLimit)
  const selected = includeLowerConfidence ? sorted : strongHits
  const clusters = clusterSearchHits(selected)
  const groupsByMedia = new Map<string, SearchVideoGroup>()

  for (const cluster of clusters) {
    const hit = cluster.primary
    const existing = groupsByMedia.get(hit.mediaId)
    if (existing) {
      existing.clusters.push(cluster)
      existing.bestScore = Math.max(existing.bestScore, hit.score)
      continue
    }
    groupsByMedia.set(hit.mediaId, {
      mediaId: hit.mediaId,
      title: cleanMediaTitle(hit.title),
      relativePath: hit.relativePath,
      createdAtMs: hit.createdAtMs,
      clusters: [cluster],
      bestScore: hit.score
    })
  }

  const groups = [...groupsByMedia.values()]
    .map((group) => ({ ...group, clusters: group.clusters.sort((left, right) => right.primary.score - left.primary.score) }))
    .sort((left, right) => right.bestScore - left.bestScore)

  return {
    groups,
    visibleHitCount: selected.length,
    lowerConfidenceCount: Math.max(0, hits.length - strongHits.length),
    threshold,
    strongHits
  }
}

export function clusterSearchHits(hits: SearchHit[]): SearchResultCluster[] {
  const clusters: SearchResultCluster[] = []
  const sorted = [...hits].sort((left, right) => right.score - left.score || left.startMs - right.startMs)

  for (const hit of sorted) {
    const existing = clusters.find((cluster) =>
      cluster.primary.mediaId === hit.mediaId &&
      (rangesOverlap(cluster.primary, hit) || Math.abs(cluster.primary.startMs - hit.startMs) <= nearbyWindowMs)
    )
    if (existing) {
      existing.nearby.push(hit)
      existing.nearby.sort((left, right) => right.score - left.score || left.startMs - right.startMs)
    } else {
      clusters.push({ id: `${hit.mediaId}:${hit.startMs}`, primary: hit, nearby: [] })
    }
  }

  return clusters.sort((left, right) => right.primary.score - left.primary.score || left.primary.startMs - right.primary.startMs)
}

export function cleanMediaTitle(value: string): string {
  return value
    .replace(/\.(mp4|mkv|webm|mov|avi|m4v|ts)$/i, "")
    .replace(/^\d{8}\s*[-–—]\s*/, "")
    .replace(/\s*\[[A-Za-z0-9_-]{8,16}\]\s*$/, "")
    .trim()
}

export function splitQueryMatches(text: string, query: string): HighlightedTextPart[] {
  const terms = queryTerms(query)
  if (terms.length === 0 || !text) return [{ text, match: false }]
  const tokens = text.match(/[\p{L}\p{N}'’-]+|[^\p{L}\p{N}'’-]+/gu) ?? [text]
  const parts: HighlightedTextPart[] = []
  for (const token of tokens) {
    const match = /[\p{L}\p{N}]/u.test(token) && terms.some((term) => wordMatchesQueryTerm(token, term))
    const previous = parts.at(-1)
    if (previous?.match === match) previous.text += token
    else parts.push({ text: token, match })
  }
  return parts
}

function queryTerms(query: string): string[] {
  return [...new Set((query.match(/[\p{L}\p{N}'’-]+/gu) ?? [])
    .map(normalizeWord)
    .filter((term) => term.length >= 2))]
}

function wordMatchesQueryTerm(word: string, term: string): boolean {
  const candidate = normalizeWord(word)
  if (!candidate) return false
  if (candidate === term) return true
  if (term.length >= 3 && candidate.includes(term)) return true
  if (candidate.length >= 4 && term.includes(candidate)) return true
  if (term.length < 4 || candidate.length < term.length) return false
  for (const suffixLength of [term.length, term.length + 1]) {
    if (candidate.length >= suffixLength && editDistance(candidate.slice(-suffixLength), term) <= 1) return true
  }
  return false
}

function normalizeWord(value: string): string {
  return value.toLocaleLowerCase("en-US").replace(/[^\p{L}\p{N}]/gu, "")
}

function editDistance(left: string, right: string): number {
  const previous = Array.from({ length: right.length + 1 }, (_, index) => index)
  for (let leftIndex = 1; leftIndex <= left.length; leftIndex += 1) {
    const current = [leftIndex]
    for (let rightIndex = 1; rightIndex <= right.length; rightIndex += 1) {
      current[rightIndex] = Math.min(
        current[rightIndex - 1]! + 1,
        previous[rightIndex]! + 1,
        previous[rightIndex - 1]! + (left[leftIndex - 1] === right[rightIndex - 1] ? 0 : 1)
      )
    }
    previous.splice(0, previous.length, ...current)
  }
  return previous[right.length]!
}

function rangesOverlap(left: Pick<SearchHit, "startMs" | "endMs">, right: Pick<SearchHit, "startMs" | "endMs">): boolean {
  return left.startMs <= right.endMs && right.startMs <= left.endMs
}
