import { type FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import type { CodexStatus, Job, LibraryStats, MediaAsset, ModelInstallation, SearchHit, SearchMode, SourceFolder } from "@vod-search/contracts"
import {
  Activity,
  CalendarRange,
  CheckCircle2,
  CircleAlert,
  Database,
  FolderOpen,
  HardDrive,
  Library,
  LoaderCircle,
  Moon,
  Pause,
  Play,
  Plus,
  RotateCw,
  Search,
  Settings,
  Sparkles,
  Sun,
  Video,
  WandSparkles,
  X
} from "lucide-react"
import { MediaDrawer, type MediaDrawerSelection } from "@/components/media-drawer"
import { VideoThumbnail } from "@/components/video-thumbnail"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Card } from "@/components/ui/card"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { cn } from "@/lib/utils"

type View = "library" | "activity" | "settings"
type Theme = "light" | "dark"

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
  const [selection, setSelection] = useState<MediaDrawerSelection | null>(null)
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

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark")
    localStorage.setItem("vod-search-theme", theme)
  }, [theme])

  useEffect(() => {
    void refreshLibrary().catch(showError)
    void refreshJobs().catch(showError)
    void refreshModels().catch(showError)
    void refreshCodex().catch(showError)
    const removeLibraryListener = window.vodSearch.events.onLibraryChanged(() => void refreshLibrary().catch(showError))
    const removeJobsListener = window.vodSearch.events.onJobsChanged(() => {
      void refreshJobs().catch(showError)
      void refreshLibrary().catch(showError)
    })
    const removeModelsListener = window.vodSearch.events.onModelsChanged(() => void refreshModels().catch(showError))
    const removeCodexListener = window.vodSearch.events.onCodexChanged(() => void refreshCodex().catch(showError))
    return () => { removeLibraryListener(); removeJobsListener(); removeModelsListener(); removeCodexListener() }
  }, [refreshCodex, refreshJobs, refreshLibrary, refreshModels])

  function showError(reason: unknown): void {
    setError(reason instanceof Error ? reason.message : String(reason))
  }

  async function addFolder(): Promise<void> {
    setError(null)
    try {
      const path = await window.vodSearch.library.selectFolder()
      if (!path) return
      await window.vodSearch.library.addFolder(path)
      await refreshLibrary()
      setView("library")
    } catch (reason) {
      showError(reason)
    }
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background font-sans text-foreground antialiased">
      <Sidebar view={view} setView={setView} stats={stats} theme={theme} setTheme={setTheme} />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        {error && (
          <div className="absolute left-1/2 top-4 z-40 flex max-w-xl -translate-x-1/2 items-center gap-3 rounded-xl border border-destructive/30 bg-background px-4 py-3 text-sm shadow-lg">
            <CircleAlert className="size-4 shrink-0 text-destructive" /><span className="min-w-0 flex-1 truncate">{error}</span><Button variant="ghost" size="icon-sm" onClick={() => setError(null)}><X /></Button>
          </div>
        )}
        {view === "library" && (
          <LibraryDashboard
            folders={folders}
            media={media}
            stats={stats}
            models={models}
            onAddFolder={() => void addFolder()}
            onOpen={setSelection}
            onError={showError}
          />
        )}
        {view === "activity" && <ActivityDashboard jobs={jobs} media={media} stats={stats} onError={showError} />}
        {view === "settings" && (
          <SettingsDashboard
            folders={folders}
            models={models}
            codex={codex}
            theme={theme}
            setTheme={setTheme}
            onAddFolder={() => void addFolder()}
            onRefreshModels={refreshModels}
            onRefreshCodex={refreshCodex}
            onError={showError}
          />
        )}
      </main>
      <MediaDrawer selection={selection} onClose={() => setSelection(null)} />
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
    <aside className="flex w-[17rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar p-4 text-sidebar-foreground max-lg:w-[4.5rem] max-lg:px-3">
      <div className="flex h-11 items-center gap-3 px-2">
        <div className="grid size-9 shrink-0 place-items-center rounded-xl bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Video className="size-4.5" /></div>
        <div className="min-w-0 max-lg:hidden"><div className="truncate text-sm font-bold">VOD Search</div><div className="truncate text-[11px] text-muted-foreground">Personal video index</div></div>
      </div>
      <nav className="mt-8 space-y-1">
        <SidebarButton active={view === "library"} icon={Library} label="Videos" onClick={() => setView("library")} />
        <SidebarButton active={view === "activity"} icon={Activity} label="Activity" badge={stats.runningJobs + stats.queuedJobs || undefined} onClick={() => setView("activity")} />
        <SidebarButton active={view === "settings"} icon={Settings} label="Settings" badge={stats.failedJobs || undefined} onClick={() => setView("settings")} />
      </nav>
      <div className="mt-auto space-y-3">
        <div className="rounded-xl border border-sidebar-border bg-background/55 p-3 max-lg:hidden">
          <div className="mb-2 flex items-center justify-between text-xs"><span className="text-muted-foreground">Local index</span><CheckCircle2 className="size-3.5 text-chart-1" /></div>
          <div className="text-sm font-semibold">{stats.searchableChunks.toLocaleString()} moments</div>
          <div className="mt-1 text-[11px] text-muted-foreground">{stats.totalMedia.toLocaleString()} videos · on-device index</div>
        </div>
        <Button variant="ghost" className="w-full justify-start gap-3 px-3 max-lg:justify-center max-lg:px-0" onClick={() => setTheme(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun /> : <Moon />}<span className="max-lg:hidden">{theme === "dark" ? "Light mode" : "Dark mode"}</span>
        </Button>
      </div>
    </aside>
  )
}

