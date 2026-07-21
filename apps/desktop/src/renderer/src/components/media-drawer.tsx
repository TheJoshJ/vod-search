import { useEffect, useMemo, useRef, useState } from "react"
import type { MediaDetail, SearchHit } from "@vod-search/contracts"
import { CalendarDays, CircleAlert, LoaderCircle, Pause, Play, RotateCcw, RotateCw, Sparkles } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { cn } from "@/lib/utils"

export interface MediaDrawerSelection {
  mediaId: string
  title: string
  initialMs?: number
  markers?: SearchHit[]
}

export function MediaDrawer({
  selection,
  onClose
}: {
  selection: MediaDrawerSelection | null
  onClose: () => void
}): React.JSX.Element {
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [activeTab, setActiveTab] = useState("video")
  const [seekMs, setSeekMs] = useState(0)

  useEffect(() => {
    if (!selection) return
    let cancelled = false
    setLoading(true)
    setError(null)
    setDetail(null)
    setPlaybackUrl(null)
    setActiveTab("video")
    setSeekMs(selection.initialMs ?? 0)
    void Promise.all([
      window.vodSearch.media.getDetail(selection.mediaId),
      window.vodSearch.media.getPlaybackSource(selection.mediaId)
    ]).then(([nextDetail, playback]) => {
      if (cancelled) return
      setDetail(nextDetail)
      setPlaybackUrl(playback.available ? playback.url : null)
    }).catch((reason: unknown) => {
      if (!cancelled) setError(reason instanceof Error ? reason.message : String(reason))
    }).finally(() => {
      if (!cancelled) setLoading(false)
    })
    return () => { cancelled = true }
  }, [selection])

  function jumpTo(milliseconds: number): void {
    setSeekMs(milliseconds)
    setActiveTab("video")
  }

  return (
    <Sheet open={selection !== null} onOpenChange={(open) => { if (!open) onClose() }}>
      <SheetContent className="max-w-none">
        <SheetHeader>
          <SheetTitle className="truncate pr-3">{detail?.media.displayName ?? selection?.title ?? "Video"}</SheetTitle>
          <SheetDescription className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="max-w-[70vw] truncate font-mono text-xs">{detail?.media.relativePath ?? "Loading file details…"}</span>
            {detail && <span className="inline-flex items-center gap-1"><CalendarDays className="size-3.5" />{formatDate(detail.media.createdAtMs)}</span>}
          </SheetDescription>
        </SheetHeader>

        {loading ? (
          <div className="grid flex-1 place-items-center text-muted-foreground"><LoaderCircle className="size-6 animate-spin" /></div>
        ) : error ? (
          <div className="grid flex-1 place-items-center p-8">
            <div className="flex max-w-md flex-col items-center gap-3 text-center"><CircleAlert className="size-7 text-destructive" /><p className="font-semibold">Couldn’t open this video</p><p className="text-sm text-muted-foreground">{error}</p></div>
          </div>
        ) : detail ? (
          <Tabs value={activeTab} onValueChange={setActiveTab} className="min-h-0 flex-1 gap-0">
            <div className="border-b px-7 py-3">
              <TabsList>
                <TabsTrigger value="video">Video</TabsTrigger>
                <TabsTrigger value="transcript">Transcript <span className="ml-1 text-[11px] text-muted-foreground">{detail.transcript.length}</span></TabsTrigger>
                <TabsTrigger value="summary">Summary <span className="ml-1 text-[11px] text-muted-foreground">{detail.summaries.length}</span></TabsTrigger>
              </TabsList>
            </div>
            <TabsContent value="video" className="min-h-0 overflow-y-auto p-7">
              <VideoPlayer
                url={playbackUrl}
                durationMs={detail.media.durationMs ?? 0}
                seekMs={seekMs}
                markers={selection?.markers ?? []}
                onMarkerClick={setSeekMs}
              />
            </TabsContent>
            <TabsContent value="transcript" className="min-h-0 overflow-y-auto">
              <TranscriptPanel detail={detail} onJump={jumpTo} activeMs={seekMs} />
            </TabsContent>
            <TabsContent value="summary" className="min-h-0 overflow-y-auto">
              <SummaryPanel detail={detail} onJump={jumpTo} />
            </TabsContent>
          </Tabs>
        ) : null}
      </SheetContent>
    </Sheet>
  )
}

