import { describe, expect, it } from "vitest"
import { analyzeTextMatch } from "./relevance.js"
import { scoreSearchResult, semanticDistanceQuality, textMatchQuality } from "./scoring.js"

describe("search scoring", () => {
  it("produces an interpretable 0-100 score whose components add to the total", () => {
    const result = scoreSearchResult("hybrid", {
      semantic: 0.7,
      lexical: 0.8,
      transcript: 1,
      summary: 0,
      metadata: 0
    })
    expect(result.score).toBeGreaterThan(70)
    expect(Object.values(result.breakdown).reduce((total, value) => total + value, 0)).toBe(result.score)
  })

  it("gives strong transcript evidence to the ASR form of Bandos legs", () => {
    const match = analyzeTextMatch("Dude, 500k and Bando's Robleggs.", "bandos legs")
    expect(textMatchQuality(match)).toBe(0.9)
  })

  it("turns vector distance into bounded semantic quality", () => {
    expect(semanticDistanceQuality(0.8)).toBeCloseTo(0.75)
    expect(semanticDistanceQuality(2)).toBe(0)
  })
})
