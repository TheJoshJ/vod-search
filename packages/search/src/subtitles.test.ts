import { describe, expect, it } from "vitest"
import { parseAss, parseSrt, parseTimestamp, parseVtt } from "./subtitles.js"

describe("subtitle parsing", () => {
  it("parses SRT timestamps and markup", () => {
    const result = parseSrt(`1\n00:00:01,250 --> 00:00:03,500\n<i>Hello</i> &amp; welcome\n\n2\n00:00:04,000 --> 00:00:05,000\nNext line.`)
    expect(result).toEqual([
      { startMs: 1250, endMs: 3500, text: "Hello & welcome" },
      { startMs: 4000, endMs: 5000, text: "Next line." }
    ])
  })

  it("parses WEBVTT cue settings", () => {
    const result = parseVtt("WEBVTT\n\n00:01.000 --> 00:02.500 align:start\nKalphite King")
    expect(result).toEqual([{ startMs: 1000, endMs: 2500, text: "Kalphite King" }])
  })

  it("parses ASS dialogue", () => {
    const result = parseAss("[Events]\nDialogue: 0,0:00:02.00,0:00:04.20,Default,,0,0,0,,I died\\Nat KK")
    expect(result).toEqual([{ startMs: 2000, endMs: 4200, text: "I died at KK" }])
  })

  it("decodes entities once before removing encoded markup", () => {
    const result = parseSrt("1\n00:00:01,000 --> 00:00:02,000\n&lt;b&gt;Safe&lt;/b&gt; &amp;lt;literal&amp;gt;")
    expect(result).toEqual([{ startMs: 1000, endMs: 2000, text: "Safe &lt;literal&gt;" }])
  })

  it("handles large unterminated markup without backtracking", () => {
    const text = `{\\${"x{".repeat(20_000)}safe`
    const result = parseSrt(`1\n00:00:01,000 --> 00:00:02,000\n${text}`)
    expect(result[0]?.text).toBe(text)
  })

  it("rejects invalid timestamps", () => {
    expect(parseTimestamp("00:61:00.000")).toBeNull()
  })
})

