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
    addFolder: (path) => ipcRenderer.invoke(ipcChannels.libraryAddFolder, { path }),
    listFolders: () => ipcRenderer.invoke(ipcChannels.libraryListFolders),
    listMedia: (input = {}) => ipcRenderer.invoke(ipcChannels.libraryListMedia, input),
    stats: () => ipcRenderer.invoke(ipcChannels.libraryStats)
  },
  search: {
    query: (input: SearchRequest) => ipcRenderer.invoke(ipcChannels.searchQuery, input)
  },
  jobs: {
    list: () => ipcRenderer.invoke(ipcChannels.jobsList),
    pauseAll: () => ipcRenderer.invoke(ipcChannels.jobsPauseAll),
    resumeAll: () => ipcRenderer.invoke(ipcChannels.jobsResumeAll),
    setResourceMode: (mode: ResourceMode) => ipcRenderer.invoke(ipcChannels.jobsSetResourceMode, mode)
  },
  models: {
    list: () => ipcRenderer.invoke(ipcChannels.modelsList),
    download: (modelId) => ipcRenderer.invoke(ipcChannels.modelsDownload, modelId),
    cancelDownload: (modelId) => ipcRenderer.invoke(ipcChannels.modelsCancelDownload, modelId)
  },
  media: {
    getPlaybackSource: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaPlaybackSource, { mediaId }),
    getDetail: (mediaId) => ipcRenderer.invoke(ipcChannels.mediaDetail, mediaId)
  },
  events: {
    onLibraryChanged: (listener) => subscribe(ipcChannels.eventLibraryChanged, listener),
    onJobsChanged: (listener) => subscribe(ipcChannels.eventJobsChanged, listener),
    onModelsChanged: (listener) => subscribe(ipcChannels.eventModelsChanged, listener)
  }
}

contextBridge.exposeInMainWorld("vodSearch", api)
