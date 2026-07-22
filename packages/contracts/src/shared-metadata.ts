import { z } from "zod"
import { enrichmentEntitySchema, enrichmentEventSchema, transcriptSourceSchema } from "./domain.js"

export const sharedTranscriptSegmentSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  text: z.string().min(1).max(20_000),
  confidence: z.number().min(0).max(1).nullable()
}).strict()

export const sharedTranscriptTopicSchema = z.object({
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().nonnegative(),
  summary: z.string().min(1).max(640),
  entities: z.array(enrichmentEntitySchema).max(20),
  events: z.array(enrichmentEventSchema).max(20),
  aliases: z.array(z.string().min(1).max(80)).max(30),
  searchPhrases: z.array(z.string().min(1).max(160)).max(20),
  confidence: z.number().min(0).max(1)
}).strict()

export const sharedTranscriptBundleSchema = z.object({
  schemaVersion: z.literal(1),
  fingerprint: z.string().regex(/^[a-f0-9]{64}$/i),
  mediaRelativePath: z.string().min(1).max(2_048),
  mediaSizeBytes: z.number().int().nonnegative(),
  mediaDurationMs: z.number().int().nonnegative().nullable(),
  transcriptSource: transcriptSourceSchema,
  transcriptVersion: z.string().min(1).max(300),
  enrichmentVersion: z.string().min(1).max(300),
  generatedAtMs: z.number().int().nonnegative(),
  segments: z.array(sharedTranscriptSegmentSchema).min(1).max(250_000),
  topics: z.array(sharedTranscriptTopicSchema).min(1).max(20_000)
}).strict()

export type SharedTranscriptSegment = z.infer<typeof sharedTranscriptSegmentSchema>
export type SharedTranscriptTopic = z.infer<typeof sharedTranscriptTopicSchema>
export type SharedTranscriptBundle = z.infer<typeof sharedTranscriptBundleSchema>
