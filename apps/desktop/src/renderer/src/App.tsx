import { FormEvent, useCallback, useEffect, useMemo, useState } from "react"
import type {
  Job,
  LibraryStats,
  MediaAsset,
  ModelInstallation,
  SearchHit,
  SourceFolder
} from "@vod-search/contracts"

type View = "search" | "library" | "activity" | "settings"

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

export function App(): React.JSX.Element {
  const [view, setView] = useState<View>("search")
  const [folders, setFolders] = useState<SourceFolder[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [stats, setStats] = useState<LibraryStats>(emptyStats)
  const [query, setQuery] = useState("")
  const [hits, setHits] = useState<SearchHit[]>([])
  const [searching, setSearching] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [selectedHit, setSelectedHit] = useState<SearchHit | null>(null)
  const [playbackUrl, setPlaybackUrl] = useState<string | null>(null)

  const refreshLibrary = useCallback(async () => {
    const [nextFolders, nextMedia, nextStats] = await Promise.all([
      window.vodSearch.library.listFolders(),
      window.vodSearch.library.listMedia({ limit: 200 }),
      window.vodSearch.library.stats()
    ])
    setFolders(nextFolders)
    setMedia(nextMedia)
    setStats(nextStats)
  }, [])

  const refreshJobs = useCallback(async () => {
    setJobs(await window.vodSearch.jobs.list())
  }, [])

  useEffect(() => {
    void refreshLibrary().catch(showError)
    void refreshJobs().catch(showError)
    const removeLibraryListener = window.vodSearch.events.onLibraryChanged(() => {
      void refreshLibrary().catch(showError)
    })
    const removeJobsListener = window.vodSearch.events.onJobsChanged(() => {
      void refreshJobs().catch(showError)
      void refreshLibrary().catch(showError)
    })
    return () => {
      removeLibraryListener()
      removeJobsListener()
    }
  }, [refreshJobs, refreshLibrary])

  function showError(reason: unknown): void {
    setError(reason instanceof Error ? reason.message : String(reason))
  }

  async function addFolder(): Promise<void> {
    setError(null)
    const path = await window.vodSearch.library.selectFolder()
    if (!path) return
    try {
      await window.vodSearch.library.addFolder(path)
      await refreshLibrary()
      setView("library")
    } catch (reason) {
      showError(reason)
    }
  }

  async function submitSearch(event: FormEvent): Promise<void> {
    event.preventDefault()
    if (!query.trim()) return
    setSearching(true)
    setError(null)
    try {
      const response = await window.vodSearch.search.query({ query, includeMissing: false, limit: 20 })
      setHits(response.hits)
    } catch (reason) {
      showError(reason)
      setHits([])
    } finally {
      setSearching(false)
    }
  }

  async function openHit(hit: SearchHit): Promise<void> {
    setSelectedHit(hit)
    const source = await window.vodSearch.media.getPlaybackSource(hit.mediaId)
    setPlaybackUrl(source.available ? source.url : null)
  }

  const progressText = useMemo(() => {
    if (stats.totalMedia === 0) return "No videos indexed"
    return `${stats.searchableChunks.toLocaleString()} searchable moments across ${stats.totalMedia.toLocaleString()} videos`
  }, [stats])

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">V</div>
          <div><strong>VOD Search</strong><span>Local video intelligence</span></div>
        </div>
        <nav>
          <NavItem active={view === "search"} icon="⌕" label="Search" onClick={() => setView("search")} />
          <NavItem active={view === "library"} icon="▤" label="Library" onClick={() => setView("library")} />
          <NavItem active={view === "activity"} icon="◴" label="Activity" onClick={() => setView("activity")} badge={stats.failedJobs || undefined} />
          <NavItem active={view === "settings"} icon="⚙" label="Settings" onClick={() => setView("settings")} />
        </nav>
        <div className="sidebar-status">
          <div className="status-row"><span className="status-dot" />Offline processing</div>
          <small>{progressText}</small>
        </div>
      </aside>

      <main className="content">
        {error && <div className="error-banner"><span>{error}</span><button onClick={() => setError(null)}>Dismiss</button></div>}
        {view === "search" && (
          <SearchView
            query={query}
            setQuery={setQuery}
            submitSearch={submitSearch}
            hits={hits}
            searching={searching}
            hasLibrary={folders.length > 0}
            onAddFolder={() => void addFolder()}
            onOpenHit={(hit) => void openHit(hit)}
          />
        )}
        {view === "library" && (
          <LibraryView folders={folders} media={media} stats={stats} onAddFolder={() => void addFolder()} />
        )}
        {view === "activity" && (
          <ActivityView jobs={jobs} stats={stats} onRefresh={() => void refreshJobs()} />
        )}
        {view === "settings" && <SettingsView />}
      </main>

      {selectedHit && (
        <PlayerDrawer hit={selectedHit} playbackUrl={playbackUrl} onClose={() => {
          setSelectedHit(null)
          setPlaybackUrl(null)
        }} />
      )}
    </div>
  )
}

