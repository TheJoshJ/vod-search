import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"
import type {
  MediaDetail,
  NormalizedVideoRect,
  ShortFormCaptionPreset,
  ShortFormProject
} from "@vod-search/contracts"
import {
  ArrowLeft,
  Captions,
  Download,
  Grip,
  LoaderCircle,
  Pause,
  Play,
  Smartphone,
  Sparkles
} from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Slider } from "@/components/ui/slider"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatTimestamp } from "@/lib/format"
import { cn } from "@/lib/utils"
import type { MediaWorkspaceSelection } from "./media-workspace"
import { drawOutputFrame, drawSourceFrame } from "./short-form-canvas"
import {
  activeShortFormCaption,
  clampVideoRect,
  fitAspectRatio,
  resizeVideoRect
} from "./short-form-project"

type CropKind = "content" | "face"
const MIN_TRIM_DURATION_MS = 1_000

export function ShortFormWorkspace({
  project,
  onProjectChange,
  onOpenSource,
  onError
}: {
  project: ShortFormProject | null
  onProjectChange: (project: ShortFormProject | null) => void
  onOpenSource: (selection: MediaWorkspaceSelection) => void
  onError: (reason: unknown) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const outputCanvasRef = useRef<HTMLCanvasElement>(null)
  const sourceCanvasRef = useRef<HTMLCanvasElement>(null)
  const cropStageRef = useRef<HTMLDivElement>(null)
  const previewStageRef = useRef<HTMLDivElement>(null)
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(project?.startMs ?? 0)
  const [selectedCrop, setSelectedCrop] = useState<CropKind>("content")
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [previewSize, setPreviewSize] = useState({ width: 0, height: 0 })

  useEffect(() => {
    if (!project) {
      setDetail(null)
      setPlaybackUrl(null)
      return
    }
    let cancelled = false
    setLoading(true)
    setCurrentMs(project.startMs)
    void Promise.all([
      window.vodSearch.media.getDetail(project.mediaId),
      window.vodSearch.media.getPlaybackSource(project.mediaId)
    ]).then(([nextDetail, playback]) => {
      if (cancelled) return
      setDetail(nextDetail)
      setPlaybackUrl(playback.available ? playback.url : null)
    }).catch((reason: unknown) => {
      if (!cancelled) onError(reason)
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [project?.mediaId])

  useEffect(() => {
    const video = videoRef.current
    if (!project || !video) return
    let frame = 0
    const draw = (): void => {
      drawSourceFrame(sourceCanvasRef.current, video)
      drawOutputFrame(outputCanvasRef.current, video, project)
      frame = window.requestAnimationFrame(draw)
    }
    frame = window.requestAnimationFrame(draw)
    return () => window.cancelAnimationFrame(frame)
  }, [project])

  useLayoutEffect(() => {
    const stage = previewStageRef.current
    if (!stage) return
    const resize = (): void => {
      const bounds = stage.getBoundingClientRect()
      const next = fitAspectRatio(bounds.width, bounds.height, 9, 16)
      setPreviewSize((current) =>
        Math.abs(current.width - next.width) < 0.5 && Math.abs(current.height - next.height) < 0.5
          ? current
          : next)
    }
    resize()
    const observer = new ResizeObserver(resize)
    observer.observe(stage)
    return () => observer.disconnect()
  }, [loading, project?.mediaId])

  const selectedRect = project?.layout[selectedCrop === "content" ? "contentRect" : "faceRect"] ?? null
  const durationMs = project ? project.endMs - project.startMs : 0
  const contextDurationMs = project ? project.contextEndMs - project.contextStartMs : 0
  const playheadPercent = project && contextDurationMs > 0
    ? Math.max(0, Math.min(100, (currentMs - project.contextStartMs) / contextDurationMs * 100))
    : 0
  const trimmedCaptions = useMemo(
    () => project
      ? project.captions.filter((caption) => caption.endMs > project.startMs && caption.startMs < project.endMs)
      : [],
    [project]
  )
  const activeCaption = useMemo(
    () => activeShortFormCaption(trimmedCaptions, currentMs),
    [currentMs, trimmedCaptions]
  )

  function updateProject(patch: Partial<ShortFormProject>): void {
    if (!project) return
    onProjectChange({ ...project, ...patch })
    setExportedPath(null)
  }

  function updateLayout(patch: Partial<ShortFormProject["layout"]>): void {
    if (!project) return
    updateProject({ layout: { ...project.layout, ...patch } })
  }

  function updateCaptionStyle(patch: Partial<ShortFormProject["captionStyle"]>): void {
    if (!project) return
    updateProject({ captionStyle: { ...project.captionStyle, ...patch } })
  }

  function updateCrop(kind: CropKind, rect: NormalizedVideoRect): void {
    updateLayout(kind === "content" ? { contentRect: clampVideoRect(rect) } : { faceRect: clampVideoRect(rect) })
  }

  function updateTrim(startMs: number, endMs: number): void {
    if (!project) return
    const boundedStart = Math.max(
      project.contextStartMs,
      Math.min(startMs, project.contextEndMs - MIN_TRIM_DURATION_MS)
    )
    const boundedEnd = Math.min(
      project.contextEndMs,
      Math.max(endMs, boundedStart + MIN_TRIM_DURATION_MS)
    )
    updateProject({ startMs: boundedStart, endMs: boundedEnd })
    if (currentMs < boundedStart || currentMs > boundedEnd) seek(boundedStart)
  }

  function beginCropDrag(kind: CropKind, event: React.PointerEvent<HTMLButtonElement>): void {
    if (!project || !cropStageRef.current) return
    event.preventDefault()
    setSelectedCrop(kind)
    const stage = cropStageRef.current.getBoundingClientRect()
    const initial = project.layout[kind === "content" ? "contentRect" : "faceRect"]
    const startX = event.clientX
    const startY = event.clientY
    const move = (nextEvent: PointerEvent): void => {
      updateCrop(kind, {
        ...initial,
        x: initial.x + (nextEvent.clientX - startX) / Math.max(1, stage.width),
        y: initial.y + (nextEvent.clientY - startY) / Math.max(1, stage.height)
      })
    }
    const stop = (): void => {
      window.removeEventListener("pointermove", move)
      window.removeEventListener("pointerup", stop)
    }
    window.addEventListener("pointermove", move)
    window.addEventListener("pointerup", stop, { once: true })
  }

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current
    if (!project || !video) return
    if (!video.paused) {
      video.pause()
      return
    }
    if (video.currentTime * 1000 < project.startMs || video.currentTime * 1000 >= project.endMs) {
      video.currentTime = project.startMs / 1000
    }
    try { await video.play() } catch (reason) { onError(reason) }
  }

  function seek(milliseconds: number): void {
    const video = videoRef.current
    if (!project || !video) return
    const bounded = Math.max(project.contextStartMs, Math.min(project.contextEndMs, milliseconds))
    video.currentTime = bounded / 1000
    setCurrentMs(bounded)
  }

  async function exportProject(): Promise<void> {
    if (!project || exporting) return
    setExporting(true)
    setExportedPath(null)
    try {
      const result = await window.vodSearch.shortForm.export(project)
      if (result.path) setExportedPath(result.path)
    } catch (reason) {
      onError(reason)
    } finally {
      setExporting(false)
    }
  }

  if (!project) {
    return (
      <div className="flex h-full min-h-0 flex-col">
        <WorkspaceHeader title="Short form" description="Turn an indexed clip into a captioned vertical video." />
        <div className="grid min-h-0 flex-1 place-items-center p-8 text-center">
          <div className="w-full max-w-xl">
            <div className="mx-auto grid size-14 place-items-center rounded-xl border border-primary/20 bg-primary/10 text-primary shadow-sm"><Smartphone className="size-6" /></div>
            <h2 className="mt-5 text-base font-semibold tracking-tight">Start from a clip</h2>
            <p className="mx-auto mt-2 max-w-sm text-xs leading-5 text-muted-foreground">Build a vertical cut from any indexed moment, then refine the crop, timing, and captions here.</p>
            <ol className="mt-7 grid grid-cols-3 border-y text-left">
              <li className="border-r px-4 py-4"><span className="font-mono text-[9px] text-primary">01</span><p className="mt-1 text-[11px] font-semibold">Open a video</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">Choose a source from Library.</p></li>
              <li className="border-r px-4 py-4"><span className="font-mono text-[9px] text-primary">02</span><p className="mt-1 text-[11px] font-semibold">Choose Clip</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">Set the context near the playhead.</p></li>
              <li className="px-4 py-4"><span className="font-mono text-[9px] text-primary">03</span><p className="mt-1 text-[11px] font-semibold">Refine and export</p><p className="mt-1 text-[9px] leading-4 text-muted-foreground">Finish the 9:16 cut locally.</p></li>
            </ol>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <WorkspaceHeader
        title="Short form"
        description={`${project.title} · ${formatTimestamp(durationMs)} cut from ${formatTimestamp(contextDurationMs)} context · 1080 × 1920`}
        actions={(
          <div className="flex items-center gap-2">
            <Button variant="outline" size="sm" onClick={() => onOpenSource({ mediaId: project.mediaId, title: detail?.media.displayName ?? project.title, initialMs: project.startMs, returnLabel: "short form" })}><ArrowLeft />Source</Button>
            <Button size="sm" disabled={exporting || !playbackUrl} onClick={() => void exportProject()}>
              {exporting ? <LoaderCircle className="animate-spin" /> : <Download />}
              {exporting ? "Rendering…" : "Export MP4"}
            </Button>
          </div>
        )}
      />

      <div className="grid min-h-0 flex-1 grid-cols-[minmax(20rem,1fr)_minmax(20rem,32rem)_20rem] max-[1180px]:grid-cols-[minmax(18rem,1fr)_22rem_18rem]">
        <section className="min-h-0 overflow-y-auto border-r bg-muted/10 p-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div><h2 className="text-xs font-semibold">Source regions</h2><p className="mt-1 text-[10px] text-muted-foreground">Drag either box over the area it should follow.</p></div>
            <Badge variant="secondary">16:9 source</Badge>
          </div>

          <div ref={cropStageRef} className="relative mt-4 aspect-video overflow-hidden rounded-md border bg-black">
            <canvas ref={sourceCanvasRef} width={640} height={360} className="size-full" />
            {(["content", "face"] as const).map((kind) => {
              const rect = project.layout[kind === "content" ? "contentRect" : "faceRect"]
              const active = selectedCrop === kind
              return (
                <button
                  key={kind}
                  type="button"
                  className={cn(
                    "absolute flex cursor-move touch-none items-start justify-between border-2 bg-black/10 p-1 text-[9px] font-semibold uppercase tracking-wider text-white outline-none transition-colors",
                    kind === "content" ? "border-primary" : "border-chart-3",
                    active && "bg-white/10 ring-2 ring-white/60 ring-offset-1 ring-offset-black/50"
                  )}
                  style={{ left: `${rect.x * 100}%`, top: `${rect.y * 100}%`, width: `${rect.width * 100}%`, height: `${rect.height * 100}%` }}
                  onPointerDown={(event) => beginCropDrag(kind, event)}
                  onFocus={() => setSelectedCrop(kind)}
                >
                  <span className="rounded-sm bg-black/70 px-1 py-0.5">{kind === "content" ? "Content" : "Face cam"}</span><Grip className="size-3" />
                </button>
              )
            })}
          </div>

          <ToggleGroup type="single" value={selectedCrop} onValueChange={(value) => { if (value) setSelectedCrop(value as CropKind) }} className="mt-4 grid grid-cols-2">
            <ToggleGroupItem value="content">Content crop</ToggleGroupItem>
            <ToggleGroupItem value="face">Face-cam crop</ToggleGroupItem>
          </ToggleGroup>

          {selectedRect && (
            <div className="mt-5 space-y-4 border-t pt-4">
              <RangeControl label="Crop width" value={selectedRect.width * 100} minimum={8} maximum={100} suffix="%" onChange={(value) => updateCrop(selectedCrop, resizeVideoRect(selectedRect, { width: value / 100 }))} />
              <RangeControl label="Crop height" value={selectedRect.height * 100} minimum={8} maximum={100} suffix="%" onChange={(value) => updateCrop(selectedCrop, resizeVideoRect(selectedRect, { height: value / 100 }))} />
            </div>
          )}

          <div className="mt-5 border-t pt-4">
            <RangeControl label="Content height" value={project.layout.contentFraction * 100} minimum={40} maximum={82} suffix="%" onChange={(value) => updateLayout({ contentFraction: value / 100 })} />
            <div className="mt-4 flex items-center justify-between gap-3">
              <div><p className="text-[10px] font-medium">Stack order</p><p className="mt-0.5 text-[9px] text-muted-foreground">Choose which crop sits at the top.</p></div>
              <Select value={project.layout.faceFirst ? "face" : "content"} onValueChange={(value) => updateLayout({ faceFirst: value === "face" })}>
                <SelectTrigger className="h-8 w-32 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="content">Content first</SelectItem><SelectItem value="face">Face first</SelectItem></SelectContent>
              </Select>
            </div>
          </div>
        </section>

        <main className="flex min-h-0 flex-col items-center justify-center bg-[#090b0a] px-5 py-4">
          {loading ? <LoaderCircle className="size-5 animate-spin text-muted-foreground" /> : (
            <div className="flex min-h-0 w-full flex-1 flex-col items-center justify-center">
              <div ref={previewStageRef} className="flex min-h-0 w-full flex-1 items-center justify-center overflow-hidden">
                <div
                  className="relative shrink-0 overflow-hidden rounded-md border border-white/10 bg-black shadow-2xl shadow-black/40"
                  style={{ width: previewSize.width, height: previewSize.height }}
                >
                  <canvas ref={outputCanvasRef} width={360} height={640} className="size-full" />
                </div>
              </div>
              <div className="mt-4 flex w-full max-w-md items-start gap-3 border-t border-white/10 pt-3">
                <Button variant="outline" size="icon-sm" className="mt-4 shrink-0 border-white/15 bg-white/5 text-white hover:bg-white/10 hover:text-white" onClick={() => void togglePlayback()}>{playing ? <Pause /> : <Play />}</Button>
                <div className="min-w-0 flex-1">
                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[8px] font-mono tabular-nums text-white/35">
                    <span>{formatTimestamp(project.contextStartMs)}</span>
                    <span><span className="mr-1.5 uppercase tracking-wide">Playhead</span><span className="text-white/80">{formatTimestamp(currentMs)}</span></span>
                    <span className="text-right">{formatTimestamp(project.contextEndMs)}</span>
                  </div>
                  <div className="relative mt-2 py-1">
                    <Slider
                      className="relative z-10 [&_[data-slot=slider-track]]:h-1 [&_[data-slot=slider-thumb]]:size-3"
                      min={project.contextStartMs}
                      max={project.contextEndMs}
                      step={50}
                      value={[currentMs]}
                      onValueChange={(value) => seek(value[0] ?? project.startMs)}
                      aria-label="Short-form playhead"
                    />
                    <Slider
                      className="relative z-20 mt-2 [&_[data-slot=slider-track]]:h-2 [&_[data-slot=slider-range]]:bg-primary/55"
                      min={project.contextStartMs}
                      max={project.contextEndMs}
                      step={50}
                      minStepsBetweenThumbs={MIN_TRIM_DURATION_MS / 50}
                      value={[project.startMs, project.endMs]}
                      onValueChange={(value) => updateTrim(value[0] ?? project.startMs, value[1] ?? project.endMs)}
                      aria-label="Short-form in and out points"
                    />
                    <span
                      className="pointer-events-none absolute inset-y-0 z-30 w-px -translate-x-1/2 bg-white/45"
                      style={{ left: `${playheadPercent}%` }}
                      aria-hidden="true"
                    />
                  </div>
                  <div className="mt-2 grid grid-cols-[1fr_auto_1fr] items-center gap-3 text-[9px] text-white/55">
                    <span><span className="mr-1.5 font-semibold uppercase tracking-wide text-white/35">In</span><span className="font-mono tabular-nums text-white/80">{formatTimestamp(project.startMs)}</span></span>
                    <span className="font-mono tabular-nums">{formatTimestamp(durationMs)} cut</span>
                    <span className="text-right"><span className="mr-1.5 font-semibold uppercase tracking-wide text-white/35">Out</span><span className="font-mono tabular-nums text-white/80">{formatTimestamp(project.endMs)}</span></span>
                  </div>
                  <div className="mt-1 flex items-center justify-between gap-3">
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[9px] text-white/65 hover:bg-white/10 hover:text-white"
                    disabled={currentMs >= project.endMs - MIN_TRIM_DURATION_MS}
                    onClick={() => updateTrim(currentMs, project.endMs)}
                  >
                    Set in at playhead
                  </Button>
                  <span className="text-[8px] text-white/30">Drag handles or use playhead</span>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 text-[9px] text-white/65 hover:bg-white/10 hover:text-white"
                    disabled={currentMs <= project.startMs + MIN_TRIM_DURATION_MS}
                    onClick={() => updateTrim(project.startMs, currentMs)}
                  >
                    Set out at playhead
                  </Button>
                  </div>
                </div>
              </div>
              {activeCaption && <p className="mt-2 max-w-md truncate text-center text-[9px] text-white/40">Caption: {activeCaption.text}</p>}
            </div>
          )}
          <video
            ref={videoRef}
            className="pointer-events-none absolute size-px opacity-0"
            src={playbackUrl ?? undefined}
            playsInline
            preload="auto"
            onLoadedMetadata={(event) => { event.currentTarget.currentTime = project.startMs / 1000 }}
            onPlay={() => setPlaying(true)}
            onPause={() => setPlaying(false)}
            onTimeUpdate={(event) => {
              const nextMs = Math.round(event.currentTarget.currentTime * 1000)
              if (nextMs >= project.endMs) {
                event.currentTarget.pause()
                event.currentTarget.currentTime = project.startMs / 1000
                setCurrentMs(project.startMs)
              } else setCurrentMs(nextMs)
            }}
          />
        </main>

        <aside className="min-h-0 overflow-y-auto border-l p-4">
          <div className="flex items-center justify-between border-b pb-3">
            <div><h2 className="text-xs font-semibold">Captions</h2><p className="mt-1 text-[10px] text-muted-foreground">Generated from the indexed transcript.</p></div>
            <Switch checked={project.captionStyle.enabled} onCheckedChange={(enabled) => updateCaptionStyle({ enabled })} aria-label="Enable captions" />
          </div>

          <div className={cn("space-y-4 pt-4", !project.captionStyle.enabled && "pointer-events-none opacity-45")}>
            <label className="block text-[10px] font-medium">Style
              <Select value={project.captionStyle.preset} onValueChange={(value) => updateCaptionStyle({ preset: value as ShortFormCaptionPreset })}>
                <SelectTrigger className="mt-1.5 h-8 text-[10px]"><SelectValue /></SelectTrigger>
                <SelectContent><SelectItem value="impact">Impact highlight</SelectItem><SelectItem value="clean">Clean panel</SelectItem><SelectItem value="minimal">Minimal outline</SelectItem></SelectContent>
              </Select>
            </label>
            <RangeControl label="Type size" value={project.captionStyle.fontSize} minimum={36} maximum={140} suffix=" px" onChange={(fontSize) => updateCaptionStyle({ fontSize: Math.round(fontSize) })} />
            <RangeControl label="Vertical position" value={project.captionStyle.positionY * 100} minimum={12} maximum={90} suffix="%" onChange={(positionY) => updateCaptionStyle({ positionY: positionY / 100 })} />
            <div className="grid grid-cols-2 gap-3">
              <ColorControl label="Text" value={project.captionStyle.textColor} onChange={(textColor) => updateCaptionStyle({ textColor })} />
              <ColorControl label="Highlight" value={project.captionStyle.highlightColor} onChange={(highlightColor) => updateCaptionStyle({ highlightColor })} />
            </div>
            <div className="flex items-center justify-between border-y py-3">
              <div><p className="text-[10px] font-medium">Uppercase</p><p className="mt-0.5 text-[9px] text-muted-foreground">Applied at preview and export.</p></div>
              <Switch checked={project.captionStyle.uppercase} onCheckedChange={(uppercase) => updateCaptionStyle({ uppercase })} aria-label="Uppercase captions" />
            </div>
          </div>

          <div className="mt-5 flex items-center justify-between">
            <h3 className="text-[10px] font-semibold">Transcript phrases</h3>
            <Badge variant="secondary">{trimmedCaptions.length}</Badge>
          </div>
          <div className="mt-2 max-h-72 space-y-1 overflow-y-auto border-y py-1">
            {trimmedCaptions.length === 0 ? (
              <div className="py-7 text-center"><Captions className="mx-auto size-4 text-muted-foreground" /><p className="mt-2 text-[10px] text-muted-foreground">No transcript overlaps this clip.</p></div>
            ) : trimmedCaptions.map((caption) => (
              <div key={caption.id} className={cn("grid grid-cols-[3.25rem_1fr] items-center gap-2 border-b py-1.5 last:border-b-0", activeCaption?.id === caption.id && "bg-primary/5")}>
                <span className="font-mono text-[8px] text-muted-foreground">{formatTimestamp(caption.startMs - project.startMs)}</span>
                <Input
                  value={caption.text}
                  className="h-7 border-transparent bg-transparent px-1.5 text-[10px] hover:border-input focus:border-input"
                  onChange={(event) => updateProject({ captions: project.captions.map((item) => item.id === caption.id ? { ...item, text: event.target.value } : item) })}
                />
              </div>
            ))}
          </div>

          {exportedPath && <div className="mt-4 border border-primary/25 bg-primary/5 px-3 py-2 text-[10px] leading-4 text-muted-foreground"><span className="font-semibold text-foreground">Export complete.</span><br />{exportedPath.split(/[\\/]/).at(-1)}</div>}
          <div className="mt-4 flex items-start gap-2 border-t pt-3 text-[9px] leading-4 text-muted-foreground"><Sparkles className="mt-0.5 size-3 shrink-0 text-primary" />Everything renders locally with the packaged video runtime; the source file is never modified.</div>
        </aside>
      </div>
    </div>
  )
}

function WorkspaceHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }): React.JSX.Element {
  return <header className="page-header flex h-[4.5rem] shrink-0 items-center gap-3 border-b px-5"><div className="min-w-0 flex-1"><h1 className="truncate text-[17px] font-semibold tracking-[-0.03em]">{title}</h1><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{description}</p></div>{actions}</header>
}

function RangeControl({ label, value, minimum, maximum, suffix, onChange }: { label: string; value: number; minimum: number; maximum: number; suffix: string; onChange: (value: number) => void }): React.JSX.Element {
  return <label className="block"><span className="flex items-center justify-between text-[10px] font-medium"><span>{label}</span><span className="font-mono text-[9px] text-muted-foreground">{Math.round(value)}{suffix}</span></span><Slider className="mt-2" min={minimum} max={maximum} step={1} value={[value]} onValueChange={(next) => onChange(next[0] ?? value)} /></label>
}

function ColorControl({ label, value, onChange }: { label: string; value: string; onChange: (value: string) => void }): React.JSX.Element {
  return <label className="text-[10px] font-medium">{label}<span className="mt-1.5 flex h-8 items-center gap-2 rounded-md border px-2"><input type="color" value={value} onChange={(event) => onChange(event.target.value)} className="size-4 cursor-pointer border-0 bg-transparent p-0" /><span className="font-mono text-[9px] text-muted-foreground">{value}</span></span></label>
}
