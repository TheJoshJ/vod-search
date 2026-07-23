import { contextBridge, ipcRenderer } from "electron"
import {
  ipcChannels,
  type ResourceMode,
  type SearchRequest,
  type VodSearchApi
} from "@vod-search/contracts"

function subscribe(channel: string, listener: () => void): () => void {
  const wrapped = (): void => listener()
  ipcRenderer.on(channel, wrapped)
  return () => ipcRenderer.removeListener(channel, wrapped)
}

const api: VodSearchApi = {
  library: {
    selectFolder: () => ipcRenderer.invoke(ipcChannels.librarySelectFolder),
    addFolder: (path, publishSharedMetadata = false) =>
      ipcRenderer.invoke(ipcChannels.libraryAddFolder, { path, publishSharedMetadata }),
    listFolders: () => ipcRenderer.invoke(ipcChannels.libraryListFolders),
    listMedia: (input = {}) => ipcRenderer.invoke(ipcChannels.libraryListMedia, input),
    stats: () => ipcRenderer.invoke(ipcChannels.libraryStats),
    setFolderSharing: (folderId, publishSharedMetadata) =>
      ipcRenderer.invoke(ipcChannels.librarySetFolderSharing, { folderId, publishSharedMetadata }),
    rescanFolder: (folderId) => ipcRenderer.invoke(ipcChannels.libraryRescanFolder, { folderId }),
    revealFolder: (folderId) => ipcRenderer.invoke(ipcChannels.libraryRevealFolder, { folderId }),
    removeFolder: (folderId) => ipcRenderer.invoke(ipcChannels.libraryRemoveFolder, { folderId })
  },
  clips: {
    getOutputFolder: () => ipcRenderer.invoke(ipcChannels.clipsGetOutputFolder),
    selectOutputFolder: () => ipcRenderer.invoke(ipcChannels.clipsSelectOutputFolder),
    revealOutputFolder: () => ipcRenderer.invoke(ipcChannels.clipsRevealOutputFolder)
  },
  search: {
    query: (input: SearchRequest) => ipcRenderer.invoke(ipcChannels.searchQuery, input)
  },
  shortForm: {
    export: (project) => ipcRenderer.invoke(ipcChannels.shortFormExport, project)
  },
  jobs: {
    list: () => ipcRenderer.invoke(ipcChannels.jobsList),
    retry: (jobId) => ipcRenderer.invoke(ipcChannels.jobsRetry, { jobId }),
    pauseAll: () => ipcRenderer.invoke(ipcChannels.jobsPauseAll),
    resumeAll: () => ipcRenderer.invoke(ipcChannels.jobsResumeAll),
    setResourceMode: (mode: ResourceMode) => ipcRenderer.invoke(ipcChannels.jobsSetResourceMode, mode),
    getProcessingSchedule: () => ipcRenderer.invoke(ipcChannels.jobsGetProcessingSchedule),
    setProcessingSchedule: (schedule) => ipcRenderer.invoke(ipcChannels.jobsSetProcessingSchedule, schedule)
  },
  models: {
    list: () => ipcRenderer.invoke(ipcChannels.modelsList),
    download: (modelId) => ipcRenderer.invoke(ipcChannels.modelsDownload, modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke(ipcChannels.modelsCancelDownload, modelId)
  },
  speakers: {
    status: () => ipcRenderer.invoke(ipcChannels.speakersStatus),
    reviewQueue: () => ipcRenderer.invoke(ipcChannels.speakersReviewQueue),
    createProfile: (mediaSpeakerId, name) =>
      ipcRenderer.invoke(ipcChannels.speakersCreateProfile, { mediaSpeakerId, name }),
    assignProfile: (mediaSpeakerId, profileId) =>
      ipcRenderer.invoke(ipcChannels.speakersAssignProfile, { mediaSpeakerId, profileId }),
    renameProfile: (profileId, name) =>
      ipcRenderer.invoke(ipcChannels.speakersRenameProfile, { profileId, name })
  },
  codex: {
    status: () => ipcRenderer.invoke(ipcChannels.codexStatus),
    install: () => ipcRenderer.invoke(ipcChannels.codexInstall),
    login: () => ipcRenderer.invoke(ipcChannels.codexLogin)
  },
  media: {
    getPlaybackSource: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaPlaybackSource, { mediaId }),
    getDetail: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaDetail, mediaId),
    revealInExplorer: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaRevealInExplorer, { mediaId }),
    openExternal: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaOpenExternal, { mediaId }),
    openExternalAt: (mediaId, startMs) => ipcRenderer.invoke(ipcChannels.mediaOpenExternalAt, { mediaId, startMs }),
    exportClip: (mediaId, startMs, endMs) => ipcRenderer.invoke(ipcChannels.mediaExportClip, { mediaId, startMs, endMs })
  },
  events: {
    onLibraryChanged: (listener) => subscribe(ipcChannels.eventLibraryChanged, listener),
    onJobsChanged: (listener) => subscribe(ipcChannels.eventJobsChanged, listener),
    onModelsChanged: (listener) => subscribe(ipcChannels.eventModelsChanged, listener),
    onCodexChanged: (listener) => subscribe(ipcChannels.eventCodexChanged, listener)
  }
}

contextBridge.exposeInMainWorld("vodSearch", api)
