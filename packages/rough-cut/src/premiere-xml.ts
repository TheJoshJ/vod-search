import { basename } from "node:path"
import { pathToFileURL } from "node:url"
import {
  roughCutPlanSchema,
  type RoughCutFrameRate,
  type RoughCutPlan
} from "@vod-search/contracts"

export interface FrameRateDescriptor {
  timebase: number
  ntsc: boolean
  numerator: number
  denominator: number
}

const frameRates: Record<RoughCutFrameRate, FrameRateDescriptor> = {
  "23.976": { timebase: 24, ntsc: true, numerator: 24_000, denominator: 1_001 },
  "24": { timebase: 24, ntsc: false, numerator: 24, denominator: 1 },
  "25": { timebase: 25, ntsc: false, numerator: 25, denominator: 1 },
  "29.97": { timebase: 30, ntsc: true, numerator: 30_000, denominator: 1_001 },
  "30": { timebase: 30, ntsc: false, numerator: 30, denominator: 1 },
  "50": { timebase: 50, ntsc: false, numerator: 50, denominator: 1 },
  "59.94": { timebase: 60, ntsc: true, numerator: 60_000, denominator: 1_001 },
  "60": { timebase: 60, ntsc: false, numerator: 60, denominator: 1 }
}

export function describeFrameRate(rate: RoughCutFrameRate): FrameRateDescriptor {
  return frameRates[rate]
}

export function millisecondsToFrames(milliseconds: number, rate: RoughCutFrameRate, rounding: "floor" | "ceil" | "round" = "round"): number {
  const descriptor = describeFrameRate(rate)
  const frames = milliseconds * descriptor.numerator / (1_000 * descriptor.denominator)
  return Math.max(0, Math[rounding](frames))
}

export function buildPremiereXml(input: RoughCutPlan): string {
  const plan = roughCutPlanSchema.parse(input)
  const rate = describeFrameRate(plan.frameRate)
  const fileIds = new Map<string, string>()
  for (const item of plan.items) {
    if (!fileIds.has(item.mediaId)) fileIds.set(item.mediaId, `file-${fileIds.size + 1}`)
  }

  let timelineFrame = 0
  const clips = plan.items.map((item, index) => {
    const sourceIn = millisecondsToFrames(item.sourceInMs, plan.frameRate, "floor")
    const sourceOut = Math.max(sourceIn + 1, millisecondsToFrames(item.sourceOutMs, plan.frameRate, "ceil"))
    const duration = sourceOut - sourceIn
    const start = timelineFrame
    const end = start + duration
    timelineFrame = end
    return { item, index, sourceIn, sourceOut, start, end, fileId: fileIds.get(item.mediaId)! }
  })

  const fullFileIds = new Set<string>()
  const videoItems = clips.map((clip) => {
    const fileXml = fullFileIds.has(clip.fileId)
      ? `<file id="${clip.fileId}"/>`
      : buildFileXml(clip.fileId, clip.item.sourceTitle, clip.item.sourcePath, clip.item.sourceDurationMs, plan.frameRate)
    fullFileIds.add(clip.fileId)
    return buildClipItemXml({ ...clip, kind: "video", fileXml })
  }).join("\n")
  const audioItems = clips.map((clip) => buildClipItemXml({ ...clip, kind: "audio", fileXml: `<file id="${clip.fileId}"/>` })).join("\n")

  return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE xmeml>
<xmeml version="5">
  <sequence id="sequence-1">
    <name>${xml(plan.title)}</name>
    <duration>${timelineFrame}</duration>
    ${rateXml(rate, 4)}
    <timecode>
      ${rateXml(rate, 6)}
      <string>00:00:00:00</string>
      <frame>0</frame>
      <displayformat>NDF</displayformat>
    </timecode>
    <media>
      <video>
        <format>
          <samplecharacteristics>
            ${rateXml(rate, 12)}
            <width>1920</width>
            <height>1080</height>
            <anamorphic>FALSE</anamorphic>
            <pixelaspectratio>square</pixelaspectratio>
            <fielddominance>none</fielddominance>
          </samplecharacteristics>
        </format>
        <track>
${indent(videoItems, 10)}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>
      </video>
      <audio>
        <format>
          <samplecharacteristics>
            <depth>16</depth>
            <samplerate>48000</samplerate>
          </samplecharacteristics>
        </format>
        <outputs>
          <group><index>1</index><numchannels>2</numchannels><downmix>0</downmix><channel><index>1</index/></channel><channel><index>2</index/></channel></group>
        </outputs>
        <track>
${indent(audioItems, 10)}
          <enabled>TRUE</enabled>
          <locked>FALSE</locked>
        </track>
      </audio>
    </media>
  </sequence>
</xmeml>
`
}

function buildClipItemXml(input: {
  item: RoughCutPlan["items"][number]
  index: number
  sourceIn: number
  sourceOut: number
  start: number
  end: number
  fileId: string
  kind: "video" | "audio"
  fileXml: string
}): string {
  const clipNumber = input.index + 1
  const ownId = `clipitem-${input.kind === "video" ? "v" : "a"}-${clipNumber}`
  const linkedId = `clipitem-${input.kind === "video" ? "a" : "v"}-${clipNumber}`
  return `<clipitem id="${ownId}">
  <name>${xml(input.item.sourceTitle)}</name>
  <enabled>TRUE</enabled>
  <duration>${input.sourceOut - input.sourceIn}</duration>
  <start>${input.start}</start>
  <end>${input.end}</end>
  <in>${input.sourceIn}</in>
  <out>${input.sourceOut}</out>
  ${input.fileXml}
  <sourcetrack><mediatype>${input.kind}</mediatype><trackindex>1</trackindex></sourcetrack>
  <link><linkclipref>${ownId}</linkclipref><mediatype>${input.kind}</mediatype><trackindex>1</trackindex><clipindex>${clipNumber}</clipindex></link>
  <link><linkclipref>${linkedId}</linkclipref><mediatype>${input.kind === "video" ? "audio" : "video"}</mediatype><trackindex>1</trackindex><clipindex>${clipNumber}</clipindex></link>
</clipitem>`
}

function buildFileXml(id: string, title: string, sourcePath: string, durationMs: number, frameRate: RoughCutFrameRate): string {
  const rate = describeFrameRate(frameRate)
  const durationFrames = Math.max(1, millisecondsToFrames(durationMs, frameRate, "ceil"))
  return `<file id="${id}">
  <name>${xml(basename(title))}</name>
  <pathurl>${xml(pathToFileURL(sourcePath).href)}</pathurl>
  ${rateXml(rate, 2)}
  <duration>${durationFrames}</duration>
  <timecode>${rateXml(rate, 4)}<string>00:00:00:00</string><frame>0</frame><displayformat>NDF</displayformat></timecode>
  <media><video/><audio><channelcount>2</channelcount></audio></media>
</file>`
}

function rateXml(rate: FrameRateDescriptor, spaces: number): string {
  const padding = " ".repeat(spaces)
  return `<rate>\n${padding}  <timebase>${rate.timebase}</timebase>\n${padding}  <ntsc>${rate.ntsc ? "TRUE" : "FALSE"}</ntsc>\n${padding}</rate>`
}

function xml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;")
}

function indent(value: string, spaces: number): string {
  const padding = " ".repeat(spaces)
  return value.split("\n").map((line) => `${padding}${line}`).join("\n")
}
