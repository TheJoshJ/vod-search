import { availableParallelism } from "node:os"
import { dirname, extname, join, resolve } from "node:path"
import { access, mkdir } from "node:fs/promises"
import { openDatabase, Repository } from "@vod-search/database"
import {
  addFolderRequestSchema,
  listMediaRequestSchema,
  resourceModeSchema,
  searchRequestSchema
} from "@vod-search/contracts"
import { chunkTranscript, parseSubtitle, SearchService } from "@vod-search/search"
import {
  BgeEmbedder,
  CODEX_ENRICHMENT_VERSION,
  CodexEnricher,
  extractEmbeddedSubtitle,
  MAX_CODEX_ENRICHMENT_CHARACTERS,
  MAX_CODEX_ENRICHMENT_CHUNKS,
  ModelManager,
  probeMedia,
  transcribeWithWhisper
} from "@vod-search/inference"
import { scanSourceFolder } from "./scanner.js"
import { watch, type FSWatcher } from "chokidar"

interface RpcRequest {
  type: "request"
  id: string
  method: string
  payload: unknown
}

const databasePath = process.env.VOD_SEARCH_DB_PATH
if (!databasePath) throw new Error("VOD_SEARCH_DB_PATH is required")
await mkdir(dirname(databasePath), { recursive: true })
const database = openDatabase(databasePath)
const repository = new Repository(database.db)
const search = new SearchService(repository)
const modelsPathFromEnvironment = process.env.VOD_SEARCH_MODELS_PATH
if (!modelsPathFromEnvironment) throw new Error("VOD_SEARCH_MODELS_PATH is required")
const modelsPath: string = modelsPathFromEnvironment
const models = new ModelManager(modelsPath, undefined, notifyModelsChanged)
repository.recoverRunningJobs()
let embedder: BgeEmbedder | null = null
let embedderStarting: Promise<BgeEmbedder | null> | null = null
let enricher: CodexEnricher | null = null
let nextEnricherAttemptAt = 0
let schedulerRunning = false

const activeScans = new Map<string, Promise<void>>()
const folderWatchers = new Map<string, FSWatcher>()
const rescanTimers = new Map<string, NodeJS.Timeout>()
const rescanRequested = new Set<string>()

process.parentPort.on("message", (event) => {
  const message = event.data as RpcRequest
  if (message.type !== "request") return
  void handleRequest(message)
})

process.parentPort.postMessage({ type: "event", name: "ready" })
for (const folder of repository.listSourceFolders()) {
  ensureFolderWatcher(folder.id, folder.path)
  startFolderScan(folder.id, folder.path)
}

async function handleRequest(request: RpcRequest): Promise<void> {
  try {
    const result = await dispatch(request.method, request.payload)
    process.parentPort.postMessage({ type: "response", id: request.id, result })
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    process.parentPort.postMessage({ type: "response", id: request.id, error: message })
  }
}

async function dispatch(method: string, payload: unknown): Promise<unknown> {
  switch (method) {
    case "library:add-folder": {
      const input = addFolderRequestSchema.parse(payload)
      const canonicalPath = resolve(input.path)
      const folder = repository.addSourceFolder(input.path, canonicalPath)
      ensureFolderWatcher(folder.id, folder.path)
      startFolderScan(folder.id, folder.path)
      return folder
    }
    case "library:list-folders": return repository.listSourceFolders()
    case "library:list-media": return repository.listMedia(listMediaRequestSchema.parse(payload))
    case "library:stats": return repository.getStats()
    case "library:rescan": {
      const id = String(payload)
      const folder = repository.getSourceFolder(id)
      startFolderScan(id, folder.path)
      return undefined
    }
    case "search:query": {
      const input = searchRequestSchema.parse(payload)
      const activeEmbedder = input.mode === "keyword" ? null : await getEmbedder()
      const queryEmbedding = activeEmbedder ? await activeEmbedder.embedQuery(input.query) : undefined
      return search.search(input, queryEmbedding)
    }
    case "jobs:list": return repository.listJobs()
    case "jobs:pause-all": repository.pauseAllJobs(); notifyJobsChanged(); return undefined
    case "jobs:resume-all": repository.resumeAllJobs(); notifyJobsChanged(); return undefined
    case "jobs:set-resource-mode": repository.setResourceMode(resourceModeSchema.parse(payload)); return undefined
    case "models:list": return models.list()
    case "models:download": await models.install(String(payload)); return undefined
    case "models:cancel-download": models.cancel(String(payload)); return undefined
    case "codex:refresh": {
      enricher = null
      nextEnricherAttemptAt = 0
      for (const job of repository.listJobs()) {
        if (job.mediaId && job.stage === "enrich" && job.status === "failed") {
          repository.requeueJob(job.mediaId, "enrich")
        }
      }
      notifyJobsChanged()
      return undefined
    }
    case "media:path": return repository.getMediaPath(String(payload))
    case "media:detail": {
      const mediaId = String(payload)
      return {
        media: repository.getMedia(mediaId),
        transcript: repository.getTranscript(mediaId),
        summaries: repository.getMediaSummaries(mediaId)
      }
    }
    default: throw new Error(`Unknown indexer method: ${method}`)
  }
}

