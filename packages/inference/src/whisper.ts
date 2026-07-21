import { createReadStream } from "node:fs"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { z } from "zod"
import { runProcess } from "./process.js"

const whisperOutputSchema = z.object({
  transcription: z.array(z.object({
    timestamps: z.object({ from: z.string(), to: z.string() }),
    text: z.string(),
    offsets: z.object({ from: z.number(), to: z.number() }).optional()
  })).default([])
})

export interface WhisperSegment {
  startMs: number
  endMs: number
  text: string
  confidence: number | null
}

export interface WhisperOptions {
  ffmpegPath: string
  whisperPath: string
  modelPath: string
  mediaPath: string
  vocabulary?: string[]
  threads?: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export async function transcribeWithWhisper(options: WhisperOptions): Promise<WhisperSegment[]> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "vod-search-whisper-"))
  const wavPath = join(workingDirectory, "audio.wav")
  const outputPrefix = join(workingDirectory, "transcript")
  try {
    await runProcess(options.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", options.mediaPath,
      "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
      wavPath
    ], { signal: options.signal })

    const args = [
      "-m", options.modelPath,
      "-f", wavPath,
      "-l", "en",
      "-oj",
      "-of", outputPrefix,
      "--no-prints",
      "--print-progress"
    ]
    if (options.threads) args.push("-t", String(options.threads))
    if (options.vocabulary?.length) args.push("--prompt", options.vocabulary.join(", "))

    await runProcess(options.whisperPath, args, {
      signal: options.signal,
      onStderr: (text) => {
        const match = text.match(/progress\s*=\s*(\d+)%/i)
        if (match?.[1]) options.onProgress?.(Number(match[1]) / 100)
      }
    })

    const parsed = whisperOutputSchema.parse(JSON.parse(await readFile(`${outputPrefix}.json`, "utf8")))
    return parsed.transcription.flatMap((segment): WhisperSegment[] => {
      const startMs = segment.offsets?.from ?? parseWhisperTimestamp(segment.timestamps.from)
      const endMs = segment.offsets?.to ?? parseWhisperTimestamp(segment.timestamps.to)
      const text = segment.text.trim()
      return text && endMs > startMs ? [{ startMs, endMs, text, confidence: null }] : []
    })
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

// Retained for callers that need to stream or inspect the temporary audio in
// future runtime adapters without changing the transcription contract.
export function openAudioStream(path: string): NodeJS.ReadableStream {
  return createReadStream(path)
}

function parseWhisperTimestamp(value: string): number {
  const match = value.match(/(\d{2}):(\d{2}):(\d{2})[,.](\d{3})/)
  if (!match) return 0
  return (((Number(match[1]) * 60 + Number(match[2])) * 60 + Number(match[3])) * 1000) + Number(match[4])
}
