import { type FormEvent, type SetStateAction, useMemo, useRef, useState } from "react"
import type { CodexStatus, LibraryStats, MediaAsset, ModelInstallation, ProcessingSchedule, SearchMode, SourceFolder } from "@vod-search/contracts"
import { ChevronRight, LoaderCircle, Plus, Search, SlidersHorizontal, X } from "lucide-react"
import { initialLibrarySearchState, type LibrarySearchState } from "@/app-types"
import { PageHeader } from "@/components/app-shell"
import { getLibrarySearchSubmitAction } from "@/components/library-search"
import type { MediaWorkspaceSelection } from "@/components/media-workspace"
import { cleanMediaTitle } from "@/components/search-workflow"
import { VideoThumbnail } from "@/components/video-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatDate, formatDuration, formatTimestamp, joinDisplayPath, localDateStart, stageLabel } from "@/lib/format"
import { cn } from "@/lib/utils"
import { EmptyLibrary } from "./empty-library"
import { SearchResults } from "./search-results"

export interface LibraryWorkspaceProps {
  folders: SourceFolder[]
  media: MediaAsset[]
  stats: LibraryStats
  models: ModelInstallation[]
  codex: CodexStatus
  processingSchedule: ProcessingSchedule
  onAddFolder: (publishSharedMetadata?: boolean) => void
  onPrepareModels: () => void
  onOpenSettings: () => void
  onOpen: (selection: MediaWorkspaceSelection) => void
  onError: (error: unknown) => void
  searchState: LibrarySearchState
  setSearchState: (value: SetStateAction<LibrarySearchState>) => void
}

export function LibraryWorkspace({ folders, media, stats, models, codex, processingSchedule, onAddFolder, onPrepareModels, onOpenSettings, onOpen, onError, searchState, setSearchState }: LibraryWorkspaceProps): React.JSX.Element {
  const [searching, setSearching] = useState(false)
  const searchRequestIdRef = useRef(0)
  const { query, submittedQuery, mode, dateFrom, dateTo, hits, searched } = searchState
  const semanticReady = models.some((model) => model.modelId === "bge-small-en-v1.5" && model.status === "installed")
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.path])), [folders])

  function updateSearch(patch: Partial<LibrarySearchState>): void {
    setSearchState((current) => ({ ...current, ...patch }))
  }

  async function runSearch(): Promise<void> {
    const action = getLibrarySearchSubmitAction(query, searched)
    if (searching && action === "search") return
    if (action === "clear") { clearSearch(); return }
    if (action === "none") return
    const nextSubmittedQuery = query.trim()
    const requestId = ++searchRequestIdRef.current
    setSearching(true)
    updateSearch({ hits: [], searched: true, submittedQuery: nextSubmittedQuery })
    try {
      const response = await window.vodSearch.search.query({ query: nextSubmittedQuery, mode, ...(dateFrom ? { createdAfterMs: localDateStart(dateFrom) } : {}), ...(dateTo ? { createdBeforeMs: localDateStart(dateTo) + 86_400_000 } : {}), includeMissing: false, limit: 100 })
      if (requestId !== searchRequestIdRef.current) return
      updateSearch({ hits: response.hits, searched: true, submittedQuery: nextSubmittedQuery })
    } catch (reason) {
      if (requestId !== searchRequestIdRef.current) return
      updateSearch({ hits: [], searched: true, submittedQuery: nextSubmittedQuery })
      onError(reason)
    } finally {
      if (requestId === searchRequestIdRef.current) setSearching(false)
    }
  }

  function submitSearch(event: FormEvent): void { event.preventDefault(); void runSearch() }
  function clearSearch(): void { searchRequestIdRef.current += 1; setSearching(false); setSearchState({ ...initialLibrarySearchState, mode }) }
  function clearSearchInput(): void { if (searched || searching) clearSearch(); else updateSearch({ query: "" }) }
  const submitAction = getLibrarySearchSubmitAction(query, searched)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader title="Library" description={stats.totalMedia ? `${stats.totalMedia.toLocaleString()} videos · ${formatDuration(stats.totalDurationMs)} · ${stats.searchableChunks.toLocaleString()} searchable moments` : "Add a folder to begin indexing"} actions={<Button size="sm" onClick={() => onAddFolder(false)}><Plus />Add folder</Button>} />
      {media.length > 0 && <form onSubmit={submitSearch} className="command-bar border-b px-5 py-3"><div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-2"><div className="relative min-w-[18rem] flex-1"><Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => updateSearch({ query: event.target.value })} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); void runSearch(); return } if (event.key === "Escape" && (query || searched || searching)) { event.preventDefault(); clearSearchInput() } }} className="h-9 bg-background pl-8 pr-8 text-xs" placeholder="Search dialogue, people, places, or events" />{(query || searched || searching) && <button type="button" aria-label={searched || searching ? "Clear search and show all videos" : "Clear query"} onClick={clearSearchInput} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded text-muted-foreground outline-none hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring/30"><X className="size-3" /></button>}</div><SearchFilters mode={mode} dateFrom={dateFrom} dateTo={dateTo} onChange={updateSearch} /><Button type="submit" size="sm" className="h-9" disabled={searching || submitAction === "none"}>{searching ? <LoaderCircle className="animate-spin" /> : submitAction === "clear" ? <X /> : <Search />}{searching ? "Searching" : submitAction === "clear" ? "Show all" : "Search"}</Button><div className="ml-auto flex items-center gap-1.5 text-[9px] text-muted-foreground max-[1240px]:hidden"><span className={cn("size-1.5 rounded-full", semanticReady ? "status-dot bg-primary text-primary" : "bg-muted-foreground/45")} />{semanticReady ? "Semantic index ready" : "Keyword search available"}</div></div></form>}
      <div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1480px] px-5 py-4">{searched ? <SearchResults hits={hits} query={submittedQuery || query} searching={searching} onClear={clearSearch} onOpen={onOpen} onError={onError} /> : media.length === 0 ? <EmptyLibrary folders={folders} models={models} codex={codex} processingSchedule={processingSchedule} onAddFolder={onAddFolder} onPrepareModels={onPrepareModels} onOpenSettings={onOpenSettings} /> : <VideoList media={media} folderById={folderById} onOpen={onOpen} />}</div></div>
    </div>
  )
}

