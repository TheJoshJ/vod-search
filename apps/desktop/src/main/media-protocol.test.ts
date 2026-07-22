import { describe, expect, it } from "vitest"
import { parseByteRange } from "./media-protocol.js"

describe("parseByteRange", () => {
  it("parses open, bounded, and suffix byte ranges", () => {
    expect(parseByteRange("bytes=100-199", 1_000)).toEqual({ start: 100, end: 199 })
    expect(parseByteRange("bytes=900-", 1_000)).toEqual({ start: 900, end: 999 })
    expect(parseByteRange("bytes=-100", 1_000)).toEqual({ start: 900, end: 999 })
  })

  it("clamps valid ends and rejects unsatisfiable ranges", () => {
    expect(parseByteRange("bytes=900-1200", 1_000)).toEqual({ start: 900, end: 999 })
    expect(parseByteRange("bytes=1000-", 1_000)).toBeNull()
    expect(parseByteRange("bytes=200-100", 1_000)).toBeNull()
    expect(parseByteRange("items=0-10", 1_000)).toBeNull()
  })
})
