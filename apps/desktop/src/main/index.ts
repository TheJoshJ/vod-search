import { join } from "node:path"
import { pathToFileURL } from "node:url"
import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  net,
  powerMonitor,
  protocol
} from "electron"
import {
  ipcChannels,
  listMediaRequestSchema,
  mediaPlaybackRequestSchema,
  resourceModeSchema,
  searchRequestSchema
} from "@vod-search/contracts"
import { IndexerClient } from "./indexer-client.js"

protocol.registerSchemesAsPrivileged([
  {
    scheme: "vod-media",
    privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true }
  }
])

const localAppData = process.env.LOCALAPPDATA
if (localAppData) app.setPath("userData", join(localAppData, "VOD Search"))

const indexer = new IndexerClient()
let mainWindow: BrowserWindow | null = null
let manuallyPaused = false
let pausedForBattery = false

app.whenReady().then(async () => {
  await indexer.start(
    join(app.getPath("userData"), "index", "vod-search.db"),
    join(app.getPath("userData"), "models"),
    process.resourcesPath
  )
  registerProtocol()
  registerIpc()
  registerPowerControls()
  createWindow()

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
    backgroundColor: "#0d1117",
    show: false,
    title: "VOD Search",
    webPreferences: {
      preload: join(__dirname, "../preload/index.mjs"),
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
  ipcMain.handle(ipcChannels.searchQuery, (_event, payload) =>
    indexer.request("search:query", searchRequestSchema.parse(payload)))
  ipcMain.handle(ipcChannels.jobsList, () => indexer.request("jobs:list"))
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
  ipcMain.handle(ipcChannels.modelsList, () => indexer.request("models:list"))
  ipcMain.handle(ipcChannels.modelsDownload, (_event, modelId) =>
    indexer.request("models:download", String(modelId), 24 * 60 * 60 * 1000))
  ipcMain.handle(ipcChannels.modelsCancelDownload, (_event, modelId) =>
    indexer.request("models:cancel-download", String(modelId)))
  ipcMain.handle(ipcChannels.mediaPlaybackSource, async (_event, payload) => {
    const { mediaId } = mediaPlaybackRequestSchema.parse(payload)
    const path = await indexer.request<string | null>("media:path", mediaId)
    return { url: path ? `vod-media://asset/${encodeURIComponent(mediaId)}` : "", available: Boolean(path) }
  })
}

function registerProtocol(): void {
  protocol.handle("vod-media", async (request) => {
    const url = new URL(request.url)
    const mediaId = decodeURIComponent(url.pathname.replace(/^\//, ""))
    const path = await indexer.request<string | null>("media:path", mediaId)
    if (!path) return new Response("Media unavailable", { status: 404 })
    return net.fetch(pathToFileURL(path).toString(), { headers: request.headers })
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