function SearchFilters({ mode, dateFrom, dateTo, onChange }: { mode: SearchMode; dateFrom: string; dateTo: string; onChange: (patch: Partial<LibrarySearchState>) => void }): React.JSX.Element {
  const activeCount = Number(mode !== "hybrid") + Number(Boolean(dateFrom)) + Number(Boolean(dateTo))
  return <Popover><PopoverTrigger asChild><Button type="button" variant="outline" size="sm" className="h-9 bg-background"><SlidersHorizontal />Filters{activeCount > 0 && <Badge variant="accent" className="ml-0.5">{activeCount}</Badge>}</Button></PopoverTrigger><PopoverContent align="end" className="w-80 p-3"><PopoverHeader><PopoverTitle className="text-xs">Search controls</PopoverTitle><PopoverDescription className="text-[10px]">Best match combines exact wording with meaning.</PopoverDescription></PopoverHeader><div className="mt-3 flex flex-col gap-3 border-y py-3"><label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">Search method<Select value={mode} onValueChange={(value) => onChange({ mode: value as SearchMode })}><SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="hybrid">Best match</SelectItem><SelectItem value="semantic">Meaning</SelectItem><SelectItem value="keyword">Exact words</SelectItem></SelectContent></Select></label><div className="grid grid-cols-2 gap-2"><label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">From<Input aria-label="Created after" type="date" value={dateFrom} onChange={(event) => onChange({ dateFrom: event.target.value })} className="h-8 text-[10px]" /></label><label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">To<Input aria-label="Created before" type="date" value={dateTo} onChange={(event) => onChange({ dateTo: event.target.value })} className="h-8 text-[10px]" /></label></div></div><div className="mt-2 flex items-center justify-between"><span className="text-[9px] text-muted-foreground">Filters apply on the next search.</span><Button type="button" variant="ghost" size="sm" className="h-7" disabled={activeCount === 0} onClick={() => onChange({ mode: "hybrid", dateFrom: "", dateTo: "" })}>Reset</Button></div></PopoverContent></Popover>
}

function VideoList({ media, folderById, onOpen }: { media: MediaAsset[]; folderById: Map<string, string>; onOpen: (selection: MediaWorkspaceSelection) => void }): React.JSX.Element {
  return (
    <section className="pb-5">
      <div className="flex h-10 items-center justify-between border-b text-xs">
        <h2 className="font-semibold">All videos</h2>
        <span className="font-mono text-[9px] text-muted-foreground">Newest first · {media.length.toLocaleString()} items</span>
      </div>
      <div className="grid h-8 grid-cols-[7.5rem_minmax(0,1fr)_6rem_6rem_6.5rem_1rem] items-center gap-3 border-b bg-surface/55 px-3 font-mono text-[8px] uppercase tracking-[0.14em] text-muted-foreground max-[1100px]:grid-cols-[7.5rem_minmax(0,1fr)_5.5rem_1rem]">
        <span>Preview</span><span>File</span><span className="max-[1100px]:hidden">Created</span><span>Duration</span><span className="max-[1100px]:hidden">Status</span><span />
      </div>
      {media.map((item) => {
        const folder = folderById.get(item.sourceFolderId)
        const location = folder ? joinDisplayPath(folder, item.relativePath) : item.relativePath
        const displayTitle = cleanMediaTitle(item.displayName)
        return (
          <button key={item.id} type="button" className="workspace-row group grid w-full cursor-pointer grid-cols-[7.5rem_minmax(0,1fr)_6rem_6rem_6.5rem_1rem] items-center gap-3 border-b px-3 py-2.5 text-left hover:bg-accent/35 focus-visible:bg-accent/35 focus-visible:outline-none max-[1100px]:grid-cols-[7.5rem_minmax(0,1fr)_5.5rem_1rem]" onClick={() => onOpen({ mediaId: item.id, title: displayTitle })}>
            <div className="relative aspect-video overflow-hidden rounded-md border bg-muted shadow-xs"><VideoThumbnail mediaId={item.id} className="size-full" showPlay={false} />{item.availability === "missing" && <span className="absolute inset-0 grid place-items-center bg-background/80 text-[10px] font-medium text-destructive">Missing</span>}</div>
            <div className="min-w-0"><div className="truncate text-xs font-semibold transition-colors group-hover:text-primary" title={item.displayName}>{displayTitle}</div><div className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={location}>{location}</div></div>
            <span className="text-[10px] text-muted-foreground max-[1100px]:hidden">{formatDate(item.createdAtMs)}</span>
            <span className="font-mono text-[10px] tabular-nums text-muted-foreground">{item.durationMs ? formatTimestamp(item.durationMs) : "—"}</span>
            <Badge variant={item.highestCompletedStage === "ready" ? "accent" : "secondary"} className="max-[1100px]:hidden">{stageLabel(item.highestCompletedStage)}</Badge>
            <ChevronRight className="size-3.5 text-muted-foreground transition-transform group-hover:translate-x-0.5 group-hover:text-foreground" />
          </button>
        )
      })}
    </section>
  )
}
