import { type FormEvent, type SetStateAction, useCallback, useEffect, useMemo, useState } from "react"
import {
  defaultProcessingSchedule,
  isJobStageAllowed,
  isProcessingWindowOpen,
  nextProcessingWindowStart,
  scheduleGroupForJobStage,
  type CodexStatus,
  type Job,
  type LibraryStats,
  type MediaAsset,
  type ModelInstallation,
  type ProcessingSchedule,
  type ProcessingScheduleGroup,
  type ProcessingWindow,
  type SearchHit,
  type SearchMode,
  type SourceFolder
} from "@vod-search/contracts"
import {
  Activity,
  CalendarClock,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  ChevronUp,
  CircleAlert,
  Clock3,
  Database,
  Download,
  EllipsisVertical,
  ExternalLink,
  FolderOpen,
  HardDrive,
  History,
  Library,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  Plus,
  Search,
  Share2,
  SlidersHorizontal,
  Settings,
  Sparkles,
  Sun,
  Trash2,
  Video,
  X
} from "lucide-react"
import { MediaWorkspace, type MediaWorkspaceSelection } from "@/components/media-workspace"
import { getSearchResultCopy } from "@/components/search-presentation"
import { cleanMediaTitle, organizeSearchHits, splitQueryMatches, type SearchResultCluster } from "@/components/search-workflow"
import { VideoThumbnail } from "@/components/video-thumbnail"
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle
} from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger
} from "@/components/ui/dropdown-menu"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cn } from "@/lib/utils"

type View = "library" | "activity" | "settings"
type Theme = "light" | "dark"

interface LibrarySearchState {
  query: string
  submittedQuery: string
  mode: SearchMode
  dateFrom: string
  dateTo: string
  hits: SearchHit[]
  searched: boolean
}

const initialLibrarySearchState: LibrarySearchState = {
  query: "",
  submittedQuery: "",
  mode: "hybrid",
  dateFrom: "",
  dateTo: "",
  hits: [],
  searched: false
}

const emptyStats: LibraryStats = {
  sourceFolders: 0,
  totalMedia: 0,
  availableMedia: 0,
  missingMedia: 0,
  totalDurationMs: 0,
  searchableChunks: 0,
  queuedJobs: 0,
  runningJobs: 0,
  failedJobs: 0
}

const checkingCodex: CodexStatus = {
  state: "checking",
  installed: false,
  authenticated: false,
  version: null,
  managed: false,
  error: null
}

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("library")
  const [folders, setFolders] = useState<SourceFolder[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [models, setModels] = useState<ModelInstallation[]>([])
  const [codex, setCodex] = useState<CodexStatus>(checkingCodex)
  const [stats, setStats] = useState<LibraryStats>(emptyStats)
  const [processingSchedule, setProcessingSchedule] = useState<ProcessingSchedule>(defaultProcessingSchedule)
  const [selection, setSelection] = useState<MediaWorkspaceSelection | null>(null)
  const [librarySearch, setLibrarySearch] = useState<LibrarySearchState>(initialLibrarySearchState)
  const [error, setError] = useState<string | null>(null)
  const [theme, setTheme] = useState<Theme>(() => {
    const saved = localStorage.getItem("vod-search-theme")
    if (saved === "light" || saved === "dark") return saved
    return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"
  })

  const refreshLibrary = useCallback(async () => {
    const [nextFolders, nextMedia, nextStats] = await Promise.all([
      window.vodSearch.library.listFolders(),
      listAllMedia(),
      window.vodSearch.library.stats()
    ])
    setFolders(nextFolders)
    setMedia(nextMedia)
    setStats(nextStats)
  }, [])

  const refreshJobs = useCallback(async () => setJobs(await window.vodSearch.jobs.list()), [])
  const refreshModels = useCallback(async () => setModels(await window.vodSearch.models.list()), [])
  const refreshCodex = useCallback(async () => setCodex(await window.vodSearch.codex.status()), [])
  const refreshProcessingSchedule = useCallback(async () => setProcessingSchedule(await window.vodSearch.jobs.getProcessingSchedule()), [])

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("vod-search-theme", theme)
  }, [theme])

  useEffect(() => {
    void refreshLibrary().catch(showError)
    void refreshJobs().catch(showError)
    void refreshModels().catch(showError)
    void refreshCodex().catch(showError)
    void refreshProcessingSchedule().catch(showError)
    const removeLibraryListener = window.vodSearch.events.onLibraryChanged(() => void refreshLibrary().catch(showError))
    const removeJobsListener = window.vodSearch.events.onJobsChanged(() => {
      void refreshJobs().catch(showError)
      void refreshLibrary().catch(showError)
    })
    const removeModelsListener = window.vodSearch.events.onModelsChanged(() => void refreshModels().catch(showError))
    const removeCodexListener = window.vodSearch.events.onCodexChanged(() => void refreshCodex().catch(showError))
    return () => { removeLibraryListener(); removeJobsListener(); removeModelsListener(); removeCodexListener() }
  }, [refreshCodex, refreshJobs, refreshLibrary, refreshModels, refreshProcessingSchedule])

  function showError(reason: unknown): void {
    setError(reason instanceof Error ? reason.message : String(reason))
  }

  async function addFolder(publishSharedMetadata = false): Promise<void> {
    setError(null)
    try {
      const path = await window.vodSearch.library.selectFolder()
      if (!path) return
      await window.vodSearch.library.addFolder(path, publishSharedMetadata)
      await refreshLibrary()
      setView("library")
    } catch (reason) {
      showError(reason)
    }
  }

  async function prepareLocalModels(): Promise<void> {
    setError(null)
    try {
      for (const model of models) {
        if (model.status === "missing" || model.status === "invalid") {
          await window.vodSearch.models.download(model.modelId)
        }
      }
      await refreshModels()
    } catch (reason) {
      showError(reason)
    }
  }

  if (selection) {
    return (
      <div className="h-screen min-h-0 overflow-hidden bg-background font-sans text-foreground antialiased">
        <ErrorNotice error={error} onClose={() => setError(null)} />
        <MediaWorkspace selection={selection} onClose={() => setSelection(null)} />
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background font-sans text-foreground antialiased">
      <Sidebar view={view} setView={setView} stats={stats} theme={theme} setTheme={setTheme} />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <ErrorNotice error={error} onClose={() => setError(null)} />
        {view === "library" && (
          <LibraryWorkspace
            folders={folders}
            media={media}
            stats={stats}
            models={models}
            codex={codex}
            processingSchedule={processingSchedule}
            onAddFolder={(publishSharedMetadata) => void addFolder(publishSharedMetadata)}
            onPrepareModels={() => void prepareLocalModels()}
            onOpenSettings={() => setView("settings")}
            onOpen={setSelection}
            onError={showError}
            searchState={librarySearch}
            setSearchState={setLibrarySearch}
          />
        )}
        {view === "activity" && <ActivityWorkspace jobs={jobs} media={media} stats={stats} processingSchedule={processingSchedule} onError={showError} />}
        {view === "settings" && (
          <SettingsWorkspace
            folders={folders}
            models={models}
            codex={codex}
            theme={theme}
            setTheme={setTheme}
            processingSchedule={processingSchedule}
            onProcessingScheduleChange={setProcessingSchedule}
            onAddFolder={() => void addFolder()}
            onRefreshLibrary={refreshLibrary}
            onRefreshModels={refreshModels}
            onRefreshCodex={refreshCodex}
            onError={showError}
          />
        )}
      </main>
    </div>
  )
}

