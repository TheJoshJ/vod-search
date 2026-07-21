import { readFile, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { runProcess } from "./process.js"

export async function extractEmbeddedSubtitle(
  ffmpegPath: string,
  mediaPath: string,
  streamIndex: number,
  signal?: AbortSignal
): Promise<string> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "vod-search-subtitles-"))
  const subtitlePath = join(workingDirectory, "subtitle.srt")
  try {
    await runProcess(ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", mediaPath,
      "-map", `0:${streamIndex}`,
      subtitlePath
    ], { signal })
    return await readFile(subtitlePath, "utf8")
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}
