import { describe, expect, it } from "vitest"
import { chunkTranscript } from "./chunker.js"

describe("chunkTranscript", () => {
  it("creates timestamped overlapping chunks", () => {
    const segments = Array.from({ length: 12 }, (_, index) => ({
      startMs: index * 5_000,
      endMs: (index + 1) * 5_000,
      text: `Segment ${index}${index === 8 ? "." : ""}`
    }))
    const chunks = chunkTranscript(segments)
    expect(chunks.length).toBeGreaterThanOrEqual(2)
    expect(chunks[0]).toMatchObject({ startMs: 0, endMs: 45_000 })
    expect(chunks[1]!.startMs).toBeLessThan(chunks[0]!.endMs)
  })

  it("filters empty segments", () => {
    expect(chunkTranscript([{ startMs: 0, endMs: 1000, text: "   " }])).toEqual([])
  })
})

