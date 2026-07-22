import { basename, dirname, extname, join, resolve } from "node:path"
import { writeFile } from "node:fs/promises"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  powerMonitor,
  protocol,
  shell
} from "electron"
import {
  ipcChannels,
  listMediaRequestSchema,
  mediaExportClipRequestSchema,
  mediaExternalOpenRequestSchema,
  mediaPlaybackRequestSchema,
  processingScheduleSchema,
  resourceModeSchema,
  roughCutGenerateRequestSchema,
  roughCutPlanSchema,
  retryJobRequestSchema,
  searchRequestSchema,
  setFolderSharingRequestSchema,
  speakerAssignProfileRequestSchema,
  speakerCreateProfileRequestSchema,
  speakerRenameProfileRequestSchema,
  sourceFolderRequestSchema
} from "@vod-search/contracts"
import { buildPremiereXml, resequenceRoughCutPlan } from "@vod-search/rough-cut"
import { IndexerClient } from "./indexer-client.js"
import { CodexManager } from "./codex-manager.js"
import { serveMediaFile } from "./media-protocol.js"
import { exportMediaClip, openMediaAtTimestamp } from "./external-media.js"
import { registerAutoUpdates } from "./auto-update.js"

protocol.registerSchemesAsPrivileged([
  {
    scheme: "vod-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const localAppData = process.env.LOCALAPPDATA
if (localAppData) app.setPath("userData", join(localAppData, "VOD Search"))

const indexer = new IndexerClient()
let codex: CodexManager | null = null
let mainWindow: BrowserWindow | null = null
let manuallyPaused = false
let pausedForBattery = false
let runtimeResourcesPath = ""

app.whenReady().then(async () => {
  codex = new CodexManager(
    join(app.getPath("userData"), "tools", "codex", "bin"),
    () => {
      broadcast(ipcChannels.eventCodexChanged)
      void indexer.request("codex:refresh").catch(() => undefined)
    }
  )
  const resourcesPath = app.isPackaged
    ? process.resourcesPath
    : resolve(__dirname, "../../../..", "resources")
  runtimeResourcesPath = resourcesPath
  await indexer.start(
    join(app.getPath("userData"), "index", "vod-search.db"),
    join(app.getPath("userData"), "models"),
    resourcesPath,
    codex.managedExecutablePath,
    await codex.getIndexerBinding()
  )
  registerProtocol()
  registerIpc()
  registerPowerControls()
  createWindow()
  const stopAutoUpdates = registerAutoUpdates(app.isPackaged, () => mainWindow)
  app.once("will-quit", stopAutoUpdates)

  indexer.on("library-changed", () => broadcast(ipcChannels.eventLibraryChanged))
  indexer.on("jobs-changed", () => broadcast(ipcChannels.eventJobsChanged))
  indexer.on("models-changed", () => broadcast(ipcChannels.eventModelsChanged))

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on("window-all-closed", () => {
  if (process.platform !== "darwin") app.quit()
})

app.on("before-quit", () => indexer.stop())

function createWindow(): void {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 820,
    minWidth: 960,
    minHeight: 640,
    show: false,
    title: "VOD Search",
    webPreferences: {
      preload: join(__dirname, "../preload/index.cjs"),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true
    }
  })
  mainWindow.once("ready-to-show", () => mainWindow?.show())
  mainWindow.webContents.setWindowOpenHandler(() => ({ action: "deny" }))
  if (process.env.ELECTRON_RENDERER_URL) void mainWindow.loadURL(process.env.ELECTRON_RENDERER_URL)
  else void mainWindow.loadFile(join(__dirname, "../renderer/index.html"))
}

function registerIpc(): void {
  ipcMain.handle(ipcChannels.librarySelectFolder, async () => {
    const result = await dialog.showOpenDialog({ properties: ["openDirectory"] })
    return result.canceled ? null : result.filePaths[0] ?? null
  })
  ipcMain.handle(ipcChannels.libraryAddFolder, (_event, payload) =>
    indexer.request("library:add-folder", payload))
  ipcMain.handle(ipcChannels.libraryListFolders, () =>
    indexer.request("library:list-folders"))
  ipcMain.handle(ipcChannels.libraryListMedia, (_event, payload) =>
    indexer.request("library:list-media", listMediaRequestSchema.parse(payload ?? {})))
  ipcMain.handle(ipcChannels.libraryStats, () => indexer.request("library:stats"))
  ipcMain.handle(ipcChannels.librarySetFolderSharing, (_event, payload) =>
    indexer.request("library:set-folder-sharing", setFolderSharingRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.libraryRescanFolder, (_event, payload) => {
    const { folderId } = sourceFolderRequestSchema.parse(payload)
    return indexer.request("library:rescan", folderId)
  })
  ipcMain.handle(ipcChannels.libraryRevealFolder, async (_event, payload) => {
    const { folderId } = sourceFolderRequestSchema.parse(payload)
    const folder = await indexer.request<{ path: string }>("library:get-folder", folderId)
    const openError = await shell.openPath(folder.path)
    if (openError) throw new Error(openError)
  })
  ipcMain.handle(ipcChannels.libraryRemoveFolder, (_event, payload) => {
    const { folderId } = sourceFolderRequestSchema.parse(payload)
    return indexer.request("library:remove-folder", folderId)
  })
  ipcMain.handle(ipcChannels.searchQuery, (_event, payload) =>
    indexer.request("search:query", searchRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.roughCutGenerate, (_event, payload) =>
    indexer.request("rough-cut:generate", roughCutGenerateRequestSchema.parse(payload), 10 * 60_000))
  ipcMain.handle(ipcChannels.roughCutExport, async (_event, payload) => {
    const requestedPlan = roughCutPlanSchema.parse(payload)
    const currentPaths = new Map<string, string>()
    for (const mediaId of new Set(requestedPlan.items.map((item) => item.mediaId))) {
      currentPaths.set(mediaId, await requireMediaPath(mediaId))
    }
    const plan = resequenceRoughCutPlan({
      ...requestedPlan,
      items: requestedPlan.items.map((item) => ({ ...item, sourcePath: currentPaths.get(item.mediaId)! }))
    })
    const defaultPath = join(app.getPath("documents"), `${safeFileName(plan.title)}.xml`)
    const result = await dialog.showSaveDialog({
      title: "Export Premiere rough cut",
      defaultPath,
      filters: [{ name: "Final Cut Pro 7 XML", extensions: ["xml"] }]
    })
    if (result.canceled || !result.filePath) return { xmlPath: null, jsonPath: null }
    const xmlPath = extname(result.filePath).toLocaleLowerCase("en-US") === ".xml"
      ? result.filePath
      : `${result.filePath}.xml`
    const jsonPath = `${xmlPath.slice(0, -4)}.roughcut.json`
    await Promise.all([
      writeFile(xmlPath, buildPremiereXml(plan), "utf8"),
      writeFile(jsonPath, `${JSON.stringify(plan, null, 2)}\n`, "utf8")
    ])
    shell.showItemInFolder(xmlPath)
    return { xmlPath, jsonPath }
  })
  ipcMain.handle(ipcChannels.jobsList, () => indexer.request("jobs:list"))
  ipcMain.handle(ipcChannels.jobsRetry, (_event, payload) => {
    const { jobId } = retryJobRequestSchema.parse(payload)
    return indexer.request("jobs:retry", jobId)
  })
  ipcMain.handle(ipcChannels.jobsPauseAll, async () => {
    manuallyPaused = true
    await indexer.request("jobs:pause-all")
  })
  ipcMain.handle(ipcChannels.jobsResumeAll, async () => {
    manuallyPaused = false
    pausedForBattery = false
    await indexer.request("jobs:resume-all")
  })
  ipcMain.handle(ipcChannels.jobsSetResourceMode, (_event, payload) =>
    indexer.request("jobs:set-resource-mode", resourceModeSchema.parse(payload)))
  ipcMain.handle(ipcChannels.jobsGetProcessingSchedule, () =>
    indexer.request("jobs:get-processing-schedule"))
  ipcMain.handle(ipcChannels.jobsSetProcessingSchedule, (_event, payload) =>
    indexer.request("jobs:set-processing-schedule", processingScheduleSchema.parse(payload)))
  ipcMain.handle(ipcChannels.modelsList, () => indexer.request("models:list"))
  ipcMain.handle(ipcChannels.modelsDownload, (_event, modelId) =>
    indexer.request("models:download", String(modelId), 24 * 60 * 60 * 1000))
  ipcMain.handle(ipcChannels.modelsCancelDownload, (_event, modelId) =>
    indexer.request("models:cancel-download", String(modelId)))
  ipcMain.handle(ipcChannels.speakersStatus, () => indexer.request("speakers:status"))
  ipcMain.handle(ipcChannels.speakersReviewQueue, () => indexer.request("speakers:review-queue"))
  ipcMain.handle(ipcChannels.speakersCreateProfile, (_event, payload) =>
    indexer.request("speakers:create-profile", speakerCreateProfileRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.speakersAssignProfile, (_event, payload) =>
    indexer.request("speakers:assign-profile", speakerAssignProfileRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.speakersRenameProfile, (_event, payload) =>
    indexer.request("speakers:rename-profile", speakerRenameProfileRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.codexStatus, () => requireCodexManager().status())
  ipcMain.handle(ipcChannels.codexInstall, () => requireCodexManager().install())
  ipcMain.handle(ipcChannels.codexLogin, () => requireCodexManager().login())
  ipcMain.handle(ipcChannels.mediaPlaybackSource, async (_event, payload) => {
    const { mediaId } = mediaPlaybackRequestSchema.parse(payload)
    const path = await indexer.request<string | null>("media:path", mediaId)
    return { url: path ? `vod-media://asset/${encodeURIComponent(mediaId)}` : "", available: Boolean(path) }
  })
  ipcMain.handle(ipcChannels.mediaDetail, (_event, mediaId) =>
    indexer.request("media:detail", String(mediaId)))
  ipcMain.handle(ipcChannels.mediaRevealInExplorer, async (_event, payload) => {
    const { mediaId } = mediaPlaybackRequestSchema.parse(payload)
    shell.showItemInFolder(await requireMediaPath(mediaId))
  })
  ipcMain.handle(ipcChannels.mediaOpenExternal, async (_event, payload) => {
    const { mediaId } = mediaExternalOpenRequestSchema.parse(payload)
    const openError = await shell.openPath(await requireMediaPath(mediaId))
    if (openError) throw new Error(openError)
    return { mode: "default-player" as const, playerName: null }
  })
  ipcMain.handle(ipcChannels.mediaOpenExternalAt, async (_event, payload) => {
    const { mediaId, startMs } = mediaExternalOpenRequestSchema.parse(payload)
    if (startMs === undefined) throw new Error("A timestamp is required")
    return openMediaAtTimestamp({
      sourcePath: await requireMediaPath(mediaId),
      mediaId,
      startMs,
      resourcesPath: runtimeResourcesPath,
      temporaryPath: app.getPath("temp"),
      openPath: (path) => shell.openPath(path)
    })
  })
  ipcMain.handle(ipcChannels.mediaExportClip, async (_event, payload) => {
    const { mediaId, startMs, endMs } = mediaExportClipRequestSchema.parse(payload)
    const sourcePath = await requireMediaPath(mediaId)
    const extension = extname(sourcePath)
    const defaultPath = join(
      dirname(sourcePath),
      `${basename(sourcePath, extension)}-${fileTimestamp(startMs)}.mp4`
    )
    const result = await dialog.showSaveDialog({
      title: "Export video clip",
      defaultPath,
      filters: [{ name: "MP4 video", extensions: ["mp4"] }]
    })
    if (result.canceled || !result.filePath) return { path: null }
    await exportMediaClip({
      sourcePath,
      outputPath: result.filePath,
      startMs,
      endMs,
      resourcesPath: runtimeResourcesPath
    })
    shell.showItemInFolder(result.filePath)
    return { path: result.filePath }
  })
}

function fileTimestamp(milliseconds: number): string {
  const totalSeconds = Math.max(0, Math.floor(milliseconds / 1000))
  const hours = Math.floor(totalSeconds / 3600)
  const minutes = Math.floor(totalSeconds % 3600 / 60)
  const seconds = totalSeconds % 60
  return [hours, minutes, seconds].map((part) => String(part).padStart(2, "0")).join("-")
}

function safeFileName(value: string): string {
  const normalized = value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, "-").replace(/\s+/g, " ").trim()
  return (normalized || "VOD Search rough cut").slice(0, 120)
}

async function requireMediaPath(mediaId: string): Promise<string> {
  const path = await indexer.request<string | null>("media:path", mediaId)
  if (!path) throw new Error("The source video is currently unavailable")
  return path
}

function requireCodexManager(): CodexManager {
  if (!codex) throw new Error("Codex manager is not ready")
  return codex
}

function registerProtocol(): void {
  protocol.handle("vod-media", async (request) => {
    const url = new URL(request.url)
    const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ""))
    const path = await indexer.request<string | null>("media:path", mediaId)
    if (!path) return new Response("Media unavailable", { status: 404 })
    return serveMediaFile(path, request)
  })
}

function registerPowerControls(): void {
  powerMonitor.on("on-battery", () => {
    if (manuallyPaused) return
    pausedForBattery = true
    void indexer.request("jobs:pause-all")
  })
  powerMonitor.on("on-ac", () => {
    if (!pausedForBattery || manuallyPaused) return
    pausedForBattery = false
    void indexer.request("jobs:resume-all")
  })
}

function broadcast(channel: string): void {
  for (const window of BrowserWindow.getAllWindows()) window.webContents.send(channel)
}
