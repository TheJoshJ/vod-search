import { describe, expect, it } from "vitest"
import { buildTimestampClipArguments, exportMediaClip, timestampPlayerCandidates } from "./external-media.js"

describe("external media helpers", () => {
  it("builds a bounded clip beginning at the result timestamp", () => {
    const args = buildTimestampClipArguments("C:\\videos\\source.mp4", "C:\\temp\\clip.mp4", 50 * 60_000 + 20_500)
    expect(args).toContain("3020.500")
    expect(args).toContain("30.000")
    expect(args).toContain("libopenh264")
    expect(args.at(-1)).toBe("C:\\temp\\clip.mp4")
  })

  it("creates timestamp-aware VLC and mpv launch definitions", () => {
    const candidates = timestampPlayerCandidates({
      ProgramFiles: "C:\\Program Files",
      LOCALAPPDATA: "C:\\Users\\test\\AppData\\Local"
    })
    expect(candidates.some((candidate) => candidate.name === "VLC" && candidate.args("video.mp4", 5_000).includes("5.000"))).toBe(true)
    expect(candidates.some((candidate) => candidate.name === "mpv" && candidate.args("video.mp4", 5_000)[0] === "--start=5.000")).toBe(true)
  })

  it("exports a user-selected range with the bundled encoder", async () => {
    const calls: string[][] = []
    await exportMediaClip({
      sourcePath: "source.mp4",
      outputPath: "clip.mp4",
      startMs: 10_000,
      endMs: 55_000,
      resourcesPath: "C:\\resources",
      environment: { VOD_SEARCH_FFMPEG_PATH: process.execPath },
      execute: async (_path, args) => { calls.push(args) }
    })
    expect(calls[0]).toContain("45.000")
  })
})
