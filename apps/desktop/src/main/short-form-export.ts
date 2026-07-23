import { execFile } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { promisify } from "node:util"
import type { NormalizedVideoRect, ShortFormCaptionCue, ShortFormProject } from "@vod-search/contracts"

const execFileAsync = promisify(execFile)
const OUTPUT_WIDTH = 1080
const OUTPUT_HEIGHT = 1920

export interface ShortFormExportInput {
  project: ShortFormProject
  sourcePath: string
  outputPath: string
  resourcesPath: string
  environment?: NodeJS.ProcessEnv
  execute?: (executablePath: string, args: string[]) => Promise<unknown>
}

export async function exportShortFormVideo(input: ShortFormExportInput): Promise<void> {
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

  const workingDirectory = await mkdtemp(join(tmpdir(), "vod-search-short-form-"))
  try {
    const hasCaptions = input.project.captionStyle.enabled && input.project.captions.length > 0
    const subtitlePath = hasCaptions ? join(workingDirectory, "captions.ass") : null
    if (subtitlePath) await writeFile(subtitlePath, buildAssCaptions(input.project), "utf8")
    const args = buildShortFormArguments(input.sourcePath, input.outputPath, input.project, subtitlePath)
    if (input.execute) await input.execute(ffmpegPath, args)
    else await execFileAsync(ffmpegPath, args, { windowsHide: true, maxBuffer: 8 * 1024 * 1024 })
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

export function buildShortFormArguments(
  sourcePath: string,
  outputPath: string,
  project: ShortFormProject,
  subtitlePath: string | null
): string[] {
  const durationMs = project.endMs - project.startMs
  const filter = buildShortFormFilter(project, subtitlePath)
  return [
    "-hide_banner",
    "-loglevel", "error",
    "-y",
    "-ss", seconds(project.startMs),
    "-i", sourcePath,
    "-t", seconds(durationMs),
    "-filter_complex", filter,
    "-map", "[short-form-video]",
    "-map", "0:a:0?",
    "-c:v", "libopenh264",
    "-b:v", "8M",
    "-r", "30",
    "-pix_fmt", "yuv420p",
    "-c:a", "aac",
    "-b:a", "192k",
    "-af", "aresample=async=1:first_pts=0",
    "-movflags", "+faststart",
    outputPath
  ]
}

export function buildShortFormFilter(project: ShortFormProject, subtitlePath: string | null): string {
  const contentHeight = even(Math.max(2, Math.min(OUTPUT_HEIGHT - 2, OUTPUT_HEIGHT * project.layout.contentFraction)))
  const faceHeight = OUTPUT_HEIGHT - contentHeight
  const content = cropChain("content-source", "content", project.layout.contentRect, contentHeight)
  const face = cropChain("face-source", "face", project.layout.faceRect, faceHeight)
  const top = project.layout.faceFirst ? "face" : "content"
  const bottom = project.layout.faceFirst ? "content" : "face"
  const stackOutput = subtitlePath ? "stacked" : "short-form-video"
  const filters = [
    "[0:v]setpts=PTS-STARTPTS,split=2[content-source][face-source]",
    content,
    face,
    `[${top}][${bottom}]vstack=inputs=2[${stackOutput}]`
  ]
  if (subtitlePath) {
    filters.push(`[stacked]subtitles=filename='${escapeFilterPath(subtitlePath)}'[short-form-video]`)
  }
  return filters.join(";")
}

export function buildAssCaptions(project: ShortFormProject): string {
  const style = project.captionStyle
  const preset = captionPreset(style.preset)
  const primary = assColor(style.textColor)
  const accent = assColor(style.highlightColor)
  const position = `\\an5\\pos(${OUTPUT_WIDTH / 2},${Math.round(OUTPUT_HEIGHT * style.positionY)})`
  const events = project.captions
    .flatMap((cue) => captionEvents(cue, project.startMs, project.endMs, position, primary, accent, style.uppercase, style.preset === "impact"))
    .join("\n")

  return `[Script Info]
ScriptType: v4.00+
PlayResX: ${OUTPUT_WIDTH}
PlayResY: ${OUTPUT_HEIGHT}
ScaledBorderAndShadow: yes
WrapStyle: 2

[V4+ Styles]
Format: Name, Fontname, Fontsize, PrimaryColour, SecondaryColour, OutlineColour, BackColour, Bold, Italic, Underline, StrikeOut, ScaleX, ScaleY, Spacing, Angle, BorderStyle, Outline, Shadow, Alignment, MarginL, MarginR, MarginV, Encoding
Style: Default,${preset.font},${style.fontSize},${primary},${accent},&H00000000,${preset.backColor},${preset.bold ? -1 : 0},0,0,0,100,100,0,0,${preset.borderStyle},${preset.outline},${preset.shadow},5,36,36,36,1

[Events]
Format: Layer, Start, End, Style, Name, MarginL, MarginR, MarginV, Effect, Text
${events}
`
}

function cropChain(input: string, output: string, rect: NormalizedVideoRect, targetHeight: number): string {
  const crop = [
    `w='max(2,trunc(iw*${decimal(rect.width)}/2)*2)'`,
    `h='max(2,trunc(ih*${decimal(rect.height)}/2)*2)'`,
    `x='trunc(iw*${decimal(rect.x)})'`,
    `y='trunc(ih*${decimal(rect.y)})'`
  ].join(":")
  return `[${input}]crop=${crop},scale=${OUTPUT_WIDTH}:${targetHeight}:force_original_aspect_ratio=increase:flags=lanczos,crop=${OUTPUT_WIDTH}:${targetHeight},setsar=1[${output}]`
}

function captionEvents(
  cue: ShortFormCaptionCue,
  clipStartMs: number,
  clipEndMs: number,
  position: string,
  primaryColor: string,
  accentColor: string,
  uppercase: boolean,
  highlightWords: boolean
): string[] {
  const startMs = Math.max(cue.startMs, clipStartMs) - clipStartMs
  const endMs = Math.min(cue.endMs, clipEndMs) - clipStartMs
  if (endMs <= startMs) return []
  const rawText = uppercase ? cue.text.toLocaleUpperCase("en-US") : cue.text
  const words = rawText.split(/\s+/).filter(Boolean)
  if (!highlightWords || words.length <= 1) {
    return [dialogue(startMs, endMs, `{${position}}${escapeAssText(rawText)}`)]
  }

  const duration = endMs - startMs
  const weights = words.map((word) => Math.max(1, word.replace(/[^\p{L}\p{N}]/gu, "").length))
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0)
  let cursor = startMs
  return words.map((_, activeIndex) => {
    const next = activeIndex === words.length - 1
      ? endMs
      : cursor + duration * (weights[activeIndex] ?? 1) / totalWeight
    const text = words.map((word, index) => index === activeIndex
      ? `{\\c${accentColor}}${escapeAssText(word)}{\\c${primaryColor}}`
      : escapeAssText(word)).join(" ")
    const event = dialogue(cursor, next, `{${position}}${text}`)
    cursor = next
    return event
  })
}

function dialogue(startMs: number, endMs: number, text: string): string {
  return `Dialogue: 0,${assTimestamp(startMs)},${assTimestamp(endMs)},Default,,0,0,0,,${text}`
}

function captionPreset(preset: ShortFormProject["captionStyle"]["preset"]): {
  font: string
  bold: boolean
  borderStyle: number
  outline: number
  shadow: number
  backColor: string
} {
  if (preset === "clean") return { font: "Segoe UI Semibold", bold: true, borderStyle: 3, outline: 3, shadow: 0, backColor: "&H72000000" }
  if (preset === "minimal") return { font: "Segoe UI", bold: false, borderStyle: 1, outline: 2, shadow: 0, backColor: "&H00000000" }
  return { font: "Arial Black", bold: true, borderStyle: 1, outline: 7, shadow: 2, backColor: "&H00000000" }
}

function assTimestamp(milliseconds: number): string {
  const centiseconds = Math.max(0, Math.round(milliseconds / 10))
  const hours = Math.floor(centiseconds / 360_000)
  const minutes = Math.floor(centiseconds % 360_000 / 6_000)
  const seconds = Math.floor(centiseconds % 6_000 / 100)
  const remainder = centiseconds % 100
  return `${hours}:${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}.${String(remainder).padStart(2, "0")}`
}

function assColor(hex: string): string {
  const [red, green, blue] = [hex.slice(1, 3), hex.slice(3, 5), hex.slice(5, 7)]
  return `&H00${blue}${green}${red}`.toUpperCase()
}

function escapeAssText(value: string): string {
  return value.replace(/\\/g, "\\\\").replace(/{/g, "\\{").replace(/}/g, "\\}").replace(/\r?\n/g, "\\N")
}

function escapeFilterPath(path: string): string {
  return path
    .replace(/\\/g, "/")
    .replace(/\\/g, "\\\\")
    .replace(/:/g, "\\:")
    .replace(/'/g, "\\'")
}

function seconds(milliseconds: number): string {
  return (milliseconds / 1000).toFixed(3)
}

function decimal(value: number): string {
  return value.toFixed(6)
}

function even(value: number): number {
  return Math.round(value / 2) * 2
}
