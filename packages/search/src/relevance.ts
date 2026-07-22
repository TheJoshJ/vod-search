const stopWords = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or"])

export interface TextMatch {
  queryTermCount: number
  matchedTermCount: number
  coverage: number
  full: boolean
  exactPhrase: boolean
  minimumWindow: number | null
}

export interface TimedText {
  startMs: number
  endMs: number
  text: string
}

export function extractSearchTerms(value: string): string[] {
  return Array.from(new Set(tokenizeSearchText(value).filter((term) => !stopWords.has(term))))
}

export function analyzeTextMatch(text: string, query: string | string[]): TextMatch {
  const queryTerms = Array.isArray(query) ? query : extractSearchTerms(query)
  const textTerms = tokenizeSearchText(text)
  if (queryTerms.length === 0 || textTerms.length === 0) return emptyMatch(queryTerms.length)

  const matchesAt = textTerms.map((candidate) => queryTerms.flatMap((term, index) =>
    tokenMatches(term, candidate) ? [index] : []))
  const matched = new Set(matchesAt.flat())
  const full = matched.size === queryTerms.length
  const exactPhrase = queryTerms.length <= textTerms.length && textTerms.some((_term, start) =>
    start + queryTerms.length <= textTerms.length &&
    queryTerms.every((term, offset) => textTerms[start + offset] === term))

  let minimumWindow: number | null = null
  if (full) {
    const counts = Array.from({ length: queryTerms.length }, () => 0)
    let covered = 0
    let left = 0
    for (let right = 0; right < matchesAt.length; right += 1) {
      for (const index of matchesAt[right]!) {
        if (counts[index] === 0) covered += 1
        counts[index] = (counts[index] ?? 0) + 1
      }
      while (covered === queryTerms.length && left <= right) {
        const width = right - left + 1
        minimumWindow = minimumWindow === null ? width : Math.min(minimumWindow, width)
        for (const index of matchesAt[left]!) {
          counts[index] = (counts[index] ?? 0) - 1
          if (counts[index] === 0) covered -= 1
        }
        left += 1
      }
    }
  }

  return {
    queryTermCount: queryTerms.length,
    matchedTermCount: matched.size,
    coverage: matched.size / queryTerms.length,
    full,
    exactPhrase,
    minimumWindow
  }
}

export function findBestTimedText<T extends TimedText>(items: T[], query: string): T | null {
  let best: { item: T; match: TextMatch } | null = null
  for (const item of items) {
    const match = analyzeTextMatch(item.text, query)
    if (!match.full) continue
    if (!best || compareMatches(match, best.match) > 0) best = { item, match }
  }
  return best?.item ?? null
}

export function fieldMatchBoost(match: TextMatch, base: number): number {
  if (!isCoherentTextMatch(match)) return 0
  const extraTerms = Math.max(0, (match.minimumWindow ?? match.queryTermCount) - match.queryTermCount)
  const proximity = 0.012 / (1 + extraTerms)
  return base + proximity + (match.exactPhrase ? 0.01 : 0)
}

export function isCoherentTextMatch(match: TextMatch): boolean {
  if (!match.full || match.minimumWindow === null) return false
  return match.minimumWindow <= Math.max(match.queryTermCount * 3, match.queryTermCount + 8)
}

function compareMatches(left: TextMatch, right: TextMatch): number {
  if (left.exactPhrase !== right.exactPhrase) return left.exactPhrase ? 1 : -1
  return (right.minimumWindow ?? Number.MAX_SAFE_INTEGER) - (left.minimumWindow ?? Number.MAX_SAFE_INTEGER)
}

function tokenizeSearchText(value: string): string[] {
  const normalized = value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/([\p{L}\p{N}])['’]s\b/gu, "$1s")
    .replace(/['’]/g, "")
  return normalized.match(/[\p{L}\p{N}]+/gu) ?? []
}

function tokenMatches(query: string, candidate: string): boolean {
  if (query === candidate) return true
  if (query.length < 4) return false
  if (query.length >= 5 && withinOneEdit(query, candidate)) return true

  if (candidate.length > query.length + 2) {
    for (const length of [query.length - 1, query.length, query.length + 1]) {
      if (length < 3 || length > candidate.length) continue
      if (withinOneEdit(query, candidate.slice(0, length))) return true
      if (withinOneEdit(query, candidate.slice(-length))) return true
    }
  }
  return false
}

function withinOneEdit(left: string, right: string): boolean {
  if (Math.abs(left.length - right.length) > 1) return false
  if (left === right) return true
  if (left.length === right.length) {
    let differences = 0
    for (let index = 0; index < left.length; index += 1) {
      if (left[index] !== right[index] && ++differences > 1) return false
    }
    return true
  }

  const shorter = left.length < right.length ? left : right
  const longer = left.length < right.length ? right : left
  let shortIndex = 0
  let longIndex = 0
  let skipped = false
  while (shortIndex < shorter.length && longIndex < longer.length) {
    if (shorter[shortIndex] === longer[longIndex]) {
      shortIndex += 1
      longIndex += 1
    } else if (skipped) {
      return false
    } else {
      skipped = true
      longIndex += 1
    }
  }
  return true
}

function emptyMatch(queryTermCount: number): TextMatch {
  return {
    queryTermCount,
    matchedTermCount: 0,
    coverage: 0,
    full: false,
    exactPhrase: false,
    minimumWindow: null
  }
}
