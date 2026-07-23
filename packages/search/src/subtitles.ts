import type { TranscriptSegment } from "@vod-search/contracts"

export interface ParsedSubtitleSegment {
  startMs: number
  endMs: number
  text: string
}

export function parseSubtitle(content: string, extension: string): ParsedSubtitleSegment[] {
  const normalizedExtension = extension.toLowerCase().replace(/^\./, "")
  if (normalizedExtension === "ass" || normalizedExtension === "ssa") return parseAss(content)
  if (normalizedExtension === "vtt") return parseVtt(content)
  if (normalizedExtension === "srt") return parseSrt(content)
  throw new Error(`Unsupported subtitle format: ${extension}`)
}

export function parseSrt(content: string): ParsedSubtitleSegment[] {
  return parseTimedBlocks(content.replace(/^\uFEFF/, ""), /\r?\n\r?\n+/)
}

export function parseVtt(content: string): ParsedSubtitleSegment[] {
  const withoutHeader = content.replace(/^\uFEFF?WEBVTT[^\n]*\r?\n/, "")
  return parseTimedBlocks(withoutHeader, /\r?\n\r?\n+/)
}

function parseTimedBlocks(content: string, separator: RegExp): ParsedSubtitleSegment[] {
  const segments: ParsedSubtitleSegment[] = []
  for (const rawBlock of content.split(separator)) {
    const lines = rawBlock.split(/\r?\n/).map((line) => line.trim())
    const timingIndex = lines.findIndex((line) => line.includes("-->"))
    if (timingIndex < 0) continue

    const [rawStart, rawEndWithSettings] = lines[timingIndex]!.split("-->").map((part) => part.trim())
    if (!rawStart || !rawEndWithSettings) continue
    const rawEnd = rawEndWithSettings.split(/\s+/)[0]
    if (!rawEnd) continue

    const startMs = parseTimestamp(rawStart)
    const endMs = parseTimestamp(rawEnd)
    if (startMs === null || endMs === null || endMs <= startMs) continue

    const text = cleanSubtitleText(lines.slice(timingIndex + 1).join(" "))
    if (text) segments.push({ startMs, endMs, text })
  }
  return deduplicateAdjacent(segments)
}

export function parseAss(content: string): ParsedSubtitleSegment[] {
  const segments: ParsedSubtitleSegment[] = []
  for (const line of content.replace(/^\uFEFF/, "").split(/\r?\n/)) {
    if (!line.startsWith("Dialogue:")) continue
    const fields = line.slice("Dialogue:".length).split(",")
    if (fields.length < 10) continue
    const startMs = parseTimestamp(fields[1]!.trim())
    const endMs = parseTimestamp(fields[2]!.trim())
    if (startMs === null || endMs === null || endMs <= startMs) continue
    const text = cleanSubtitleText(fields.slice(9).join(",").replace(/\\N/gi, " "))
    if (text) segments.push({ startMs, endMs, text })
  }
  return deduplicateAdjacent(segments)
}

export function parseTimestamp(value: string): number | null {
  const match = value.trim().match(/^(?:(\d+):)?(\d{1,2}):(\d{2})(?:[,.](\d{1,3}))?$/)
  if (!match) return null
  const hours = Number(match[1] ?? 0)
  const minutes = Number(match[2])
  const seconds = Number(match[3])
  const fraction = (match[4] ?? "0").padEnd(3, "0").slice(0, 3)
  if (minutes > 59 || seconds > 59) return null
  return ((hours * 60 + minutes) * 60 + seconds) * 1000 + Number(fraction)
}

function cleanSubtitleText(text: string): string {
  return stripSubtitleMarkup(decodeSubtitleEntities(text)).replace(/\s+/g, " ").trim()
}

function decodeSubtitleEntities(text: string): string {
  const entities: ReadonlyArray<readonly [string, string]> = [
    ["&nbsp;", " "],
    ["&amp;", "&"],
    ["&lt;", "<"],
    ["&gt;", ">"]
  ]
  let output = ""
  for (let index = 0; index < text.length;) {
    let decoded = false
    if (text[index] === "&") {
      for (const [entity, replacement] of entities) {
        if (text.slice(index, index + entity.length).toLowerCase() !== entity) continue
        output += replacement
        index += entity.length
        decoded = true
        break
      }
    }
    if (!decoded) {
      output += text[index]
      index += 1
    }
  }
  return output
}

function stripSubtitleMarkup(text: string): string {
  let output = ""
  let markup: "ass" | "html" | null = null
  let markupStart = -1
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index]!
    if (markup === "ass") {
      if (character === "}") {
        markup = null
        markupStart = -1
      }
      continue
    }
    if (markup === "html") {
      if (character === ">") {
        markup = null
        markupStart = -1
      }
      continue
    }
    if (character === "{" && text[index + 1] === "\\") {
      markup = "ass"
      markupStart = index
      continue
    }
    if (character === "<") {
      markup = "html"
      markupStart = index
      continue
    }
    output += character
  }
  if (markup && markupStart >= 0) output += text.slice(markupStart)
  return output
}

function deduplicateAdjacent(segments: ParsedSubtitleSegment[]): ParsedSubtitleSegment[] {
  const output: ParsedSubtitleSegment[] = []
  for (const segment of segments.sort((a, b) => a.startMs - b.startMs)) {
    const previous = output.at(-1)
    if (previous && previous.text === segment.text && segment.startMs <= previous.endMs + 250) {
      previous.endMs = Math.max(previous.endMs, segment.endMs)
    } else {
      output.push({ ...segment })
    }
  }
  return output
}

export function toTranscriptSegments(
  mediaId: string,
  source: TranscriptSegment["source"],
  segments: ParsedSubtitleSegment[]
): Array<Omit<TranscriptSegment, "id">> {
  return segments.map((segment) => ({
    mediaId,
    source,
    confidence: null,
    mediaSpeakerId: null,
    ...segment
  }))
}

