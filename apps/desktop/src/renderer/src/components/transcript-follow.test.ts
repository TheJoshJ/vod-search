import { describe, expect, it } from "vitest"
import type { TranscriptSegment } from "@vod-search/contracts"
import { findActiveTranscriptSegmentId, getTranscriptFollowScrollTop } from "./transcript-follow"

const transcript = [
  { id: 1, startMs: 1_000, endMs: 2_000 },
  { id: 2, startMs: 2_500, endMs: 4_000 },
  { id: 3, startMs: 4_000, endMs: 5_000 }
] as TranscriptSegment[]

describe("findActiveTranscriptSegmentId", () => {
  it("uses the exact segment at its boundaries", () => {
    expect(findActiveTranscriptSegmentId(transcript, 1_000)).toBe(1)
    expect(findActiveTranscriptSegmentId(transcript, 3_000)).toBe(2)
    expect(findActiveTranscriptSegmentId(transcript, 5_000)).toBe(3)
  })

  it("keeps the preceding line active across transcript gaps", () => {
    expect(findActiveTranscriptSegmentId(transcript, 2_250)).toBe(1)
  })

  it("returns no line before the transcript starts", () => {
    expect(findActiveTranscriptSegmentId(transcript, 500)).toBeNull()
  })
})

describe("getTranscriptFollowScrollTop", () => {
  it("does not scroll when the active row is in the reading band", () => {
    expect(getTranscriptFollowScrollTop({
      containerTop: 100,
      containerHeight: 600,
      rowTop: 300,
      rowHeight: 40,
      scrollTop: 800
    })).toBeNull()
  })

  it("brings a row below the reading band up to the preferred position", () => {
    expect(getTranscriptFollowScrollTop({
      containerTop: 100,
      containerHeight: 600,
      rowTop: 650,
      rowHeight: 40,
      scrollTop: 800
    })).toBe(1160)
  })

  it("never returns a negative scroll position for a row above the reading band", () => {
    expect(getTranscriptFollowScrollTop({
      containerTop: 100,
      containerHeight: 600,
      rowTop: 90,
      rowHeight: 40,
      scrollTop: 10
    })).toBe(0)
  })
})