function NavItem(props: {
  active: boolean
  icon: string
  label: string
  badge?: number | undefined
  onClick: () => void
}): React.JSX.Element {
  return (
    <button className={`nav-item ${props.active ? "active" : ""}`} onClick={props.onClick}>
      <span className="nav-icon">{props.icon}</span>{props.label}
      {props.badge ? <span className="badge">{props.badge}</span> : null}
    </button>
  )
}

function SearchView(props: {
  query: string
  setQuery: (query: string) => void
  submitSearch: (event: FormEvent) => void
  hits: SearchHit[]
  searching: boolean
  hasLibrary: boolean
  onAddFolder: () => void
  onOpenHit: (hit: SearchHit) => void
}): React.JSX.Element {
  return (
    <section className="page search-page">
      <header className="page-header search-header">
        <p className="eyebrow">FIND THE MOMENT</p>
        <h1>Search what was said,<br />not just what was titled.</h1>
        <p>Search transcripts, people, places, and events across your local video library.</p>
      </header>
      <form className="search-box" onSubmit={props.submitSearch}>
        <span>⌕</span>
        <input
          autoFocus
          value={props.query}
          onChange={(event) => props.setQuery(event.target.value)}
          placeholder="e.g. death to Kalphite King"
        />
        <button type="submit" disabled={props.searching || !props.query.trim()}>
          {props.searching ? "Searching…" : "Search"}
        </button>
      </form>

      {!props.hasLibrary ? (
        <EmptyState
          title="Start with a folder of videos"
          body="Existing English subtitles become searchable first. Videos without subtitles are queued for private, local transcription."
          action="Add video folder"
          onAction={props.onAddFolder}
        />
      ) : props.hits.length > 0 ? (
        <div className="results">
          <div className="results-heading"><strong>{props.hits.length} moments</strong><span>Best matches first</span></div>
          {props.hits.map((hit) => (
            <button className="result-card" key={`${hit.mediaId}:${hit.startMs}`} onClick={() => props.onOpenHit(hit)}>
              <div className="result-time">{formatTimestamp(hit.startMs)}</div>
              <div className="result-body">
                <div className="result-title"><strong>{hit.title}</strong><span>{hit.availability}</span></div>
                {hit.summary && <p className="summary">{hit.summary}</p>}
                <p>{hit.transcriptExcerpt}</p>
                <div className="tags">
                  {hit.matchReasons.map((reason) => <span key={reason}>{reason}</span>)}
                  {hit.events.slice(0, 3).map((event) => <span key={event}>{event}</span>)}
                </div>
              </div>
              <span className="play-button">▶</span>
            </button>
          ))}
        </div>
      ) : props.query && !props.searching ? (
        <EmptyState title="No matching moments yet" body="Try fewer words, or wait for more of the indexing queue to finish." />
      ) : (
        <div className="search-hint-grid">
          <Hint title="Exact dialogue" example="“we finally got the drop”" />
          <Hint title="People and places" example="Kalphite King" />
          <Hint title="Described events" example="died during the boss fight" />
        </div>
      )}
    </section>
  )
}

