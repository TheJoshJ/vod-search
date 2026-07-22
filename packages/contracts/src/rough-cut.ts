import { z } from "zod"

export const roughCutFrameRateSchema = z.enum([
  "23.976",
  "24",
  "25",
  "29.97",
  "30",
  "50",
  "59.94",
  "60"
])
export type RoughCutFrameRate = z.infer<typeof roughCutFrameRateSchema>

export const roughCutGenerateRequestSchema = z.object({
  title: z.string().trim().min(1).max(120).optional(),
  prompt: z.string().trim().min(1).max(4_000),
  mediaIds: z.array(z.string().min(1)).min(1).max(25)
    .refine((ids) => new Set(ids).size === ids.length, "Selected media must be unique"),
  handleBeforeMs: z.number().int().min(0).max(120_000).default(15_000),
  handleAfterMs: z.number().int().min(0).max(120_000).default(15_000),
  frameRate: roughCutFrameRateSchema.default("30")
})
export type RoughCutGenerateRequest = z.infer<typeof roughCutGenerateRequestSchema>

export const roughCutPlanItemSchema = z.object({
  id: z.string().uuid(),
  order: z.number().int().nonnegative(),
  mediaId: z.string().min(1),
  sourcePath: z.string().min(1),
  sourceTitle: z.string().min(1),
  sourceDurationMs: z.number().int().positive(),
  contentStartMs: z.number().int().nonnegative(),
  contentEndMs: z.number().int().positive(),
  sourceInMs: z.number().int().nonnegative(),
  sourceOutMs: z.number().int().positive(),
  sequenceStartMs: z.number().int().nonnegative(),
  sequenceEndMs: z.number().int().positive(),
  handleBeforeMs: z.number().int().nonnegative(),
  handleAfterMs: z.number().int().nonnegative(),
  requestedText: z.string().min(1).max(240),
  matchRationale: z.string().min(1).max(480),
  transcriptExcerpt: z.string().min(1).max(1_200)
}).superRefine((item, context) => {
  if (item.contentEndMs <= item.contentStartMs) {
    context.addIssue({ code: "custom", path: ["contentEndMs"], message: "Content end must follow content start" })
  }
  if (item.sourceInMs > item.contentStartMs) {
    context.addIssue({ code: "custom", path: ["sourceInMs"], message: "Source in cannot follow the matched content" })
  }
  if (item.sourceOutMs < item.contentEndMs) {
    context.addIssue({ code: "custom", path: ["sourceOutMs"], message: "Source out cannot precede the matched content" })
  }
  if (item.sourceOutMs > item.sourceDurationMs) {
    context.addIssue({ code: "custom", path: ["sourceOutMs"], message: "Source out exceeds the media duration" })
  }
  if (item.sourceOutMs <= item.sourceInMs) {
    context.addIssue({ code: "custom", path: ["sourceOutMs"], message: "Source out must follow source in" })
  }
  if (item.sequenceEndMs <= item.sequenceStartMs) {
    context.addIssue({ code: "custom", path: ["sequenceEndMs"], message: "Sequence end must follow sequence start" })
  }
})
export type RoughCutPlanItem = z.infer<typeof roughCutPlanItemSchema>

export const roughCutPlanSchema = z.object({
  version: z.literal(1),
  id: z.string().uuid(),
  title: z.string().min(1).max(120),
  brief: z.string().min(1).max(4_000),
  createdAtMs: z.number().int().nonnegative(),
  frameRate: roughCutFrameRateSchema,
  selectedMediaIds: z.array(z.string().min(1)).min(1).max(25),
  handleBeforeMs: z.number().int().min(0).max(120_000),
  handleAfterMs: z.number().int().min(0).max(120_000),
  totalDurationMs: z.number().int().positive(),
  items: z.array(roughCutPlanItemSchema).min(1).max(50)
}).superRefine((plan, context) => {
  let cursor = 0
  for (const [index, item] of plan.items.entries()) {
    if (item.order !== index) {
      context.addIssue({ code: "custom", path: ["items", index, "order"], message: "Cut order must match its array position" })
    }
    if (item.sequenceStartMs !== cursor) {
      context.addIssue({ code: "custom", path: ["items", index, "sequenceStartMs"], message: "Sequence cuts must be contiguous" })
    }
    const expectedDuration = item.sourceOutMs - item.sourceInMs
    if (item.sequenceEndMs - item.sequenceStartMs !== expectedDuration) {
      context.addIssue({ code: "custom", path: ["items", index, "sequenceEndMs"], message: "Sequence duration must match the source range" })
    }
    cursor = item.sequenceEndMs
  }
  if (plan.totalDurationMs !== cursor) {
    context.addIssue({ code: "custom", path: ["totalDurationMs"], message: "Plan duration must match its cuts" })
  }
})
export type RoughCutPlan = z.infer<typeof roughCutPlanSchema>

export const roughCutExportResponseSchema = z.object({
  xmlPath: z.string().nullable(),
  jsonPath: z.string().nullable()
})
export type RoughCutExportResponse = z.infer<typeof roughCutExportResponseSchema>
