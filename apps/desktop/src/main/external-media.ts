import { execFile, spawn } from "node:child_process"
import { createHash } from "node:crypto"
import { access, mkdir, stat } from "node:fs/promises"
import { join } from "node:path"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)

export interface ExternalOpenResult {
  mode: "timestamp-player" | "generated-clip"
  playerName: string | null
}

export async function exportMediaClip(input: {
  sourcePath: string
  outputPath: string
  startMs: number
  endMs: number
  resourcesPath: string
  environment?: NodeJS.ProcessEnv
  execute?: (executablePath: string, args: string[]) => Promise<unknown>
}): Promise<void> {
  const environment = input.environment ?? process.env
  const ffmpegPath = environment.VOD_SEARCH_FFMPEG_PATH ?? join(
    input.resourcesPath,
    "runtime",
    "windows",
    "ffmpeg",
    "bin",
    "ffmpeg.exe"
  )
  await access(ffmpegPath)
  const args = buildTimestampClipArguments(input.sourcePath, input.outputPath, input.startMs, input.endMs - input.startMs)
  if (input.execute) await input.execute(ffmpegPath, args)
  else await execFileAsync(ffmpegPath, args, { windowsHide: true, maxBuffer: 4 * 1024 * 1024 })
}

interface TimestampPlayer {
  name: string
  path: string
  args: (sourcePath: string, startMs: number) => string[]
}

export async function openMediaAtTimestamp(input: {
  sourcePath: string
  mediaId: string
  startMs: number
  resourcesPath: string
  temporaryPath: string
  environment?: NodeJS.ProcessEnv
  openPath: (path: string) => Promise<string>
}): Promise<ExternalOpenResult> {
  const environment = input.environment ?? process.env
  const player = await findTimestampPlayer(environment)
  if (player) {
    await spawnDetached(player.path, player.args(input.sourcePath, input.startMs))
    return { mode: "timestamp-player", playerName: player.name }
  }

  const ffmpegPath = environment.VOD_SEARCH_FFMPEG_PATH ?? join(
    input.resourcesPath,
    "runtime",
    "windows",
    "ffmpeg",
    "bin",
    "ffmpeg.exe"
  )
  await access(ffmpegPath)
  const clipDirectory = join(input.temporaryPath, "CutScout", "clips")
  await mkdir(clipDirectory, { recursive: true })
  const sourceStats = await stat(input.sourcePath)
  const cacheKey = createHash("sha256")
    .update(`${input.mediaId}:${input.startMs}:${sourceStats.size}:${sourceStats.mtimeMs}`)
    .digest("hex")
    .slice(0, 16)
  const clipPath = join(clipDirectory, `${cacheKey}.mp4`)

  try {
    await access(clipPath)
  } catch {
    await execFileAsync(ffmpegPath, buildTimestampClipArguments(input.sourcePath, clipPath, input.startMs), {
      windowsHide: true,
      maxBuffer: 4 * 1024 * 1024
    })
  }

  const openError = await input.openPath(clipPath)
  if (openError) throw new Error(openError)
  return { mode: "generated-clip", playerName: null }
}

export function buildTimestampClipArguments(
  sourcePath: string,
  outputPath: string,
  startMs: number,
  durationMs = 30_000
): string[] {
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-ss", (startMs / 1000).toFixed(3),
    "-i", sourcePath,
    "-t", (durationMs / 1000).toFixed(3),
    "-map", "0:v:0?",
    "-map", "0:a:0?",
    "-c:v", "libopenh264",
    "-b:v", "4M",
    "-c:a", "aac",
    "-movflags", "+faststart",
    outputPath
  ]
}

export function timestampPlayerCandidates(environment: NodeJS.ProcessEnv): TimestampPlayer[] {
  const paths = [
    environment.ProgramFiles ? join(environment.ProgramFiles, "VideoLAN", "VLC", "vlc.exe") : null,
    environment["ProgramFiles(x86)"] ? join(environment["ProgramFiles(x86)"]!, "VideoLAN", "VLC", "vlc.exe") : null,
    environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "VideoLAN", "VLC", "vlc.exe") : null,
    environment.ProgramFiles ? join(environment.ProgramFiles, "mpv", "mpv.exe") : null,
    environment.LOCALAPPDATA ? join(environment.LOCALAPPDATA, "Programs", "mpv", "mpv.exe") : null
  ].filter((path): path is string => Boolean(path))

  return paths.map((path) => path.toLocaleLowerCase("en-US").endsWith("vlc.exe")
    ? {
        name: "VLC",
        path,
        args: (sourcePath, startMs) => ["--start-time", (startMs / 1000).toFixed(3), sourcePath]
      }
    : {
        name: "mpv",
        path,
        args: (sourcePath, startMs) => [`--start=${(startMs / 1000).toFixed(3)}`, sourcePath]
      })
}

async function findTimestampPlayer(environment: NodeJS.ProcessEnv): Promise<TimestampPlayer | null> {
  for (const candidate of timestampPlayerCandidates(environment)) {
    try {
      await access(candidate.path)
      return candidate
    } catch {
      // Continue through known timestamp-aware players.
    }
  }
  return null
}

async function spawnDetached(executablePath: string, args: string[]): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executablePath, args, { detached: true, stdio: "ignore" })
    child.once("error", reject)
    child.once("spawn", () => {
      child.unref()
      resolve()
    })
  })
}
