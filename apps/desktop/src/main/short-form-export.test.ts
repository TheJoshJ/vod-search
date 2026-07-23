import { describe, expect, it } from "vitest"
import type { ShortFormProject } from "@vod-search/contracts"
import { buildAssCaptions, buildShortFormArguments, buildShortFormFilter, exportShortFormVideo } from "./short-form-export.js"

const project: ShortFormProject = {
  mediaId: "media-1",
  title: "A vertical test",
  contextStartMs: 5_000,
  contextEndMs: 45_000,
  startMs: 10_000,
  endMs: 40_000,
  layout: {
    contentRect: { x: 0, y: 0, width: 0.75, height: 1 },
    faceRect: { x: 0.7, y: 0, width: 0.3, height: 0.4 },
    contentFraction: 0.64,
    faceFirst: false
  },
  captionStyle: {
    enabled: true,
    preset: "impact",
    fontSize: 78,
    positionY: 0.58,
    textColor: "#ffffff",
    highlightColor: "#a3ff12",
    uppercase: true
  },
  captions: [{ id: "caption-1", startMs: 12_000, endMs: 14_000, text: "This is huge" }]
}

describe("short-form export", () => {
  it("builds a 9:16 stacked crop without stretching either selected region", () => {
    const filter = buildShortFormFilter(project, null)
    expect(filter).toContain("scale=1080:1228:force_original_aspect_ratio=increase")
    expect(filter).toContain("scale=1080:692:force_original_aspect_ratio=increase")
    expect(filter).toContain("[content][face]vstack")
  })

  it("adds a Windows-safe ASS subtitle filter", () => {
    const filter = buildShortFormFilter(project, "C:\\Temp Folder\\captions.ass")
    expect(filter).toContain("subtitles=filename='C\\:/Temp Folder/captions.ass'")
  })

  it("escapes every FFmpeg metacharacter in a Windows subtitle path", () => {
    const filter = buildShortFormFilter(project, "C:\\Editor's Cut\\nested\\captions.ass")
    expect(filter).toContain("subtitles=filename='C\\:/Editor\\'s Cut/nested/captions.ass'")
  })

  it("emits clip-relative, word-highlighted subtitle events", () => {
    const captions = buildAssCaptions(project)
    expect(captions).toContain("PlayResX: 1080")
    expect(captions).toContain("0:00:02.00")
    expect(captions).toContain("\\pos(540,1114)")
    expect(captions).toMatch(/THIS.*IS.*HUGE/)
    expect(captions).toContain("&H0012FFA3")
  })

  it("uses the selected source range and bundled local encoder", () => {
    const args = buildShortFormArguments("source.mp4", "short.mp4", project, null)
    expect(args).toContain("10.000")
    expect(args).toContain("30.000")
    expect(args).toContain("libopenh264")
    expect(args.at(-1)).toBe("short.mp4")
  })

  it("executes through an injected local runtime", async () => {
    const calls: string[][] = []
    await exportShortFormVideo({
      project: { ...project, captionStyle: { ...project.captionStyle, enabled: false } },
      sourcePath: "source.mp4",
      outputPath: "short.mp4",
      resourcesPath: "C:\\resources",
      environment: { VOD_SEARCH_FFMPEG_PATH: process.execPath },
      execute: async (_path, args) => { calls.push(args) }
    })
    expect(calls).toHaveLength(1)
    expect(calls[0]).toContain("[short-form-video]")
  })
})
