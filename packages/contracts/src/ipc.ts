import { z } from "zod"
import {
  codexStatusSchema,
  jobSchema,
  libraryStatsSchema,
  mediaAssetSchema,
  mediaDetailSchema,
  modelInstallationSchema,
  resourceModeSchema,
  sourceFolderSchema
} from "./domain.js"
import { searchRequestSchema, searchResponseSchema } from "./search.js"
import { processingScheduleSchema } from "./schedule.js"

export const ipcChannels = {
  librarySelectFolder: "library:select-folder",
  libraryAddFolder: "library:add-folder",
  libraryListFolders: "library:list-folders",
  libraryListMedia: "library:list-media",
  libraryStats: "library:stats",
  librarySetFolderSharing: "library:set-folder-sharing",
  libraryRescanFolder: "library:rescan-folder",
  libraryRevealFolder: "library:reveal-folder",
  libraryRemoveFolder: "library:remove-folder",
  searchQuery: "search:query",
  jobsList: "jobs:list",
  jobsRetry: "jobs:retry",
  jobsPauseAll: "jobs:pause-all",
  jobsResumeAll: "jobs:resume-all",
  jobsSetResourceMode: "jobs:set-resource-mode",
  jobsGetProcessingSchedule: "jobs:get-processing-schedule",
  jobsSetProcessingSchedule: "jobs:set-processing-schedule",
  modelsList: "models:list",
  modelsDownload: "models:download",
  modelsCancelDownload: "models:cancel-download",
  codexStatus: "codex:status",
  codexInstall: "codex:install",
  codexLogin: "codex:login",
  mediaPlaybackSource: "media:playback-source",
  mediaDetail: "media:detail",
  mediaRevealInExplorer: "media:reveal-in-explorer",
  mediaOpenExternal: "media:open-external",
  mediaOpenExternalAt: "media:open-external-at",
  mediaExportClip: "media:export-clip",
  eventLibraryChanged: "event:library-changed",
  eventJobsChanged: "event:jobs-changed",
  eventModelsChanged: "event:models-changed",
  eventCodexChanged: "event:codex-changed"
} as const

export const addFolderRequestSchema = z.object({
  path: z.string().min(1),
  publishSharedMetadata: z.boolean().default(false)
})
export const setFolderSharingRequestSchema = z.object({
  folderId: z.string().uuid(),
  publishSharedMetadata: z.boolean()
})
export const sourceFolderRequestSchema = z.object({ folderId: z.string().min(1) })
export const listMediaRequestSchema = z.object({
  sourceFolderId: z.string().optional(),
  offset: z.number().int().nonnegative().default(0),
  limit: z.number().int().min(1).max(500).default(100)
})
export const mediaPlaybackRequestSchema = z.object({ mediaId: z.string().min(1) })
export const mediaExternalOpenRequestSchema = z.object({
  mediaId: z.string().min(1),
  startMs: z.number().int().nonnegative().optional()
})
export const mediaExternalOpenResponseSchema = z.object({
  mode: z.enum(["default-player", "timestamp-player", "generated-clip"]),
  playerName: z.string().nullable()
})
export const mediaExportClipRequestSchema = z.object({
  mediaId: z.string().min(1),
  startMs: z.number().int().nonnegative(),
  endMs: z.number().int().positive()
}).refine((input) => input.endMs > input.startMs && input.endMs - input.startMs <= 30 * 60_000, {
  message: "Clip duration must be between one millisecond and 30 minutes",
  path: ["endMs"]
})
export const mediaExportClipResponseSchema = z.object({ path: z.string().nullable() })
export const retryJobRequestSchema = z.object({ jobId: z.string().uuid() })
export const mediaPlaybackResponseSchema = z.object({
  url: z.string(),
  available: z.boolean()
})

export interface VodSearchApi {
  library: {
    selectFolder(): Promise<string | null>
    addFolder(path: string, publishSharedMetadata?: boolean): Promise<z.infer<typeof sourceFolderSchema>>
    listFolders(): Promise<Array<z.infer<typeof sourceFolderSchema>>>
    listMedia(input?: z.input<typeof listMediaRequestSchema>): Promise<Array<z.infer<typeof mediaAssetSchema>>>
    stats(): Promise<z.infer<typeof libraryStatsSchema>>
    setFolderSharing(folderId: string, publishSharedMetadata: boolean): Promise<z.infer<typeof sourceFolderSchema>>
    rescanFolder(folderId: string): Promise<void>
    revealFolder(folderId: string): Promise<void>
    removeFolder(folderId: string): Promise<void>
  }
  search: {
    query(input: z.input<typeof searchRequestSchema>): Promise<z.infer<typeof searchResponseSchema>>
  }
  jobs: {
    list(): Promise<Array<z.infer<typeof jobSchema>>>
    retry(jobId: string): Promise<void>
    pauseAll(): Promise<void>
    resumeAll(): Promise<void>
    setResourceMode(mode: z.infer<typeof resourceModeSchema>): Promise<void>
    getProcessingSchedule(): Promise<z.infer<typeof processingScheduleSchema>>
    setProcessingSchedule(schedule: z.infer<typeof processingScheduleSchema>): Promise<z.infer<typeof processingScheduleSchema>>
  }
  models: {
    list(): Promise<Array<z.infer<typeof modelInstallationSchema>>>
    download(modelId: string): Promise<void>
    cancelDownload(modelId: string): Promise<void>
  }
  codex: {
    status(): Promise<z.infer<typeof codexStatusSchema>>
    install(): Promise<z.infer<typeof codexStatusSchema>>
    login(): Promise<z.infer<typeof codexStatusSchema>>
  }
  media: {
    getPlaybackSource(mediaId: string): Promise<z.infer<typeof mediaPlaybackResponseSchema>>
    getDetail(mediaId: string): Promise<z.infer<typeof mediaDetailSchema>>
    revealInExplorer(mediaId: string): Promise<void>
    openExternal(mediaId: string): Promise<z.infer<typeof mediaExternalOpenResponseSchema>>
    openExternalAt(mediaId: string, startMs: number): Promise<z.infer<typeof mediaExternalOpenResponseSchema>>
    exportClip(mediaId: string, startMs: number, endMs: number): Promise<z.infer<typeof mediaExportClipResponseSchema>>
  }
  events: {
    onLibraryChanged(listener: () => void): () => void
    onJobsChanged(listener: () => void): () => void
    onModelsChanged(listener: () => void): () => void
    onCodexChanged(listener: () => void): () => void
  }
}
