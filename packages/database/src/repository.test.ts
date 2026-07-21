import { describe, expect, it } from "vitest"
import { SearchService } from "@vod-search/search"
import { openDatabase } from "./database.js"
import { Repository } from "./repository.js"

describe("Repository", () => {
  it("stores chunks and returns timestamped full-text hits", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "boss-fight.mp4",
        canonicalPath: "C:\\videos\\boss-fight.mp4",
        displayName: "boss-fight.mp4",
        sizeBytes: 1234,
        modifiedAtMs: 100,
        quickFingerprint: "fixture-fingerprint",
        durationMs: 120_000
      })
      repository.replaceChunks(media.id, "chunk-v1", [{
        startMs: 45_000,
        endMs: 70_000,
        transcript: "I died to the Kalphite King, also called KK."
      }])

      const response = new SearchService(repository).search({
        query: "died kalphite king",
        includeMissing: false,
        limit: 20
      })
      expect(response.indexedChunkCount).toBe(1)
      expect(response.hits).toHaveLength(1)
      expect(response.hits[0]).toMatchObject({ mediaId: media.id, startMs: 45_000 })
    } finally {
      database.close()
    }
  })

  it("recovers interrupted jobs", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "clip.mp4",
        canonicalPath: "C:\\videos\\clip.mp4",
        displayName: "clip.mp4",
        sizeBytes: 1,
        modifiedAtMs: 1,
        quickFingerprint: "job-fixture"
      })
      repository.enqueueJob(media.id, "probe")
      expect(repository.claimNextJob()?.status).toBe("running")
      expect(repository.recoverRunningJobs()).toBe(1)
      expect(repository.listJobs()[0]?.status).toBe("queued")
    } finally {
      database.close()
    }
  })

  it("retrieves vector-nearest chunks", () => {
    const database = openDatabase(":memory:")
    try {
      expect(database.vectorSearchAvailable).toBe(true)
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "semantic.mp4",
        canonicalPath: "C:\\videos\\semantic.mp4",
        displayName: "semantic.mp4",
        sizeBytes: 2,
        modifiedAtMs: 2,
        quickFingerprint: "semantic-fixture"
      })
      repository.replaceChunks(media.id, "chunk-v1", [
        { startMs: 0, endMs: 10_000, transcript: "unrelated introduction" },
        { startMs: 20_000, endMs: 30_000, transcript: "the player died to the boss" }
      ])
      const chunks = repository.getChunksForEmbedding(media.id)
      const first = new Float32Array(384)
      first[0] = 1
      const second = new Float32Array(384)
      second[1] = 1
      repository.storeEmbeddings([
        { chunkId: chunks[0]!.id, embedding: first },
        { chunkId: chunks[1]!.id, embedding: second }
      ], "fixture-v1")
      const query = new Float32Array(384)
      query[1] = 1
      expect(repository.semanticSearch(query, false, 10)[0]?.chunkId).toBe(chunks[1]!.id)
    } finally {
      database.close()
    }
  })

  it("keeps completed stages monotonic and invalidates stale vectors when chunks change", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "lifecycle.mp4",
        canonicalPath: "C:\\videos\\lifecycle.mp4",
        displayName: "lifecycle.mp4",
        sizeBytes: 3,
        modifiedAtMs: 3,
        quickFingerprint: "lifecycle-fixture"
      })
      repository.replaceChunks(media.id, "chunk-v1", [
        { startMs: 0, endMs: 10_000, transcript: "old searchable transcript" }
      ])
      const oldChunk = repository.getChunksForEmbedding(media.id)[0]!
      const embedding = new Float32Array(384)
      embedding[0] = 1
      repository.storeEmbeddings([{ chunkId: oldChunk.id, embedding }], "fixture-v1")
      repository.setMediaStage(media.id, "ready")

      repository.updateMediaProbe(media.id, {
        durationMs: 20_000,
        container: "mp4",
        videoCodec: "h264",
        audioCodec: "aac"
      })
      expect(repository.getMedia(media.id).highestCompletedStage).toBe("ready")

      repository.replaceChunks(media.id, "chunk-v2", [
        { startMs: 0, endMs: 12_000, transcript: "new searchable transcript" }
      ])
      expect(repository.getMedia(media.id).highestCompletedStage).toBe("chunked")
      expect(repository.semanticSearch(embedding, false, 10)).toHaveLength(0)
    } finally {
      database.close()
    }
  })

  it("distinguishes duplicate files while preserving the identity of a moved file", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const first = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "copy-a.mp4",
        canonicalPath: "C:\\videos\\copy-a.mp4",
        displayName: "copy-a.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "same-content"
      })
      const second = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "copy-b.mp4",
        canonicalPath: "C:\\videos\\copy-b.mp4",
        displayName: "copy-b.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "same-content"
      })
      expect(second.id).not.toBe(first.id)

      repository.markMissingExcept(folder.id, ["C:\\videos\\copy-b.mp4"])
      const moved = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "moved-a.mp4",
        canonicalPath: "C:\\videos\\moved-a.mp4",
        displayName: "moved-a.mp4",
        sizeBytes: 10,
        modifiedAtMs: 11,
        quickFingerprint: "same-content"
      })
      expect(moved.id).toBe(first.id)
    } finally {
      database.close()
    }
  })

  it("clears derived data when a file changes in place", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const input = {
        sourceFolderId: folder.id,
        relativePath: "changing.mp4",
        canonicalPath: "C:\\videos\\changing.mp4",
        displayName: "changing.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "before"
      }
      const media = repository.upsertMedia(input)
      repository.replaceTranscript(media.id, "whisper", "whisper:before", [
        { startMs: 0, endMs: 1_000, text: "stale words" }
      ])
      repository.replaceChunks(media.id, "chunk-v1", [
        { startMs: 0, endMs: 1_000, transcript: "stale words" }
      ])
      repository.setMediaStage(media.id, "ready")

      repository.upsertMedia({ ...input, sizeBytes: 20, modifiedAtMs: 20, quickFingerprint: "after" })
      expect(repository.getMedia(media.id).highestCompletedStage).toBe("discovered")
      expect(repository.getTranscript(media.id)).toHaveLength(0)
      expect(repository.countSearchChunks()).toBe(0)
    } finally {
      database.close()
    }
  })
})
