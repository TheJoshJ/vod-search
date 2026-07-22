import { createHash, randomUUID } from "node:crypto"
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { Repository } from "@vod-search/database"
import {
  sharedTranscriptBundleSchema,
  type SharedTranscriptBundle,
  type SharedTranscriptTopic
} from "@vod-search/contracts"

const sharedDirectoryName = ".vod-search"
const maximumBundleBytes = 64 * 1024 * 1024

export async function importSharedMetadata(
  repository: Repository,
  mediaId: string,
  sourceRoot: string
): Promise<boolean> {
  const media = repository.getMedia(mediaId)
  const path = sharedBundlePath(sourceRoot, media.quickFingerprint)
  let content: string
  try {
    const file = await stat(path)
    if (file.size > maximumBundleBytes) throw new Error(`Shared metadata exceeds ${maximumBundleBytes} bytes`)
    content = await readFile(path, "utf8")
  } catch (error) {
    if (isMissingFile(error)) return false
    throw error
  }

  const bundle = sharedTranscriptBundleSchema.parse(JSON.parse(content))
  if (bundle.fingerprint !== media.quickFingerprint || bundle.mediaSizeBytes !== media.sizeBytes) {
    throw new Error("Shared metadata does not match the video fingerprint")
  }
  assertTimeline(bundle)

  const sharedVersion = `shared-v1:${createHash("sha256").update(content).digest("hex")}`
  const currentVersion = repository.getTranscriptVersion(mediaId)
  if (currentVersion === sharedVersion) return true
  if (currentVersion && !currentVersion.startsWith("shared-v1:") && repository.isEnrichmentComplete(mediaId)) {
    return false
  }

  repository.replaceTranscript(mediaId, "sidecar", sharedVersion, bundle.segments)
  repository.replaceChunksWithTopics(
    mediaId,
    materializeTopics(bundle.segments, bundle.topics),
    bundle.enrichmentVersion
  )
  repository.cancelJob(mediaId, "transcribe")
  repository.cancelJob(mediaId, "enrich")
  return true
}

export async function publishSharedMetadata(repository: Repository, mediaId: string): Promise<boolean> {
  const media = repository.getMedia(mediaId)
  const source = repository.getSourceFolder(media.sourceFolderId)
  if (!source.publishSharedMetadata || media.availability !== "available") return false
  const transcript = repository.getTranscript(mediaId)
  const topics = repository.getTopicsForSharing(mediaId)
  if (transcript.length === 0 || !topics) return false

  const bundle = sharedTranscriptBundleSchema.parse({
    schemaVersion: 1,
    fingerprint: media.quickFingerprint,
    mediaRelativePath: media.relativePath,
    mediaSizeBytes: media.sizeBytes,
    mediaDurationMs: media.durationMs,
    transcriptSource: transcript[0]!.source,
    transcriptVersion: repository.getTranscriptVersion(mediaId)!,
    enrichmentVersion: topics.enrichmentVersion,
    generatedAtMs: Date.now(),
    segments: transcript.map((segment) => ({
      startMs: segment.startMs,
      endMs: segment.endMs,
      text: segment.text,
      confidence: segment.confidence
    })),
    topics: topics.topics
  }) satisfies SharedTranscriptBundle

  const directory = join(source.path, sharedDirectoryName)
  const destination = sharedBundlePath(source.path, media.quickFingerprint)
  const temporary = join(directory, `${media.quickFingerprint}.${randomUUID()}.tmp`)
  await mkdir(directory, { recursive: true })
  await writeFile(temporary, `${JSON.stringify(bundle, null, 2)}\n`, "utf8")
  await rename(temporary, destination)
  return true
}

export function sharedBundlePath(sourceRoot: string, fingerprint: string): string {
  return join(sourceRoot, sharedDirectoryName, `${fingerprint.toLowerCase()}.json`)
}

function materializeTopics(
  segments: SharedTranscriptBundle["segments"],
  topics: SharedTranscriptTopic[]
) {
  return topics.map((topic) => {
    const transcript = segments
      .filter((segment) => segment.startMs < topic.endMs && segment.endMs > topic.startMs)
      .map((segment) => segment.text.trim())
      .filter(Boolean)
      .join(" ")
      .replace(/\s+/g, " ")
    if (!transcript) throw new Error(`Shared topic at ${topic.startMs}ms has no transcript text`)
    return { ...topic, transcript }
  })
}

function assertTimeline(bundle: SharedTranscriptBundle): void {
  for (const [index, segment] of bundle.segments.entries()) {
    if (segment.endMs <= segment.startMs) throw new Error(`Invalid shared transcript segment ${index}`)
    if (index > 0 && segment.startMs < bundle.segments[index - 1]!.startMs) {
      throw new Error("Shared transcript segments are not ordered")
    }
  }
  for (const [index, topic] of bundle.topics.entries()) {
    if (topic.endMs <= topic.startMs) throw new Error(`Invalid shared topic ${index}`)
    if (index > 0 && topic.startMs < bundle.topics[index - 1]!.endMs) {
      throw new Error("Shared topics overlap or are not ordered")
    }
  }
}

function isMissingFile(error: unknown): boolean {
  return error instanceof Error && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT"
}