function notifyLibraryChanged(): void {
  process.parentPort.postMessage({ type: "event", name: "library-changed" })
}

function notifyJobsChanged(): void {
  process.parentPort.postMessage({ type: "event", name: "jobs-changed" })
}

function notifyModelsChanged(): void {
  process.parentPort.postMessage({ type: "event", name: "models-changed" })
}

function createThrottledNotification(callback: () => void, intervalMs: number): () => void {
  let lastRunAt = 0
  return () => {
    const now = Date.now()
    if (now - lastRunAt < intervalMs) return
    lastRunAt = now
    callback()
  }
}

process.on("exit", () => {
  database.close()
  for (const timer of rescanTimers.values()) clearTimeout(timer)
  for (const watcher of folderWatchers.values()) void watcher.close()
})

setInterval(() => { void runSchedulerTick() }, 750).unref()

async function runSchedulerTick(): Promise<void> {
  if (schedulerRunning) return
  schedulerRunning = true
  try {
    const installations = await models.list()
    const ffprobePath = await findRuntimeExecutable("ffprobe")
    const ffmpegPath = await findRuntimeExecutable("ffmpeg")
    const transcriptionRuntime = await getTranscriptionRuntime(installations, ffmpegPath)
    const hasEmbeddingModel = installations.some((model) =>
      model.modelId === "bge-small-en-v1.5" && model.status === "installed")
    const activeEnricher = await getEnricher()
    const availableStages = [
      ...(ffprobePath ? ["probe" as const] : []),
      ...(transcriptionRuntime ? ["transcribe" as const] : []),
      ...(hasEmbeddingModel ? ["embed" as const] : []),
      ...(activeEnricher ? ["enrich" as const] : [])
    ]
    if (availableStages.length === 0) return
    const job = repository.claimNextJob(availableStages)
    if (!job?.mediaId) return
    notifyJobsChanged()
    try {
      if (job.stage === "probe" && ffprobePath) {
        await runProbeJob(job.id, job.mediaId, ffprobePath, ffmpegPath)
      } else if (job.stage === "transcribe" && transcriptionRuntime) {
        await runTranscriptionJob(job.id, job.mediaId, transcriptionRuntime)
      } else if (job.stage === "embed") {
        const activeEmbedder = await getEmbedder()
        if (!activeEmbedder) throw new Error("The embedding model is not installed")
        await runEmbeddingJob(job.id, job.mediaId, activeEmbedder)
      } else if (job.stage === "enrich") {
        if (!activeEnricher) throw new Error("Codex CLI is not installed and signed in")
        await runEnrichmentJob(job.id, job.mediaId, activeEnricher)
      }
    } catch (error) {
      repository.updateJob(job.id, {
        status: "failed",
        error: error instanceof Error ? error.message : String(error)
      })
    }
  } finally {
    schedulerRunning = false
    notifyJobsChanged()
  }
}

interface TranscriptionRuntime {
  ffmpegPath: string
  whisperPath: string
  modelPath: string
  modelVersion: string
}

