import {
  isJobStageAllowed,
  nextProcessingWindowStart,
  scheduleGroupForJobStage,
  type CodexStatus,
  type Job,
  type MediaAsset,
  type ProcessingSchedule,
  type ProcessingScheduleGroup,
  type SpeakerEngineStatus
} from "@vod-search/contracts"

export function localDateStart(value: string): number {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day!).getTime()
}

export function joinDisplayPath(folder: string, relative: string): string {
  const separator = folder.includes("\\") ? "\\" : "/"
  return `${folder.replace(/[\\/]$/, "")}${separator}${relative}`
}

export function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}

export function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

export function timeToMinute(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return Math.max(0, Math.min(1_439, (hours ?? 0) * 60 + (minutes ?? 0)))
}

export function formatDuration(milliseconds: number): string {
  const hours = milliseconds / 3_600_000
  if (hours >= 1) return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hours`
  return `${Math.round(milliseconds / 60_000)} minutes`
}

export function formatDate(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(milliseconds)
}

export function formatRelative(milliseconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1_440)}d ago`
}

export function formatNextScheduleStart(next: Date): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const sameDay = next.toDateString() === now.toDateString()
  const nextDay = next.toDateString() === tomorrow.toDateString()
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(next)
  if (sameDay) return `starts at ${time}`
  if (nextDay) return `starts tomorrow at ${time}`
  return `starts ${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(next)}`
}

export function processingGroupLabel(group: ProcessingScheduleGroup): string {
  if (group === "ingestion") return "Ingestion"
  if (group === "transcription") return "Transcription"
  return "AI summaries"
}

export function jobStatusDescription(job: Job, schedule: ProcessingSchedule): string {
  if (job.status === "running") return `${humanize(job.stage)} is ${Math.round(job.progress * 100)}% complete`
  if (job.status === "queued") {
    const group = scheduleGroupForJobStage(job.stage)
    if (group && !isJobStageAllowed(schedule, job.stage)) {
      const next = nextProcessingWindowStart(schedule[group])
      return `${processingGroupLabel(group)} is scheduled${next ? ` · ${formatNextScheduleStart(next)}` : ""}`
    }
    return `Waiting for an available ${humanize(job.stage).toLocaleLowerCase("en-US")} worker`
  }
  if (job.status === "paused") return "Paused; resume processing when this computer is available"
  if (job.status === "succeeded") return `${humanize(job.stage)} completed successfully`
  if (job.status === "failed") return `${humanize(job.stage)} stopped and can be retried`
  return `${humanize(job.stage)} was cancelled`
}

export function formatJobTiming(job: Job): string {
  if (job.status === "running") return `Running ${formatCompactDuration(Date.now() - job.updatedAtMs)}`
  if (job.status === "queued" || job.status === "paused") return `Queued ${formatRelative(job.createdAtMs)}`
  return `Updated ${formatRelative(job.updatedAtMs)}`
}

export function estimateJobRemaining(job: Job): string {
  const elapsed = Math.max(1_000, Date.now() - job.createdAtMs)
  const estimated = elapsed / job.progress * (1 - job.progress)
  return formatCompactDuration(Math.min(estimated, 24 * 60 * 60_000))
}

export function formatCompactDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

export function summarizeJobError(error: string): string {
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines.at(-1) ?? error
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary
}

export function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

export function stageLabel(stage: MediaAsset["highestCompletedStage"]): string {
  if (stage === "ready") return "Ready"
  if (stage === "embedded" || stage === "enriched") return "Searchable"
  if (stage === "chunked") return "Indexed"
  return humanize(stage)
}

export function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase())
}

export function modelName(modelId: string): string {
  return ({ "whisper-small-en": "Whisper small.en", "bge-small-en-v1.5": "Semantic search index" } as Record<string, string>)[modelId] ?? modelId
}

export function modelDescription(modelId: string): string {
  return ({ "whisper-small-en": "Local speech transcription", "bge-small-en-v1.5": "Local vector encoder for meaning-based search" } as Record<string, string>)[modelId] ?? "Local component"
}

export function codexStatusLabel(status: CodexStatus): string {
  return ({ checking: "Checking", missing: "Not installed", installing: "Installing", "signed-out": "Sign-in required", "signing-in": "Signing in", ready: "Ready", updating: "Updating", unsupported: "Manual setup required", error: "Needs attention" } as const)[status.state]
}

export function speakerEngineLabel(status: SpeakerEngineStatus): string {
  if (status.state === "ready") return "Bundled"
  if (status.state === "missing") return "Build assets missing"
  if (status.state === "error") return "Needs attention"
  return "Preparing"
}
