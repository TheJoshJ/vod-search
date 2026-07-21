import { z } from "zod"

export const indexStageSchema = z.enum([
  "discovered",
  "probed",
  "subtitled",
  "transcribed",
  "chunked",
  "embedded",
  "enriched",
  "ready"
])
export type IndexStage = z.infer<typeof indexStageSchema>

export const jobStageSchema = z.enum([
  "probe",
  "subtitles",
  "transcribe",
  "chunk",
  "embed",
  "enrich",
  "preview"
])
export type JobStage = z.infer<typeof jobStageSchema>

export const jobStatusSchema = z.enum([
  "queued",
  "running",
  "paused",
  "succeeded",
  "failed",
  "cancelled"
])
export type JobStatus = z.infer<typeof jobStatusSchema>

export const resourceModeSchema = z.enum(["low", "normal", "high"])
export type ResourceMode = z.infer<typeof resourceModeSchema>

export const sourceFolderSchema = z.object({
  id: z.string(),
  path: z.string(),
  addedAtMs: z.number().int().nonnegative(),
  lastScanAtMs: z.number().int().nonnegative().nullable(),
  availableMediaCount: z.number().int().nonnegative(),
  missingMediaCount: z.number().int().nonnegative()
})
export type SourceFolder = z.infer<typeof sourceFolderSchema>

export const mediaAssetSchema = z.object({
  id: z.string(),
  sourceFolderId: z.string(),
  displayName: z.string(),
  relativePath: z.string(),
  durationMs: z.number().int().nonnegative().nullable(),
  sizeBytes: z.number().int().nonnegative(),
  createdAtMs: z.number().int().nonnegative(),
  modifiedAtMs: z.number().int().nonnegative(),
  quickFingerprint: z.string(),
  availability: z.enum(["available", "missing"]),
  highestCompletedStage: indexStageSchema
})
export type MediaAsset = z.infer<typeof mediaAssetSchema>

export const transcriptSourceSchema = z.enum(["sidecar", "embedded", "whisper"])
export type TranscriptSource = z.infer<typeof transcriptSourceSchema>

export const transcriptSegmentSchema = z.object({
  id: z.number().int().nonnegative(),
  mediaId: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string(),
  source: transcriptSourceSchema,
  confidence: z.number().min(0).max(1).nullable()
})
export type TranscriptSegment = z.infer<typeof transcriptSegmentSchema>

export const mediaSummarySectionSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string(),
  entities: z.array(z.string()),
  events: z.array(z.string())
})
export type MediaSummarySection = z.infer<typeof mediaSummarySectionSchema>

export const mediaDetailSchema = z.object({
  media: mediaAssetSchema,
  transcript: z.array(transcriptSegmentSchema),
  summaries: z.array(mediaSummarySectionSchema)
})
export type MediaDetail = z.infer<typeof mediaDetailSchema>

export const enrichmentEntitySchema = z.object({
  name: z.string().min(1).max(120),
  type: z.string().min(1).max(60)
})

export const enrichmentEventSchema = z.object({
  type: z.string().min(1).max(80),
  subject: z.string().max(120).nullable(),
  object: z.string().max(120).nullable(),
  confidence: z.number().min(0).max(1)
})

export const enrichedChunkSchema = z.object({
  chunkId: z.number().int().nonnegative(),
  summary: z.string().max(320),
  entities: z.array(enrichmentEntitySchema).max(20),
  events: z.array(enrichmentEventSchema).max(20),
  aliases: z.array(z.string().min(1).max(80)).max(30),
  searchPhrases: z.array(z.string().min(1).max(160)).max(20),
  confidence: z.number().min(0).max(1)
})
export type EnrichedChunk = z.infer<typeof enrichedChunkSchema>

export const jobSchema = z.object({
  id: z.string(),
  mediaId: z.string().nullable(),
  stage: jobStageSchema,
  status: jobStatusSchema,
  priority: z.number().int(),
  progress: z.number().min(0).max(1),
  attempts: z.number().int().nonnegative(),
  error: z.string().nullable(),
  createdAtMs: z.number().int().nonnegative(),
  updatedAtMs: z.number().int().nonnegative()
})
export type Job = z.infer<typeof jobSchema>

export const libraryStatsSchema = z.object({
  sourceFolders: z.number().int().nonnegative(),
  totalMedia: z.number().int().nonnegative(),
  availableMedia: z.number().int().nonnegative(),
  missingMedia: z.number().int().nonnegative(),
  totalDurationMs: z.number().int().nonnegative(),
  searchableChunks: z.number().int().nonnegative(),
  queuedJobs: z.number().int().nonnegative(),
  runningJobs: z.number().int().nonnegative(),
  failedJobs: z.number().int().nonnegative()
})
export type LibraryStats = z.infer<typeof libraryStatsSchema>

export const modelRoleSchema = z.enum(["transcription", "enrichment", "embedding"])
export type ModelRole = z.infer<typeof modelRoleSchema>

export const modelManifestEntrySchema = z.object({
  id: z.string(),
  version: z.string(),
  role: modelRoleSchema,
  urls: z.array(z.url()).min(1),
  sizeBytes: z.number().int().positive(),
  sha256: z.string().regex(/^[a-f0-9]{64}$/i),
  license: z.string(),
  licenseUrl: z.url(),
  requiredRuntimeVersion: z.string()
})
export type ModelManifestEntry = z.infer<typeof modelManifestEntrySchema>

export const modelInstallationSchema = z.object({
  modelId: z.string(),
  version: z.string(),
  role: modelRoleSchema,
  status: z.enum(["missing", "downloading", "installed", "invalid"]),
  bytesDownloaded: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  path: z.string().nullable(),
  error: z.string().nullable()
})
export type ModelInstallation = z.infer<typeof modelInstallationSchema>
