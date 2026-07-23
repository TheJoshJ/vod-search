import { useEffect, useMemo, useRef, useState } from "react"
import type { MediaDetail, SearchHit, ShortFormProject } from "@vod-search/contracts"
import { ArrowLeft, CalendarDays, ChevronLeft, ChevronRight, CircleAlert, FileText, LoaderCircle, Search, Sparkles, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { formatDate, formatTimestamp, stageLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { ClipComposer } from "./clip-composer"
import { SpeakersPanel, TranscriptSpeakerAssignment } from "./media-speaker-panel"
import { areDisplayTextsEquivalent } from "./search-presentation"
import { cleanMediaTitle, splitQueryMatches } from "./search-workflow"
import { createShortFormProject } from "./short-form-project"
import { clusterTimelinePoints } from "./timeline-presentation"
import { findActiveTranscriptSegmentId, getTranscriptFollowScrollTop } from "./transcript-follow"

export interface MediaWorkspaceSelection {
  mediaId: string
  title: string
  initialMs?: number
  markers?: SearchHit[]
  query?: string
  returnLabel?: string
}

interface TimelineMarker {
  id: string
  startMs: number
  endMs: number
  label: string
  kind: "summary" | "match"
}

export function MediaWorkspace({
  selection,
  onClose,
  onEditShort
}: {
  selection: MediaWorkspaceSelection
  onClose: () => void
  onEditShort: (project: ShortFormProject) => void
}): React.JSX.Element {
  const returnLabel = selection.returnLabel ?? "library"
  const videoRef = useRef<HTMLVideoElement>(null)
  const timelineRef = useRef<HTMLDivElement>(null)
  const transcriptScrollRef = useRef<HTMLDivElement>(null)
  const transcriptRowsRef = useRef(new Map<number, HTMLButtonElement>())
  const lastFollowedSegmentRef = useRef<number | null>(null)
  const pendingSeekRef = useRef(selection.initialMs ?? 0)
  const resumeAfterScrubRef = useRef(false)
  const scrubbingRef = useRef(false)
  const previewEndRef = useRef<number | null>(null)
  const [detail, setDetail] = useState<MediaDetail | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [currentMs, setCurrentMs] = useState(selection.initialMs ?? 0)
  const [actualDurationMs, setActualDurationMs] = useState(0)
  const [markerKinds, setMarkerKinds] = useState<Array<TimelineMarker["kind"]>>(
    selection.query ? ["match"] : ["summary"]
  )
  const [sidebarTab, setSidebarTab] = useState<"transcript" | "speakers">("transcript")

  useEffect(() => {
    let cancelled = false
    const initialMs = selection.initialMs ?? 0
    pendingSeekRef.current = initialMs
    setLoading(true)
    setError(null)
    setDetail(null)
    setPlaybackUrl(null)
    setCurrentMs(initialMs)
    setActualDurationMs(0)
    setMarkerKinds(selection.query ? ["match"] : ["summary"])
    setSidebarTab("transcript")
    previewEndRef.current = null
    lastFollowedSegmentRef.current = null
    transcriptRowsRef.current.clear()
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

  useEffect(() => window.vodSearch.events.onLibraryChanged(() => {
    void window.vodSearch.media.getDetail(selection.mediaId).then(setDetail).catch((reason: unknown) => {
      setError(reason instanceof Error ? reason.message : String(reason))
    })
  }), [selection.mediaId])

  const durationMs = Math.max(1, actualDurationMs || detail?.media.durationMs || 1)
  const markers = useMemo(() => buildMarkers(detail, selection.markers ?? []), [detail, selection.markers])
  const visibleMarkers = useMemo(() => markers.filter((marker) => markerKinds.includes(marker.kind)), [markerKinds, markers])
  const markerGroups = useMemo(() => clusterTimelinePoints(visibleMarkers, durationMs), [durationMs, visibleMarkers])
  const searchMatches = useMemo(() => markers.filter((marker) => marker.kind === "match"), [markers])
  const activeSearchIndex = useMemo(() => findClosestMarkerIndex(searchMatches, currentMs), [currentMs, searchMatches])
  const activeSegmentId = useMemo(
    () => detail ? findActiveTranscriptSegmentId(detail.transcript, currentMs) : null,
    [currentMs, detail]
  )
  const speakersById = useMemo(() => new Map(detail?.speakers.map((speaker) => [speaker.id, speaker]) ?? []), [detail?.speakers])

  useEffect(() => {
    if (sidebarTab !== "transcript" || activeSegmentId === null || lastFollowedSegmentRef.current === activeSegmentId) return

    const container = transcriptScrollRef.current
    const row = transcriptRowsRef.current.get(activeSegmentId)
    if (!container || !row) return

    const containerBounds = container.getBoundingClientRect()
    const rowBounds = row.getBoundingClientRect()
    const nextScrollTop = getTranscriptFollowScrollTop({
      containerTop: containerBounds.top,
      containerHeight: containerBounds.height,
      rowTop: rowBounds.top,
      rowHeight: rowBounds.height,
      scrollTop: container.scrollTop
    })

    lastFollowedSegmentRef.current = activeSegmentId
    if (nextScrollTop === null) return

    container.scrollTo({
      top: nextScrollTop,
      behavior: scrubbingRef.current ? "auto" : "smooth"
    })
  }, [activeSegmentId, sidebarTab])

  function seekTo(milliseconds: number): void {
    previewEndRef.current = null
    const nextMs = Math.max(0, Math.min(durationMs, milliseconds))
    pendingSeekRef.current = nextMs
    setCurrentMs(nextMs)
    const video = videoRef.current
    if (video && video.readyState >= HTMLMediaElement.HAVE_METADATA && Number.isFinite(video.duration)) {
      video.currentTime = Math.min(nextMs / 1000, Math.max(0, video.duration - 0.01))
    }
  }

  function navigateSearch(direction: -1 | 1): void {
    if (searchMatches.length === 0) return
    const nextIndex = activeSearchIndex < 0
      ? 0
      : (activeSearchIndex + direction + searchMatches.length) % searchMatches.length
    seekTo(searchMatches[nextIndex]!.startMs)
  }

  function previewRange(startMs: number, endMs: number): void {
    seekTo(startMs)
    previewEndRef.current = endMs
    void videoRef.current?.play().catch(() => undefined)
  }

  async function refreshDetail(): Promise<void> {
    setDetail(await window.vodSearch.media.getDetail(selection.mediaId))
  }

  function beginScrub(): void {
    const video = videoRef.current
    resumeAfterScrubRef.current = Boolean(video && !video.paused)
    scrubbingRef.current = true
    video?.pause()
  }

  function finishScrub(milliseconds: number): void {
    seekTo(milliseconds)
    scrubbingRef.current = false
    if (resumeAfterScrubRef.current) void videoRef.current?.play().catch(() => undefined)
    resumeAfterScrubRef.current = false
  }

  function timelinePosition(clientX: number): number {
    const bounds = timelineRef.current?.getBoundingClientRect()
    if (!bounds || bounds.width <= 0) return currentMs
    return Math.max(0, Math.min(durationMs, (clientX - bounds.left) / bounds.width * durationMs))
  }

  function moveTimelineWithKey(event: React.KeyboardEvent<HTMLDivElement>): void {
    const amount = event.shiftKey ? 30_000 : 5_000
    const nextMs = event.key === "ArrowLeft" || event.key === "ArrowDown"
      ? currentMs - amount
      : event.key === "ArrowRight" || event.key === "ArrowUp"
        ? currentMs + amount
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? durationMs
            : null
    if (nextMs === null) return
    event.preventDefault()
    seekTo(nextMs)
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <header className="flex h-16 shrink-0 items-center gap-3 border-b px-3">
        <Button variant="ghost" size="icon-sm" aria-label={`Back to ${returnLabel}`} onClick={onClose}><ArrowLeft /></Button>
        <div className="min-w-0 flex-1 border-l pl-3">
          <h1 className="truncate text-sm font-semibold tracking-tight" title={detail?.media.displayName ?? selection.title}>{cleanMediaTitle(detail?.media.displayName ?? selection.title)}</h1>
          <div className="mt-0.5 flex min-w-0 items-center gap-3 text-[10px] text-muted-foreground">
            <span className="min-w-0 truncate font-mono">{detail?.media.relativePath ?? "Loading file details…"}</span>
            {detail && <span className="inline-flex shrink-0 items-center gap-1"><CalendarDays className="size-3" />{formatDate(detail.media.createdAtMs)}</span>}
            {detail?.media.durationMs && <span className="shrink-0 font-mono">{formatTimestamp(detail.media.durationMs)}</span>}
          </div>
        </div>
        {detail && <Badge variant={detail.media.highestCompletedStage === "ready" ? "accent" : "secondary"}>{stageLabel(detail.media.highestCompletedStage)}</Badge>}
        {detail && <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground min-[1100px]:flex"><FileText className="size-3" />{detail.transcript.length} segments</span>}
        {detail && (
          <ClipComposer
            mediaId={detail.media.id}
            currentMs={currentMs}
            durationMs={durationMs}
            disabled={!playbackUrl}
            onPreview={previewRange}
            onEditShort={(startMs, endMs) => onEditShort(createShortFormProject(detail, startMs, endMs))}
          />
        )}
      </header>

      {detail && selection.query && searchMatches.length > 0 && (
        <div className="flex h-10 shrink-0 items-center gap-2 border-b bg-chart-3/5 px-3 text-[10px]">
          <Search className="size-3.5 text-chart-3" />
          <span className="font-semibold">Search: “{selection.query}”</span>
          <span className="text-muted-foreground">{searchMatches.length} strong {searchMatches.length === 1 ? "moment" : "moments"}</span>
          <span className="ml-auto font-mono tabular-nums text-muted-foreground">{activeSearchIndex + 1} of {searchMatches.length}</span>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Previous search match" onClick={() => navigateSearch(-1)}><ChevronLeft /></Button>
          <Button variant="ghost" size="icon-sm" className="size-7" aria-label="Next search match" onClick={() => navigateSearch(1)}><ChevronRight /></Button>
        </div>
      )}

      {loading ? (
        <div className="grid min-h-0 flex-1 place-items-center text-muted-foreground"><LoaderCircle className="size-5 animate-spin" /></div>
      ) : error ? (
        <div className="grid min-h-0 flex-1 place-items-center p-8"><div className="max-w-sm text-center"><CircleAlert className="mx-auto size-6 text-destructive" /><p className="mt-3 text-sm font-semibold">Couldn’t open this video</p><p className="mt-2 text-xs leading-5 text-muted-foreground">{error}</p><Button variant="outline" size="sm" className="mt-4" onClick={onClose}>Back to {returnLabel}</Button></div></div>
      ) : detail ? (
        <div className="grid min-h-0 flex-1 grid-cols-[minmax(0,1fr)_minmax(20rem,25rem)] max-[1050px]:grid-cols-[minmax(0,1fr)_20rem]">
          <main className="min-h-0 overflow-y-auto bg-muted/15">
            <div className="border-b p-4">
              {playbackUrl ? (
                <div className="mx-auto max-w-[1120px] overflow-hidden rounded-md border bg-black">
                  <video
                    ref={videoRef}
                    className="aspect-video max-h-[calc(100vh-18rem)] w-full bg-black object-contain"
                    src={playbackUrl}
                    controls
                    playsInline
                    preload="metadata"
                    onLoadedMetadata={(event) => {
                      const video = event.currentTarget
                      const nextDurationMs = Number.isFinite(video.duration) ? Math.round(video.duration * 1000) : detail.media.durationMs ?? 0
                      setActualDurationMs(nextDurationMs)
                      const nextSeconds = Math.min(pendingSeekRef.current / 1000, Math.max(0, video.duration - 0.01))
                      if (Number.isFinite(nextSeconds)) video.currentTime = nextSeconds
                    }}
                    onDurationChange={(event) => {
                      if (Number.isFinite(event.currentTarget.duration)) setActualDurationMs(Math.round(event.currentTarget.duration * 1000))
                    }}
                    onTimeUpdate={(event) => {
                      const nextMs = Math.round(event.currentTarget.currentTime * 1000)
                      if (previewEndRef.current !== null && nextMs >= previewEndRef.current) {
                        event.currentTarget.pause()
                        previewEndRef.current = null
                      }
                      if (!scrubbingRef.current) setCurrentMs(nextMs)
                    }}
                    onSeeked={(event) => setCurrentMs(Math.round(event.currentTarget.currentTime * 1000))}
                  />
                </div>
              ) : (
                <div className="mx-auto grid aspect-video max-h-[calc(100vh-18rem)] max-w-[1120px] place-items-center rounded-md border bg-muted text-xs text-muted-foreground">The source file is currently unavailable.</div>
              )}
            </div>

            <section className="mx-auto max-w-[1120px] px-4 py-3" aria-label="Video timeline">
              <div className="flex items-center justify-between gap-3 text-[10px]">
                <div className="flex items-center gap-3"><span className="font-mono font-medium tabular-nums text-foreground">{formatTimestamp(currentMs)} <span className="text-muted-foreground">/ {formatTimestamp(durationMs)}</span></span>{visibleMarkers.length > 0 && <span className="text-muted-foreground">{visibleMarkers.length} visible markers</span>}</div>
                <ToggleGroup
                  type="multiple"
                  size="sm"
                  value={markerKinds}
                  onValueChange={(value) => setMarkerKinds(value as Array<TimelineMarker["kind"]>)}
                  aria-label="Visible marker layers"
                  className="shrink-0"
                >
                  <ToggleGroupItem value="summary" aria-label="Show topic markers"><span className="size-1.5 rounded-full bg-primary" />Topics</ToggleGroupItem>
                  {selection.query && <ToggleGroupItem value="match" aria-label="Show search markers"><span className="size-1.5 rounded-full bg-chart-3" />Search</ToggleGroupItem>}
                </ToggleGroup>
              </div>
              <div className="relative mt-2 h-8">
                <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1 -translate-y-1/2 overflow-hidden rounded-full bg-input">
                  <div className="h-full bg-primary" style={{ width: `${Math.min(100, currentMs / durationMs * 100)}%` }} />
                </div>
                <div
                  ref={timelineRef}
                  role="slider"
                  tabIndex={0}
                  aria-label="Video position"
                  aria-valuemin={0}
                  aria-valuemax={durationMs}
                  aria-valuenow={Math.min(currentMs, durationMs)}
                  aria-valuetext={`${formatTimestamp(currentMs)} of ${formatTimestamp(durationMs)}`}
                  className="absolute inset-0 z-10 cursor-pointer rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                  onKeyDown={moveTimelineWithKey}
                  onPointerDown={(event) => {
                    if (event.button !== 0) return
                    event.currentTarget.setPointerCapture(event.pointerId)
                    beginScrub()
                    seekTo(timelinePosition(event.clientX))
                  }}
                  onPointerMove={(event) => { if (scrubbingRef.current) seekTo(timelinePosition(event.clientX)) }}
                  onPointerUp={(event) => {
                    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
                    finishScrub(timelinePosition(event.clientX))
                  }}
                  onPointerCancel={() => finishScrub(currentMs)}
                  onBlur={() => { scrubbingRef.current = false }}
                />
                <span aria-hidden="true" className="pointer-events-none absolute top-1/2 z-30 size-3 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-background bg-primary ring-1 ring-primary/40" style={{ left: `${Math.min(100, currentMs / durationMs * 100)}%` }} />
                {markerGroups.map((group) => {
                  const primaryMarker = group.points.find((marker) => marker.kind === "match") ?? group.points[0]!
                  return (
                  <span
                    key={group.id}
                    title={`${primaryMarker.kind === "match" ? "Search match" : "Topic"} at ${formatTimestamp(primaryMarker.startMs)}: ${primaryMarker.label}${group.points.length > 1 ? ` (+${group.points.length - 1} nearby)` : ""}`}
                    aria-hidden="true"
                    className={cn("pointer-events-none absolute top-1/2 z-20 -translate-x-1/2 -translate-y-1/2 rounded-sm", primaryMarker.kind === "match" ? "h-3 w-1 bg-chart-3 ring-1 ring-background" : "h-2 w-px bg-primary/75", group.points.length > 1 && "w-1.5 ring-2 ring-background")}
                    style={{ left: `${Math.min(100, group.startMs / durationMs * 100)}%` }}
                  />
                  )
                })}
              </div>
            </section>

            <section className="mx-auto max-w-[1120px] border-t px-4 py-3">
              <div className="mb-2 flex items-center justify-between"><h2 className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">Markers</h2><span className="text-[10px] text-muted-foreground">Select a marker to seek</span></div>
              {visibleMarkers.length === 0 ? (
                <p className="py-3 text-xs text-muted-foreground">No markers are visible. Enable a marker layer above.</p>
              ) : (
                <div className="divide-y border-y">
                  {visibleMarkers.map((marker) => (
                    <button key={`${marker.id}:row`} type="button" onClick={() => seekTo(marker.startMs)} className="grid w-full cursor-pointer grid-cols-[4.5rem_1rem_minmax(0,1fr)] items-start gap-2 py-2 text-left transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 focus-visible:outline-none">
                      <span className="font-mono text-[10px] font-medium tabular-nums text-primary">{formatTimestamp(marker.startMs)}</span>
                      {marker.kind === "match" ? <Search className="mt-0.5 size-3 text-chart-3" /> : <Sparkles className="mt-0.5 size-3 text-primary" />}
                      <span className="line-clamp-2 text-[11px] leading-4 text-muted-foreground">{marker.label}</span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </main>

          <aside className="min-h-0 border-l bg-background">
            <Tabs value={sidebarTab} onValueChange={(value) => setSidebarTab(value as "transcript" | "speakers")} className="h-full min-h-0 gap-0">
              <div className="flex h-11 shrink-0 items-center border-b px-2">
                <TabsList className="h-8 w-full rounded-none bg-transparent p-0">
                  <TabsTrigger value="transcript" className="h-8 rounded-none px-2 text-[11px] shadow-none data-[state=active]:border-x-0 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><FileText />Transcript <span className="font-mono text-[9px] text-muted-foreground">{detail.transcript.length}</span></TabsTrigger>
                  <TabsTrigger value="speakers" className="h-8 rounded-none px-2 text-[11px] shadow-none data-[state=active]:border-x-0 data-[state=active]:border-b-primary data-[state=active]:bg-transparent data-[state=active]:shadow-none"><Users />Speakers <span className="font-mono text-[9px] text-muted-foreground">{detail.speakers.length}</span></TabsTrigger>
                </TabsList>
              </div>
              <TabsContent value="transcript" className="min-h-0 overflow-hidden">
                <div ref={transcriptScrollRef} className="h-full overflow-y-auto">
                  {detail.transcript.length === 0 ? (
                    <div className="grid min-h-48 place-items-center px-5 text-center"><div><FileText className="mx-auto size-4 text-muted-foreground" /><p className="mt-3 text-xs font-semibold">No transcript yet</p><p className="mt-1 text-[10px] leading-4 text-muted-foreground">This video is waiting for subtitles or local transcription.</p></div></div>
                  ) : detail.transcript.map((segment) => {
                    const queryMatch = Boolean(selection.query && searchMatches.some((marker) => rangesOverlap(marker, segment)))
                    const speaker = segment.mediaSpeakerId ? speakersById.get(segment.mediaSpeakerId) : undefined
                    return (
                      <div key={segment.id} className={cn("group relative border-b border-l-2 border-l-transparent border-r-2 border-r-transparent transition-colors hover:bg-accent/35", queryMatch && "border-r-chart-3 bg-chart-3/10", activeSegmentId === segment.id && "border-l-primary bg-accent/65")}>
                        <button type="button" ref={(node) => { if (node) transcriptRowsRef.current.set(segment.id, node); else transcriptRowsRef.current.delete(segment.id) }} data-active={activeSegmentId === segment.id} aria-current={activeSegmentId === segment.id ? "true" : undefined} aria-label={`Seek to ${formatTimestamp(segment.startMs)}: ${segment.text}`} onClick={() => seekTo(segment.startMs)} className="grid w-full cursor-pointer grid-cols-[3.5rem_minmax(0,1fr)] gap-2 px-3 py-2.5 text-left focus-visible:bg-accent/35 focus-visible:outline-none">
                          <span className={cn("font-mono text-[9px] font-medium tabular-nums text-primary", activeSegmentId === segment.id && "font-semibold")}>{formatTimestamp(segment.startMs)}</span>
                          <span className="min-w-0">{speaker && <span aria-hidden="true" className="mb-1 block h-5" />}<span className={cn("block text-[11px] leading-[1.45] text-foreground/90", activeSegmentId === segment.id && "font-medium text-foreground")}><HighlightedTranscriptText text={segment.text} query={selection.query} /></span></span>
                        </button>
                        {speaker && <div className="absolute left-[4.5rem] right-2 top-1.5 flex min-w-0 items-center"><TranscriptSpeakerAssignment speaker={speaker} profiles={detail.speakerProfiles} onChanged={refreshDetail} onError={(reason) => setError(reason instanceof Error ? reason.message : String(reason))} /></div>}
                      </div>
                    )
                  })}
                </div>
              </TabsContent>
              <TabsContent value="speakers" className="min-h-0 overflow-y-auto"><SpeakersPanel detail={detail} onChanged={refreshDetail} onError={(reason) => setError(reason instanceof Error ? reason.message : String(reason))} /></TabsContent>
            </Tabs>
          </aside>
        </div>
      ) : null}
    </div>
  )
}

function HighlightedTranscriptText({ text, query }: { text: string; query?: string | undefined }): React.JSX.Element {
  if (!query) return <>{text}</>
  return <>{splitQueryMatches(text, query).map((part, index) => part.match
    ? <mark key={`${part.text}:${index}`} className="rounded-sm bg-chart-3/25 px-0.5 text-inherit">{part.text}</mark>
    : <span key={`${part.text}:${index}`}>{part.text}</span>)}</>
}

function findClosestMarkerIndex(markers: TimelineMarker[], currentMs: number): number {
  if (markers.length === 0) return -1
  const containingIndex = markers.findIndex((marker) => currentMs >= marker.startMs && currentMs <= marker.endMs)
  if (containingIndex >= 0) return containingIndex
  return markers.reduce((bestIndex, marker, index) =>
    Math.abs(marker.startMs - currentMs) < Math.abs(markers[bestIndex]!.startMs - currentMs) ? index : bestIndex, 0)
}

function buildMarkers(detail: MediaDetail | null, searchHits: SearchHit[]): TimelineMarker[] {
  if (!detail) return []
  const summaries: TimelineMarker[] = detail.summaries.map((section, index) => ({
    id: `summary:${section.startMs}:${index}`,
    startMs: section.startMs,
    endMs: section.endMs,
    label: section.summary,
    kind: "summary"
  }))
  const matches: TimelineMarker[] = searchHits.map((hit, index) => ({
    id: `match:${hit.startMs}:${index}`,
    startMs: hit.startMs,
    endMs: hit.endMs,
    label: hit.transcriptExcerpt.trim() || hit.summary || "Search match",
    kind: "match"
  }))
  const unique: TimelineMarker[] = []
  for (const marker of [...summaries, ...matches]) {
    const duplicateIndex = unique.findIndex((candidate) =>
      areDisplayTextsEquivalent(candidate.label, marker.label) &&
      (rangesOverlap(candidate, marker) || Math.abs(candidate.startMs - marker.startMs) <= 15_000)
    )
    if (duplicateIndex < 0) {
      unique.push(marker)
    } else if (marker.kind === "match" && unique[duplicateIndex]!.kind !== "match") {
      unique[duplicateIndex] = marker
    }
  }
  return unique.sort((left, right) => left.startMs - right.startMs || (left.kind === "match" ? 1 : -1))
}

function rangesOverlap(left: { startMs: number; endMs: number }, right: { startMs: number; endMs: number }): boolean {
  return left.startMs <= right.endMs && right.startMs <= left.endMs
}
