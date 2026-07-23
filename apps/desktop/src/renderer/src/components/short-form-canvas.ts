import type { NormalizedVideoRect, ShortFormProject } from "@vod-search/contracts"
import { activeShortFormCaption, coverSourceRect } from "./short-form-project"

export function drawSourceFrame(canvas: HTMLCanvasElement | null, video: HTMLVideoElement): void {
  if (!canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return
  const context = canvas.getContext("2d")
  if (!context) return
  context.clearRect(0, 0, canvas.width, canvas.height)
  context.drawImage(video, 0, 0, canvas.width, canvas.height)
}

export function drawOutputFrame(canvas: HTMLCanvasElement | null, video: HTMLVideoElement, project: ShortFormProject): void {
  if (!canvas || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA || video.videoWidth <= 0) return
  const context = canvas.getContext("2d")
  if (!context) return
  const contentHeight = Math.round(canvas.height * project.layout.contentFraction)
  const faceHeight = canvas.height - contentHeight
  const contentY = project.layout.faceFirst ? faceHeight : 0
  const faceY = project.layout.faceFirst ? 0 : contentHeight
  context.fillStyle = "#000000"
  context.fillRect(0, 0, canvas.width, canvas.height)
  drawCrop(context, video, project.layout.contentRect, 0, contentY, canvas.width, contentHeight)
  drawCrop(context, video, project.layout.faceRect, 0, faceY, canvas.width, faceHeight)
  if (!project.captionStyle.enabled) return
  const cue = activeShortFormCaption(project.captions, video.currentTime * 1000)
  if (cue) drawCaptionPreview(context, cue.text, video.currentTime * 1000, cue.startMs, cue.endMs, project)
}

function drawCrop(context: CanvasRenderingContext2D, video: HTMLVideoElement, rect: NormalizedVideoRect, x: number, y: number, width: number, height: number): void {
  const source = coverSourceRect(rect, video.videoWidth, video.videoHeight, width, height)
  context.drawImage(video, source.sx, source.sy, source.sw, source.sh, x, y, width, height)
}

function drawCaptionPreview(context: CanvasRenderingContext2D, rawText: string, currentMs: number, startMs: number, endMs: number, project: ShortFormProject): void {
  const style = project.captionStyle
  const text = style.uppercase ? rawText.toLocaleUpperCase("en-US") : rawText
  const words = text.split(/\s+/).filter(Boolean)
  if (words.length === 0) return
  const fontSize = style.fontSize / 3
  const font = style.preset === "impact" ? "Arial Black, Arial, sans-serif" : "Segoe UI, Arial, sans-serif"
  context.save()
  context.font = `${style.preset === "minimal" ? 600 : 800} ${fontSize}px ${font}`
  context.textAlign = "left"
  context.textBaseline = "middle"
  context.lineJoin = "round"
  const space = context.measureText(" ").width
  const widths = words.map((word) => context.measureText(word).width)
  const totalWidth = widths.reduce((sum, width) => sum + width, 0) + space * (words.length - 1)
  const scale = Math.min(1, context.canvas.width * 0.92 / Math.max(1, totalWidth))
  if (scale < 1) context.font = `${style.preset === "minimal" ? 600 : 800} ${fontSize * scale}px ${font}`
  const finalSpace = context.measureText(" ").width
  const finalWidths = words.map((word) => context.measureText(word).width)
  const finalTotal = finalWidths.reduce((sum, width) => sum + width, 0) + finalSpace * (words.length - 1)
  let x = (context.canvas.width - finalTotal) / 2
  const y = context.canvas.height * style.positionY
  if (style.preset === "clean") {
    context.fillStyle = "rgba(0,0,0,0.62)"
    context.fillRect(x - 8, y - fontSize * 0.72, finalTotal + 16, fontSize * 1.44)
  }
  const activeIndex = Math.min(words.length - 1, Math.floor((currentMs - startMs) / Math.max(1, endMs - startMs) * words.length))
  words.forEach((word, index) => {
    if (style.preset !== "clean") {
      context.lineWidth = style.preset === "impact" ? Math.max(3, fontSize * 0.16) : Math.max(2, fontSize * 0.08)
      context.strokeStyle = "rgba(0,0,0,0.92)"
      context.strokeText(word, x, y)
    }
    context.fillStyle = style.preset === "impact" && index === activeIndex ? style.highlightColor : style.textColor
    context.fillText(word, x, y)
    x += (finalWidths[index] ?? 0) + finalSpace
  })
  context.restore()
}
