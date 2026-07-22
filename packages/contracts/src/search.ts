import { z } from "zod"

export const searchModeSchema = z.enum(["hybrid", "semantic", "keyword"])
export type SearchMode = z.infer<typeof searchModeSchema>

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  mode: searchModeSchema.default("hybrid"),
  createdAfterMs: z.number().int().nonnegative().optional(),
  createdBeforeMs: z.number().int().nonnegative().optional(),
  sourceFolderIds: z.array(z.string()).max(100).optional(),
  includeMissing: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20)
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

export const matchReasonSchema = z.enum(["exact", "transcript", "tag", "semantic"])

export const searchScoreBreakdownSchema = z.object({
  semantic: z.number().min(0).max(100),
  lexical: z.number().min(0).max(100),
  transcript: z.number().min(0).max(100),
  summary: z.number().min(0).max(100),
  metadata: z.number().min(0).max(100)
})
export type SearchScoreBreakdown = z.infer<typeof searchScoreBreakdownSchema>

export const searchHitSchema = z.object({
  mediaId: z.string(),
  title: z.string(),
  relativePath: z.string(),
  createdAtMs: z.number().int().nonnegative(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  transcriptExcerpt: z.string(),
  summary: z.string().nullable(),
  entities: z.array(z.string()),
  events: z.array(z.string()),
  availability: z.enum(["available", "missing"]),
  matchReasons: z.array(matchReasonSchema),
  score: z.number().min(0).max(100),
  scoreBreakdown: searchScoreBreakdownSchema
})
export type SearchHit = z.infer<typeof searchHitSchema>

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema),
  elapsedMs: z.number().nonnegative(),
  indexedChunkCount: z.number().int().nonnegative()
})
export type SearchResponse = z.infer<typeof searchResponseSchema>
