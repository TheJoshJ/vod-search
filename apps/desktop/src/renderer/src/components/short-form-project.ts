import type {
  MediaDetail,
  NormalizedVideoRect,
  ShortFormCaptionCue,
  ShortFormProject,
  TranscriptSegment
} from "@vod-search/contracts"
import { cleanMediaTitle } from "./search-workflow"

export interface SourceDrawRect {
  sx: number
  sy: number
  sw: number
  sh: number
}

export interface FittedSize {
  width: number
  height: number
}

export function contextWindowAroundPlayhead(
  playheadMs: number,
  sourceDurationMs: number,
  distanceMs: number
): [number, number] {
  const duration = Math.max(1, sourceDurationMs)
  const playhead = clamp(playheadMs, 0, duration)
  const distance = Math.max(1_000, distanceMs)
  return [
    Math.max(0, playhead - distance),
    Math.min(duration, playhead + distance)
  ]
}

export function createShortFormProject(detail: MediaDetail, startMs: number, endMs: number): ShortFormProject {
  const safeStart = Math.max(0, Math.min(startMs, Math.max(0, endMs - 1)))
  const safeEnd = Math.max(safeStart + 1, Math.min(endMs, detail.media.durationMs ?? endMs))
  return {
    mediaId: detail.media.id,
    title: `${cleanMediaTitle(detail.media.displayName)} short`,
    contextStartMs: safeStart,
    contextEndMs: safeEnd,
    startMs: safeStart,
    endMs: safeEnd,
    layout: {
      contentRect: { x: 0, y: 0, width: 1, height: 1 },
      faceRect: { x: 0.68, y: 0, width: 0.32, height: 0.42 },
      contentFraction: 0.64,
      faceFirst: false
    },
    captionStyle: {
      enabled: true,
      preset: "impact",
      fontSize: 78,
      positionY: 0.6,
      textColor: "#ffffff",
      highlightColor: "#a3ff12",
      uppercase: true
    },
    captions: buildShortFormCaptionCues(detail.transcript, safeStart, safeEnd)
  }
}

export function buildShortFormCaptionCues(
  transcript: TranscriptSegment[],
  clipStartMs: number,
  clipEndMs: number,
  maxWords = 4
): ShortFormCaptionCue[] {
  const cues: ShortFormCaptionCue[] = []
  for (const segment of transcript) {
    const startMs = Math.max(segment.startMs, clipStartMs)
    const endMs = Math.min(segment.endMs, clipEndMs)
    if (endMs <= startMs) continue
    const words = segment.text.trim().split(/\s+/).filter(Boolean)
    if (words.length === 0) continue
    const groups = Array.from({ length: Math.ceil(words.length / maxWords) }, (_, index) =>
      words.slice(index * maxWords, (index + 1) * maxWords))
    const weights = groups.map((group) => Math.max(1, group.join("").length))
    const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
    let cursor = startMs
    groups.forEach((group, index) => {
      const next = index === groups.length - 1
        ? endMs
        : cursor + Math.round((endMs - startMs) * (weights[index] ?? 1) / totalWeight)
      cues.push({
        id: `${segment.id}:${index}`,
        startMs: cursor,
        endMs: Math.max(cursor + 1, next),
        text: group.join(" ")
      })
      cursor = next
    })
  }
  return cues
}

export function clampVideoRect(rect: NormalizedVideoRect): NormalizedVideoRect {
  const width = clamp(rect.width, 0.08, 1)
  const height = clamp(rect.height, 0.08, 1)
  return {
    x: clamp(rect.x, 0, 1 - width),
    y: clamp(rect.y, 0, 1 - height),
    width,
    height
  }
}

export function resizeVideoRect(
  rect: NormalizedVideoRect,
  patch: Partial<Pick<NormalizedVideoRect, "width" | "height">>
): NormalizedVideoRect {
  const centerX = rect.x + rect.width / 2
  const centerY = rect.y + rect.height / 2
  const width = patch.width ?? rect.width
  const height = patch.height ?? rect.height
  return clampVideoRect({ x: centerX - width / 2, y: centerY - height / 2, width, height })
}

export function fitAspectRatio(
  containerWidth: number,
  containerHeight: number,
  aspectWidth: number,
  aspectHeight: number
): FittedSize {
  const widthLimit = Math.max(0, containerWidth)
  const heightLimit = Math.max(0, containerHeight)
  const aspectRatio = Math.max(1, aspectWidth) / Math.max(1, aspectHeight)
  const width = Math.min(widthLimit, heightLimit * aspectRatio)
  return { width, height: width / aspectRatio }
}

export function coverSourceRect(
  rect: NormalizedVideoRect,
  sourceWidth: number,
  sourceHeight: number,
  targetWidth: number,
  targetHeight: number
): SourceDrawRect {
  const bounded = clampVideoRect(rect)
  const boxX = bounded.x * sourceWidth
  const boxY = bounded.y * sourceHeight
  const boxWidth = bounded.width * sourceWidth
  const boxHeight = bounded.height * sourceHeight
  const targetAspect = targetWidth / Math.max(1, targetHeight)
  let sw = boxWidth
  let sh = sw / targetAspect
  if (sh > boxHeight) {
    sh = boxHeight
    sw = sh * targetAspect
  }
  return {
    sx: boxX + (boxWidth - sw) / 2,
    sy: boxY + (boxHeight - sh) / 2,
    sw,
    sh
  }
}

export function activeShortFormCaption(cues: ShortFormCaptionCue[], currentMs: number): ShortFormCaptionCue | null {
  return cues.find((cue) => currentMs >= cue.startMs && currentMs < cue.endMs) ?? null
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.max(minimum, Math.min(maximum, value))
}