function ErrorNotice({ error, onClose }: { error: string | null; onClose: () => void }): React.JSX.Element | null {
  if (!error) return null
  return (
    <div className="absolute left-1/2 top-3 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 border border-destructive/35 bg-background px-3 py-2 text-xs shadow-md">
      <CircleAlert className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 truncate">{error}</span>
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Dismiss error" onClick={onClose}><X /></Button>
    </div>
  )
}

function Sidebar({
  view,
  setView,
  stats,
  theme,
  setTheme
}: {
  view: View
  setView: (view: View) => void
  stats: LibraryStats
  theme: Theme
  setTheme: (theme: Theme) => void
}): React.JSX.Element {
  return (
    <aside className="flex w-[13rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3 py-3 text-sidebar-foreground max-[1050px]:w-[3.75rem] max-[1050px]:px-2">
      <div className="flex h-10 items-center gap-2.5 px-2">
        <div className="grid size-7 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground"><Video className="size-3.5" /></div>
        <div className="min-w-0 max-[1050px]:hidden">
          <div className="truncate text-[13px] font-semibold tracking-tight">VOD Search</div>
          <div className="truncate text-[10px] text-muted-foreground">Local video workspace</div>
        </div>
      </div>
      <nav className="mt-5 space-y-0.5">
        <SidebarButton active={view === "library"} icon={Library} label="Library" onClick={() => setView("library")} />
        <SidebarButton active={view === "activity"} icon={Activity} label="Activity" badge={stats.runningJobs + stats.queuedJobs || undefined} onClick={() => setView("activity")} />
        <SidebarButton active={view === "settings"} icon={Settings} label="Settings" badge={stats.failedJobs || undefined} onClick={() => setView("settings")} />
      </nav>
      <div className="mt-auto border-t border-sidebar-border pt-3">
        <div className="px-2 max-[1050px]:hidden">
          <div className="flex items-center gap-2 text-[11px] font-medium"><span className="size-1.5 rounded-full bg-primary" />Local index ready</div>
          <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{stats.searchableChunks.toLocaleString()} moments in {stats.totalMedia.toLocaleString()} videos</div>
        </div>
        <Button variant="ghost" size="sm" className="mt-2 w-full justify-start gap-2 px-2 font-normal max-[1050px]:justify-center" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />}<span className="max-[1050px]:hidden">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
        </Button>
      </div>
    </aside>
  )
}

function SidebarButton({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof Library; label: string; badge?: number | undefined; onClick: () => void }): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      className={cn("relative h-8 w-full justify-start gap-2 px-2 font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-[1050px]:justify-center", active && "bg-sidebar-accent text-sidebar-accent-foreground")}
      onClick={onClick}
    >
      <Icon className="size-3.5" />
      <span className="max-[1050px]:hidden">{label}</span>
      {badge ? <Badge variant={label === "Settings" ? "destructive" : "secondary"} className="ml-auto h-4 min-w-4 px-1 text-[9px] max-[1050px]:absolute max-[1050px]:-right-0.5 max-[1050px]:-top-0.5">{badge}</Badge> : null}
    </Button>
  )
}

function LibraryWorkspace({
  folders,
  media,
  stats,
  models,
  codex,
  processingSchedule,
  onAddFolder,
  onPrepareModels,
  onOpenSettings,
  onOpen,
  onError,
  searchState,
  setSearchState
}: {
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
}): React.JSX.Element {
  const [searching, setSearching] = useState(false)
  const { query, submittedQuery, mode, dateFrom, dateTo, hits, searched } = searchState
  const semanticReady = models.some((model) => model.modelId === "bge-small-en-v1.5" && model.status === "installed")
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.path])), [folders])

  function updateSearch(patch: Partial<LibrarySearchState>): void {
    setSearchState((current) => ({ ...current, ...patch }))
  }

  async function submitSearch(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!query.trim()) return
    const nextSubmittedQuery = query.trim()
    setSearching(true)
    try {
      const response = await window.vodSearch.search.query({
        query: nextSubmittedQuery,
        mode,
        ...(dateFrom ? { createdAfterMs: localDateStart(dateFrom) } : {}),
        ...(dateTo ? { createdBeforeMs: localDateStart(dateTo) + 86_400_000 } : {}),
        includeMissing: false,
        limit: 100
      })
      updateSearch({ hits: response.hits, searched: true, submittedQuery: nextSubmittedQuery })
    } catch (reason) {
      updateSearch({ hits: [], searched: true, submittedQuery: nextSubmittedQuery })
      onError(reason)
    } finally {
      setSearching(false)
    }
  }

  function clearSearch(): void {
    setSearchState({ ...initialLibrarySearchState, mode })
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <PageHeader
        title="Library"
        description={stats.totalMedia ? `${stats.totalMedia.toLocaleString()} videos · ${formatDuration(stats.totalDurationMs)} · ${stats.searchableChunks.toLocaleString()} searchable moments` : "Add a folder to begin indexing"}
        actions={<Button size="sm" onClick={() => onAddFolder(false)}><Plus />Add folder</Button>}
      />
      {media.length > 0 && <form onSubmit={(event) => void submitSearch(event)} className="border-b bg-muted/20 px-5 py-3">
        <div className="mx-auto flex max-w-[1480px] flex-wrap items-center gap-2">
          <div className="relative min-w-[18rem] flex-1">
            <Search className="absolute left-3 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input value={query} onChange={(event) => updateSearch({ query: event.target.value })} className="h-8 bg-background pl-8 pr-8 text-xs shadow-none" placeholder="Search dialogue, people, places, or events" />
            {query && <button type="button" aria-label="Clear query" onClick={() => updateSearch({ query: "" })} className="absolute right-2 top-1/2 grid size-5 -translate-y-1/2 cursor-pointer place-items-center rounded text-muted-foreground hover:bg-muted hover:text-foreground"><X className="size-3" /></button>}
          </div>
          <SearchFilters mode={mode} dateFrom={dateFrom} dateTo={dateTo} onChange={updateSearch} />
          <Button type="submit" size="sm" disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="animate-spin" /> : <Search />}Search</Button>
          <div className="ml-auto flex items-center gap-1.5 text-[10px] text-muted-foreground max-[1240px]:hidden">
            <span className={cn("size-1.5 rounded-full", semanticReady ? "bg-primary" : "bg-muted-foreground/45")} />
            {semanticReady ? "Semantic index ready" : "Keyword search available"}
          </div>
        </div>
      </form>}
      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto max-w-[1480px] px-5 py-4">
          {searched ? (
            <SearchResults hits={hits} query={submittedQuery || query} searching={searching} onClear={clearSearch} onOpen={onOpen} onError={onError} />
          ) : media.length === 0 ? (
            <EmptyLibrary
              folders={folders}
              models={models}
              codex={codex}
              processingSchedule={processingSchedule}
              onAddFolder={onAddFolder}
              onPrepareModels={onPrepareModels}
              onOpenSettings={onOpenSettings}
            />
          ) : (
            <VideoList media={media} folderById={folderById} onOpen={onOpen} />
          )}
        </div>
      </div>
    </div>
  )
}

