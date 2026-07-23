import { z } from "zod"

export const normalizedVideoRectSchema = z.object({
  x: z.number().min(0).max(1),
  y: z.number().min(0).max(1),
  width: z.number().min(0.08).max(1),
  height: z.number().min(0.08).max(1)
}).superRefine((rect, context) => {
  if (rect.x + rect.width > 1.000_001) {
    context.addIssue({ code: "custom", message: "Crop extends past the right edge", path: ["width"] })
  }
  if (rect.y + rect.height > 1.000_001) {
    context.addIssue({ code: "custom", message: "Crop extends past the bottom edge", path: ["height"] })
  }
})

export type NormalizedVideoRect = z.infer<typeof normalizedVideoRectSchema>

export const shortFormLayoutSchema = z.object({
  contentRect: normalizedVideoRectSchema,
  faceRect: normalizedVideoRectSchema,
  contentFraction: z.number().min(0.4).max(0.82),
  faceFirst: z.boolean()
})

export type ShortFormLayout = z.infer<typeof shortFormLayoutSchema>

export const shortFormCaptionPresetSchema = z.enum(["impact", "clean", "minimal"])
export type ShortFormCaptionPreset = z.infer<typeof shortFormCaptionPresetSchema>

export const shortFormCaptionStyleSchema = z.object({
  enabled: z.boolean(),
  preset: shortFormCaptionPresetSchema,
  fontSize: z.number().int().min(36).max(140),
  positionY: z.number().min(0.12).max(0.9),
  textColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  highlightColor: z.string().regex(/^#[0-9a-f]{6}$/i),
  uppercase: z.boolean()
})

export type ShortFormCaptionStyle = z.infer<typeof shortFormCaptionStyleSchema>

export const shortFormCaptionCueSchema = z.object({
  id: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  text: z.string().trim().min(1).max(240)
}).refine((cue) => cue.endMs > cue.startMs, {
  message: "Caption end must follow its start",
  path: ["endMs"]
})

export type ShortFormCaptionCue = z.infer<typeof shortFormCaptionCueSchema>

export const shortFormProjectSchema = z.object({
  mediaId: z.string().min(1),
  title: z.string().trim().min(1).max(160),
  contextStartMs: z.number().int().nonnegative(),
  contextEndMs: z.number().int().positive(),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive(),
  layout: shortFormLayoutSchema,
  captionStyle: shortFormCaptionStyleSchema,
  captions: z.array(shortFormCaptionCueSchema).max(500)
}).superRefine((project, context) => {
  if (project.contextEndMs <= project.contextStartMs || project.contextEndMs - project.contextStartMs > 30 * 60_000) {
    context.addIssue({
      code: "custom",
      message: "Short-form context must be between one millisecond and 30 minutes",
      path: ["contextEndMs"]
    })
  }
  if (project.endMs <= project.startMs || project.endMs - project.startMs > 30 * 60_000) {
    context.addIssue({
      code: "custom",
      message: "Short-form duration must be between one millisecond and 30 minutes",
      path: ["endMs"]
    })
  }
  if (project.startMs < project.contextStartMs || project.endMs > project.contextEndMs) {
    context.addIssue({
      code: "custom",
      message: "Short-form in and out points must stay inside the source context",
      path: ["startMs"]
    })
  }
})

export type ShortFormProject = z.infer<typeof shortFormProjectSchema>

export const shortFormExportResponseSchema = z.object({ path: z.string().nullable() })
export type ShortFormExportResponse = z.infer<typeof shortFormExportResponseSchema>
