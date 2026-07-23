import { useCallback, useEffect, useState } from "react"
import {
  defaultProcessingSchedule,
  type CodexStatus,
  type Job,
  type MediaAsset,
  type ModelInstallation,
  type ProcessingSchedule,
  type ShortFormProject,
  type SpeakerReviewQueue,
  type SourceFolder
} from "@vod-search/contracts"
import { emptyStats, initialLibrarySearchState, type AppView, type LibrarySearchState, type Theme } from "@/app-types"
import { AppSidebar, ErrorNotice } from "@/components/app-shell"
import { MediaWorkspace, type MediaWorkspaceSelection } from "@/components/media-workspace"
import { ShortFormWorkspace } from "@/components/short-form-workspace"
import { ActivityWorkspace } from "@/features/activity/activity-workspace"
import { LibraryWorkspace } from "@/features/library/library-workspace"
import { SettingsWorkspace } from "@/features/settings/settings-workspace"
import { SpeakersWorkspace } from "@/features/speakers/speakers-workspace"

const checkingCodex: CodexStatus = {
  state: "checking",
  installed: false,
  authenticated: false,
  version: null,
  managed: false,
  error: null
}

const emptySpeakerReviewQueue: SpeakerReviewQueue = { items: [], profiles: [] }

export function App(): React.JSX.Element {
  const [view, setView] = useState<AppView>("library")
  const [folders, setFolders] = useState<SourceFolder[]>([])
  const [media, setMedia] = useState<MediaAsset[]>([])
  const [jobs, setJobs] = useState<Job[]>([])
  const [models, setModels] = useState<ModelInstallation[]>([])
  const [codex, setCodex] = useState<CodexStatus>(checkingCodex)
  const [stats, setStats] = useState(emptyStats)
  const [processingSchedule, setProcessingSchedule] = useState<ProcessingSchedule>(defaultProcessingSchedule)
  const [speakerReviewQueue, setSpeakerReviewQueue] = useState<SpeakerReviewQueue>(emptySpeakerReviewQueue)
  const [selection, setSelection] = useState<MediaWorkspaceSelection | null>(null)
  const [librarySearch, setLibrarySearch] = useState<LibrarySearchState>(initialLibrarySearchState)
  const [shortFormProject, setShortFormProject] = useState<ShortFormProject | null>(null)
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
  const refreshSpeakerReviewQueue = useCallback(async () => setSpeakerReviewQueue(await window.vodSearch.speakers.reviewQueue()), [])
  const showError = useCallback((reason: unknown): void => {
    setError(reason instanceof Error ? reason.message : String(reason))
  }, [])

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
    void refreshSpeakerReviewQueue().catch(showError)
    const removeLibraryListener = window.vodSearch.events.onLibraryChanged(() => {
      void refreshLibrary().catch(showError)
      void refreshSpeakerReviewQueue().catch(showError)
    })
    const removeJobsListener = window.vodSearch.events.onJobsChanged(() => {
      void refreshJobs().catch(showError)
      void refreshLibrary().catch(showError)
    })
    const removeModelsListener = window.vodSearch.events.onModelsChanged(() => void refreshModels().catch(showError))
    const removeCodexListener = window.vodSearch.events.onCodexChanged(() => void refreshCodex().catch(showError))
    return () => { removeLibraryListener(); removeJobsListener(); removeModelsListener(); removeCodexListener() }
  }, [refreshCodex, refreshJobs, refreshLibrary, refreshModels, refreshProcessingSchedule, refreshSpeakerReviewQueue, showError])

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
        if (model.status === "missing" || model.status === "invalid") await window.vodSearch.models.download(model.modelId)
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
        <div className="workspace-view">
          <MediaWorkspace selection={selection} onClose={() => setSelection(null)} onEditShort={(project) => { setShortFormProject(project); setSelection(null); setView("short-form") }} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen min-h-0 overflow-hidden bg-background font-sans text-foreground antialiased">
      <AppSidebar view={view} onViewChange={setView} stats={stats} unassignedSpeakerCount={speakerReviewQueue.items.length} theme={theme} onThemeChange={setTheme} />
      <main className="relative min-w-0 flex-1 overflow-hidden">
        <ErrorNotice error={error} onClose={() => setError(null)} />
        <div key={view} className="workspace-view">
          {view === "library" && <LibraryWorkspace folders={folders} media={media} stats={stats} models={models} codex={codex} processingSchedule={processingSchedule} onAddFolder={(publish) => void addFolder(publish)} onPrepareModels={() => void prepareLocalModels()} onOpenSettings={() => setView("settings")} onOpen={setSelection} onError={showError} searchState={librarySearch} setSearchState={setLibrarySearch} />}
          {view === "short-form" && <ShortFormWorkspace project={shortFormProject} onProjectChange={setShortFormProject} onOpenSource={setSelection} onError={showError} />}
          {view === "speakers" && <SpeakersWorkspace queue={speakerReviewQueue} onRefresh={refreshSpeakerReviewQueue} onOpen={(item) => setSelection({ mediaId: item.mediaId, title: item.mediaTitle, initialMs: item.sampleStartMs })} onError={showError} />}
          {view === "activity" && <ActivityWorkspace jobs={jobs} media={media} processingSchedule={processingSchedule} onProcessingScheduleChange={setProcessingSchedule} onError={showError} />}
          {view === "settings" && <SettingsWorkspace folders={folders} models={models} codex={codex} theme={theme} setTheme={setTheme} onAddFolder={() => void addFolder()} onRefreshLibrary={refreshLibrary} onRefreshModels={refreshModels} onRefreshCodex={refreshCodex} onError={showError} />}
        </div>
      </main>
    </div>
  )
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