function SearchFilters({
  mode,
  dateFrom,
  dateTo,
  onChange
}: {
  mode: SearchMode
  dateFrom: string
  dateTo: string
  onChange: (patch: Partial<LibrarySearchState>) => void
}): React.JSX.Element {
  const activeCount = Number(mode !== "hybrid") + Number(Boolean(dateFrom)) + Number(Boolean(dateTo))
  return (
    <Popover>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" className="bg-background">
          <SlidersHorizontal />Filters
          {activeCount > 0 && <Badge variant="accent" className="ml-0.5">{activeCount}</Badge>}
        </Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-80 p-3">
        <PopoverHeader>
          <PopoverTitle className="text-xs">Search controls</PopoverTitle>
          <PopoverDescription className="text-[10px]">Best match combines exact wording with meaning.</PopoverDescription>
        </PopoverHeader>
        <div className="mt-3 flex flex-col gap-3 border-y py-3">
          <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">
            Search method
            <Select value={mode} onValueChange={(value) => onChange({ mode: value as SearchMode })}>
              <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">Best match</SelectItem>
                <SelectItem value="semantic">Meaning</SelectItem>
                <SelectItem value="keyword">Exact words</SelectItem>
              </SelectContent>
            </Select>
          </label>
          <div className="grid grid-cols-2 gap-2">
            <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">From<Input aria-label="Created after" type="date" value={dateFrom} onChange={(event) => onChange({ dateFrom: event.target.value })} className="h-8 text-[10px]" /></label>
            <label className="flex flex-col gap-1 text-[10px] font-medium text-muted-foreground">To<Input aria-label="Created before" type="date" value={dateTo} onChange={(event) => onChange({ dateTo: event.target.value })} className="h-8 text-[10px]" /></label>
          </div>
        </div>
        <div className="mt-2 flex items-center justify-between">
          <span className="text-[9px] text-muted-foreground">Filters apply on the next search.</span>
          <Button type="button" variant="ghost" size="sm" className="h-7" disabled={activeCount === 0} onClick={() => onChange({ mode: "hybrid", dateFrom: "", dateTo: "" })}>Reset</Button>
        </div>
      </PopoverContent>
    </Popover>
  )
}

