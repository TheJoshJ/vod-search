import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { openDatabase, Repository } from "@vod-search/database"
import { SearchService } from "@vod-search/search"
import { scanSourceFolder } from "./scanner.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("scanSourceFolder", () => {
  it("discovers media and indexes a matching sidecar progressively", async () => {
    const root = await mkdtemp(join(tmpdir(), "vod-search-scan-"))
    temporaryPaths.push(root)
    await writeFile(join(root, "Kalphite fight.mp4"), Buffer.from("fixture media bytes"))
    await writeFile(join(root, "Kalphite fight.srt"), [
      "1",
      "00:00:01,000 --> 00:00:20,000",
      "We are fighting the Kalphite King.",
      "",
      "2",
      "00:00:21,000 --> 00:00:47,000",
      "I died at KK."
    ].join("\n"))

    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder(root, root)
      await scanSourceFolder(repository, folder.id, root)

      const media = repository.listMedia({ sourceFolderId: folder.id, offset: 0, limit: 10 })
      expect(media).toHaveLength(1)
      expect(media[0]!.highestCompletedStage).toBe("chunked")
      const response = new SearchService(repository).search({
        query: "died KK",
        mode: "hybrid",
        includeMissing: false,
        limit: 20
      })
      expect(response.hits[0]).toMatchObject({ mediaId: media[0]!.id, startMs: 21_000 })

      expect(repository.listJobs().filter((job) => job.stage === "enrich")).toHaveLength(1)
      expect(repository.listJobs().filter((job) => job.stage === "embed")).toHaveLength(0)
      const enrichment = repository.listJobs().find((job) => job.stage === "enrich")!
      repository.updateJob(enrichment.id, { status: "succeeded", progress: 1 })
      await scanSourceFolder(repository, folder.id, root)
      expect(repository.listJobs().find((job) => job.stage === "enrich")?.status).toBe("succeeded")
    } finally {
      database.close()
    }
  })

  it("waits for a successful probe before queueing transcription", async () => {
    const root = await mkdtemp(join(tmpdir(), "vod-search-scan-"))
    temporaryPaths.push(root)
    await writeFile(join(root, "needs-probe.mp4"), Buffer.from("fixture media bytes"))

    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder(root, root)
      await scanSourceFolder(repository, folder.id, root)

      expect(repository.listJobs().map((job) => job.stage)).toEqual(["probe"])
    } finally {
      database.close()
    }
  })

  it("ignores a configured clip output folder and removes previously indexed clips from active results", async () => {
    const root = await mkdtemp(join(tmpdir(), "vod-search-scan-"))
    temporaryPaths.push(root)
    const clipOutputFolder = join(root, "CutScout Clips")
    await mkdir(clipOutputFolder)
    await writeFile(join(root, "source.mp4"), Buffer.from("source media bytes"))
    await writeFile(join(clipOutputFolder, "exported-clip.mp4"), Buffer.from("exported clip bytes"))

    const database = openDatabase(":memory:")
    try {
      const repository = new Repository(database.db)
      const folder = repository.addSourceFolder(root, root)
      await scanSourceFolder(repository, folder.id, root)
      expect(repository.listMedia({ sourceFolderId: folder.id, offset: 0, limit: 10 })).toHaveLength(2)

      await scanSourceFolder(repository, folder.id, root, { excludedPaths: [clipOutputFolder] })
      const media = repository.listMedia({ sourceFolderId: folder.id, offset: 0, limit: 10 })
      expect(media.find((item) => item.displayName === "source.mp4")?.availability).toBe("available")
      expect(media.find((item) => item.displayName === "exported-clip.mp4")?.availability).toBe("missing")
    } finally {
      database.close()
    }
  })
})
