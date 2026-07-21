import { z } from "zod"
import { runProcess } from "./process.js"

const ffprobeSchema = z.object({
  format: z.object({
    duration: z.string().optional(),
    format_name: z.string().optional()
  }).optional(),
  streams: z.array(z.object({
    codec_type: z.enum(["video", "audio", "subtitle"]).or(z.string()),
    codec_name: z.string().optional(),
    index: z.number().int(),
    tags: z.record(z.string(), z.string()).optional()
  })).default([])
})

export interface MediaProbeResult {
  durationMs: number | null
  container: string | null
  videoCodec: string | null
  audioCodec: string | null
  subtitles: Array<{ streamIndex: number; language: string | null; title: string | null }>
}

export async function probeMedia(
  ffprobePath: string,
  mediaPath: string,
  signal?: AbortSignal
): Promise<MediaProbeResult> {
  const result = await runProcess(ffprobePath, [
    "-v", "error",
    "-show_format",
    "-show_streams",
    "-of", "json",
    mediaPath
  ], { signal })
  const parsed = ffprobeSchema.parse(JSON.parse(result.stdout))
  const durationSeconds = parsed.format?.duration ? Number(parsed.format.duration) : Number.NaN
  const video = parsed.streams.find((stream) => stream.codec_type === "video")
  const audio = parsed.streams.find((stream) => stream.codec_type === "audio")
  return {
    durationMs: Number.isFinite(durationSeconds) ? Math.max(0, Math.round(durationSeconds * 1000)) : null,
    container: parsed.format?.format_name ?? null,
    videoCodec: video?.codec_name ?? null,
    audioCodec: audio?.codec_name ?? null,
    subtitles: parsed.streams
      .filter((stream) => stream.codec_type === "subtitle")
      .map((stream) => ({
        streamIndex: stream.index,
        language: stream.tags?.language ?? null,
        title: stream.tags?.title ?? null
      }))
  }
}

