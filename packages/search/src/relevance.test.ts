import { describe, expect, it } from "vitest"
import { analyzeTextMatch, findBestTimedText, isCoherentTextMatch } from "./relevance.js"

describe("analyzeTextMatch", () => {
  it("matches a full query against a close ASR compound", () => {
    const match = analyzeTextMatch("Dude, 500k and Bando's Robleggs.", "bandos legs")
    expect(match).toMatchObject({ full: true, exactPhrase: false, minimumWindow: 2 })
  })

  it("does not combine terms from separate fields", () => {
    expect(analyzeTextMatch("My rune plate legs are stronger.", "bandos legs").full).toBe(false)
    expect(analyzeTextMatch("The account is ready for Bandos.", "bandos legs").full).toBe(false)
  })

  it("does not treat terms far apart in a long passage as one coherent match", () => {
    const match = analyzeTextMatch(`Bandos ${"unrelated ".repeat(30)} legs`, "bandos legs")
    expect(match.full).toBe(true)
    expect(isCoherentTextMatch(match)).toBe(false)
  })

  it("does not fuzzy-match short ordinary words such as lets to legs", () => {
    expect(analyzeTextMatch("Bandos lets us enter.", "bandos legs").full).toBe(false)
  })

  it("recognizes an exact normalized phrase", () => {
    expect(analyzeTextMatch("A Bandos legs drop appears.", "bandos legs"))
      .toMatchObject({ full: true, exactPhrase: true, minimumWindow: 2 })
  })
})

describe("findBestTimedText", () => {
  it("selects the precise transcript line that satisfies the whole query", () => {
    const result = findBestTimedText([
      { startMs: 1_000, endMs: 2_000, text: "We are heading to Bandos." },
      { startMs: 50_020, endMs: 54_000, text: "Dude, 500k and Bando's Robleggs." }
    ], "bandos legs")
    expect(result?.startMs).toBe(50_020)
  })
})