function VideoList({ media, folderById, onOpen }: { media: MediaAsset[]; folderById: Map<string, string>; onOpen: (selection: MediaWorkspaceSelection) => void }): React.JSX.Element {
  return (
    <section>
      <div className="flex h-8 items-center justify-between border-b text-xs">
        <h2 className="font-semibold">All videos</h2>
        <span className="text-[10px] text-muted-foreground">Newest first · {media.length.toLocaleString()} items</span>
      </div>
      <div className="grid h-7 grid-cols-[7rem_minmax(0,1fr)_6rem_6rem_6.5rem_1rem] items-center gap-3 border-b px-2 font-mono text-[9px] uppercase tracking-wider text-muted-foreground max-[1100px]:grid-cols-[7rem_minmax(0,1fr)_5.5rem_1rem]">
        <span>Preview</span><span>File</span><span className="max-[1100px]:hidden">Created</span><span>Duration</span><span className="max-[1100px]:hidden">Status</span><span />
      </div>
      {media.map((item) => {
        const folder = folderById.get(item.sourceFolderId)
        const location = folder ? joinDisplayPath(folder, item.relativePath) : item.relativePath
        const displayTitle = cleanMediaTitle(item.displayName)
        return (
          <button
            key={item.id}
            type="button"
            className="group grid w-full cursor-pointer grid-cols-[7rem_minmax(0,1fr)_6rem_6rem_6.5rem_1rem] items-center gap-3 border-b px-2 py-2 text-left transition-colors hover:bg-accent/45 focus-visible:bg-accent/45 focus-visible:outline-none max-[1100px]:grid-cols-[7rem_minmax(0,1fr)_5.5rem_1rem]"
            onClick={() => onOpen({ mediaId: item.id, title: displayTitle })}
          >
            <div className="relative aspect-video overflow-hidden rounded-md border bg-muted"><VideoThumbnail mediaId={item.id} className="size-full" showPlay={false} />{item.availability === "missing" && <span className="absolute inset-0 grid place-items-center bg-background/80 text-[10px] font-medium text-destructive">Missing</span>}</div>
            <div className="min-w-0"><div className="truncate text-xs font-semibold group-hover:text-primary" title={item.displayName}>{displayTitle}</div><div className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={location}>{location}</div></div>
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

function SearchResults({ hits, query, searching, onClear, onOpen, onError }: { hits: SearchHit[]; query: string; searching: boolean; onClear: () => void; onOpen: (selection: MediaWorkspaceSelection) => void; onError: (error: unknown) => void }): React.JSX.Element {
  const [showLowerConfidence, setShowLowerConfidence] = useState(false)
  const [expandedClusters, setExpandedClusters] = useState<Set<string>>(() => new Set())
  const organized = useMemo(() => organizeSearchHits(hits, showLowerConfidence), [hits, showLowerConfidence])
  const markersByMedia = useMemo(() => {
    const grouped = new Map<string, SearchHit[]>()
    for (const hit of organized.strongHits) grouped.set(hit.mediaId, [...(grouped.get(hit.mediaId) ?? []), hit])
    return grouped
  }, [organized.strongHits])

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
        <Button variant="ghost" size="sm" className="h-7" onClick={onClear}><X />Clear</Button>
      </div>
      {!searching && hits.length === 0 ? (
        <div className="grid min-h-64 place-items-center border-b text-center"><div><Search className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-sm font-semibold">No matching moments</p><p className="mt-1 text-xs text-muted-foreground">Try a broader phrase, exact-words mode, or another date range.</p></div></div>
      ) : organized.groups.map((group) => (
        <section key={group.mediaId} aria-label={`Matches in ${group.title}`} className="border-b">
          <div className="flex h-9 items-center gap-2 bg-muted/25 px-2">
            <Video className="size-3.5 text-muted-foreground" />
            <h2 className="min-w-0 flex-1 truncate text-[11px] font-semibold" title={group.relativePath}>{group.title}</h2>
            <span className="text-[9px] text-muted-foreground">{formatDate(group.createdAtMs)}</span>
            <Badge variant="secondary">{group.clusters.length} {group.clusters.length === 1 ? "moment" : "moments"}</Badge>
          </div>
          {group.clusters.map((cluster) => <SearchClusterRow key={cluster.id} cluster={cluster} query={query} expanded={expandedClusters.has(cluster.id)} onToggle={() => toggleCluster(cluster.id)} onOpen={openHit} onError={onError} />)}
        </section>
      ))}
      {!searching && organized.lowerConfidenceCount > 0 && (
        <div className="flex items-center justify-center border-b py-3">
          <Button variant="ghost" size="sm" onClick={() => setShowLowerConfidence((current) => !current)}>{showLowerConfidence ? <ChevronUp /> : <ChevronDown />}{showLowerConfidence ? "Show strong matches only" : `Show ${organized.lowerConfidenceCount} lower-confidence matches`}</Button>
        </div>
      )}
    </section>
  )
}

function SearchClusterRow({ cluster, query, expanded, onToggle, onOpen, onError }: { cluster: SearchResultCluster; query: string; expanded: boolean; onToggle: () => void; onOpen: (hit: SearchHit) => void; onError: (error: unknown) => void }): React.JSX.Element {
  const hit = cluster.primary
  const copy = getSearchResultCopy(hit.transcriptExcerpt, hit.summary)
  return (
    <div>
      <div className="group relative grid w-full grid-cols-[8rem_4.5rem_minmax(0,1fr)_7rem_4.25rem] items-center gap-3 px-2 py-2 text-left transition-colors hover:bg-accent/45 max-[1100px]:grid-cols-[7rem_4rem_minmax(0,1fr)_4.25rem]">
        <button type="button" aria-label={`Open ${cleanMediaTitle(hit.title)} at ${formatTimestamp(hit.startMs)}`} className="absolute inset-0 z-0 cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/40" onClick={() => onOpen(hit)} />
        <div className="pointer-events-none relative z-10 aspect-video overflow-hidden rounded-md border bg-muted"><VideoThumbnail mediaId={hit.mediaId} seekMs={hit.startMs} className="size-full" showPlay={false} /></div>
        <span className="pointer-events-none relative z-10 font-mono text-[11px] font-medium tabular-nums text-primary">{formatTimestamp(hit.startMs)}</span>
        <div className="pointer-events-none relative z-10 min-w-0">
          <p className="line-clamp-2 text-[11px] leading-4 text-foreground/90"><HighlightedQueryText text={copy.transcript} query={query} /></p>
          {copy.summary && <p className="mt-0.5 line-clamp-1 text-[10px] leading-4 text-muted-foreground"><span className="mr-1 font-semibold text-foreground/75">Synopsis</span><HighlightedQueryText text={copy.summary} query={query} /></p>}
        </div>
        <div className="pointer-events-none relative z-10 flex flex-col items-end gap-1 max-[1100px]:hidden" title={searchScoreTitle(hit)}>
          <span className="font-mono text-[9px] tabular-nums text-muted-foreground"><span className="font-semibold text-foreground">{Math.round(hit.score)}</span> score</span>
          <div className="flex gap-1">{hit.matchReasons.slice(0, 2).map((reason) => <Badge key={reason} variant="secondary">{reason}</Badge>)}</div>
        </div>
        <div className="relative z-20 flex items-center justify-end gap-0.5">
          {cluster.nearby.length > 0 && <Button type="button" variant="ghost" size="icon-sm" className="size-7" aria-label={`${expanded ? "Hide" : "Show"} ${cluster.nearby.length} nearby matches`} onClick={onToggle}>{expanded ? <ChevronUp /> : <ChevronDown />}</Button>}
          <SearchResultActions hit={hit} onError={onError} />
        </div>
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

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild><Button type="button" variant="ghost" size="icon-sm" className="size-7 text-muted-foreground" aria-label={`File actions for ${cleanMediaTitle(hit.title)}`} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <EllipsisVertical />}</Button></DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-52 text-xs">
        <DropdownMenuGroup>
          <DropdownMenuItem onSelect={() => void run("timestamp")}><Play />Open at {formatTimestamp(hit.startMs)}</DropdownMenuItem>
          <DropdownMenuItem onSelect={() => void run("player")}><ExternalLink />Open full video</DropdownMenuItem>
        </DropdownMenuGroup>
        <DropdownMenuSeparator />
        <DropdownMenuGroup><DropdownMenuItem onSelect={() => void run("explorer")}><FolderOpen />Show in Explorer</DropdownMenuItem></DropdownMenuGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function EmptyLibrary({
  folders,
  models,
  codex,
  processingSchedule,
  onAddFolder,
  onPrepareModels,
  onOpenSettings
}: {
  folders: SourceFolder[]
  models: ModelInstallation[]
  codex: CodexStatus
  processingSchedule: ProcessingSchedule
  onAddFolder: (publishSharedMetadata: boolean) => void
  onPrepareModels: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [publishSharedMetadata, setPublishSharedMetadata] = useState(false)
  const localModelsReady = models.length > 0 && models.every((model) => model.status === "installed")
  const modelsDownloading = models.some((model) => model.status === "downloading")
  const sourceConnected = folders.length > 0
  const sourceScanning = sourceConnected && folders.some((folder) => folder.lastScanAtMs === null)
  const ingestionOpen = isProcessingWindowOpen(processingSchedule.ingestion)
  const sourceWaitingForSchedule = sourceScanning && !ingestionOpen
  const nextIngestion = nextProcessingWindowStart(processingSchedule.ingestion)
  return (
    <div className="mx-auto max-w-[980px] pt-10">
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)] border-y max-[980px]:grid-cols-1">
        <section className="border-r px-8 py-9 max-[980px]:border-b max-[980px]:border-r-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">{sourceConnected ? "Preparing library" : "First run"}</div>
          <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight">{sourceConnected ? "Your first source is connected. We’re making it searchable." : "Connect the folder where your videos already live."}</h2>
          <p className="mt-3 max-w-xl text-xs leading-5 text-muted-foreground">{sourceConnected ? "Shared transcripts are imported first. Videos without reusable data then move through transcription, topic analysis, and semantic indexing." : "VOD Search scans in place, reuses subtitles and shared metadata first, then queues only the work that is still missing."}</p>
          {!sourceConnected && <div className="mt-7 flex items-start gap-3 border-y py-4">
            <Share2 className="mt-0.5 size-4 shrink-0 text-primary" />
            <div className="min-w-0 flex-1">
              <label htmlFor="publish-shared-metadata" className="text-xs font-semibold">Contribute results to this folder</label>
              <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Write portable transcripts and topic summaries under <span className="font-mono">.vod-search</span> so other users of the same folder can skip transcription and Codex summarization.</p>
            </div>
            <Switch id="publish-shared-metadata" checked={publishSharedMetadata} onCheckedChange={setPublishSharedMetadata} />
          </div>}
          {sourceConnected ? <div className="mt-7 border-y"><ReadinessRow label="Folder connected" description={folders[0]!.path} ready /><ReadinessRow label="Shared data" description={sourceWaitingForSchedule ? `Waiting for ingestion window${nextIngestion ? ` · ${formatNextScheduleStart(nextIngestion)}` : ""}` : "Importing compatible transcripts and summaries first"} ready={!sourceScanning} busy={sourceScanning && ingestionOpen} /><ReadinessRow label="Remaining processing" description="Only missing transcription, topics, and embeddings will be queued" ready={false} busy={sourceScanning && ingestionOpen} /></div> : null}
          <Button className="mt-6" size="sm" variant={sourceConnected ? "outline" : "default"} onClick={() => onAddFolder(publishSharedMetadata)}><FolderOpen />{sourceConnected ? "Add another folder" : "Choose video folder"}</Button>
        </section>
        <aside className="px-6 py-7">
          <h3 className="text-xs font-semibold">This PC</h3>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Processing can start while setup finishes.</p>
          <div className="mt-5 divide-y border-y">
            <ReadinessRow label="Video folder" description={sourceWaitingForSchedule ? "Connected · ingestion scheduled" : sourceConnected ? `${folders.length} connected` : "Not connected"} ready={sourceConnected} busy={sourceScanning && ingestionOpen} />
            <ReadinessRow label="Local models" description={localModelsReady ? "Whisper and semantic search ready" : modelsDownloading ? "Downloading components" : "Setup required"} ready={localModelsReady} busy={modelsDownloading} />
            <ReadinessRow label="Codex summaries" description={codex.state === "ready" ? "Signed in and ready" : codexStatusLabel(codex)} ready={codex.state === "ready"} busy={["checking", "installing", "updating", "signing-in"].includes(codex.state)} />
          </div>
          {!localModelsReady && <Button variant="outline" size="sm" className="mt-4 w-full justify-start" disabled={modelsDownloading} onClick={onPrepareModels}>{modelsDownloading ? <LoaderCircle className="animate-spin" /> : <Download />}Prepare local models</Button>}
          {codex.state !== "ready" && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={onOpenSettings}><Settings />Review Codex setup</Button>}
        </aside>
      </div>
      <div className="flex items-center gap-2 px-2 py-3 text-[10px] text-muted-foreground"><Database className="size-3.5 text-primary" />Compatible shared bundles are always loaded automatically. Publishing remains opt-in per folder.</div>
    </div>
  )
}

function ReadinessRow({ label, description, ready, busy = false }: { label: string; description: string; ready: boolean; busy?: boolean }): React.JSX.Element {
  return <div className="flex items-center gap-3 py-3"><span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", ready && "border-primary/35 bg-primary/10 text-primary")}>{busy ? <LoaderCircle className="size-3 animate-spin" /> : ready ? <CheckCircle2 className="size-3" /> : <span className="size-1.5 rounded-full bg-muted-foreground/45" />}</span><div className="min-w-0"><div className="text-[11px] font-medium">{label}</div><div className="mt-0.5 truncate text-[9px] text-muted-foreground">{description}</div></div></div>
}

function ActivityWorkspace({ jobs, media, stats, processingSchedule, onError }: { jobs: Job[]; media: MediaAsset[]; stats: LibraryStats; processingSchedule: ProcessingSchedule; onError: (error: unknown) => void }): React.JSX.Element {
  const names = useMemo(() => new Map(media.map((item) => [item.id, item.displayName])), [media])
  const active = jobs.filter((job) => ["queued", "running", "paused", "failed"].includes(job.status))
  const history = jobs.filter((job) => ["succeeded", "cancelled"].includes(job.status))
  const [filter, setFilter] = useState<"active" | "history" | "all">("active")
  const visibleJobs = filter === "active" ? active : filter === "history" ? history : jobs
  const hasRunning = jobs.some((job) => job.status === "running")
  const canResume = !hasRunning && jobs.some((job) => job.status === "paused")
  async function run(action: () => Promise<void>): Promise<void> { try { await action() } catch (error) { onError(error) } }
  return (
    <WorkspacePage
      title="Activity"
      description="Processing state, recent history, and actionable failures"
      actions={hasRunning ? <Button variant="outline" size="sm" onClick={() => void run(() => window.vodSearch.jobs.pauseAll())}><Pause />Pause all</Button> : canResume ? <Button size="sm" onClick={() => void run(() => window.vodSearch.jobs.resumeAll())}><Play />Resume</Button> : undefined}
    >
      <div className="grid grid-cols-3 border-b">
        <InlineMetric label="Running" value={stats.runningJobs} tone="healthy" />
        <InlineMetric label="Queued" value={stats.queuedJobs} />
        <InlineMetric label="Needs attention" value={stats.failedJobs} tone={stats.failedJobs > 0 ? "danger" : "default"} />
      </div>
      <div className="flex h-12 items-center justify-between border-b">
        <div><h2 className="text-xs font-semibold">Processing activity</h2><p className="mt-0.5 text-[10px] text-muted-foreground">Every stage explains whether it is running, waiting, complete, or blocked.</p></div>
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(value) => { if (value) setFilter(value as typeof filter) }}>
          <ToggleGroupItem value="active">Active <span className="font-mono text-[9px]">{active.length}</span></ToggleGroupItem>
          <ToggleGroupItem value="history">History <span className="font-mono text-[9px]">{history.length}</span></ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {visibleJobs.length === 0 ? <div className="flex min-h-48 flex-col items-center justify-center gap-2 border-b text-xs text-muted-foreground"><History className="size-4" /><span>{filter === "active" ? "No active processing. The library is caught up." : "No processing history yet."}</span>{filter === "active" && history.length > 0 && <Button variant="ghost" size="sm" onClick={() => setFilter("history")}>View recent history</Button>}</div> : visibleJobs.map((job) => {
        const scheduleHeld = job.status === "queued" && !isJobStageAllowed(processingSchedule, job.stage)
        return <div key={job.id} className="grid grid-cols-[minmax(0,1fr)_8rem_8rem_auto] items-center gap-4 border-b py-3 max-[1100px]:grid-cols-[minmax(0,1fr)_7rem_auto]">
          <div className="flex min-w-0 items-start gap-2.5"><span className={cn("mt-1 size-1.5 shrink-0 rounded-full", job.status === "running" || job.status === "succeeded" ? "bg-primary" : job.status === "failed" ? "bg-destructive" : "bg-muted-foreground/45")} /><div className="min-w-0"><div className="truncate text-xs font-semibold" title={names.get(job.mediaId ?? "")}>{cleanMediaTitle(names.get(job.mediaId ?? "") ?? "Library task")}</div><div className="mt-1 text-[10px] text-muted-foreground">{jobStatusDescription(job, processingSchedule)}</div>{job.error && <div className="mt-1 truncate text-[10px] text-destructive" title={job.error}>{summarizeJobError(job.error)}</div>}</div></div>
          <div className="max-[1100px]:hidden"><div className="font-mono text-[9px] text-muted-foreground">{humanize(job.stage)}</div>{["running", "queued", "paused"].includes(job.status) ? <Progress className="mt-1.5 h-1" value={job.progress * 100} /> : <div className="mt-1 text-[9px] text-muted-foreground">{job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</div>}</div>
          <div className="max-[1100px]:hidden"><div className="font-mono text-[9px] text-muted-foreground">{formatJobTiming(job)}</div>{job.status === "running" && job.progress > 0.02 && <div className="mt-1 text-[9px] text-muted-foreground">{estimateJobRemaining(job)} remaining</div>}</div>
          <div className="flex items-center justify-self-end gap-1.5"><Badge variant={job.status === "failed" ? "destructive" : ["running", "succeeded"].includes(job.status) ? "accent" : "secondary"}>{scheduleHeld ? "scheduled" : job.status}</Badge>{job.status === "failed" && <Button variant="ghost" size="sm" className="h-7" onClick={() => void run(() => window.vodSearch.jobs.retry(job.id))}>Retry</Button>}</div>
        </div>
      })}
    </WorkspacePage>
  )
}

function InlineMetric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "healthy" | "danger" }): React.JSX.Element {
  return <div className="border-r px-4 py-3 last:border-r-0"><div className="text-[10px] text-muted-foreground">{label}</div><div className={cn("mt-0.5 font-mono text-lg font-semibold tabular-nums", tone === "healthy" && "text-primary", tone === "danger" && "text-destructive")}>{value.toLocaleString()}</div></div>
}

function SettingsWorkspace({ folders, models, codex, theme, setTheme, processingSchedule, onProcessingScheduleChange, onAddFolder, onRefreshLibrary, onRefreshModels, onRefreshCodex, onError }: { folders: SourceFolder[]; models: ModelInstallation[]; codex: CodexStatus; theme: Theme; setTheme: (theme: Theme) => void; processingSchedule: ProcessingSchedule; onProcessingScheduleChange: (schedule: ProcessingSchedule) => void; onAddFolder: () => void; onRefreshLibrary: () => Promise<void>; onRefreshModels: () => Promise<void>; onRefreshCodex: () => Promise<void>; onError: (error: unknown) => void }): React.JSX.Element {
  const [folderToRemove, setFolderToRemove] = useState<SourceFolder | null>(null)
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null)
  const [savingSchedule, setSavingSchedule] = useState<ProcessingScheduleGroup | null>(null)
  async function download(modelId: string): Promise<void> { try { await window.vodSearch.models.download(modelId) } catch (error) { onError(error) } finally { await onRefreshModels() } }
  async function runCodex(action: () => Promise<CodexStatus>): Promise<void> { try { await action() } catch (error) { onError(error) } finally { await onRefreshCodex() } }
  async function setFolderSharing(folderId: string, enabled: boolean): Promise<void> { try { await window.vodSearch.library.setFolderSharing(folderId, enabled) } catch (error) { onError(error) } finally { await onRefreshLibrary() } }
  async function runFolderAction(folderId: string, action: () => Promise<void>): Promise<void> { setBusyFolderId(folderId); try { await action() } catch (error) { onError(error) } finally { setBusyFolderId(null); await onRefreshLibrary() } }
  async function updateProcessingWindow(group: ProcessingScheduleGroup, nextWindow: ProcessingWindow): Promise<void> {
    const previous = processingSchedule
    const next = { ...processingSchedule, [group]: nextWindow }
    onProcessingScheduleChange(next)
    setSavingSchedule(group)
    try {
      const saved = await window.vodSearch.jobs.setProcessingSchedule(next)
      onProcessingScheduleChange(saved)
    } catch (error) {
      onProcessingScheduleChange(previous)
      onError(error)
    } finally {
      setSavingSchedule(null)
    }
  }
  const codexBusy = ["checking", "installing", "updating", "signing-in"].includes(codex.state)
  return (
    <WorkspacePage title="Settings" description="Sources, processing components, and local preferences" actions={<Button size="sm" onClick={onAddFolder}><Plus />Add folder</Button>}>
      <SettingsSection title="Codex enrichment" description="Summaries and searchable event metadata generated from transcripts.">
        <SettingRow icon={Sparkles} title="Codex CLI" description={`Uses your ChatGPT or OpenAI account${codex.version ? ` · ${codex.version}` : ""}. Transcript batches are sent to OpenAI for enrichment.`}>
          <Badge variant={codex.state === "ready" ? "accent" : codex.state === "error" ? "destructive" : "secondary"}>{codexStatusLabel(codex)}</Badge>
          {codex.installed && !codex.authenticated && <Button size="sm" disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.login())}>{codex.state === "signing-in" ? <LoaderCircle className="animate-spin" /> : null}Sign in</Button>}
          {codex.state !== "unsupported" && <Button variant={codex.installed ? "outline" : "default"} size="sm" disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.install())}>{["installing", "updating"].includes(codex.state) ? <LoaderCircle className="animate-spin" /> : null}{codex.installed ? "Update" : "Install"}</Button>}
        </SettingRow>
        {codex.error && <div className="border-t py-2 text-[10px] text-destructive">{codex.error}</div>}
      </SettingsSection>

      <SettingsSection title="On-device components" description="Local transcription and semantic search models.">
        {models.map((model) => (
          <SettingRow key={model.modelId} icon={HardDrive} title={modelName(model.modelId)} description={`${modelDescription(model.modelId)} · ${formatBytes(model.sizeBytes)}`}>
            {model.status === "installed" ? <Badge variant="accent"><CheckCircle2 />Installed</Badge> : model.status === "downloading" ? <Button variant="ghost" size="sm" onClick={() => void window.vodSearch.models.cancelDownload(model.modelId)}>Cancel</Button> : <Button variant="outline" size="sm" onClick={() => void download(model.modelId)}>Install</Button>}
          </SettingRow>
        ))}
        {models.some((model) => model.status === "downloading") && <div className="border-t py-2">{models.filter((model) => model.status === "downloading").map((model) => <Progress key={model.modelId} className="h-1" value={model.bytesDownloaded / model.sizeBytes * 100} />)}</div>}
      </SettingsSection>

      <SettingsSection title="Source folders" description="Shared bundles are imported automatically. Publishing is controlled per folder.">
        {folders.length === 0 ? <div className="py-4 text-xs text-muted-foreground">No folders configured.</div> : folders.map((folder) => (
          <SettingRow key={folder.id} icon={FolderOpen} title={folder.path} titleMono description={`${folder.availableMediaCount} videos · ${folder.missingMediaCount} missing · ${folder.lastScanAtMs ? `scanned ${formatRelative(folder.lastScanAtMs)}` : "scanning"}`}>
            <div className="text-right"><div className="flex items-center justify-end gap-1.5"><Badge variant={folder.missingMediaCount > 0 ? "destructive" : folder.lastScanAtMs ? "accent" : "secondary"}>{folder.lastScanAtMs ? folder.missingMediaCount > 0 ? "Needs attention" : "Healthy" : "Scanning"}</Badge><span className="text-[9px] text-muted-foreground">{folder.publishSharedMetadata ? "Sharing transcripts" : "Import only"}</span></div><div className="mt-1 flex items-center justify-end gap-2"><span className="text-[9px] text-muted-foreground">Publish</span><Switch checked={folder.publishSharedMetadata} disabled={busyFolderId === folder.id} onCheckedChange={(enabled) => void setFolderSharing(folder.id, enabled)} /></div></div>
            <DropdownMenu>
              <DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${folder.path}`} disabled={busyFolderId === folder.id}>{busyFolderId === folder.id ? <LoaderCircle className="animate-spin" /> : <EllipsisVertical />}</Button></DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-48">
                <DropdownMenuGroup>
                  <DropdownMenuItem onSelect={() => void runFolderAction(folder.id, () => window.vodSearch.library.rescanFolder(folder.id))}><Clock3 />Rescan now</DropdownMenuItem>
                  <DropdownMenuItem onSelect={() => void runFolderAction(folder.id, () => window.vodSearch.library.revealFolder(folder.id))}><FolderOpen />Open folder</DropdownMenuItem>
                </DropdownMenuGroup>
                <DropdownMenuSeparator />
                <DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={() => setFolderToRemove(folder)}><Trash2 />Remove source</DropdownMenuItem></DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Processing schedule" description="Daily windows use this computer’s local time. Overnight ranges are supported.">
        <ScheduleSettingRow group="ingestion" title="Ingestion and subtitles" description="Discover files, inspect media, and import available subtitle data." window={processingSchedule.ingestion} busy={savingSchedule === "ingestion"} onChange={(window) => void updateProcessingWindow("ingestion", window)} />
        <ScheduleSettingRow group="transcription" title="Local transcription" description="Run Whisper for videos that do not already have subtitles." window={processingSchedule.transcription} busy={savingSchedule === "transcription"} onChange={(window) => void updateProcessingWindow("transcription", window)} />
        <ScheduleSettingRow group="summarization" title="AI summaries" description="Send completed transcript text to Codex for topic analysis and summaries." window={processingSchedule.summarization} busy={savingSchedule === "summarization"} onChange={(window) => void updateProcessingWindow("summarization", window)} />
      </SettingsSection>

      <SettingsSection title="Preferences" description="Appearance and background resource use.">
        <SettingRow title="Dark appearance" description="Use the dark workspace theme."><Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} /></SettingRow>
        <SettingRow title="Resource mode" description="Controls the CPU threads available to transcription.">
          <Select defaultValue="normal" onValueChange={(value) => void window.vodSearch.jobs.setResourceMode(value as "low" | "normal" | "high").catch(onError)}><SelectTrigger className="h-8 min-w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low impact</SelectItem><SelectItem value="normal">Balanced</SelectItem><SelectItem value="high">High performance</SelectItem></SelectContent></Select>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Storage and privacy" description="How VOD Search handles your data.">
        <div className="py-3 text-xs leading-5 text-muted-foreground">Videos, transcripts, summaries, embeddings, and the search index remain in local application data. Codex only receives transcript batches when it creates enrichment metadata.</div>
      </SettingsSection>
      <AlertDialog open={Boolean(folderToRemove)} onOpenChange={(open) => { if (!open) setFolderToRemove(null) }}>
        <AlertDialogContent size="sm">
          <AlertDialogHeader><AlertDialogTitle>Remove this source?</AlertDialogTitle><AlertDialogDescription>The folder and video files will stay on disk. VOD Search will remove only its local index, transcript copies, summaries, and processing history for this source.</AlertDialogDescription></AlertDialogHeader>
          <AlertDialogFooter><AlertDialogCancel>Keep source</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { const folder = folderToRemove; setFolderToRemove(null); if (folder) void runFolderAction(folder.id, () => window.vodSearch.library.removeFolder(folder.id)) }}>Remove source</AlertDialogAction></AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </WorkspacePage>
  )
}

function ScheduleSettingRow({ group, title, description, window, busy, onChange }: { group: ProcessingScheduleGroup; title: string; description: string; window: ProcessingWindow; busy: boolean; onChange: (window: ProcessingWindow) => void }): React.JSX.Element {
  const open = isProcessingWindowOpen(window)
  const next = nextProcessingWindowStart(window)
  const status = !window.enabled ? "Any time" : open ? "Open now" : next ? formatNextScheduleStart(next).replace(/^starts /, "Next ") : "Scheduled"
  return (
    <SettingRow icon={CalendarClock} title={title} description={description}>
      <Badge variant={open ? "accent" : "secondary"}>{busy ? <LoaderCircle className="animate-spin" /> : null}{status}</Badge>
      <Switch aria-label={`Schedule ${processingGroupLabel(group)}`} checked={window.enabled} disabled={busy} onCheckedChange={(enabled) => onChange({ ...window, enabled })} />
      <Input aria-label={`${title} start time`} type="time" step={900} value={minuteToTime(window.startMinute)} disabled={!window.enabled || busy} onChange={(event) => onChange({ ...window, startMinute: timeToMinute(event.target.value) })} className="h-8 w-[6.75rem] font-mono text-[10px]" />
      <span className="text-[9px] text-muted-foreground">to</span>
      <Input aria-label={`${title} end time`} type="time" step={900} value={minuteToTime(window.endMinute)} disabled={!window.enabled || busy} onChange={(event) => onChange({ ...window, endMinute: timeToMinute(event.target.value) })} className="h-8 w-[6.75rem] font-mono text-[10px]" />
    </SettingRow>
  )
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="grid grid-cols-[13rem_minmax(0,1fr)] gap-8 border-b py-6 max-[1100px]:grid-cols-[11rem_minmax(0,1fr)]"><div><h2 className="text-xs font-semibold">{title}</h2><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</p></div><div className="min-w-0 divide-y">{children}</div></section>
}

function SettingRow({ icon: Icon, title, titleMono = false, description, children }: { icon?: typeof Settings; title: string; titleMono?: boolean; description: string; children: React.ReactNode }): React.JSX.Element {
  return (
    <div className="flex min-h-14 items-center gap-3 py-3 first:pt-0 last:pb-0">
      {Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}
      <div className="min-w-0 flex-1"><div className={cn("truncate text-xs font-semibold", titleMono && "font-mono text-[10px]")}>{title}</div><div className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</div></div>
      <div className="flex shrink-0 items-center gap-1.5">{children}</div>
    </div>
  )
}

function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }): React.JSX.Element {
  return <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-5"><div className="min-w-0"><h1 className="text-base font-semibold tracking-tight">{title}</h1><p className="mt-0.5 truncate text-[11px] text-muted-foreground">{description}</p></div>{actions}</header>
}

function WorkspacePage({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full min-h-0 flex-col"><PageHeader title={title} description={description} actions={actions} /><div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1200px] px-5 pb-8">{children}</div></div></div>
}

async function listAllMedia(): Promise<MediaAsset[]> {
  const result: MediaAsset[] = []
  const batchSize = 500
  for (let offset = 0; ; offset += batchSize) {
    const batch = await window.vodSearch.library.listMedia({ offset, limit: batchSize })
    result.push(...batch)
    if (batch.length < batchSize) return result
  }
}

function localDateStart(value: string): number {
  const [year, month, day] = value.split("-").map(Number)
  return new Date(year!, month! - 1, day!).getTime()
}

function searchScoreTitle(hit: SearchHit): string {
  const parts = Object.entries(hit.scoreBreakdown)
    .filter(([, score]) => score > 0)
    .map(([name, score]) => `${name} ${score.toFixed(1)}`)
  return `${hit.score.toFixed(1)} / 100${parts.length ? ` · ${parts.join(" + ")}` : ""}`
}

function joinDisplayPath(folder: string, relative: string): string {
  const separator = folder.includes("\\") ? "\\" : "/"
  return `${folder.replace(/[\\/]$/, "")}${separator}${relative}`
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours > 0 ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`
}

function minuteToTime(minute: number): string {
  return `${String(Math.floor(minute / 60)).padStart(2, "0")}:${String(minute % 60).padStart(2, "0")}`
}

function timeToMinute(value: string): number {
  const [hours, minutes] = value.split(":").map(Number)
  return Math.max(0, Math.min(1_439, (hours ?? 0) * 60 + (minutes ?? 0)))
}

function formatDuration(milliseconds: number): string {
  const hours = milliseconds / 3_600_000
  if (hours >= 1) return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hours`
  return `${Math.round(milliseconds / 60_000)} minutes`
}

function formatDate(milliseconds: number): string {
  return new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", year: "numeric" }).format(milliseconds)
}

function formatRelative(milliseconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  if (minutes < 1_440) return `${Math.round(minutes / 60)}h ago`
  return `${Math.round(minutes / 1_440)}d ago`
}

function jobStatusDescription(job: Job, processingSchedule: ProcessingSchedule): string {
  if (job.status === "running") return `${humanize(job.stage)} is ${Math.round(job.progress * 100)}% complete`
  if (job.status === "queued") {
    const group = scheduleGroupForJobStage(job.stage)
    if (group && !isJobStageAllowed(processingSchedule, job.stage)) {
      const next = nextProcessingWindowStart(processingSchedule[group])
      return `${processingGroupLabel(group)} is scheduled${next ? ` · ${formatNextScheduleStart(next)}` : ""}`
    }
    return `Waiting for an available ${humanize(job.stage).toLocaleLowerCase("en-US")} worker`
  }
  if (job.status === "paused") return "Paused; resume processing when this computer is available"
  if (job.status === "succeeded") return `${humanize(job.stage)} completed successfully`
  if (job.status === "failed") return `${humanize(job.stage)} stopped and can be retried`
  return `${humanize(job.stage)} was cancelled`
}

function formatNextScheduleStart(next: Date): string {
  const now = new Date()
  const tomorrow = new Date(now)
  tomorrow.setDate(tomorrow.getDate() + 1)
  const sameDay = next.toDateString() === now.toDateString()
  const nextDay = next.toDateString() === tomorrow.toDateString()
  const time = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" }).format(next)
  return sameDay ? `starts at ${time}` : nextDay ? `starts tomorrow at ${time}` : `starts ${new Intl.DateTimeFormat(undefined, { weekday: "short", hour: "numeric", minute: "2-digit" }).format(next)}`
}

function processingGroupLabel(group: ProcessingScheduleGroup): string {
  if (group === "ingestion") return "Ingestion"
  if (group === "transcription") return "Transcription"
  return "AI summaries"
}

function formatJobTiming(job: Job): string {
  if (job.status === "running") return `Running ${formatCompactDuration(Date.now() - job.updatedAtMs)}`
  if (job.status === "queued" || job.status === "paused") return `Queued ${formatRelative(job.createdAtMs)}`
  return `Updated ${formatRelative(job.updatedAtMs)}`
}

function estimateJobRemaining(job: Job): string {
  const elapsed = Math.max(1_000, Date.now() - job.createdAtMs)
  const estimated = elapsed / job.progress * (1 - job.progress)
  return formatCompactDuration(Math.min(estimated, 24 * 60 * 60_000))
}

function formatCompactDuration(milliseconds: number): string {
  const seconds = Math.max(1, Math.round(milliseconds / 1000))
  if (seconds < 60) return `${seconds}s`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes}m`
  return `${Math.round(minutes / 60)}h`
}

function summarizeJobError(error: string): string {
  const lines = error.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
  const summary = lines.at(-1) ?? error
  return summary.length > 180 ? `${summary.slice(0, 177)}…` : summary
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function stageLabel(stage: MediaAsset["highestCompletedStage"]): string {
  return stage === "ready" ? "Ready" : stage === "embedded" || stage === "enriched" ? "Searchable" : stage === "chunked" ? "Indexed" : humanize(stage)
}

function humanize(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase())
}

function modelName(modelId: string): string {
  return ({ "whisper-small-en": "Whisper small.en", "bge-small-en-v1.5": "Semantic search index" } as Record<string, string>)[modelId] ?? modelId
}

function modelDescription(modelId: string): string {
  return ({ "whisper-small-en": "Local speech transcription", "bge-small-en-v1.5": "Local vector encoder for meaning-based search" } as Record<string, string>)[modelId] ?? "Local component"
}

function codexStatusLabel(status: CodexStatus): string {
  return ({ checking: "Checking", missing: "Not installed", installing: "Installing", "signed-out": "Sign-in required", "signing-in": "Signing in", ready: "Ready", updating: "Updating", unsupported: "Manual setup required", error: "Needs attention" } as const)[status.state]
}