async function getTranscriptionRuntime(
  installations: Awaited<ReturnType<ModelManager["list"]>>,
  ffmpegPath: string | null
): Promise<TranscriptionRuntime | null> {
  if (!ffmpegPath) return null
  const installation = installations.find((model) => model.modelId === "whisper-small-en")
  if (installation?.status !== "installed") return null
  const whisperPath = await findRuntimeExecutable("whisper-cli")
  const modelPath = models.getInstalledFile("whisper-small-en", "ggml-small.en.bin")
  if (!whisperPath || !modelPath) return null
  return { ffmpegPath, whisperPath, modelPath, modelVersion: installation.version }
}

async function getEmbedder(): Promise<BgeEmbedder | null> {
  if (embedder) return embedder
  if (embedderStarting) return embedderStarting
  embedderStarting = (async () => {
    const installation = (await models.list()).find((model) => model.modelId === "bge-small-en-v1.5")
    if (installation?.status !== "installed" || !installation.path) return null
    const instance = new BgeEmbedder(installation.path)
    await instance.start()
    embedder = instance
    return instance
  })().finally(() => { embedderStarting = null })
  return embedderStarting
}

async function getEnricher(): Promise<CodexEnricher | null> {
  if (enricher) return enricher
  if (Date.now() < nextEnricherAttemptAt) return null
  try {
    const instance = new CodexEnricher()
    await instance.start({
      workspacePath: join(dirname(modelsPath), "codex-workspace"),
      executablePath: await findCodexExecutable()
    })
    const status = await instance.probe()
    if (!status.installed || !status.authenticated) {
      nextEnricherAttemptAt = Date.now() + 30_000
      return null
    }
    enricher = instance
    return instance
  } catch (error) {
    nextEnricherAttemptAt = Date.now() + 30_000
    console.error("Codex enrichment could not start:", error)
    return null
  }
}

async function runProbeJob(
  jobId: string,
  mediaId: string,
  ffprobePath: string,
  ffmpegPath: string | null
): Promise<void> {
  const mediaPath = repository.getMediaPath(mediaId)
  if (!mediaPath) throw new Error("The media file is no longer available")
  const metadata = await probeMedia(ffprobePath, mediaPath)
  repository.updateMediaProbe(mediaId, metadata)
  repository.updateJob(jobId, { progress: 0.5 })

  if (ffmpegPath && metadata.subtitles.length > 0 && repository.getTranscriptVersion(mediaId) === null) {
    const subtitle = preferredSubtitle(metadata.subtitles)
    try {
      const content = await extractEmbeddedSubtitle(ffmpegPath, mediaPath, subtitle.streamIndex)
      const segments = parseSubtitle(content, ".srt")
      if (segments.length > 0) {
        const media = repository.getMedia(mediaId)
        repository.replaceTranscript(
          mediaId,
          "embedded",
          `embedded-v1:${media.quickFingerprint}:${subtitle.streamIndex}`,
          segments
        )
        repository.replaceChunks(mediaId, "chunk-v1", chunkTranscript(segments))
        repository.requeueJob(mediaId, "embed")
        repository.requeueJob(mediaId, "enrich")
        repository.cancelJob(mediaId, "transcribe")
      }
    } catch (error) {
      console.warn(`Embedded subtitles could not be extracted for ${mediaPath}; Whisper will be used instead.`, error)
    }
  }

  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  notifyLibraryChanged()
}

async function runTranscriptionJob(
  jobId: string,
  mediaId: string,
  runtime: TranscriptionRuntime
): Promise<void> {
  const mediaPath = repository.getMediaPath(mediaId)
  if (!mediaPath) throw new Error("The media file is no longer available")
  const media = repository.getMedia(mediaId)
  const version = `whisper-small-en:${runtime.modelVersion}:${media.quickFingerprint}`
  const existingVersion = repository.getTranscriptVersion(mediaId)
  if (existingVersion === version || existingVersion?.startsWith("sidecar-") || existingVersion?.startsWith("embedded-")) {
    repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
    return
  }

  const segments = await transcribeWithWhisper({
    ffmpegPath: runtime.ffmpegPath,
    whisperPath: runtime.whisperPath,
    modelPath: runtime.modelPath,
    mediaPath,
    threads: transcriptionThreads(repository.getResourceMode()),
    onProgress: (progress) => {
      repository.updateJob(jobId, { progress: Math.max(0.02, Math.min(0.95, progress)) })
      notifyJobsChanged()
    }
  })
  if (segments.length === 0) throw new Error("Whisper produced an empty transcript")

  if (repository.getMedia(mediaId).quickFingerprint !== media.quickFingerprint) {
    repository.requeueJob(mediaId, "transcribe")
    return
  }
  const currentVersion = repository.getTranscriptVersion(mediaId)
  if (!currentVersion?.startsWith("sidecar-") && !currentVersion?.startsWith("embedded-")) {
    repository.replaceTranscript(mediaId, "whisper", version, segments)
    repository.setMediaStage(mediaId, "transcribed")
    repository.replaceChunks(mediaId, "chunk-v1", chunkTranscript(segments))
    repository.requeueJob(mediaId, "embed")
    repository.requeueJob(mediaId, "enrich")
  }
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  notifyLibraryChanged()
}