function LibraryView(props: {
  folders: SourceFolder[]
  media: MediaAsset[]
  stats: LibraryStats
  onAddFolder: () => void
}): React.JSX.Element {
  return (
    <section className="page">
      <header className="page-title-row">
        <div><p className="eyebrow">YOUR ARCHIVE</p><h1>Library</h1><p>Videos stay exactly where they are.</p></div>
        <button className="primary-button" onClick={props.onAddFolder}>＋ Add folder</button>
      </header>
      <div className="stat-grid">
        <Stat value={props.stats.totalMedia.toLocaleString()} label="Videos" />
        <Stat value={formatDuration(props.stats.totalDurationMs)} label="Total runtime" />
        <Stat value={props.stats.searchableChunks.toLocaleString()} label="Searchable moments" />
        <Stat value={props.stats.missingMedia.toLocaleString()} label="Missing files" warning={props.stats.missingMedia > 0} />
      </div>
      <div className="panel">
        <div className="panel-header"><strong>Source folders</strong><span>{props.folders.length}</span></div>
        {props.folders.length === 0 ? <p className="muted padded">No folders added.</p> : props.folders.map((folder) => (
          <div className="folder-row" key={folder.id}>
            <span className="folder-icon">▰</span>
            <div><strong>{folder.path}</strong><small>{folder.availableMediaCount} available · {folder.missingMediaCount} missing</small></div>
            <span>{folder.lastScanAtMs ? `Scanned ${formatRelative(folder.lastScanAtMs)}` : "Scanning…"}</span>
          </div>
        ))}
      </div>
      <div className="panel media-panel">
        <div className="panel-header"><strong>Recently discovered</strong><span>Showing {props.media.length}</span></div>
        {props.media.map((item) => (
          <div className="media-row" key={item.id}>
            <span className="video-icon">▶</span>
            <div className="media-name"><strong>{item.displayName}</strong><small>{item.relativePath}</small></div>
            <span>{item.durationMs ? formatDuration(item.durationMs) : "—"}</span>
            <span className={`stage stage-${item.highestCompletedStage}`}>{item.highestCompletedStage}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function ActivityView(props: {
  jobs: Job[]
  stats: LibraryStats
  onRefresh: () => void
}): React.JSX.Element {
  const active = props.jobs.filter((job) => ["queued", "running", "paused", "failed"].includes(job.status))
  return (
    <section className="page">
      <header className="page-title-row">
        <div><p className="eyebrow">BACKGROUND WORK</p><h1>Activity</h1><p>Every stage is durable and safe to resume.</p></div>
        <div className="button-group">
          <button className="secondary-button" onClick={() => void window.vodSearch.jobs.pauseAll()}>Pause</button>
          <button className="primary-button" onClick={() => void window.vodSearch.jobs.resumeAll()}>Resume</button>
        </div>
      </header>
      <div className="stat-grid three">
        <Stat value={props.stats.runningJobs.toString()} label="Running" />
        <Stat value={props.stats.queuedJobs.toString()} label="Queued" />
        <Stat value={props.stats.failedJobs.toString()} label="Needs attention" warning={props.stats.failedJobs > 0} />
      </div>
      <div className="panel">
        <div className="panel-header"><strong>Processing queue</strong><button className="text-button" onClick={props.onRefresh}>Refresh</button></div>
        {active.length === 0 ? <p className="muted padded">Nothing is currently queued.</p> : active.map((job) => (
          <div className="job-row" key={job.id}>
            <span className={`job-state ${job.status}`} />
            <div><strong>{capitalize(job.stage)}</strong><small>{job.mediaId ?? "Library task"}</small></div>
            <div className="progress-track"><span style={{ width: `${Math.round(job.progress * 100)}%` }} /></div>
            <span>{job.status}</span>
          </div>
        ))}
      </div>
    </section>
  )
}

function SettingsView(): React.JSX.Element {
  const [models, setModels] = useState<ModelInstallation[]>([])
  const [modelError, setModelError] = useState<string | null>(null)

  const refresh = useCallback(async () => {
    setModels(await window.vodSearch.models.list())
  }, [])

  useEffect(() => {
    void refresh().catch((error) => setModelError(error instanceof Error ? error.message : String(error)))
    return window.vodSearch.events.onModelsChanged(() => {
      void refresh().catch((error) => setModelError(error instanceof Error ? error.message : String(error)))
    })
  }, [refresh])

  async function download(modelId: string): Promise<void> {
    setModelError(null)
    try { await window.vodSearch.models.download(modelId) }
    catch (error) { setModelError(error instanceof Error ? error.message : String(error)) }
    finally { await refresh() }
  }

  return (
    <section className="page">
      <header className="page-header"><p className="eyebrow">LOCAL BY DEFAULT</p><h1>Settings</h1><p>Control how much of your machine indexing may use.</p></header>
      <div className="settings-grid">
        <div className="panel setting-card">
          <div><strong>Resource mode</strong><p>Controls CPU threads and background concurrency.</p></div>
          <select defaultValue="normal" onChange={(event) => void window.vodSearch.jobs.setResourceMode(event.target.value as "low" | "normal" | "high")}>
            <option value="low">Low</option><option value="normal">Normal</option><option value="high">High</option>
          </select>
        </div>
        <div className="panel model-settings">
          <div className="panel-header"><strong>Local model pack</strong><span>{formatBytes(models.reduce((total, model) => total + model.sizeBytes, 0))}</span></div>
          {modelError && <p className="model-error">{modelError}</p>}
          {models.map((model) => (
            <div className="model-row" key={model.modelId}>
              <div><strong>{modelName(model.modelId)}</strong><small>{model.role} · {formatBytes(model.sizeBytes)}</small></div>
              {model.status === "downloading" ? (
                <div className="model-progress">
                  <span>{Math.round(model.bytesDownloaded / model.sizeBytes * 100)}%</span>
                  <button className="text-button" onClick={() => void window.vodSearch.models.cancelDownload(model.modelId)}>Cancel</button>
                </div>
              ) : model.status === "installed" ? (
                <span className="status-pill good">Installed</span>
              ) : (
                <button className="secondary-button" onClick={() => void download(model.modelId)}>Download</button>
              )}
            </div>
          ))}
        </div>
        <div className="panel setting-card">
          <div><strong>Network privacy</strong><p>Indexing and search are configured for local processing only.</p></div>
          <span className="status-pill good">Offline</span>
        </div>
      </div>
    </section>
  )
}

function PlayerDrawer(props: { hit: SearchHit; playbackUrl: string | null; onClose: () => void }): React.JSX.Element {
  return (
    <div className="drawer-backdrop" onMouseDown={(event) => event.target === event.currentTarget && props.onClose()}>
      <aside className="player-drawer">
        <div className="drawer-header"><div><strong>{props.hit.title}</strong><span>{formatTimestamp(props.hit.startMs)}</span></div><button onClick={props.onClose}>×</button></div>
        {props.playbackUrl ? (
          <video
            src={`${props.playbackUrl}#t=${Math.max(0, props.hit.startMs / 1000)}`}
            controls
            autoPlay
          />
        ) : <div className="unavailable-player">This source file is currently unavailable.</div>}
        <div className="drawer-copy">
          {props.hit.summary && <h3>{props.hit.summary}</h3>}
          <p>{props.hit.transcriptExcerpt}</p>
          <small>Transcript-derived result · timestamp is approximate</small>
        </div>
      </aside>
    </div>
  )
}

function EmptyState(props: { title: string; body: string; action?: string; onAction?: () => void }): React.JSX.Element {
  return <div className="empty-state"><div className="empty-icon">◫</div><h2>{props.title}</h2><p>{props.body}</p>{props.action && <button className="primary-button" onClick={props.onAction}>{props.action}</button>}</div>
}

function Hint(props: { title: string; example: string }): React.JSX.Element {
  return <div className="hint"><span>⌁</span><strong>{props.title}</strong><small>{props.example}</small></div>
}

function Stat(props: { value: string; label: string; warning?: boolean }): React.JSX.Element {
  return <div className={`stat ${props.warning ? "warning" : ""}`}><strong>{props.value}</strong><span>{props.label}</span></div>
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.floor(milliseconds / 1000)
  const hours = Math.floor(seconds / 3600)
  const minutes = Math.floor((seconds % 3600) / 60)
  const remainder = seconds % 60
  return hours > 0
    ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`
    : `${minutes}:${String(remainder).padStart(2, "0")}`
}

function formatDuration(milliseconds: number): string {
  const hours = milliseconds / 3_600_000
  if (hours >= 1) return `${hours.toLocaleString(undefined, { maximumFractionDigits: 1 })} hr`
  return `${Math.round(milliseconds / 60_000)} min`
}

function formatRelative(milliseconds: number): string {
  const minutes = Math.max(0, Math.round((Date.now() - milliseconds) / 60_000))
  if (minutes < 1) return "just now"
  if (minutes < 60) return `${minutes}m ago`
  return `${Math.round(minutes / 60)}h ago`
}

function capitalize(value: string): string {
  return value.charAt(0).toUpperCase() + value.slice(1)
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 ** 3) return `${(bytes / 1024 ** 3).toFixed(1)} GB`
  if (bytes >= 1024 ** 2) return `${Math.round(bytes / 1024 ** 2)} MB`
  return `${Math.round(bytes / 1024)} KB`
}

function modelName(modelId: string): string {
  const names: Record<string, string> = {
    "whisper-small-en": "Whisper small.en",
    "qwen3-4b-q4-k-m": "Qwen3 4B",
    "bge-small-en-v1.5": "BGE small English"
  }
  return names[modelId] ?? modelId
}
