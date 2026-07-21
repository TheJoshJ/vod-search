import { z } from "zod"

export const searchRequestSchema = z.object({
  query: z.string().trim().min(1).max(500),
  sourceFolderIds: z.array(z.string()).max(100).optional(),
  includeMissing: z.boolean().default(false),
  limit: z.number().int().min(1).max(100).default(20)
})
export type SearchRequest = z.infer<typeof searchRequestSchema>

export const matchReasonSchema = z.enum(["exact", "transcript", "tag", "semantic"])

export const searchHitSchema = z.object({
  mediaId: z.string(),
  title: z.string(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  transcriptExcerpt: z.string(),
  summary: z.string().nullable(),
  entities: z.array(z.string()),
  events: z.array(z.string()),
  availability: z.enum(["available", "missing"]),
  matchReasons: z.array(matchReasonSchema),
  score: z.number()
})
export type SearchHit = z.infer<typeof searchHitSchema>

export const searchResponseSchema = z.object({
  hits: z.array(searchHitSchema),
  elapsedMs: z.number().nonnegative(),
  indexedChunkCount: z.number().int().nonnegative()
})
export type SearchResponse = z.infer<typeof searchResponseSchema>

