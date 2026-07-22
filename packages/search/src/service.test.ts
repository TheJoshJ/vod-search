import { describe, expect, it } from "vitest"
import { SearchService, type LexicalSearchRecord, type SearchRepository } from "./service.js"

const wrongCrossField: LexicalSearchRecord = {
  chunkId: 1,
  mediaId: "video",
  title: "God Wars",
  relativePath: "god-wars.mp4",
  createdAtMs: 1,
  startMs: 18 * 60_000 + 55_000,
  endMs: 22 * 60_000 + 29_000,
  transcript: "My rune plate legs have more armour.",
  summary: "The account is now ready for Bandos.",
  entitiesJson: "[]",
  eventsJson: "[]",
  aliasesJson: "[]",
  searchPhrasesJson: "[]",
  availability: "available",
  rank: 0.85
}

const desiredMoment: LexicalSearchRecord = {
  ...wrongCrossField,
  chunkId: 2,
  startMs: 50 * 60_000,
  endMs: 52 * 60_000,
  transcript: "Dude, 500k and Bando's Robleggs.",
  summary: "The player continues the quest.",
  rank: 1.10
}

function repository(): SearchRepository {
  return {
    lexicalSearch: () => [wrongCrossField],
    semanticSearch: () => [wrongCrossField, desiredMoment],
    countSearchChunks: () => 2,
    getTranscriptSegmentsInRange: (_mediaId, startMs) => startMs >= 50 * 60_000
      ? [{ startMs: 50 * 60_000 + 20_000, endMs: 50 * 60_000 + 24_000, text: "Dude, 500k and Bando's Robleggs." }]
      : [
          { startMs: 21 * 60_000 + 2_000, endMs: 21 * 60_000 + 6_000, text: "My rune plate legs have more armour." },
          { startMs: 21 * 60_000 + 59_000, endMs: 22 * 60_000 + 3_000, text: "We are ready for Bandos." }
        ]
  }
}

describe("SearchService ranking modes", () => {
  it("uses whole-query same-field evidence to rerank semantic and hybrid results", () => {
    const service = new SearchService(repository())
    const embedding = new Float32Array([1])

    const semantic = service.search({ query: "bandos legs", mode: "semantic", includeMissing: false, limit: 10 }, embedding)
    const hybrid = service.search({ query: "bandos legs", mode: "hybrid", includeMissing: false, limit: 10 }, embedding)

    expect(semantic.hits[0]).toMatchObject({
      startMs: 50 * 60_000 + 20_000,
      transcriptExcerpt: "Dude, 500k and Bando's Robleggs.",
      matchReasons: ["transcript", "semantic"]
    })
    expect(hybrid.hits[0]).toMatchObject({
      startMs: 50 * 60_000 + 20_000,
      transcriptExcerpt: "Dude, 500k and Bando's Robleggs.",
      matchReasons: ["transcript", "semantic"]
    })
    expect(semantic.hits[0]!.scoreBreakdown.semantic).toBeGreaterThan(0)
    expect(semantic.hits[0]!.scoreBreakdown.transcript).toBeGreaterThan(0)
    expect(semantic.hits[0]!.score).not.toBe(hybrid.hits[0]!.score)
  })

  it("rejects a keyword hit whose terms only match across different fields", () => {
    const response = new SearchService(repository()).search({
      query: "bandos legs",
      mode: "keyword",
      includeMissing: false,
      limit: 10
    })
    expect(response.hits).toEqual([])
  })

  it("passes selected media constraints to both retrieval modes", () => {
    const calls: Array<string[] | undefined> = []
    const constrained: SearchRepository = {
      lexicalSearch: (_query, _missing, _limit, _after, _before, mediaIds) => { calls.push(mediaIds); return [] },
      semanticSearch: (_embedding, _missing, _limit, _after, _before, mediaIds) => { calls.push(mediaIds); return [] },
      countSearchChunks: () => 0
    }
    new SearchService(constrained).search({
      query: "a story beat",
      mode: "hybrid",
      includeMissing: false,
      limit: 10,
      mediaIds: ["chosen-video"]
    }, new Float32Array([1]))
    expect(calls).toEqual([["chosen-video"], ["chosen-video"]])
  })
})
