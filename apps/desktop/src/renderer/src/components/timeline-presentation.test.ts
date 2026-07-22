import { describe, expect, it } from "vitest"
import { clusterTimelinePoints } from "./timeline-presentation"

describe("clusterTimelinePoints", () => {
  it("combines markers that would visually overlap", () => {
    const points = [
      { id: "one", startMs: 10_000 },
      { id: "two", startMs: 10_500 },
      { id: "three", startMs: 30_000 }
    ]

    const groups = clusterTimelinePoints(points, 60_000)

    expect(groups).toHaveLength(2)
    expect(groups[0]?.points.map((point) => point.id)).toEqual(["one", "two"])
    expect(groups[1]?.points.map((point) => point.id)).toEqual(["three"])
  })
})
