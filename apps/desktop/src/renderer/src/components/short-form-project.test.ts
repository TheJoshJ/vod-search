import { describe, expect, it } from "vitest"
import type { TranscriptSegment } from "@vod-search/contracts"
import {
  buildShortFormCaptionCues,
  clampVideoRect,
  contextWindowAroundPlayhead,
  coverSourceRect,
  fitAspectRatio,
  resizeVideoRect
} from "./short-form-project.js"

describe("short-form project helpers", () => {
  it("builds equal context on both sides of the playhead and clamps at source edges", () => {
    expect(contextWindowAroundPlayhead(120_000, 600_000, 60_000)).toEqual([60_000, 180_000])
    expect(contextWindowAroundPlayhead(20_000, 600_000, 60_000)).toEqual([0, 80_000])
    expect(contextWindowAroundPlayhead(580_000, 600_000, 60_000)).toEqual([520_000, 600_000])
  })

  it("groups transcript text into short timed caption phrases", () => {
    const transcript: TranscriptSegment[] = [{
      id: 9,
      mediaId: "media-1",
      startMs: 1_000,
      endMs: 5_000,
      text: "one two three four five six seven",
      source: "whisper",
      confidence: null,
      mediaSpeakerId: null
    }]
    const cues = buildShortFormCaptionCues(transcript, 2_000, 5_000)
    expect(cues.map((cue) => cue.text)).toEqual(["one two three four", "five six seven"])
    expect(cues[0]?.startMs).toBe(2_000)
    expect(cues.at(-1)?.endMs).toBe(5_000)
  })

  it("keeps moved and resized crop boxes inside the source", () => {
    expect(clampVideoRect({ x: 0.9, y: -0.2, width: 0.4, height: 0.5 }))
      .toEqual({ x: 0.6, y: 0, width: 0.4, height: 0.5 })
    const resized = resizeVideoRect({ x: 0.4, y: 0.4, width: 0.2, height: 0.2 }, { width: 0.6 })
    expect(resized.x).toBeCloseTo(0.2)
    expect(resized.width).toBe(0.6)
  })

  it("cover-fits a selected source box into a portrait panel without stretching", () => {
    const draw = coverSourceRect({ x: 0, y: 0, width: 1, height: 1 }, 1920, 1080, 1080, 1200)
    expect(draw.sw / draw.sh).toBeCloseTo(0.9)
    expect(draw.sh).toBe(1080)
    expect(draw.sx).toBeGreaterThan(0)
  })

  it("fits a portrait preview inside both narrow and tall editor panes", () => {
    expect(fitAspectRatio(320, 620, 9, 16)).toEqual({ width: 320, height: 320 * 16 / 9 })
    expect(fitAspectRatio(600, 800, 9, 16)).toEqual({ width: 450, height: 800 })
  })
})
