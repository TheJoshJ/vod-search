import { createHash } from "node:crypto"
import { createServer } from "node:http"
import { mkdtemp, readFile, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { downloadVerifiedFile } from "./models.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("downloadVerifiedFile", () => {
  it("downloads and verifies a model artifact", async () => {
    const bytes = Buffer.from("small model fixture")
    const server = createServer((_request, response) => {
      response.writeHead(200, { "content-length": bytes.length })
      response.end(bytes)
    })
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve))
    const address = server.address()
    if (!address || typeof address === "string") throw new Error("Fixture server failed to start")
    const root = await mkdtemp(join(tmpdir(), "vod-search-model-"))
    temporaryPaths.push(root)
    const destination = join(root, "fixture.bin")
    try {
      await downloadVerifiedFile({
        path: "fixture.bin",
        url: `http://127.0.0.1:${address.port}/fixture.bin`,
        sizeBytes: bytes.length,
        sha256: createHash("sha256").update(bytes).digest("hex")
      }, destination, new AbortController().signal)
      expect(await readFile(destination)).toEqual(bytes)
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()))
    }
  })
})