function preferredSubtitle(
  subtitles: Array<{ streamIndex: number; language: string | null; title: string | null }>
): { streamIndex: number; language: string | null; title: string | null } {
  return subtitles.find((subtitle) => /^(en|eng|english)$/i.test(subtitle.language ?? "")) ?? subtitles[0]!
}

function transcriptionThreads(mode: "low" | "normal" | "high"): number {
  const cores = Math.max(1, availableParallelism())
  if (mode === "low") return Math.min(2, cores)
  if (mode === "high") return Math.max(1, cores - 1)
  return Math.max(1, Math.min(6, Math.ceil(cores / 2)))
}

async function runEmbeddingJob(jobId: string, mediaId: string, activeEmbedder: BgeEmbedder): Promise<void> {
  const chunks = repository.getChunksForEmbedding(mediaId)
  const chunkIds = chunks.map((chunk) => chunk.id)
  let completed = 0
  for (let index = 0; index < chunks.length; index += 32) {
    const batch = chunks.slice(index, index + 32)
    const embeddings = await activeEmbedder.embedPassages(batch.map(embeddingText))
    if (!repository.areCurrentChunks(mediaId, chunkIds)) {
      repository.requeueJob(mediaId, "embed")
      return
    }
    repository.storeEmbeddings(
      batch.map((chunk, batchIndex) => ({ chunkId: chunk.id, embedding: embeddings[batchIndex]! })),
      "bge-small-en-v1.5:v1"
    )
    completed += batch.length
    repository.updateJob(jobId, { progress: chunks.length ? completed / chunks.length : 1 })
    notifyJobsChanged()
  }
  if (!repository.areCurrentChunks(mediaId, chunkIds)) {
    repository.requeueJob(mediaId, "embed")
    return
  }
  repository.finishEmbedding(mediaId)
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  notifyLibraryChanged()
}

async function runEnrichmentJob(jobId: string, mediaId: string, activeEnricher: CodexEnricher): Promise<void> {
  const chunks = repository.getChunksForEnrichment(mediaId)
  const chunkIds = chunks.map((chunk) => chunk.id)
  let completed = 0
  for (let index = 0; index < chunks.length;) {
    const batch = [] as typeof chunks
    let characters = 0
    while (index < chunks.length && batch.length < MAX_CODEX_ENRICHMENT_CHUNKS) {
      const candidate = chunks[index]!
      if (batch.length > 0 && characters + candidate.transcript.length > MAX_CODEX_ENRICHMENT_CHARACTERS) break
      batch.push(candidate)
      characters += candidate.transcript.length
      index += 1
    }
    const result = await activeEnricher.enrich(batch.map((chunk) => ({
      chunkId: chunk.id,
      startMs: chunk.startMs,
      endMs: chunk.endMs,
      transcript: chunk.transcript
    })))
    if (!repository.areCurrentChunks(mediaId, chunkIds)) {
      repository.requeueJob(mediaId, "enrich")
      return
    }
    repository.applyEnrichments(mediaId, result, CODEX_ENRICHMENT_VERSION)
    completed += batch.length
    repository.updateJob(jobId, { progress: chunks.length ? completed / chunks.length : 1 })
    notifyJobsChanged()
  }
  repository.setMediaStage(mediaId, "enriched")
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  repository.requeueJob(mediaId, "embed")
  notifyLibraryChanged()
}

