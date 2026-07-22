import { describe, expect, it } from "vitest"
import { buildSemanticPassage } from "./embeddings.js"

describe("buildSemanticPassage", () => {
  it("uses the concise synopsis when enrichment is available", () => {
    const passage = buildSemanticPassage({
      summary: "The player continues an island quest.",
      transcript: "Dude, 500k and Bando's Robleggs.",
      metadata: ["Bandos equipment"]
    })
    expect(passage).toContain("Summary: The player continues an island quest.")
    expect(passage).not.toContain("Robleggs")
    expect(passage).toContain("Bandos equipment")
  })

  it("falls back to transcript content when no synopsis exists", () => {
    expect(buildSemanticPassage({
      summary: null,
      transcript: "Dude, 500k and Bando's Robleggs.",
      metadata: []
    })).toContain("Transcript: Dude, 500k and Bando's Robleggs.")
  })
})
