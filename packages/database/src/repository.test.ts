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
        mode: "hybrid",
        includeMissing: false,
        limit: 20
      })
      expect(response.indexedChunkCount).toBe(1)
      expect(response.hits).toHaveLength(1)
      expect(response.hits[0]).toMatchObject({
        mediaId: media.id,
        relativePath: "boss-fight.mp4",
        createdAtMs: 100,
        startMs: 45_000
      })
    } finally {
      database.close()
    }
  })

  it("removes a source and its local search index without affecting other sources", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const removedFolder = repository.addSourceFolder("C:\\removed", "C:\\removed")
      const keptFolder = repository.addSourceFolder("C:\\kept", "C:\\kept")

      for (const [folder, name] of [[removedFolder, "removed.mp4"], [keptFolder, "kept.mp4"]] as const) {
        const media = repository.upsertMedia({
          sourceFolderId: folder.id,
          relativePath: name,
          canonicalPath: `${folder.path}\\${name}`,
          displayName: name,
          sizeBytes: 100,
          modifiedAtMs: 100,
          quickFingerprint: `fixture-${name}`
        })
        repository.replaceChunks(media.id, "chunk-v1", [{
          startMs: 0,
          endMs: 10_000,
          transcript: `unique searchable phrase ${name}`
        }])
      }

      repository.removeSourceFolder(removedFolder.id)

      expect(repository.listSourceFolders().map((folder) => folder.id)).toEqual([keptFolder.id])
      expect(repository.listMedia({ offset: 0, limit: 20 }).map((media) => media.displayName)).toEqual(["kept.mp4"])
      expect(new SearchService(repository).search({
        query: "unique searchable phrase",
        mode: "keyword",
        includeMissing: false,
        limit: 20
      }).hits.map((hit) => hit.title)).toEqual(["kept.mp4"])
    } finally {
      database.close()
    }
  })

  it("filters timestamp results by the media creation date", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      for (const [name, createdAtMs] of [["old.mp4", 100], ["new.mp4", 300]] as const) {
        const media = repository.upsertMedia({
          sourceFolderId: folder.id,
          relativePath: name,
          canonicalPath: `C:\\videos\\${name}`,
          displayName: name,
          sizeBytes: createdAtMs,
          createdAtMs,
          modifiedAtMs: createdAtMs,
          quickFingerprint: `fixture-${name}`
        })
        repository.replaceChunks(media.id, "chunk-v1", [{
          startMs: 0,
          endMs: 10_000,
          transcript: "Kalphite King death review"
        }])
      }

      const service = new SearchService(repository)
      const recent = service.search({
        query: "kalphite king",
        mode: "keyword",
        createdAfterMs: 200,
        includeMissing: false,
        limit: 20
      })
      const older = service.search({
        query: "kalphite king",
        mode: "keyword",
        createdBeforeMs: 200,
        includeMissing: false,
        limit: 20
      })
      expect(recent.hits.map((hit) => hit.title)).toEqual(["new.mp4"])
      expect(older.hits.map((hit) => hit.title)).toEqual(["old.mp4"])
    } finally {
      database.close()
    }
  })

  it("returns enriched summary sections for the media drawer", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "summary.mp4",
        canonicalPath: "C:\\videos\\summary.mp4",
        displayName: "summary.mp4",
        sizeBytes: 100,
        modifiedAtMs: 100,
        quickFingerprint: "summary-fixture"
      })
      repository.replaceChunksWithTopics(media.id, [{
        startMs: 10_000,
        endMs: 20_000,
        transcript: "The player changes strategy.",
        summary: "A defensive strategy change stabilizes the attempt.",
        entities: [{ name: "Kalphite King", type: "boss" }],
        events: [{ type: "strategy_change", subject: "player", object: null, confidence: 0.96 }],
        aliases: ["KK"],
        searchPhrases: ["defensive strategy"],
        confidence: 0.95
      }], "fixture-v1")

      expect(repository.getMediaSummaries(media.id)).toEqual([{
        startMs: 10_000,
        endMs: 20_000,
        summary: "A defensive strategy change stabilizes the attempt.",
        entities: ["Kalphite King"],
        events: ["strategy_change"]
      }])
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

  it("learns recurring speaker patterns across clips and annotates transcript turns", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const first = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "first.mp4",
        canonicalPath: "C:\\videos\\first.mp4",
        displayName: "first.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "speakers-first"
      })
      repository.replaceTranscript(first.id, "whisper", "whisper:first", [
        { startMs: 0, endMs: 8_000, text: "Primary speaker opens the call." },
        { startMs: 8_000, endMs: 12_000, text: "The recurring guest joins." }
      ])
      repository.replaceSpeakerDiarization(first.id, "community-1:test", [
        { label: "SPEAKER_00", embedding: [1, 0, 0] },
        { label: "SPEAKER_01", embedding: [0, 1, 0] }
      ], [
        { label: "SPEAKER_00", startMs: 0, endMs: 8_000 },
        { label: "SPEAKER_01", startMs: 8_000, endMs: 12_000 }
      ])
      const firstGuest = repository.getMediaSpeakers(first.id).find((speaker) => speaker.diarizationLabel === "SPEAKER_01")!
      const guestProfile = repository.createSpeakerProfile(firstGuest.id, "Jamie")
      expect(repository.listSpeakerProfiles()).toContainEqual(expect.objectContaining({ id: guestProfile.id, sampleCount: 1 }))

      const second = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "second.mp4",
        canonicalPath: "C:\\videos\\second.mp4",
        displayName: "second.mp4",
        sizeBytes: 20,
        modifiedAtMs: 20,
        quickFingerprint: "speakers-second"
      })
      repository.replaceTranscript(second.id, "whisper", "whisper:second", [
        { startMs: 0, endMs: 10_000, text: "The primary speaker continues." },
        { startMs: 10_000, endMs: 14_000, text: "The same guest returns." },
        { startMs: 20_000, endMs: 24_000, text: "The guest joins again." },
        { startMs: 30_000, endMs: 34_000, text: "A third voice appears." }
      ])
      repository.replaceSpeakerDiarization(second.id, "community-1:test", [
        { label: "SPEAKER_00", embedding: [1, 0, 0] },
        { label: "SPEAKER_01", embedding: [0.02, 0.999, 0] },
        { label: "SPEAKER_02", embedding: [0, 0, 1] }
      ], [
        { label: "SPEAKER_00", startMs: 0, endMs: 10_000 },
        { label: "SPEAKER_01", startMs: 10_000, endMs: 14_000 },
        { label: "SPEAKER_01", startMs: 20_000, endMs: 24_000 },
        { label: "SPEAKER_02", startMs: 30_000, endMs: 34_000 }
      ])

      const secondSpeakers = repository.getMediaSpeakers(second.id)
      const recurringGuest = secondSpeakers.find((speaker) => speaker.diarizationLabel === "SPEAKER_01")!
      const thirdSpeaker = secondSpeakers.find((speaker) => speaker.diarizationLabel === "SPEAKER_02")!
      expect(recurringGuest).toMatchObject({
        suggestedProfileId: guestProfile.id,
        turnCount: 2,
        speechMs: 8_000
      })
      expect(thirdSpeaker.suggestedProfileId).toBeNull()

      const reviewQueue = repository.getSpeakerReviewQueue()
      expect(reviewQueue.profiles).toContainEqual(expect.objectContaining({ id: guestProfile.id, name: "Jamie" }))
      expect(reviewQueue.items).toContainEqual(expect.objectContaining({
        id: recurringGuest.id,
        mediaTitle: "second.mp4",
        relativePath: "second.mp4",
        sampleStartMs: 10_000,
        sampleEndMs: 14_000,
        sampleText: "The same guest returns.",
        suggestedProfileId: guestProfile.id
      }))

      repository.assignMediaSpeakerProfile(recurringGuest.id, guestProfile.id)
      expect(repository.listSpeakerProfiles()).toContainEqual(expect.objectContaining({ id: guestProfile.id, sampleCount: 2 }))
      expect(repository.getSpeakerReviewQueue().items.some((item) => item.id === recurringGuest.id)).toBe(false)
      expect(repository.getMediaSpeakers(second.id).find((speaker) => speaker.id === recurringGuest.id)).toMatchObject({
        profileId: guestProfile.id,
        displayName: "Jamie"
      })
      expect(repository.getTranscript(second.id).slice(1, 3).map((segment) => segment.mediaSpeakerId)).toEqual([
        recurringGuest.id,
        recurringGuest.id
      ])

      repository.assignMediaSpeakerProfile(recurringGuest.id, null)
      expect(repository.listSpeakerProfiles()).toContainEqual(expect.objectContaining({ id: guestProfile.id, sampleCount: 1 }))
    } finally {
      database.close()
    }
  })

  it("persists independent processing windows", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      expect(repository.getProcessingSchedule().transcription.enabled).toBe(false)

      const saved = repository.setProcessingSchedule({
        ingestion: { enabled: true, startMinute: 8 * 60, endMinute: 12 * 60 },
        transcription: { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 },
        summarization: { enabled: true, startMinute: 1 * 60, endMinute: 5 * 60 }
      })

      expect(repository.getProcessingSchedule()).toEqual(saved)
    } finally {
      database.close()
    }
  })

  it("preserves failed jobs during routine enqueue and retries them only when requested", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "broken.mkv",
        canonicalPath: "C:\\videos\\broken.mkv",
        displayName: "broken.mkv",
        sizeBytes: 810,
        modifiedAtMs: 1,
        quickFingerprint: "broken-fixture"
      })
      const job = repository.enqueueJob(media.id, "probe")
      repository.updateJob(job.id, { status: "failed", error: "End of file" })

      expect(repository.enqueueJob(media.id, "probe").status).toBe("failed")
      expect(repository.retryJob(job.id)).toMatchObject({ status: "queued", progress: 0, error: null })
    } finally {
      database.close()
    }
  })

  it("queues Codex enrichment before BGE embedding and invalidates stale vectors", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "clip.mp4",
        canonicalPath: "C:\\videos\\clip.mp4",
        displayName: "clip.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "model-job-fixture"
      })
      repository.replaceChunks(media.id, "chunk-v1", [{
        startMs: 0,
        endMs: 10_000,
        transcript: "searchable words"
      }])

      expect(repository.ensureEnrichmentJobs()).toBe(1)
      expect(repository.listJobs().find((job) => job.stage === "enrich")?.status).toBe("queued")
      expect(repository.ensureEmbeddingJobs()).toBe(0)

      repository.enqueueJob(media.id, "embed")
      expect(repository.cancelEmbeddingsBlockedByEnrichment()).toBe(1)
      expect(repository.listJobs().find((job) => job.stage === "embed")?.status).toBe("cancelled")
      const chunk = repository.getChunksForEmbedding(media.id)[0]!
      const enrichment = {
        chunkId: chunk.id,
        summary: "The speaker says searchable words.",
        entities: [],
        events: [],
        aliases: [],
        searchPhrases: ["searchable words"],
        confidence: 0.99
      }
      repository.applyEnrichments(media.id, [enrichment], "codex-fixture-v1")
      expect(repository.isEnrichmentComplete(media.id)).toBe(true)
      expect(repository.isEnrichmentComplete(media.id, "codex-fixture-v1")).toBe(true)
      expect(repository.isEnrichmentComplete(media.id, "codex-fixture-v2")).toBe(false)
      expect(repository.ensureEmbeddingJobs()).toBe(1)
      expect(repository.listJobs().find((job) => job.stage === "embed")?.status).toBe("queued")

      const vector = new Float32Array(384)
      vector[0] = 1
      repository.storeEmbeddings([{ chunkId: chunk.id, embedding: vector }], "bge-fixture-v1")
      const embeddingJob = repository.listJobs().find((job) => job.stage === "embed")!
      repository.updateJob(embeddingJob.id, { status: "succeeded", progress: 1 })
      expect(repository.semanticSearch(vector, false, 10)).toHaveLength(1)
      expect(repository.ensureEmbeddingJobs("codex-fixture-v1", "bge-fixture-v1")).toBe(0)
      expect(repository.ensureEmbeddingJobs("codex-fixture-v1", "bge-fixture-v2")).toBe(1)
      repository.updateJob(embeddingJob.id, { status: "succeeded", progress: 1 })

      repository.applyEnrichments(media.id, [{
        ...enrichment,
        summary: "A revised Codex summary."
      }], "codex-fixture-v2")
      expect(repository.semanticSearch(vector, false, 10)).toHaveLength(0)
      expect(repository.ensureEmbeddingJobs()).toBe(1)
      expect(repository.listJobs().find((job) => job.stage === "embed")?.status).toBe("queued")

    } finally {
      database.close()
    }
  })

  it("requeues topic analysis when the Codex prompt version changes", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "versioned.mp4",
        canonicalPath: "C:\\videos\\versioned.mp4",
        displayName: "versioned.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "versioned-enrichment-fixture"
      })
      repository.replaceChunks(media.id, "chunk-v1", [{
        startMs: 0,
        endMs: 10_000,
        transcript: "A complete thought."
      }])
      expect(repository.ensureEnrichmentJobs("topic-prompt-v1")).toBe(1)
      const enrichmentJob = repository.listJobs().find((job) => job.stage === "enrich")!
      const chunk = repository.getChunksForEmbedding(media.id)[0]!
      repository.applyEnrichments(media.id, [{
        chunkId: chunk.id,
        summary: "The speaker expresses a complete thought.",
        entities: [],
        events: [],
        aliases: [],
        searchPhrases: ["complete thought"],
        confidence: 0.95
      }], "topic-prompt-v1")
      repository.updateJob(enrichmentJob.id, { status: "succeeded", progress: 1 })

      expect(repository.ensureEnrichmentJobs("topic-prompt-v1")).toBe(0)
      expect(repository.ensureEnrichmentJobs("topic-prompt-v2")).toBe(1)
      expect(repository.getJob(enrichmentJob.id).status).toBe("queued")
      expect(repository.ensureEmbeddingJobs("topic-prompt-v2")).toBe(0)
    } finally {
      database.close()
    }
  })

  it("cancels transcription when its required probe failed", () => {
    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder("C:\\videos", "C:\\videos")
      const media = repository.upsertMedia({
        sourceFolderId: folder.id,
        relativePath: "broken.mp4",
        canonicalPath: "C:\\videos\\broken.mp4",
        displayName: "broken.mp4",
        sizeBytes: 10,
        modifiedAtMs: 10,
        quickFingerprint: "failed-probe-fixture"
      })

      const probe = repository.enqueueJob(media.id, "probe")
      repository.updateJob(probe.id, { status: "failed", error: "corrupt input" })
      repository.enqueueJob(media.id, "transcribe")
      expect(repository.cancelTranscriptionsBlockedByFailedProbe()).toBe(1)
      expect(repository.listJobs().find((job) => job.stage === "transcribe")?.status).toBe("cancelled")
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
