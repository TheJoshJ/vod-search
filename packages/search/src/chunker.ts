import type { TranscriptSegment } from "@vod-search/contracts"

export interface SearchChunkDraft {
  startMs: number
  endMs: number
  transcript: string
}

export interface ChunkOptions {
  minimumMs: number
  targetMs: number
  maximumMs: number
  overlapMs: number
}

export const defaultChunkOptions: ChunkOptions = {
  minimumMs: 35_000,
  targetMs: 45_000,
  maximumMs: 60_000,
  overlapMs: 8_000
}

export function chunkTranscript(
  transcript: Pick<TranscriptSegment, "startMs" | "endMs" | "text">[],
  options: ChunkOptions = defaultChunkOptions
): SearchChunkDraft[] {
  const segments = transcript
    .filter((segment) => segment.text.trim() && segment.endMs > segment.startMs)
    .sort((a, b) => a.startMs - b.startMs)
  const chunks: SearchChunkDraft[] = []
  let startIndex = 0

  while (startIndex < segments.length) {
    const first = segments[startIndex]!
    let endIndex = startIndex
    let chosenEndIndex = startIndex

    while (endIndex < segments.length) {
      const current = segments[endIndex]!
      const duration = current.endMs - first.startMs
      chosenEndIndex = endIndex

      const endsSentence = /[.!?]["')\]]?$/.test(current.text.trim())
      if (duration >= options.minimumMs && (duration >= options.targetMs || endsSentence)) break
      if (duration >= options.maximumMs) break
      endIndex += 1
    }

    const selected = segments.slice(startIndex, chosenEndIndex + 1)
    const last = selected.at(-1)!
    chunks.push({
      startMs: first.startMs,
      endMs: last.endMs,
      transcript: selected.map((segment) => segment.text.trim()).join(" ").replace(/\s+/g, " ")
    })

    if (chosenEndIndex >= segments.length - 1) break
    const overlapCutoff = Math.max(first.startMs + 1, last.endMs - options.overlapMs)
    let nextIndex = startIndex + 1
    while (nextIndex <= chosenEndIndex && segments[nextIndex]!.endMs <= overlapCutoff) nextIndex += 1
    startIndex = Math.max(startIndex + 1, nextIndex)
  }

  return chunks
}

