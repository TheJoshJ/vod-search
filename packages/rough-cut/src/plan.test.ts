import { describe, expect, it } from "vitest"
import { roughCutPlanSchema } from "@vod-search/contracts"
import { buildRoughCutPlan, resequenceRoughCutPlan, type RoughCutSource } from "./plan.js"

const source: RoughCutSource = {
  mediaId: "media-1",
  path: "C:\\media\\episode.mp4",
  title: "Episode & one.mp4",
  durationMs: 20_000,
  segments: [
    { id: 1, startMs: 2_000, endMs: 4_000, text: "First useful moment." },
    { id: 2, startMs: 5_000, endMs: 7_000, text: "The explanation continues." },
    { id: 3, startMs: 18_000, endMs: 19_500, text: "A final thought." }
  ]
}

function ids(): () => string {
  let value = 1
  return () => `00000000-0000-4000-8000-${String(value++).padStart(12, "0")}`
}

describe("rough-cut plans", () => {
  it("clamps handles and merges adjacent overlapping selections", () => {
    const plan = buildRoughCutPlan({
      request: {
        prompt: "Open with the explanation, then let it continue.",
        mediaIds: [source.mediaId],
        handleBeforeMs: 5_000,
        handleAfterMs: 5_000,
        frameRate: "30"
      },
      sources: [source],
      matches: [
        { mediaId: source.mediaId, startSegmentId: 1, endSegmentId: 1, requestedText: "Open", matchRationale: "It introduces the subject." },
        { mediaId: source.mediaId, startSegmentId: 2, endSegmentId: 2, requestedText: "Continue", matchRationale: "It develops the same thought." }
      ],
      now: 123,
      createId: ids()
    })

    expect(plan.items).toHaveLength(1)
    expect(plan.items[0]).toMatchObject({
      sourceInMs: 0,
      sourceOutMs: 12_000,
      contentStartMs: 2_000,
      contentEndMs: 7_000,
      sequenceStartMs: 0,
      sequenceEndMs: 12_000,
      handleBeforeMs: 2_000,
      handleAfterMs: 5_000
    })
    expect(plan.totalDurationMs).toBe(12_000)
  })

  it("clamps a trailing handle to the source duration", () => {
    const plan = buildRoughCutPlan({
      request: {
        title: "Ending",
        prompt: "Finish on the final thought.",
        mediaIds: [source.mediaId],
        handleBeforeMs: 1_000,
        handleAfterMs: 10_000,
        frameRate: "59.94"
      },
      sources: [source],
      matches: [{ mediaId: source.mediaId, startSegmentId: 3, endSegmentId: 3, requestedText: "Finish", matchRationale: "This is the closing thought." }],
      createId: ids()
    })
    expect(plan.items[0]).toMatchObject({ sourceInMs: 17_000, sourceOutMs: 20_000, handleAfterMs: 500 })
  })

  it("resequences edited plans and rejects inconsistent timing", () => {
    const original = buildRoughCutPlan({
      request: { prompt: "Use both moments.", mediaIds: [source.mediaId], handleBeforeMs: 0, handleAfterMs: 0, frameRate: "30" },
      sources: [source],
      matches: [
        { mediaId: source.mediaId, startSegmentId: 1, endSegmentId: 1, requestedText: "First", matchRationale: "First moment." },
        { mediaId: source.mediaId, startSegmentId: 3, endSegmentId: 3, requestedText: "Last", matchRationale: "Last moment." }
      ],
      createId: ids()
    })
    const reordered = resequenceRoughCutPlan({ ...original, items: [...original.items].reverse() })
    expect(reordered.items.map((item) => item.requestedText)).toEqual(["Last", "First"])
    expect(reordered.items.map((item) => [item.order, item.sequenceStartMs, item.sequenceEndMs])).toEqual([
      [0, 0, 1_500],
      [1, 1_500, 3_500]
    ])
    expect(() => roughCutPlanSchema.parse({ ...reordered, totalDurationMs: 99 })).toThrow(/Plan duration/)
  })

  it("rejects invented transcript segment identifiers", () => {
    expect(() => buildRoughCutPlan({
      request: { prompt: "Invent nothing.", mediaIds: [source.mediaId], handleBeforeMs: 0, handleAfterMs: 0, frameRate: "30" },
      sources: [source],
      matches: [{ mediaId: source.mediaId, startSegmentId: 999, endSegmentId: 999, requestedText: "Missing", matchRationale: "Not grounded." }],
      createId: ids()
    })).toThrow(/unknown transcript segment/)
  })
})
