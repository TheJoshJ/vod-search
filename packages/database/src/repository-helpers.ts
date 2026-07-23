import type { IndexStage, Job, JobStage, MediaAsset, SourceFolder, SpeakerProfile, TranscriptTopic } from "@vod-search/contracts"

export interface SourceFolderRow {
  id: string
  path: string
  added_at_ms: number
  last_scan_at_ms: number | null
  publish_shared_metadata: number
  available_media_count: number
  missing_media_count: number
}

export interface MediaRow {
  id: string
  source_folder_id: string
  display_name: string
  relative_path: string
  duration_ms: number | null
  size_bytes: number
  created_at_ms: number
  modified_at_ms: number
  quick_fingerprint: string
  availability: "available" | "missing"
  highest_completed_stage: IndexStage
}

export interface JobRow {
  id: string
  media_id: string | null
  stage: JobStage
  status: Job["status"]
  priority: number
  progress: number
  attempts: number
  error: string | null
  created_at_ms: number
  updated_at_ms: number
}

export interface SpeakerProfileRow {
  id: string
  name: string
  sample_count: number
  created_at_ms: number
  updated_at_ms: number
}

export interface SpeakerProfileWithEmbedding {
  profile: SpeakerProfile
  embedding: number[]
}

export const indexStageOrder: Record<IndexStage, number> = {
  discovered: 0,
  probed: 1,
  subtitled: 2,
  transcribed: 2,
  chunked: 3,
  embedded: 4,
  enriched: 5,
  ready: 6
}

export function mapSourceFolder(row: SourceFolderRow): SourceFolder {
  return { id: row.id, path: row.path, addedAtMs: row.added_at_ms, lastScanAtMs: row.last_scan_at_ms, publishSharedMetadata: row.publish_shared_metadata === 1, availableMediaCount: row.available_media_count, missingMediaCount: row.missing_media_count }
}

export function mapMedia(row: MediaRow): MediaAsset {
  return { id: row.id, sourceFolderId: row.source_folder_id, displayName: row.display_name, relativePath: row.relative_path, durationMs: row.duration_ms, sizeBytes: row.size_bytes, createdAtMs: row.created_at_ms, modifiedAtMs: row.modified_at_ms, quickFingerprint: row.quick_fingerprint, availability: row.availability, highestCompletedStage: row.highest_completed_stage }
}

export function mapSpeakerProfile(row: SpeakerProfileRow): SpeakerProfile {
  return { id: row.id, name: row.name, sampleCount: row.sample_count, createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms }
}

export function fallbackSpeakerName(label: string): string {
  const numericSuffix = label.match(/(\d+)$/)?.[1]
  return numericSuffix === undefined ? "Detected speaker" : `Speaker ${Number(numericSuffix) + 1}`
}

export function embeddingToBuffer(embedding: number[]): Buffer {
  const values = Float32Array.from(embedding)
  return Buffer.from(values.buffer, values.byteOffset, values.byteLength)
}

export function bufferToEmbedding(buffer: Buffer): number[] {
  if (buffer.byteLength === 0 || buffer.byteLength % Float32Array.BYTES_PER_ELEMENT !== 0) return []
  const bytes = Uint8Array.from(buffer)
  return Array.from(new Float32Array(bytes.buffer))
}

export function normalizeEmbedding(embedding: number[]): number[] {
  const magnitude = Math.sqrt(embedding.reduce((sum, value) => sum + value * value, 0))
  return magnitude > 0 ? embedding.map((value) => value / magnitude) : embedding.map(() => 0)
}

export function averageEmbeddings(embeddings: number[][]): number[] | null {
  const dimension = embeddings[0]?.length ?? 0
  if (dimension === 0) return null
  const compatible = embeddings.filter((embedding) => embedding.length === dimension)
  if (compatible.length === 0) return null
  return normalizeEmbedding(Array.from({ length: dimension }, (_, index) => compatible.reduce((sum, embedding) => sum + embedding[index]!, 0) / compatible.length))
}

export function cosineSimilarity(left: number[], right: number[]): number {
  if (left.length === 0 || left.length !== right.length) return -1
  let dot = 0
  let leftMagnitude = 0
  let rightMagnitude = 0
  for (let index = 0; index < left.length; index += 1) {
    dot += left[index]! * right[index]!
    leftMagnitude += left[index]! * left[index]!
    rightMagnitude += right[index]! * right[index]!
  }
  return leftMagnitude > 0 && rightMagnitude > 0 ? dot / Math.sqrt(leftMagnitude * rightMagnitude) : -1
}

export function bestProfileMatch(embedding: number[], candidates: Array<{ profile_id: string; embedding: Buffer }>, threshold: number): string | null {
  let best: { id: string; score: number } | null = null
  for (const candidate of candidates) {
    const score = cosineSimilarity(embedding, bufferToEmbedding(candidate.embedding))
    if (score >= threshold && (!best || score > best.score)) best = { id: candidate.profile_id, score }
  }
  return best?.id ?? null
}

export function bestSuggestion(embedding: number[], candidates: SpeakerProfileWithEmbedding[], threshold: number): { profile: SpeakerProfile; score: number } | null {
  let best: { profile: SpeakerProfile; score: number } | null = null
  for (const candidate of candidates) {
    const score = cosineSimilarity(embedding, candidate.embedding)
    if (score >= threshold && (!best || score > best.score)) best = { profile: candidate.profile, score }
  }
  return best
}

export function enrichmentTags(topic: Omit<TranscriptTopic, "startSegmentId">): string {
  return [...topic.entities.flatMap((entity) => [entity.name, entity.type]), ...topic.events.flatMap((event) => [event.type, event.subject ?? "", event.object ?? ""]), ...topic.aliases, ...topic.searchPhrases].filter(Boolean).join(" ")
}

export function jsonStringField(json: string, field: string): string[] {
  try {
    const parsed: unknown = JSON.parse(json)
    if (!Array.isArray(parsed)) return []
    return parsed.flatMap((item): string[] => {
      if (typeof item === "string") return [item]
      if (!item || typeof item !== "object") return []
      const value = (item as Record<string, unknown>)[field]
      return typeof value === "string" ? [value] : []
    })
  } catch {
    return []
  }
}

export function mapJob(row: JobRow): Job {
  return { id: row.id, mediaId: row.media_id, stage: row.stage, status: row.status, priority: row.priority, progress: row.progress, attempts: row.attempts, error: row.error, createdAtMs: row.created_at_ms, updatedAtMs: row.updated_at_ms }
}
