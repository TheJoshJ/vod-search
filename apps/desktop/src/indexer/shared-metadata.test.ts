import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { openDatabase, Repository } from "@vod-search/database"
import { sharedTranscriptBundleSchema } from "@vod-search/contracts"
import { importSharedMetadata, publishSharedMetadata, sharedBundlePath } from "./shared-metadata.js"

describe("shared CutScout metadata", () => {
  it("publishes a portable bundle and imports it into a fresh local index", async () => {
    const root = await mkdtemp(join(tmpdir(), "vod-search-shared-"))
    const fingerprint = "a".repeat(64)
    const firstDatabase = openDatabase(":memory:")
    const secondDatabase = openDatabase(":memory:")
    try {
      const first = new Repository(firstDatabase.db)
      const publishingFolder = first.addSourceFolder(root, root, true)
      const original = first.upsertMedia({
        sourceFolderId: publishingFolder.id,
        relativePath: "sessions\\boss-fight.mp4",
        canonicalPath: join(root, "sessions", "boss-fight.mp4"),
        displayName: "boss-fight.mp4",
        sizeBytes: 1_024,
        modifiedAtMs: 100,
        quickFingerprint: fingerprint,
        durationMs: 20_000
      })
      first.replaceTranscript(original.id, "whisper", "whisper-fixture-v1", [
        { startMs: 0, endMs: 9_000, text: "The team prepares for the encounter.", confidence: 0.95 },
        { startMs: 9_000, endMs: 20_000, text: "The boss falls and drops a rare sword.", confidence: 0.93 }
      ])
      first.replaceChunksWithTopics(original.id, [
        {
          startMs: 0,
          endMs: 9_000,
          transcript: "The team prepares for the encounter.",
          summary: "The team prepares its boss strategy.",
          entities: [{ name: "the team", type: "group" }],
          events: [{ type: "strategy_setup", subject: "team", object: "boss", confidence: 0.96 }],
          aliases: [],
          searchPhrases: ["boss strategy"],
          confidence: 0.96
        },
        {
          startMs: 9_000,
          endMs: 20_000,
          transcript: "The boss falls and drops a rare sword.",
          summary: "The boss is defeated and drops a rare sword.",
          entities: [{ name: "rare sword", type: "item" }],
          events: [{ type: "rare_drop", subject: "boss", object: "rare sword", confidence: 0.99 }],
          aliases: ["sword"],
          searchPhrases: ["rare boss drop"],
          confidence: 0.99
        }
      ], "topic-fixture-v1")

      expect(await publishSharedMetadata(first, original.id)).toBe(true)
      expect(await publishSharedMetadata(first, original.id)).toBe(true)
      const bundle = sharedTranscriptBundleSchema.parse(JSON.parse(
        await readFile(sharedBundlePath(root, fingerprint), "utf8")
      ))
      expect(bundle.mediaRelativePath).toBe("sessions\\boss-fight.mp4")
      expect(bundle.segments).toHaveLength(2)
      expect(bundle.topics.map((topic) => topic.summary)).toEqual([
        "The team prepares its boss strategy.",
        "The boss is defeated and drops a rare sword."
      ])
      expect(JSON.stringify(bundle)).not.toContain(root)

      const second = new Repository(secondDatabase.db)
      const importingFolder = second.addSourceFolder(root, root)
      const importedMedia = second.upsertMedia({
        sourceFolderId: importingFolder.id,
        relativePath: "copied\\boss-fight.mp4",
        canonicalPath: join(root, "copied", "boss-fight.mp4"),
        displayName: "boss-fight.mp4",
        sizeBytes: 1_024,
        modifiedAtMs: 200,
        quickFingerprint: fingerprint,
        durationMs: 20_000
      })

      expect(await importSharedMetadata(second, importedMedia.id, root)).toBe(true)
      expect(second.getTranscript(importedMedia.id).map((segment) => segment.text)).toEqual(
        first.getTranscript(original.id).map((segment) => segment.text)
      )
      expect(second.getMediaSummaries(importedMedia.id).map((topic) => topic.summary)).toEqual(
        first.getMediaSummaries(original.id).map((topic) => topic.summary)
      )
      expect(second.getTranscriptVersion(importedMedia.id)).toMatch(/^shared-v1:/)
      expect(second.getSourceFolder(importingFolder.id).publishSharedMetadata).toBe(false)
    } finally {
      firstDatabase.close()
      secondDatabase.close()
      await rm(root, { recursive: true, force: true })
    }
  })
})
