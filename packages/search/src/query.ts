const stopWords = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or"])

export function toFtsQuery(query: string): string {
  const normalized = query.trim().replace(/\s+/g, " ")
  if (!normalized) throw new Error("Search query cannot be empty")
  const phrase = quoteFts(normalized)
  const terms = Array.from(
    new Set(normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])
  ).filter((term) => !stopWords.has(term))

  if (terms.length === 0) return phrase
  const termExpression = terms.map(quoteFts).join(" AND ")
  return `${phrase} OR (${termExpression})`
}

function quoteFts(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export interface RankedCandidate<T> {
  id: number
  value: T
}

export function reciprocalRankFusion<T>(
  lexical: RankedCandidate<T>[],
  semantic: RankedCandidate<T>[],
  options: { k?: number; lexicalWeight?: number; semanticWeight?: number } = {}
): Array<{ value: T; score: number; lexicalRank?: number; semanticRank?: number }> {
  const k = options.k ?? 60
  const lexicalWeight = options.lexicalWeight ?? 1
  const semanticWeight = options.semanticWeight ?? 0.8
  const combined = new Map<number, {
    value: T
    score: number
    lexicalRank?: number
    semanticRank?: number
  }>()

  lexical.forEach((candidate, index) => {
    const rank = index + 1
    combined.set(candidate.id, {
      value: candidate.value,
      score: lexicalWeight / (k + rank),
      lexicalRank: rank
    })
  })

  semantic.forEach((candidate, index) => {
    const rank = index + 1
    const existing = combined.get(candidate.id)
    if (existing) {
      existing.score += semanticWeight / (k + rank)
      existing.semanticRank = rank
    } else {
      combined.set(candidate.id, {
        value: candidate.value,
        score: semanticWeight / (k + rank),
        semanticRank: rank
      })
    }
  })

  return [...combined.values()].sort((a, b) => b.score - a.score)
}

