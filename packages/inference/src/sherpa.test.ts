import { describe, expect, it } from "vitest"
import { clusterLocalSpeakers, collectSpeakerSamples, cosineSimilarity } from "./sherpa.js"

describe("Sherpa speaker matching", () => {
  it("compares normalized voice embeddings", () => {
    expect(cosineSimilarity([1, 0], [1, 0])).toBe(1)
    expect(cosineSimilarity([1, 0], [0, 1])).toBe(0)
    expect(cosineSimilarity([], [])).toBeNull()
  })

  it("collects only the requested speaker's audio", () => {
    const samples = Float32Array.from({ length: 40 }, (_, index) => index)
    const collected = collectSpeakerSamples(samples, 10, [
      { label: "speaker-1", startMs: 0, endMs: 1_000 },
      { label: "speaker-2", startMs: 1_000, endMs: 2_000 },
      { label: "speaker-1", startMs: 2_000, endMs: 3_000 }
    ], "speaker-1", 30, 2)
    expect(Array.from(collected)).toEqual([...Array.from(samples.slice(0, 10)), ...Array.from(samples.slice(20, 30))])
  })

  it("repeats a short sample to meet the embedding model minimum", () => {
    const samples = Float32Array.from([1, 2, 3, 4])
    const collected = collectSpeakerSamples(samples, 4, [
      { label: "speaker-1", startMs: 0, endMs: 1_000 }
    ], "speaker-1", 30, 2)
    expect(Array.from(collected)).toEqual([1, 2, 3, 4, 1, 2, 3, 4])
  })

  it("reconciles the same voice across independent long-file chunks", () => {
    const result = clusterLocalSpeakers([
      { label: "chunk-1-speaker-1", embedding: [1, 0, 0] },
      { label: "chunk-1-speaker-2", embedding: [0, 1, 0] },
      { label: "chunk-2-speaker-1", embedding: [0.99, 0.04, 0] },
      { label: "chunk-2-speaker-2", embedding: [0, 0, 1] }
    ])
    expect(result.speakers).toHaveLength(3)
    expect(result.labels.get("chunk-2-speaker-1")).toBe(result.labels.get("chunk-1-speaker-1"))
    expect(result.labels.get("chunk-2-speaker-2")).not.toBe(result.labels.get("chunk-1-speaker-2"))
  })

  it("drops sub-second local noise without losing a brief real speaker", () => {
    const durations = new Map([
      ["chunk-1-speaker-1", 40_000],
      ["chunk-1-speaker-2", 3_100],
      ["chunk-2-speaker-3", 900]
    ])
    const result = clusterLocalSpeakers([
      { label: "chunk-1-speaker-1", embedding: [1, 0, 0] },
      { label: "chunk-1-speaker-2", embedding: [0, 1, 0] },
      { label: "chunk-2-speaker-3", embedding: [0, 0, 1] }
    ], 0.5, durations)
    expect(result.speakers).toHaveLength(2)
    expect(result.labels.has("chunk-1-speaker-2")).toBe(true)
    expect(result.labels.has("chunk-2-speaker-3")).toBe(false)
  })
})