function VideoPlayer({
  url,
  durationMs,
  seekMs,
  markers,
  onMarkerClick
}: {
  url: string | null
  durationMs: number
  seekMs: number
  markers: SearchHit[]
  onMarkerClick: (milliseconds: number) => void
}): React.JSX.Element {
  const videoRef = useRef<HTMLVideoElement>(null)
  const [playing, setPlaying] = useState(false)
  const [currentMs, setCurrentMs] = useState(seekMs)
  const [actualDurationMs, setActualDurationMs] = useState(durationMs)
  const effectiveDuration = Math.max(1, actualDurationMs || durationMs)

  useEffect(() => {
    setPlaying(false)
    setCurrentMs(seekMs)
    setActualDurationMs(durationMs)
  }, [url, durationMs])

  useEffect(() => {
    const video = videoRef.current
    setCurrentMs(seekMs)
    if (video && Number.isFinite(video.duration)) video.currentTime = Math.min(seekMs / 1000, video.duration)
  }, [seekMs])

  async function togglePlayback(): Promise<void> {
    const video = videoRef.current
    if (!video) return
    if (video.paused) {
      try {
        await video.play()
      } catch {
        setPlaying(false)
      }
    }
    else video.pause()
  }

  function seek(nextMs: number): void {
    const video = videoRef.current
    setCurrentMs(nextMs)
    if (video) video.currentTime = nextMs / 1000
  }

  if (!url) {
    return <div className="grid aspect-video max-h-[68vh] w-full place-items-center rounded-xl border bg-muted text-sm text-muted-foreground">The source file is currently unavailable.</div>
  }

  return (
    <div className="mx-auto flex w-full max-w-[1120px] flex-col gap-4">
      <div className="relative overflow-hidden rounded-xl border bg-black shadow-lg">
        <video
          ref={videoRef}
          className="aspect-video max-h-[68vh] w-full bg-black object-contain"
          src={url}
          playsInline
          onClick={() => void togglePlayback()}
          onLoadedMetadata={(event) => {
            const video = event.currentTarget
            setActualDurationMs(Math.round(video.duration * 1000))
            video.currentTime = Math.min(seekMs / 1000, video.duration)
          }}
          onTimeUpdate={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
          onPlay={() => setPlaying(true)}
          onPause={() => setPlaying(false)}
          onEnded={() => setPlaying(false)}
        />
      </div>
      <div className="rounded-xl border bg-card p-4 shadow-xs">
        <div className="mb-3 flex items-center gap-2">
          <Button variant="ghost" size="icon-sm" aria-label="Back 10 seconds" onClick={() => seek(Math.max(0, currentMs - 10_000))}><RotateCcw /></Button>
          <Button size="icon" aria-label={playing ? "Pause" : "Play"} onClick={() => void togglePlayback()}>{playing ? <Pause className="fill-current" /> : <Play className="ml-0.5 fill-current" />}</Button>
          <Button variant="ghost" size="icon-sm" aria-label="Forward 10 seconds" onClick={() => seek(Math.min(effectiveDuration, currentMs + 10_000))}><RotateCw /></Button>
          <span className="ml-2 font-mono text-xs tabular-nums text-muted-foreground">{formatTimestamp(currentMs)} / {formatTimestamp(effectiveDuration)}</span>
          {markers.length > 0 && <Badge variant="accent" className="ml-auto">{markers.length} {markers.length === 1 ? "match" : "matches"}</Badge>}
        </div>
        <div className="relative h-8">
          <div className="absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2 overflow-hidden rounded-full bg-input">
            <div className="h-full bg-primary" style={{ width: `${Math.min(100, currentMs / effectiveDuration * 100)}%` }} />
          </div>
          {markers.map((marker, index) => {
            const left = Math.min(100, marker.startMs / effectiveDuration * 100)
            const width = Math.max(0.5, (marker.endMs - marker.startMs) / effectiveDuration * 100)
            return (
              <button
                key={`${marker.startMs}:${index}`}
                type="button"
                title={`Match at ${formatTimestamp(marker.startMs)}`}
                className="absolute top-1/2 z-20 h-3 -translate-y-1/2 cursor-pointer rounded-full bg-chart-3 ring-2 ring-background transition-transform hover:scale-y-125"
                style={{ left: `${left}%`, width: `${width}%` }}
                onClick={() => { seek(marker.startMs); onMarkerClick(marker.startMs) }}
              />
            )
          })}
          <input
            aria-label="Video position"
            type="range"
            min={0}
            max={effectiveDuration}
            step={100}
            value={Math.min(currentMs, effectiveDuration)}
            onChange={(event) => seek(Number(event.target.value))}
            className="absolute inset-0 z-10 h-full w-full cursor-pointer appearance-none bg-transparent opacity-0"
          />
        </div>
        {markers.length > 0 && (
          <div className="mt-3 flex gap-2 overflow-x-auto pb-1">
            {markers.map((marker, index) => (
              <button key={`${marker.startMs}:label:${index}`} type="button" onClick={() => seek(marker.startMs)} className="flex shrink-0 cursor-pointer items-center gap-2 rounded-lg border bg-background px-3 py-2 text-left text-xs transition-colors hover:bg-accent">
                <span className="font-mono font-medium text-primary">{formatTimestamp(marker.startMs)}</span>
                <span className="max-w-56 truncate text-muted-foreground">{marker.summary ?? marker.transcriptExcerpt}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

function TranscriptPanel({ detail, onJump, activeMs }: { detail: MediaDetail; onJump: (ms: number) => void; activeMs: number }): React.JSX.Element {
  if (detail.transcript.length === 0) return <EmptyPanel title="No transcript yet" body="This video is still waiting for subtitles or local transcription." />
  return (
    <div className="mx-auto max-w-4xl px-7 py-6">
      <div className="mb-5 flex items-center justify-between"><div><h3 className="font-semibold">Timestamped transcript</h3><p className="mt-1 text-sm text-muted-foreground">Select any line to jump to that moment.</p></div><Badge variant="secondary">{detail.transcript.length} segments</Badge></div>
      <div className="overflow-hidden rounded-xl border bg-card shadow-xs">
        {detail.transcript.map((segment) => (
          <button
            type="button"
            key={segment.id}
            onClick={() => onJump(segment.startMs)}
            className={cn("grid w-full cursor-pointer grid-cols-[5.5rem_1fr] gap-4 border-b px-5 py-4 text-left transition-colors last:border-b-0 hover:bg-accent/60", activeMs >= segment.startMs && activeMs <= segment.endMs && "bg-accent")}
          >
            <span className="font-mono text-xs font-medium text-primary">{formatTimestamp(segment.startMs)}</span>
            <span className="text-sm leading-6">{segment.text}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

function SummaryPanel({ detail, onJump }: { detail: MediaDetail; onJump: (ms: number) => void }): React.JSX.Element {
  const overview = useMemo(() => detail.summaries.map((section) => section.summary).join(" "), [detail.summaries])
  if (detail.summaries.length === 0) return <EmptyPanel title="No summary yet" body="Install the enrichment model in Settings to generate local summaries, entities, and events." />
  return (
    <div className="mx-auto max-w-4xl px-7 py-6">
      <div className="mb-5 rounded-xl border bg-accent/60 p-5">
        <div className="mb-2 flex items-center gap-2 font-semibold text-accent-foreground"><Sparkles className="size-4" />Video overview</div>
        <p className="text-sm leading-6 text-foreground/85">{overview}</p>
      </div>
      <div className="space-y-3">
        {detail.summaries.map((section, index) => (
          <button key={`${section.startMs}:${index}`} type="button" onClick={() => onJump(section.startMs)} className="block w-full cursor-pointer rounded-xl border bg-card p-5 text-left shadow-xs transition-colors hover:bg-accent/45">
            <div className="mb-2 font-mono text-xs font-medium text-primary">{formatTimestamp(section.startMs)} – {formatTimestamp(section.endMs)}</div>
            <p className="text-sm leading-6">{section.summary}</p>
            {(section.entities.length > 0 || section.events.length > 0) && <div className="mt-3 flex flex-wrap gap-1.5">{section.events.map((event) => <Badge key={`event:${event}`} variant="accent">{humanize(event)}</Badge>)}{section.entities.map((entity) => <Badge key={`entity:${entity}`} variant="secondary">{entity}</Badge>)}</div>}
          </button>
        ))}
      </div>
    </div>
  )
}

function EmptyPanel({ title, body }: { title: string; body: string }): React.JSX.Element {
  return <div className="grid h-full min-h-72 place-items-center p-8"><div className="max-w-sm text-center"><p className="font-semibold">{title}</p><p className="mt-2 text-sm leading-6 text-muted-foreground">{body}</p></div></div>
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`
}

function formatDate(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(milliseconds)
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase())
}
