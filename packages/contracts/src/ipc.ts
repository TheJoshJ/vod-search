import { z } from "zod"
import {
  jobSchema,
  libraryStatsSchema,
  mediaAssetSchema,
  mediaDetailSchema,
  modelInstallationSchema,
  resourceModeSchema,
  sourceFolderSchema
} from "./domain.js"
import { searchRequestSchema, searchResponseSchema } from "./search.js"

export const ipcChannels = {
  librarySelectFolder: "library:select-folder",
  libraryAddFolder: "library:add-folder",
  libraryListFolders: "library:list-folders",
  libraryListMedia: "library:list-media",
  libraryStats: "library:stats",
  searchQuery: "search:query",
  jobsList: "jobs:list",
  jobsPauseAll: "jobs:pause-all",
  jobsResumeAll: "jobs:resume-all",
  jobsSetResourceMode: "jobs:set-resource-mode",
  modelsList: "models:list",
  modelsDownload: "models:download",
  modelsCancelDownload: "models:cancel-download",
  mediaPlaybackSource: "media:playback-source",
  mediaDetail: "media:detail",
  eventLibraryChanged: "event:library-changed",
  eventJobsChanged: "event:jobs-changed",
  eventModelsChanged: "event:models-changed"
} as const

export const addFolderRequestSchema = z.object({ path: z.string().min(1) })
export const listMediaRequestSchema = z.object({
  sourceFolderId: z.string().optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(500).default(100)
})
export const mediaPlaybackRequestSchema = z.object({ mediaId: z.string().min(1) })
export const mediaPlaybackResponseSchema = z.object({
  url: z.string(),
  available: z.boolean()
})

export interface VodSearchApi {
  library: {
    selectFolder(): Promise<string | null>
    addFolder(path: string): Promise<z.infer<typeof sourceFolderSchema>>
    listFolders(): Promise<Array<z.infer<typeof sourceFolderSchema>>>
    listMedia(input?: z.input<typeof listMediaRequestSchema>): Promise<Array<z.infer<typeof mediaAssetSchema>>>
    stats(): Promise<z.infer<typeof libraryStatsSchema>>
  }
  search: {
    query(input: z.input<typeof searchRequestSchema>): Promise<z.infer<typeof searchResponseSchema>>
  }
  jobs: {
    list(): Promise<Array<z.infer<typeof jobSchema>>>
    pauseAll(): Promise<void>
    resumeAll(): Promise<void>
    setResourceMode(mode: z.infer<typeof resourceModeSchema>): Promise<void>
  }
  models: {
    list(): Promise<Array<z.infer<typeof modelInstallationSchema>>>
    download(modelId: string): Promise<void>
    cancelDownload(modelId: string): Promise<void>
  }
  media: {
    getPlaybackSource(mediaId: string): Promise<z.infer<typeof mediaPlaybackResponseSchema>>
    getDetail(mediaId: string): Promise<z.infer<typeof mediaDetailSchema>>
  }
  events: {
    onLibraryChanged(listener: () => void): () => void
    onJobsChanged(listener: () => void): () => void
    onModelsChanged(listener: () => void): () => void
  }
}
