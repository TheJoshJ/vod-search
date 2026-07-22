import { describe, expect, it } from "vitest"
import { buildRoughCutPlan, type RoughCutSource } from "./plan.js"
import { buildPremiereXml, describeFrameRate, millisecondsToFrames } from "./premiere-xml.js"

const source: RoughCutSource = {
  mediaId: "video",
  path: "C:\\Media\\A&B <source>.mp4",
  title: "A&B <source>.mp4",
  durationMs: 60_000,
  segments: [{ id: 10, startMs: 10_000, endMs: 12_000, text: "A useful line." }]
}

const createId = (() => {
  let value = 1
  return () => `10000000-0000-4000-8000-${String(value++).padStart(12, "0")}`
})()

describe("Premiere Final Cut Pro XML export", () => {
  it("uses the documented NTSC timebase pairs", () => {
    expect(describeFrameRate("23.976")).toMatchObject({ timebase: 24, ntsc: true, numerator: 24_000, denominator: 1_001 })
    expect(describeFrameRate("29.97")).toMatchObject({ timebase: 30, ntsc: true })
    expect(describeFrameRate("59.94")).toMatchObject({ timebase: 60, ntsc: true })
    expect(millisecondsToFrames(1_001, "29.97", "round")).toBe(30)
    expect(millisecondsToFrames(1_000, "30", "round")).toBe(30)
  })

  it("writes a linked straight-cut sequence with escaped names and file URLs", () => {
    const plan = buildRoughCutPlan({
      request: { title: "Rough & ready <cut>", prompt: "Use the line.", mediaIds: [source.mediaId], handleBeforeMs: 1_000, handleAfterMs: 2_000, frameRate: "29.97" },
      sources: [source],
      matches: [{ mediaId: source.mediaId, startSegmentId: 10, endSegmentId: 10, requestedText: "Use the line", matchRationale: "It says the requested idea." }],
      createId
    })
    const xml = buildPremiereXml(plan)

    expect(xml).toContain('<xmeml version="5">')
    expect(xml).toContain("<name>Rough &amp; ready &lt;cut&gt;</name>")
    expect(xml).toContain("<timebase>30</timebase>")
    expect(xml).toContain("<ntsc>TRUE</ntsc>")
    expect(xml).toContain('<clipitem id="clipitem-v-1">')
    expect(xml).toContain('<clipitem id="clipitem-a-1">')
    expect(xml).toContain("<linkclipref>clipitem-a-1</linkclipref>")
    expect(xml).toContain("A&amp;B%20%3Csource%3E.mp4")
    expect(xml).not.toContain("A&B <source>.mp4")
  })
})
