import { describe, expect, it } from "vitest"
import { reciprocalRankFusion, toFtsQuery } from "./query.js"

describe("query helpers", () => {
  it("builds a safe phrase and meaningful-term query", () => {
    expect(toFtsQuery('death to "kalphite" king')).toBe(
      '"death to ""kalphite"" king" OR ("death" AND "kalphite" AND "king")'
    )
  })

  it("fuses lexical and semantic candidates", () => {
    const fused = reciprocalRankFusion(
      [{ id: 1, value: "one" }, { id: 2, value: "two" }],
      [{ id: 2, value: "two" }, { id: 3, value: "three" }]
    )
    expect(fused[0]!.value).toBe("two")
    expect(fused[0]!.lexicalRank).toBe(2)
    expect(fused[0]!.semanticRank).toBe(1)
  })
})

