import { randomUUID } from "node:crypto"
import {
  roughCutGenerateRequestSchema,
  roughCutPlanSchema,
  type RoughCutGenerateRequest,
  type RoughCutPlan,
  type RoughCutPlanItem
} from "@vod-search/contracts"

export interface RoughCutSourceSegment {
  id: number
  startMs: number
  endMs: number
  text: string
}

export interface RoughCutSource {
  mediaId: string
  path: string
  title: string
  durationMs: number
  segments: RoughCutSourceSegment[]
}

export interface RoughCutMatch {
  mediaId: string
  startSegmentId: number
  endSegmentId: number
  requestedText: string
  matchRationale: string
}

export interface BuildRoughCutPlanOptions {
  request: RoughCutGenerateRequest
  sources: RoughCutSource[]
  matches: RoughCutMatch[]
  now?: number
  createId?: () => string
}

export function buildRoughCutPlan(options: BuildRoughCutPlanOptions): RoughCutPlan {
  const request = roughCutGenerateRequestSchema.parse(options.request)
  const sourceById = new Map(options.sources.map((source) => [source.mediaId, source]))
  const createId = options.createId ?? randomUUID
  const rawItems = options.matches.map((match) => materializeMatch(match, sourceById, request, createId))
  if (rawItems.length === 0) throw new Error("No transcript moments matched the rough-cut brief")
  const merged = mergeAdjacentOverlaps(rawItems)
  const title = request.title ?? conciseTitle(request.prompt)
  return roughCutPlanSchema.parse(resequenceRoughCutPlan({
    version: 1,
    id: createId(),
    title,
    brief: request.prompt,
    createdAtMs: options.now ?? Date.now(),
    frameRate: request.frameRate,
    selectedMediaIds: request.mediaIds,
    handleBeforeMs: request.handleBeforeMs,
    handleAfterMs: request.handleAfterMs,
    totalDurationMs: 1,
    items: merged
  }))
}

export function resequenceRoughCutPlan(plan: RoughCutPlan | Omit<RoughCutPlan, "totalDurationMs"> & { totalDurationMs?: number }): RoughCutPlan {
  let cursor = 0
  const items = plan.items.map((item, order) => {
    const duration = item.sourceOutMs - item.sourceInMs
    const next = {
      ...item,
      order,
      sequenceStartMs: cursor,
      sequenceEndMs: cursor + duration
    }
    cursor += duration
    return next
  })
  return roughCutPlanSchema.parse({ ...plan, items, totalDurationMs: cursor })
}

function materializeMatch(
  match: RoughCutMatch,
  sources: Map<string, RoughCutSource>,
  request: RoughCutGenerateRequest,
  createId: () => string
): RoughCutPlanItem {
  const source = sources.get(match.mediaId)
  if (!source) throw new Error(`The cut plan referenced unselected media: ${match.mediaId}`)
  const startIndex = source.segments.findIndex((segment) => segment.id === match.startSegmentId)
  const endIndex = source.segments.findIndex((segment) => segment.id === match.endSegmentId)
  if (startIndex < 0 || endIndex < 0) throw new Error(`The cut plan referenced an unknown transcript segment in ${source.title}`)
  if (endIndex < startIndex) throw new Error(`The cut plan reversed a transcript range in ${source.title}`)
  const selected = source.segments.slice(startIndex, endIndex + 1)
  const first = selected[0]!
  const last = selected.at(-1)!
  const sourceInMs = Math.max(0, first.startMs - request.handleBeforeMs)
  const sourceOutMs = Math.min(source.durationMs, last.endMs + request.handleAfterMs)
  return {
    id: createId(),
    order: 0,
    mediaId: source.mediaId,
    sourcePath: source.path,
    sourceTitle: source.title,
    sourceDurationMs: source.durationMs,
    contentStartMs: first.startMs,
    contentEndMs: last.endMs,
    sourceInMs,
    sourceOutMs,
    sequenceStartMs: 0,
    sequenceEndMs: sourceOutMs - sourceInMs,
    handleBeforeMs: first.startMs - sourceInMs,
    handleAfterMs: sourceOutMs - last.endMs,
    requestedText: match.requestedText.trim(),
    matchRationale: match.matchRationale.trim(),
    transcriptExcerpt: excerpt(selected.map((segment) => segment.text).join(" "))
  }
}

function mergeAdjacentOverlaps(items: RoughCutPlanItem[]): RoughCutPlanItem[] {
  const merged: RoughCutPlanItem[] = []
  for (const item of items) {
    const previous = merged.at(-1)
    if (!previous || previous.mediaId !== item.mediaId || item.sourceInMs > previous.sourceOutMs) {
      merged.push(item)
      continue
    }
    const sourceInMs = Math.min(previous.sourceInMs, item.sourceInMs)
    const sourceOutMs = Math.max(previous.sourceOutMs, item.sourceOutMs)
    const contentStartMs = Math.min(previous.contentStartMs, item.contentStartMs)
    const contentEndMs = Math.max(previous.contentEndMs, item.contentEndMs)
    merged[merged.length - 1] = {
      ...previous,
      sourceInMs,
      sourceOutMs,
      contentStartMs,
      contentEndMs,
      sequenceEndMs: sourceOutMs - sourceInMs,
      handleBeforeMs: contentStartMs - sourceInMs,
      handleAfterMs: sourceOutMs - contentEndMs,
      requestedText: joinDistinct(previous.requestedText, item.requestedText, 240),
      matchRationale: joinDistinct(previous.matchRationale, item.matchRationale, 480),
      transcriptExcerpt: excerpt(joinDistinct(previous.transcriptExcerpt, item.transcriptExcerpt, 1_200))
    }
  }
  return merged
}

function conciseTitle(prompt: string): string {
  const firstLine = prompt.split(/\r?\n/).map((line) => line.trim()).find(Boolean) ?? "Text-directed rough cut"
  return firstLine.length <= 80 ? firstLine : `${firstLine.slice(0, 77).trimEnd()}...`
}

function joinDistinct(left: string, right: string, maximum: number): string {
  const joined = left === right ? left : `${left} / ${right}`
  return joined.length <= maximum ? joined : `${joined.slice(0, Math.max(0, maximum - 3)).trimEnd()}...`
}

function excerpt(value: string): string {
  const normalized = value.trim().replace(/\s+/g, " ")
  return normalized.length <= 1_200 ? normalized : `${normalized.slice(0, 1_197).trimEnd()}...`
}
