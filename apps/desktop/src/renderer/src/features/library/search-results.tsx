import { useEffect, useMemo, useState } from "react"
import type { SearchHit } from "@vod-search/contracts"
import { ChevronDown, ChevronUp, EllipsisVertical, ExternalLink, FolderOpen, LoaderCircle, Play, Search, Video, X } from "lucide-react"
import type { MediaWorkspaceSelection } from "@/components/media-workspace"
import { getSearchResultCopy } from "@/components/search-presentation"
import { cleanMediaTitle, organizeSearchHits, splitQueryMatches, type SearchResultCluster } from "@/components/search-workflow"
import { VideoThumbnail } from "@/components/video-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { formatDate, formatTimestamp } from "@/lib/format"

export function SearchResults({ hits, query, searching, onClear, onOpen, onError }: {
  hits: SearchHit[]
  query: string
  searching: boolean
  onClear: () => void
  onOpen: (selection: MediaWorkspaceSelection) => void
  onError: (error: unknown) => void
}): React.JSX.Element {
  const [showLowerConfidence, setShowLowerConfidence] = useState(false)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set())
  const organized = useMemo(() => organizeSearchHits(hits, showLowerConfidence), [hits, showLowerConfidence])
  const markersByMedia = useMemo(() => {
    const grouped = new Map<string, SearchHit[]>()
    for (const hit of organized.strongHits) grouped.set(hit.mediaId, [...(grouped.get(hit.mediaId) ?? []), hit])
    return grouped
  }, [organized.strongHits])

  useEffect(() => {
    setShowLowerConfidence(false)
    setExpandedClusters(new Set())
  }, [query])

  function openHit(hit: SearchHit): void {
    const strongMarkers = markersByMedia.get(hit.mediaId) ?? []
    const markers = strongMarkers.some((candidate) => candidate.startMs === hit.startMs && candidate.endMs === hit.endMs)
      ? strongMarkers
      : [...strongMarkers, hit]
    onOpen({ mediaId: hit.mediaId, title: cleanMediaTitle(hit.title), initialMs: hit.startMs, markers, query })
  }

  function toggleCluster(id: string): void {
    setExpandedClusters((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  return (
    <section>
      <div className="flex h-10 items-center justify-between border-b">
        <div className="min-w-0 text-xs">
          <span className="font-semibold">{searching ? "Searching…" : `${organized.visibleHitCount} ${showLowerConfidence ? "matches" : "strong matches"}`}</span>
          <span className="ml-2 truncate text-muted-foreground">for “{query}”</span>
          {!showLowerConfidence && organized.lowerConfidenceCount > 0 && <span className="ml-2 text-[10px] text-muted-foreground">· {organized.lowerConfidenceCount} lower confidence hidden</span>}
        </div>
        <Button variant="ghost" size="sm" className="h-7" onClick={onClear}><X />Clear search</Button>
      </div>
      {searching ? (
        <div role="status" aria-live="polite" className="grid min-h-64 place-items-center border-b text-center"><div><LoaderCircle className="mx-auto size-5 animate-spin text-primary" /><p className="mt-3 text-sm font-semibold">Searching indexed moments</p><p className="mt-1 text-xs text-muted-foreground">Looking across transcripts for “{query}”.</p></div></div>
      ) : hits.length === 0 ? (
        <div className="grid min-h-64 place-items-center border-b text-center"><div><Search className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No matching moments</p><p className="mt-1 text-xs text-muted-foreground">Try a broader phrase, exact-words mode, or another date range.</p></div></div>
      ) : organized.groups.map((group) => (
        <section key={group.mediaId} aria-label={`Matches in ${group.title}`} className="border-b">
          <div className="flex h-9 items-center gap-2 bg-muted/25 px-2"><Video className="size-3.5 text-muted-foreground" /><h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={group.relativePath}>{group.title}</h2><span className="text-[9px] text-muted-foreground">{formatDate(group.createdAtMs)}</span><Badge variant="secondary">{group.clusters.length} {group.clusters.length === 1 ? "moment" : "moments"}</Badge></div>
          {group.clusters.map((cluster) => <SearchClusterRow key={cluster.id} cluster={cluster} query={query} expanded={expandedClusters.has(cluster.id)} onToggle={() => toggleCluster(cluster.id)} onOpen={openHit} onError={onError} />)}
        </section>
      ))}
      {!searching && organized.lowerConfidenceCount > 0 && <div className="flex items-center justify-center border-b py-3"><Button variant="ghost" size="sm" onClick={() => setShowLowerConfidence((current) => !current)}>{showLowerConfidence ? <ChevronUp /> : <ChevronDown />}{showLowerConfidence ? "Show strong matches only" : `Show ${organized.lowerConfidenceCount} lower-confidence matches`}</Button></div>}
    </section>
  )
}

function SearchClusterRow({ cluster, query, expanded, onToggle, onOpen, onError }: { cluster: SearchResultCluster; query: string; expanded: boolean; onToggle: () => void; onOpen: (hit: SearchHit) => void; onError: (error: unknown) => void }): React.JSX.Element {
  const hit = cluster.primary
  const copy = getSearchResultCopy(hit.transcriptExcerpt, hit.summary)
  return (
    <div>
      <div className="workspace-row group relative grid w-full grid-cols-[8rem_4.5rem_minmax(0,1fr)_7rem_4.25rem] items-center gap-3 px-2 py-2.5 text-left hover:bg-accent/35 max-[1100px]:grid-cols-[7rem_4rem_minmax(0,1fr)_4.25rem]">
        <button type="button" aria-label={`Open ${cleanMediaTitle(hit.title)} at ${formatTimestamp(hit.startMs)}`} className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40" onClick={() => onOpen(hit)} />
        <div className="pointer-events-none relative z-10 aspect-video overflow-hidden rounded-md border bg-muted"><VideoThumbnail mediaId={hit.mediaId} seekMs={hit.startMs} className="size-full" showPlay={false} /></div>
        <span className="pointer-events-none relative z-10 font-mono text-[11px] font-medium tabular-nums text-primary">{formatTimestamp(hit.startMs)}</span>
        <div className="pointer-events-none relative z-10 min-w-0"><p className="line-clamp-2 text-[11px] leading-4 text-foreground/90"><HighlightedQueryText text={copy.transcript} query={query} /></p>{copy.summary && <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-muted-foreground"><span className="mr-1 font-semibold text-foreground/75">Synopsis</span><HighlightedQueryText text={copy.summary} query={query} /></p>}</div>
        <div className="pointer-events-none relative z-10 flex flex-col items-end gap-1 max-[1100px]:hidden" title={searchScoreTitle(hit)}><span className="font-mono text-[9px] tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{Math.round(hit.score)}</span> score</span><div className="flex gap-1">{hit.matchReasons.slice(0, 2).map((reason) => <Badge key={reason} variant="secondary">{reason}</Badge>)}</div></div>
        <div className="relative z-20 flex items-center justify-end gap-0.5">{cluster.nearby.length > 0 && <Button type="button" variant="ghost" size="icon-sm" className="size-7" aria-label={`${expanded ? "Hide" : "Show"} ${cluster.nearby.length} nearby matches`} onClick={onToggle}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button>}<SearchResultActions hit={hit} onError={onError} /></div>
      </div>
      {expanded && cluster.nearby.length > 0 && <div className="border-t border-dashed bg-muted/15 pl-[10.5rem] max-[1100px]:pl-[9.5rem]">{cluster.nearby.map((nearby) => <button key={`${nearby.mediaId}:${nearby.startMs}:${nearby.score}`} type="button" className="grid w-full cursor-pointer grid-cols-[4.5rem_minmax(0,1fr)_5rem] items-center gap-3 border-b px-2 py-2 text-left last:border-b-0 hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none" onClick={() => onOpen(nearby)}><span className="font-mono text-[10px] text-primary">{formatTimestamp(nearby.startMs)}</span><span className="line-clamp-1 text-[10px] text-muted-foreground"><HighlightedQueryText text={nearby.transcriptExcerpt} query={query} /></span><span className="text-right font-mono text-[9px] text-muted-foreground">{Math.round(nearby.score)} score</span></button>)}</div>}
    </div>
  )
}

function HighlightedQueryText({ text, query }: { text: string; query: string }): React.JSX.Element {
  return <>{splitQueryMatches(text, query).map((part, index) => part.match ? <mark key={index} className="rounded-sm bg-chart-3/20 px-0.5 text-foreground">{part.text}</mark> : <span key={index}>{part.text}</span>)}</>
}

function SearchResultActions({ hit, onError }: { hit: SearchHit; onError: (error: unknown) => void }): React.JSX.Element {
  const [busy, setBusy] = useState(false)
  async function run(action: "timestamp" | "player" | "explorer"): Promise<void> {
    setBusy(true)
    try {
      if (action === "timestamp") await window.vodSearch.media.openExternalAt(hit.mediaId, hit.startMs)
      else if (action === "player") await window.vodSearch.media.openExternal(hit.mediaId)
      else await window.vodSearch.media.revealInExplorer(hit.mediaId)
    } catch (reason) {
      onError(reason)
    } finally {
      setBusy(false)
    }
  }
  return <DropdownMenu><DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={`File actions for ${cleanMediaTitle(hit.title)}`} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <EllipsisVertical />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-52 text-xs"><DropdownMenuGroup><DropdownMenuItem onSelect={() => void run("timestamp")}><Play />Open at {formatTimestamp(hit.startMs)}</DropdownMenuItem><DropdownMenuItem onSelect={() => void run("player")}><ExternalLink />Open full video</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem onSelect={() => void run("explorer")}><FolderOpen />Show in Explorer</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function searchScoreTitle(hit: SearchHit): string {
  const parts = Object.entries(hit.scoreBreakdown).filter(([, score]) => score > 0).map(([name, score]) => `${name} ${score.toFixed(1)}`)
  return `${hit.score.toFixed(1)} / 100${parts.length ? ` · ${parts.join(" + ")}` : ""}`
}
