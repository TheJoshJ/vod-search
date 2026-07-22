import type { TranscriptSegment } from "@vod-search/contracts"

export function findActiveTranscriptSegmentId(
  transcript: TranscriptSegment[],
  currentMs: number
): number | null {
  let previousId: number | null = null

  for (const segment of transcript) {
    if (currentMs < segment.startMs) break
    previousId = segment.id
    if (currentMs <= segment.endMs) return segment.id
  }

  return previousId
}

export interface TranscriptFollowGeometry {
  containerTop: number
  containerHeight: number
  rowTop: number
  rowHeight: number
  scrollTop: number
}

export function getTranscriptFollowScrollTop({
  containerTop,
  containerHeight,
  rowTop,
  rowHeight,
  scrollTop
}: TranscriptFollowGeometry): number | null {
  const rowBottom = rowTop + rowHeight
  const safeTop = containerTop + containerHeight * 0.18
  const safeBottom = containerTop + containerHeight * 0.82

  if (rowTop >= safeTop && rowBottom <= safeBottom) return null

  const preferredCenter = containerTop + containerHeight * 0.35
  const rowCenter = rowTop + rowHeight / 2
  return Math.max(0, scrollTop + rowCenter - preferredCenter)
}
