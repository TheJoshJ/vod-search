import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { extname } from "node:path"
import { Readable } from "node:stream"

interface ByteRange {
  start: number
  end: number
}

export async function serveMediaFile(path: string, request: Request): Promise<Response> {
  const metadata = await stat(path)
  const size = metadata.size
  const headers = new Headers({
    "Accept-Ranges": "bytes",
    "Content-Type": mediaType(path),
    "Last-Modified": metadata.mtime.toUTCString(),
    "Cache-Control": "no-store"
  })
  const rangeHeader = request.headers.get("range")
  const range = rangeHeader ? parseByteRange(rangeHeader, size) : null

  if (rangeHeader && !range) {
    headers.set("Content-Range", `bytes */${size}`)
    return new Response(null, { status: 416, headers })
  }

  const start = range?.start ?? 0
  const end = range?.end ?? Math.max(0, size - 1)
  const contentLength = size === 0 ? 0 : end - start + 1
  headers.set("Content-Length", String(contentLength))
  if (range) headers.set("Content-Range", `bytes ${start}-${end}/${size}`)

  if (request.method === "HEAD" || size === 0) {
    return new Response(null, { status: range ? 206 : 200, headers })
  }

  const file = createReadStream(path, { start, end })
  request.signal.addEventListener("abort", () => file.destroy(), { once: true })
  const body = Readable.toWeb(file) as ReadableStream<Uint8Array>
  return new Response(body, { status: range ? 206 : 200, headers })
}

export function parseByteRange(value: string, size: number): ByteRange | null {
  if (!Number.isSafeInteger(size) || size <= 0) return null
  const match = /^bytes=(\d*)-(\d*)$/i.exec(value.trim())
  if (!match || (!match[1] && !match[2])) return null

  if (!match[1]) {
    const suffixLength = Number(match[2])
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null
    return { start: Math.max(0, size - suffixLength), end: size - 1 }
  }

  const start = Number(match[1])
  const requestedEnd = match[2] ? Number(match[2]) : size - 1
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || requestedEnd < start || start >= size) return null
  return { start, end: Math.min(requestedEnd, size - 1) }
}

function mediaType(path: string): string {
  return ({
    ".avi": "video/x-msvideo",
    ".m4v": "video/x-m4v",
    ".mkv": "video/x-matroska",
    ".mov": "video/quicktime",
    ".mp4": "video/mp4",
    ".mpeg": "video/mpeg",
    ".mpg": "video/mpeg",
    ".webm": "video/webm"
  } as Record<string, string>)[extname(path).toLowerCase()] ?? "application/octet-stream"
}
