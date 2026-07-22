import { describe, expect, it } from "vitest"
import type { SearchHit } from "@vod-search/contracts"
import { cleanMediaTitle, organizeSearchHits, splitQueryMatches } from "./search-workflow.js"

describe("search workflow presentation", () => {
  it("keeps strong results and hides low-confidence noise by default", () => {
    const hits = [hit("video-1", 0, 80), hit("video-1", 120_000, 60), hit("video-2", 0, 20)]
    const organized = organizeSearchHits(hits)
    expect(organized.strongHits).toHaveLength(2)
    expect(organized.lowerConfidenceCount).toBe(1)
    expect(organized.groups).toHaveLength(1)
  })

  it("clusters nearby hits into one expandable moment", () => {
    const organized = organizeSearchHits([hit("video-1", 10_000, 70), hit("video-1", 35_000, 65)])
    expect(organized.groups[0]!.clusters).toHaveLength(1)
    expect(organized.groups[0]!.clusters[0]!.nearby).toHaveLength(1)
  })

  it("cleans capture metadata from display titles", () => {
    expect(cleanMediaTitle("20260716 - Risking It All [JpLuluW2KPk].mp4")).toBe("Risking It All")
  })

  it("highlights exact and lightly fuzzy query terms", () => {
    const parts = splitQueryMatches("Dude, 500k and Bando's Robleggs.", "bandos legs")
    expect(parts.filter((part) => part.match).map((part) => part.text)).toEqual(["Bando's", "Robleggs"])
  })
})

function hit(mediaId: string, startMs: number, score: number): SearchHit {
  return {
    mediaId,
    title: "20260716 - Sample video [abcdefghijk].mp4",
    relativePath: "Sample video.mp4",
    createdAtMs: 1,
    startMs,
    endMs: startMs + 30_000,
    transcriptExcerpt: "sample",
    summary: "sample",
    entities: [],
    events: [],
    availability: "available",
    matchReasons: ["semantic"],
    score,
    scoreBreakdown: { semantic: score, lexical: 0, transcript: 0, summary: 0, metadata: 0 }
  }
}
