import { createHash } from "node:crypto"
import { open, readFile, readdir, realpath, stat } from "node:fs/promises"
import { basename, dirname, extname, relative, resolve } from "node:path"
import type { Repository } from "@vod-search/database"
import { chunkTranscript, parseSubtitle } from "@vod-search/search"
import { importSharedMetadata } from "./shared-metadata.js"

const mediaExtensions = new Set([".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts"])
const subtitleExtensions = [".srt", ".vtt", ".ass"] as const
const fingerprintBytes = 1024 * 1024

export interface ScanCallbacks {
  onProgress?: (discovered: number) => void
  onMediaIndexed?: () => void
}

export async function scanSourceFolder(
  repository: Repository,
  sourceFolderId: string,
  sourcePath: string,
  callbacks: ScanCallbacks = {}
): Promise<void> {
  const canonicalRoot = await realpath(sourcePath)
  const mediaPaths: string[] = []
  const subtitleByStem = new Map<string, string>()

  for await (const path of walk(canonicalRoot)) {
    const extension = extname(path).toLowerCase()
    if (mediaExtensions.has(extension)) mediaPaths.push(path)
    else if (subtitleExtensions.includes(extension as typeof subtitleExtensions[number])) {
      const stem = path.slice(0, -extension.length).toLocaleLowerCase("en-US")
      if (!subtitleByStem.has(stem) || subtitleExtensions.indexOf(extension as typeof subtitleExtensions[number]) <
          subtitleExtensions.indexOf(extname(subtitleByStem.get(stem)!).toLowerCase() as typeof subtitleExtensions[number])) {
        subtitleByStem.set(stem, path)
      }
    }
  }

  const canonicalPaths: string[] = []
  for (const path of mediaPaths) {
    try { canonicalPaths.push(await realpath(path)) } catch { /* The file disappeared during discovery. */ }
  }
  repository.markMissingExcept(sourceFolderId, canonicalPaths)

  for (let index = 0; index < canonicalPaths.length; index += 1) {
    const canonicalPath = canonicalPaths[index]!
    try {
      const fileStat = await stat(canonicalPath)
      const media = repository.upsertMedia({
        sourceFolderId,
        relativePath: relative(canonicalRoot, canonicalPath),
        canonicalPath,
        displayName: basename(canonicalPath),
        sizeBytes: fileStat.size,
        createdAtMs: Math.round(fileStat.birthtimeMs > 0 ? fileStat.birthtimeMs : fileStat.mtimeMs),
        modifiedAtMs: Math.round(fileStat.mtimeMs),
        quickFingerprint: await quickFingerprint(canonicalPath, fileStat.size)
      })
      repository.enqueueJob(media.id, "probe", Math.round(fileStat.mtimeMs / 1000))

      const mediaStem = canonicalPath.slice(0, -extname(canonicalPath).length).toLocaleLowerCase("en-US")
      const subtitlePath = subtitleByStem.get(mediaStem)
      if (subtitlePath) {
        await indexSidecar(repository, media.id, subtitlePath)
        repository.cancelJob(media.id, "transcribe")
      }
      try {
        await importSharedMetadata(repository, media.id, canonicalRoot)
      } catch (error) {
        console.warn(`Shared VOD Search metadata could not be imported for ${canonicalPath}:`, error)
      }
      callbacks.onProgress?.(index + 1)
      callbacks.onMediaIndexed?.()
    } catch (error) {
      console.error(`Failed to inspect ${canonicalPath}:`, error)
    }
  }

  repository.markMissingExcept(sourceFolderId, canonicalPaths)
  repository.finishSourceFolderScan(sourceFolderId)
}

async function indexSidecar(repository: Repository, mediaId: string, subtitlePath: string): Promise<void> {
  const extension = extname(subtitlePath).toLowerCase()
  const subtitleStat = await stat(subtitlePath)
  const segments = parseSubtitle(await readFile(subtitlePath, "utf8"), extension)
  if (segments.length === 0) return
  const version = `sidecar-v1:${Math.round(subtitleStat.mtimeMs)}:${subtitleStat.size}`
  if (repository.getTranscriptVersion(mediaId) === version) return
  repository.replaceTranscript(mediaId, "sidecar", version, segments)
  repository.setMediaStage(mediaId, "subtitled")
  const chunks = chunkTranscript(segments)
  repository.replaceChunks(mediaId, "chunk-v1", chunks)
  repository.requeueJob(mediaId, "enrich")
}

async function quickFingerprint(path: string, size: number): Promise<string> {
  const handle = await open(path, "r")
  try {
    const firstLength = Math.min(size, fingerprintBytes)
    const lastLength = Math.min(Math.max(0, size - firstLength), fingerprintBytes)
    const first = Buffer.alloc(firstLength)
    const last = Buffer.alloc(lastLength)
    if (firstLength) await handle.read(first, 0, firstLength, 0)
    if (lastLength) await handle.read(last, 0, lastLength, Math.max(0, size - lastLength))
    return createHash("sha256")
      .update(String(size))
      .update("\0")
      .update(first)
      .update(last)
      .digest("hex")
  } finally {
    await handle.close()
  }
}

async function* walk(root: string): AsyncGenerator<string> {
  const directories = [resolve(root)]
  while (directories.length > 0) {
    const directory = directories.pop()!
    let entries
    try {
      entries = await readdir(directory, { withFileTypes: true })
    } catch {
      continue
    }
    for (const entry of entries) {
      const path = resolve(directory, entry.name)
      if (entry.isDirectory()) directories.push(path)
      else if (entry.isFile()) yield path
    }
  }
}
