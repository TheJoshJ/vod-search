import { describe, expect, it } from "vitest"
import { shortFormProjectSchema } from "./short-form.js"

const validProject = {
  mediaId: "media-1",
  title: "Trim test",
  contextStartMs: 10_000,
  contextEndMs: 130_000,
  startMs: 25_000,
  endMs: 70_000,
  layout: {
    contentRect: { x: 0, y: 0, width: 1, height: 1 },
    faceRect: { x: 0.68, y: 0, width: 0.32, height: 0.42 },
    contentFraction: 0.64,
    faceFirst: false
  },
  captionStyle: {
    enabled: true,
    preset: "impact" as const,
    fontSize: 78,
    positionY: 0.6,
    textColor: "#ffffff",
    highlightColor: "#a3ff12",
    uppercase: true
  },
  captions: []
}

describe("shortFormProjectSchema", () => {
  it("accepts final in and out points inside a wider source context", () => {
    expect(shortFormProjectSchema.safeParse(validProject).success).toBe(true)
  })

  it("rejects final trim points outside the recoverable source context", () => {
    const result = shortFormProjectSchema.safeParse({ ...validProject, startMs: 5_000 })
    expect(result.success).toBe(false)
    if (!result.success) expect(result.error.issues[0]?.message).toContain("source context")
  })
})