function SidebarButton({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof Library; label: string; badge?: number | undefined; onClick: () => void }): React.JSX.Element {
  return (
    <Button variant="ghost" className={cn("relative h-11 w-full justify-start gap-3 px-3 font-medium text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-lg:justify-center max-lg:px-0", active && "bg-sidebar-accent text-sidebar-accent-foreground")} onClick={onClick}>
      <Icon className="size-[18px]" /><span className="max-lg:hidden">{label}</span>{badge ? <Badge variant={label === "Settings" ? "destructive" : "secondary"} className="ml-auto max-lg:absolute max-lg:-right-1 max-lg:-top-1 max-lg:size-4 max-lg:px-0 max-lg:text-[9px]">{badge}</Badge> : null}
    </Button>
  )
}

function LibraryDashboard({
  folders,
  media,
  stats,
  models,
  onAddFolder,
  onOpen,
  onError
}: {
  folders: SourceFolder[]
  media: MediaAsset[]
  stats: LibraryStats
  models: ModelInstallation[]
  onAddFolder: () => void
  onOpen: (selection: MediaDrawerSelection) => void
  onError: (error: unknown) => void
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState<SearchMode>("hybrid")
  const [dateFrom, setDateFrom] = useState("")
  const [dateTo, setDateTo] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [searched, setSearched] = useState(false)
  const semanticReady = models.some((model) => model.modelId === "bge-small-en-v1.5" && model.status === "installed")
  const folderById = useMemo(() => new Map(folders.map((folder) => [folder.id, folder.path])), [folders])

  async function submitSearch(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    try {
      const response = await window.vodSearch.search.query({
        query,
        mode,
        ...(dateFrom ? { createdAfterMs: localDateStart(dateFrom) } : {}),
        ...(dateTo ? { createdBeforeMs: localDateStart(dateTo) + 86_400_000 } : {}),
        includeMissing: false,
        limit: 100
      })
      setHits(response.hits)
      setSearched(true)
    } catch (reason) {
      setHits([])
      onError(reason)
    } finally {
      setSearching(false)
    }
  }

  function clearSearch(): void {
    setQuery("")
    setDateFrom("")
    setDateTo("")
    setHits([])
    setSearched(false)
  }

  return (
    <div className="h-full overflow-y-auto">
      <header className="sticky top-0 z-30 border-b bg-background/92 px-7 py-5 backdrop-blur-xl">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-6">
          <div className="min-w-0"><h1 className="text-xl font-bold tracking-tight">Video library</h1><p className="mt-1 text-sm text-muted-foreground">{stats.totalMedia ? `${stats.totalMedia.toLocaleString()} indexed videos · ${formatDuration(stats.totalDurationMs)} total` : "Add a folder to begin indexing"}</p></div>
          <Button onClick={onAddFolder}><Plus />Add folder</Button>
        </div>
      </header>
      <div className="mx-auto max-w-[1500px] px-7 py-6">
        <form onSubmit={(event) => void submitSearch(event)} className="rounded-xl border bg-card p-3 shadow-sm">
          <div className="flex items-center gap-3">
            <div className="relative min-w-0 flex-1">
              <Search className="absolute left-3.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <Input value={query} onChange={(event) => setQuery(event.target.value)} className="h-12 border-0 bg-muted pl-10 pr-10 text-[15px] shadow-none focus-visible:ring-2" placeholder="Search dialogue, people, places, or events…" />
              {query && <button type="button" aria-label="Clear query" onClick={() => setQuery("")} className="absolute right-3 top-1/2 grid size-7 -translate-y-1/2 cursor-pointer place-items-center rounded-md text-muted-foreground hover:bg-background hover:text-foreground"><X className="size-3.5" /></button>}
            </div>
            <Button type="submit" size="lg" className="h-12 px-6" disabled={searching || !query.trim()}>{searching ? <LoaderCircle className="animate-spin" /> : <Search />}Search</Button>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 border-t pt-3">
            <Select value={mode} onValueChange={(value) => setMode(value as SearchMode)}>
              <SelectTrigger className="h-9"><Sparkles className="size-3.5 text-primary" /><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value="hybrid">Hybrid search</SelectItem>
                <SelectItem value="semantic">Semantic only</SelectItem>
                <SelectItem value="keyword">Keyword only</SelectItem>
              </SelectContent>
            </Select>
            <div className="flex h-9 items-center gap-2 rounded-lg border border-input bg-background px-3 shadow-xs">
              <CalendarRange className="size-3.5 text-muted-foreground" />
              <input aria-label="Created after" type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className="w-[8.2rem] bg-transparent text-xs font-medium outline-none" />
              <span className="text-xs text-muted-foreground">to</span>
              <input aria-label="Created before" type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className="w-[8.2rem] bg-transparent text-xs font-medium outline-none" />
            </div>
            <div className="ml-auto flex items-center gap-2 text-xs text-muted-foreground">
              <span className={cn("size-1.5 rounded-full", semanticReady ? "bg-chart-1" : "bg-muted-foreground/50")} />
              {semanticReady ? "Semantic index ready" : "Install BGE in Settings for semantic search"}
            </div>
          </div>
        </form>

        {searched ? (
          <SearchResults hits={hits} query={query} searching={searching} onClear={clearSearch} onOpen={onOpen} />
        ) : media.length === 0 ? (
          <EmptyLibrary onAddFolder={onAddFolder} />
        ) : (
          <VideoGrid media={media} folderById={folderById} onOpen={onOpen} />
        )}
      </div>
    </div>
  )
}

function VideoGrid({ media, folderById, onOpen }: { media: MediaAsset[]; folderById: Map<string, string>; onOpen: (selection: MediaDrawerSelection) => void }): React.JSX.Element {
  return (
    <section className="mt-7">
      <div className="mb-4 flex items-end justify-between"><div><h2 className="font-semibold">All videos</h2><p className="mt-1 text-sm text-muted-foreground">Newest files first</p></div><span className="text-xs text-muted-foreground">{media.length.toLocaleString()} items</span></div>
      <div className="grid grid-cols-2 gap-x-5 gap-y-7 xl:grid-cols-3 2xl:grid-cols-4">
        {media.map((item) => {
          const folder = folderById.get(item.sourceFolderId)
          const location = folder ? joinDisplayPath(folder, item.relativePath) : item.relativePath
          return (
            <button key={item.id} type="button" className="group min-w-0 cursor-pointer text-left" onClick={() => onOpen({ mediaId: item.id, title: item.displayName })}>
              <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted shadow-xs transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                <VideoThumbnail mediaId={item.id} className="size-full" />
                <div className="absolute bottom-2 right-2 rounded-md bg-black/75 px-1.5 py-0.5 font-mono text-[10px] text-white backdrop-blur-sm">{item.durationMs ? formatTimestamp(item.durationMs) : "Processing"}</div>
                {item.availability === "missing" && <Badge variant="destructive" className="absolute left-2 top-2">Missing</Badge>}
              </div>
              <div className="px-1 pt-3">
                <div className="truncate text-sm font-semibold group-hover:text-primary">{item.displayName}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground" title={location}>{location}</div>
                <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground"><span>{formatDate(item.createdAtMs)}</span><Badge variant="secondary" className="font-normal">{stageLabel(item.highestCompletedStage)}</Badge></div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function SearchResults({ hits, query, searching, onClear, onOpen }: { hits: SearchHit[]; query: string; searching: boolean; onClear: () => void; onOpen: (selection: MediaDrawerSelection) => void }): React.JSX.Element {
  const markersByMedia = useMemo(() => {
    const grouped = new Map<string, SearchHit[]>()
    for (const hit of hits) grouped.set(hit.mediaId, [...(grouped.get(hit.mediaId) ?? []), hit])
    return grouped
  }, [hits])
  return (
    <section className="mt-7">
      <div className="mb-4 flex items-center justify-between">
        <div><h2 className="font-semibold">{searching ? "Searching…" : `${hits.length} timestamp ${hits.length === 1 ? "match" : "matches"}`}</h2><p className="mt-1 text-sm text-muted-foreground">Results for “{query}”</p></div>
        <Button variant="ghost" size="sm" onClick={onClear}><X />Clear results</Button>
      </div>
      {!searching && hits.length === 0 ? (
        <div className="grid min-h-72 place-items-center rounded-xl border border-dashed bg-muted/30 p-8 text-center"><div><Search className="mx-auto size-6 text-muted-foreground" /><p className="mt-3 font-semibold">No matching moments</p><p className="mt-1 text-sm text-muted-foreground">Try a broader description, keyword mode, or another date range.</p></div></div>
      ) : (
        <div className="grid grid-cols-2 gap-x-5 gap-y-7 xl:grid-cols-3 2xl:grid-cols-4">
          {hits.map((hit, index) => (
            <button key={`${hit.mediaId}:${hit.startMs}:${index}`} type="button" className="group min-w-0 cursor-pointer text-left" onClick={() => onOpen({ mediaId: hit.mediaId, title: hit.title, initialMs: hit.startMs, markers: markersByMedia.get(hit.mediaId) ?? [] })}>
              <div className="relative aspect-video overflow-hidden rounded-xl border bg-muted shadow-xs transition-all duration-200 group-hover:-translate-y-0.5 group-hover:shadow-md">
                <VideoThumbnail mediaId={hit.mediaId} seekMs={hit.startMs} className="size-full" />
                <Badge className="absolute bottom-2 left-2 font-mono shadow-sm">{formatTimestamp(hit.startMs)}</Badge>
                <div className="absolute bottom-2 right-2 flex gap-1">{hit.matchReasons.slice(0, 2).map((reason) => <Badge key={reason} variant="secondary" className="bg-background/90 font-normal backdrop-blur-sm">{reason}</Badge>)}</div>
              </div>
              <div className="px-1 pt-3">
                <div className="truncate text-sm font-semibold group-hover:text-primary">{hit.title}</div>
                <div className="mt-1 truncate font-mono text-[11px] text-muted-foreground">{hit.relativePath}</div>
                <p className="mt-2 line-clamp-2 text-xs leading-5 text-muted-foreground">{hit.summary ?? hit.transcriptExcerpt}</p>
                <div className="mt-2 text-xs text-muted-foreground">{formatDate(hit.createdAtMs)}</div>
              </div>
            </button>
          ))}
        </div>
      )}
    </section>
  )
}

function EmptyLibrary({ onAddFolder }: { onAddFolder: () => void }): React.JSX.Element {
  return (
    <div className="grid min-h-[28rem] place-items-center">
      <div className="max-w-md text-center"><div className="mx-auto grid size-14 place-items-center rounded-xl border bg-card shadow-sm"><FolderOpen className="size-6 text-primary" /></div><h2 className="mt-5 text-lg font-bold">Add your video archive</h2><p className="mt-2 text-sm leading-6 text-muted-foreground">Choose a folder containing videos. Existing subtitles are indexed first, then remaining audio can be transcribed privately on this computer.</p><Button className="mt-5" onClick={onAddFolder}><Plus />Add video folder</Button></div>
    </div>
  )
}

function ActivityDashboard({ jobs, media, stats, onError }: { jobs: Job[]; media: MediaAsset[]; stats: LibraryStats; onError: (error: unknown) => void }): React.JSX.Element {
  const names = useMemo(() => new Map(media.map((item) => [item.id, item.displayName])), [media])
  const active = jobs.filter((job) => ["queued", "running", "paused", "failed"].includes(job.status))
  async function run(action: () => Promise<void>): Promise<void> { try { await action() } catch (error) { onError(error) } }
  return (
    <DashboardPage title="Activity" description="Indexing work is durable and resumes after interruptions." actions={<div className="flex gap-2"><Button variant="outline" onClick={() => void run(() => window.vodSearch.jobs.pauseAll())}><Pause />Pause all</Button><Button onClick={() => void run(() => window.vodSearch.jobs.resumeAll())}><Play />Resume</Button></div>}>
      <div className="grid grid-cols-3 gap-4">
        <MetricCard icon={RotateCw} label="Running" value={stats.runningJobs} detail="Current background tasks" />
        <MetricCard icon={Database} label="Queued" value={stats.queuedJobs} detail="Waiting to process" />
        <MetricCard icon={CircleAlert} label="Needs attention" value={stats.failedJobs} detail="Failed tasks" destructive={stats.failedJobs > 0} />
      </div>
      <Card className="mt-6 overflow-hidden">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-semibold">Processing queue</h2><p className="mt-1 text-xs text-muted-foreground">Newest status changes appear first</p></div><Badge variant="secondary">{active.length} active</Badge></div>
        {active.length === 0 ? <div className="grid min-h-48 place-items-center text-sm text-muted-foreground">Nothing is currently queued.</div> : active.map((job) => (
          <div key={job.id} className="grid grid-cols-[minmax(0,1fr)_10rem_6rem] items-center gap-5 border-b px-5 py-4 last:border-b-0">
            <div className="flex min-w-0 items-center gap-3"><span className={cn("size-2 shrink-0 rounded-full", job.status === "running" ? "bg-chart-1" : job.status === "failed" ? "bg-destructive" : "bg-muted-foreground/50")} /><div className="min-w-0"><div className="truncate text-sm font-semibold">{names.get(job.mediaId ?? "") ?? "Library task"}</div><div className="mt-1 text-xs text-muted-foreground">{humanize(job.stage)} · attempt {job.attempts}</div>{job.error && <div className="mt-1 truncate text-xs text-destructive">{job.error}</div>}</div></div>
            <Progress value={job.progress * 100} />
            <Badge variant={job.status === "failed" ? "destructive" : "secondary"} className="justify-self-end">{job.status}</Badge>
          </div>
        ))}
      </Card>
    </DashboardPage>
  )
}

function SettingsDashboard({ folders, models, codex, theme, setTheme, onAddFolder, onRefreshModels, onRefreshCodex, onError }: { folders: SourceFolder[]; models: ModelInstallation[]; codex: CodexStatus; theme: Theme; setTheme: (theme: Theme) => void; onAddFolder: () => void; onRefreshModels: () => Promise<void>; onRefreshCodex: () => Promise<void>; onError: (error: unknown) => void }): React.JSX.Element {
  async function download(modelId: string): Promise<void> { try { await window.vodSearch.models.download(modelId) } catch (error) { onError(error) } finally { await onRefreshModels() } }
  async function runCodex(action: () => Promise<CodexStatus>): Promise<void> { try { await action() } catch (error) { onError(error) } finally { await onRefreshCodex() } }
  const codexBusy = ["checking", "installing", "updating", "signing-in"].includes(codex.state)
  return (
    <DashboardPage title="Settings" description="AI setup, source folders, and background resource limits." actions={<Button onClick={onAddFolder}><Plus />Add folder</Button>}>
      <div className="grid grid-cols-[minmax(0,1fr)_22rem] gap-6 max-xl:grid-cols-1">
        <div className="space-y-6">
          <Card className="overflow-hidden">
            <SettingHeader icon={WandSparkles} title="Codex enrichment" description="Codex turns transcripts into summaries and searchable event metadata." />
            <div className="flex items-center gap-4 px-5 py-5">
              <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Sparkles className="size-4" /></div>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><div className="text-sm font-semibold">Codex CLI</div><Badge variant={codex.state === "ready" ? "accent" : codex.state === "error" ? "destructive" : "secondary"}>{codexStatusLabel(codex)}</Badge></div>
                <div className="mt-1 text-xs leading-5 text-muted-foreground">Uses your ChatGPT or OpenAI account. Transcript text is sent to OpenAI for enrichment{codex.version ? ` · Version ${codex.version}` : "."}</div>
                {codex.error && <div className="mt-2 text-xs text-destructive">{codex.error}</div>}
              </div>
              <div className="flex shrink-0 gap-2">
                {codex.installed && !codex.authenticated && <Button disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.login())}>{codex.state === "signing-in" ? <LoaderCircle className="animate-spin" /> : null}Sign in</Button>}
                {codex.state !== "unsupported" && <Button variant={codex.installed ? "outline" : "default"} disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.install())}>{["installing", "updating"].includes(codex.state) ? <LoaderCircle className="animate-spin" /> : null}{codex.installed ? "Update" : "Install Codex"}</Button>}
              </div>
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SettingHeader icon={HardDrive} title="On-device components" description="No separate Node or Python installation is required." />
            <div className="divide-y">
              {models.map((model) => (
                <div key={model.modelId} className="flex items-center gap-4 px-5 py-4">
                  <div className="grid size-10 shrink-0 place-items-center rounded-lg bg-accent text-accent-foreground"><Sparkles className="size-4" /></div>
                  <div className="min-w-0 flex-1"><div className="text-sm font-semibold">{modelName(model.modelId)}</div><div className="mt-1 text-xs text-muted-foreground">{modelDescription(model.modelId)} · {formatBytes(model.sizeBytes)}</div>{model.status === "downloading" && <Progress className="mt-2 max-w-sm" value={model.bytesDownloaded / model.sizeBytes * 100} />}</div>
                  {model.status === "installed" ? <Badge variant="accent"><CheckCircle2 />Installed</Badge> : model.status === "downloading" ? <Button variant="ghost" size="sm" onClick={() => void window.vodSearch.models.cancelDownload(model.modelId)}>Cancel</Button> : <Button variant="outline" size="sm" onClick={() => void download(model.modelId)}>Install</Button>}
                </div>
              ))}
            </div>
          </Card>
          <Card className="overflow-hidden">
            <SettingHeader icon={FolderOpen} title="Source folders" description="Videos remain in place and are never copied or modified." />
            <div className="divide-y">
              {folders.length === 0 ? <div className="px-5 py-8 text-center text-sm text-muted-foreground">No folders configured.</div> : folders.map((folder) => (
                <div key={folder.id} className="flex items-center gap-4 px-5 py-4"><div className="grid size-10 shrink-0 place-items-center rounded-lg bg-muted"><HardDrive className="size-4" /></div><div className="min-w-0 flex-1"><div className="truncate font-mono text-xs font-medium">{folder.path}</div><div className="mt-1 text-xs text-muted-foreground">{folder.availableMediaCount} videos · {folder.missingMediaCount} missing</div></div><Badge variant="secondary">{folder.lastScanAtMs ? `Scanned ${formatRelative(folder.lastScanAtMs)}` : "Scanning"}</Badge></div>
              ))}
            </div>
          </Card>
        </div>
        <div className="space-y-6">
          <Card className="p-5"><div className="flex items-start justify-between gap-4"><div><h3 className="text-sm font-semibold">Dark appearance</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Use the supplied dark theme throughout the dashboard.</p></div><Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} /></div></Card>
          <Card className="p-5"><h3 className="text-sm font-semibold">Resource mode</h3><p className="mt-1 text-xs leading-5 text-muted-foreground">Controls how many CPU threads transcription may use.</p><Select defaultValue="normal" onValueChange={(value) => void window.vodSearch.jobs.setResourceMode(value as "low" | "normal" | "high").catch(onError)}><SelectTrigger className="mt-4 w-full"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low impact</SelectItem><SelectItem value="normal">Balanced</SelectItem><SelectItem value="high">High performance</SelectItem></SelectContent></Select></Card>
          <Card className="p-5"><div className="mb-3 flex items-center gap-2 text-sm font-semibold"><HardDrive className="size-4 text-primary" />Storage and privacy</div><p className="text-xs leading-5 text-muted-foreground">Videos, transcripts, summaries, embeddings, and the search index remain in local application data. Codex receives transcript batches when it creates enrichment metadata.</p><div className="mt-4 flex items-center gap-2 text-xs font-medium text-primary"><span className="size-1.5 rounded-full bg-primary" />Local index · cloud enrichment</div></Card>
        </div>
      </div>
    </DashboardPage>
  )
}

function DashboardPage({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <div className="h-full overflow-y-auto"><header className="sticky top-0 z-30 border-b bg-background/92 px-7 py-5 backdrop-blur-xl"><div className="mx-auto flex max-w-[1400px] items-center justify-between gap-6"><div><h1 className="text-xl font-bold tracking-tight">{title}</h1><p className="mt-1 text-sm text-muted-foreground">{description}</p></div>{actions}</div></header><div className="mx-auto max-w-[1400px] px-7 py-6">{children}</div></div>
}

function MetricCard({ icon: Icon, label, value, detail, destructive = false }: { icon: typeof Activity; label: string; value: number; detail: string; destructive?: boolean }): React.JSX.Element {
  return <Card className="p-5"><div className="flex items-start justify-between"><div><div className="text-sm font-medium text-muted-foreground">{label}</div><div className={cn("mt-2 text-3xl font-bold", destructive && "text-destructive")}>{value.toLocaleString()}</div><div className="mt-1 text-xs text-muted-foreground">{detail}</div></div><div className={cn("grid size-10 place-items-center rounded-lg bg-accent text-accent-foreground", destructive && "bg-destructive/10 text-destructive")}><Icon className="size-4" /></div></div></Card>
}

function SettingHeader({ icon: Icon, title, description }: { icon: typeof Settings; title: string; description: string }): React.JSX.Element {
  return <div className="flex items-center gap-3 border-b px-5 py-4"><div className="grid size-9 place-items-center rounded-lg bg-accent text-accent-foreground"><Icon className="size-4" /></div><div><h2 className="text-sm font-semibold">{title}</h2><p className="mt-0.5 text-xs text-muted-foreground">{description}</p></div></div>
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
  return ({
    checking: "Checking",
    missing: "Not installed",
    installing: "Installing",
    "signed-out": "Sign-in required",
    "signing-in": "Signing in",
    ready: "Ready",
    updating: "Updating",
    unsupported: "Manual setup required",
    error: "Needs attention"
  } as const)[status.state]
}
