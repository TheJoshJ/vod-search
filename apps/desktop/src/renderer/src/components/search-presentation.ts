export interface SearchResultCopy {
  transcript: string
  summary: string | null
}

export function getSearchResultCopy(transcriptExcerpt: string, summary: string | null): SearchResultCopy {
  const transcript = transcriptExcerpt.trim()
  const cleanSummary = summary?.trim() || null

  if (!transcript) return { transcript: cleanSummary ?? "No transcript context available.", summary: null }
  if (!cleanSummary || areDisplayTextsEquivalent(transcript, cleanSummary)) {
    return { transcript, summary: null }
  }

  return { transcript, summary: cleanSummary }
}

export function areDisplayTextsEquivalent(left: string, right: string): boolean {
  const normalizedLeft = normalizeDisplayText(left)
  const normalizedRight = normalizeDisplayText(right)
  return normalizedLeft.length > 0 && normalizedLeft === normalizedRight
}

function normalizeDisplayText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim()
}