type RuntimeExecutable = "ffmpeg" | "ffprobe" | "whisper-cli"

async function findRuntimeExecutable(name: RuntimeExecutable): Promise<string | null> {
  const override = {
    ffmpeg: process.env.VOD_SEARCH_FFMPEG_PATH,
    ffprobe: process.env.VOD_SEARCH_FFPROBE_PATH,
    "whisper-cli": process.env.VOD_SEARCH_WHISPER_PATH
  }[name]
  const resourcesPath = process.env.VOD_SEARCH_RESOURCES_PATH
  const packagedRelativePath = name === "whisper-cli"
    ? join("runtime", "windows", "whisper", "Release", "whisper-cli.exe")
    : join("runtime", "windows", "ffmpeg", "bin", `${name}.exe`)
  const candidates = [
    override,
    resourcesPath ? join(resourcesPath, packagedRelativePath) : undefined,
    resourcesPath ? join(resourcesPath, "runtime", process.platform, name) : undefined
  ].filter((value): value is string => Boolean(value))
  for (const candidate of candidates) {
    try { await access(candidate); return candidate } catch { /* Continue to the next runtime location. */ }
  }
  return null
}

async function findCodexExecutable(): Promise<string> {
  const candidates = [process.env.VOD_SEARCH_CODEX_PATH, process.env.VOD_SEARCH_CODEX_MANAGED_PATH]
  for (const candidate of candidates) {
    if (!candidate) continue
    try { await access(candidate); return candidate } catch { /* Try the next Codex location. */ }
  }
  return process.platform === "win32" ? "codex.exe" : "codex"
}

function embeddingText(chunk: ReturnType<Repository["getChunksForEmbedding"]>[number]): string {
  return [
    chunk.summary ?? "",
    chunk.transcript,
    safeJsonText(chunk.entitiesJson),
    safeJsonText(chunk.eventsJson),
    safeJsonText(chunk.aliasesJson),
    safeJsonText(chunk.searchPhrasesJson)
  ].filter(Boolean).join("\n")
}

function safeJsonText(value: string): string {
  try {
    const parsed: unknown = JSON.parse(value)
    if (!Array.isArray(parsed)) return ""
    return parsed.map((item) => typeof item === "string" ? item : Object.values(item as object).join(" ")).join(" ")
  } catch {
    return ""
  }
}

function startFolderScan(folderId: string, path: string): void {
  if (activeScans.has(folderId)) {
    rescanRequested.add(folderId)
    return
  }
  const scan = scanSourceFolder(repository, folderId, path, {
    onProgress: createThrottledNotification(notifyLibraryChanged, 500)
  }).catch((error) => {
    console.error(`Failed to scan source folder ${path}:`, error)
  }).finally(() => {
    activeScans.delete(folderId)
    notifyLibraryChanged()
    notifyJobsChanged()
    if (rescanRequested.delete(folderId)) startFolderScan(folderId, path)
  })
  activeScans.set(folderId, scan)
}

function ensureFolderWatcher(folderId: string, path: string): void {
  if (folderWatchers.has(folderId)) return
  const watcher = watch(path, {
    ignoreInitial: true,
    persistent: true,
    awaitWriteFinish: { stabilityThreshold: 1_500, pollInterval: 100 },
    followSymlinks: false
  })
  const changed = (changedPath: string): void => {
    if (!isRelevantLibraryPath(changedPath)) return
    const previous = rescanTimers.get(folderId)
    if (previous) clearTimeout(previous)
    const timer = setTimeout(() => {
      rescanTimers.delete(folderId)
      startFolderScan(folderId, path)
    }, 2_000)
    rescanTimers.set(folderId, timer)
  }
  watcher.on("add", changed).on("change", changed).on("unlink", changed)
  watcher.on("error", (error) => console.error(`Source folder watcher failed for ${path}:`, error))
  folderWatchers.set(folderId, watcher)
}

function isRelevantLibraryPath(path: string): boolean {
  return [".mp4", ".mkv", ".webm", ".mov", ".avi", ".m4v", ".ts", ".srt", ".vtt", ".ass"]
    .includes(extname(path).toLowerCase())
}
