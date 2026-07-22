import { z } from "zod"
import type { JobStage } from "./domain.js"

export const processingWindowSchema = z.object({
  enabled: z.boolean(),
  startMinute: z.number().int().min(0).max(1_439),
  endMinute: z.number().int().min(0).max(1_439)
})
export type ProcessingWindow = z.infer<typeof processingWindowSchema>

export const processingScheduleSchema = z.object({
  ingestion: processingWindowSchema,
  transcription: processingWindowSchema,
  summarization: processingWindowSchema
})
export type ProcessingSchedule = z.infer<typeof processingScheduleSchema>
export type ProcessingScheduleGroup = keyof ProcessingSchedule

export const defaultProcessingSchedule: ProcessingSchedule = {
  ingestion: { enabled: false, startMinute: 8 * 60, endMinute: 22 * 60 },
  transcription: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60 },
  summarization: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60 }
}

export function scheduleGroupForJobStage(stage: JobStage): ProcessingScheduleGroup | null {
  if (["probe", "subtitles", "chunk", "preview"].includes(stage)) return "ingestion"
  if (stage === "transcribe") return "transcription"
  if (stage === "enrich") return "summarization"
  return null
}

export function isJobStageAllowed(schedule: ProcessingSchedule, stage: JobStage, at = new Date()): boolean {
  const group = scheduleGroupForJobStage(stage)
  return group === null || isProcessingWindowOpen(schedule[group], at)
}

export function isProcessingWindowOpen(window: ProcessingWindow, at = new Date()): boolean {
  if (!window.enabled || window.startMinute === window.endMinute) return true
  const minute = at.getHours() * 60 + at.getMinutes()
  if (window.startMinute < window.endMinute) {
    return minute >= window.startMinute && minute < window.endMinute
  }
  return minute >= window.startMinute || minute < window.endMinute
}

export function nextProcessingWindowStart(window: ProcessingWindow, at = new Date()): Date | null {
  if (!window.enabled || isProcessingWindowOpen(window, at)) return null
  const next = new Date(at)
  next.setHours(Math.floor(window.startMinute / 60), window.startMinute % 60, 0, 0)
  if (next.getTime() <= at.getTime()) next.setDate(next.getDate() + 1)
  return next
}
