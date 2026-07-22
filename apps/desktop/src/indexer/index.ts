import { availableParallelism } from "node:os"
import { dirname, extname, join, resolve } from "node:path"
import { access, mkdir } from "node:fs/promises"
import { fork } from "node:child_process"
import { openDatabase, Repository } from "@vod-search/database"
import {
  addFolderRequestSchema,
  isJobStageAllowed,
  isProcessingWindowOpen,
  listMediaRequestSchema,
  processingScheduleSchema,
  resourceModeSchema,
  roughCutGenerateRequestSchema,
  retryJobRequestSchema,
  searchRequestSchema,
  setFolderSharingRequestSchema,
  speakerAssignProfileRequestSchema,
  speakerCreateProfileRequestSchema,
  speakerRenameProfileRequestSchema,
  type SpeakerAnalysis,
  type ProcessingSchedule,
  type TranscriptSegment,
  type TranscriptTopic
} from "@vod-search/contracts"
import { chunkTranscript, parseSubtitle, SearchService } from "@vod-search/search"
import { buildRoughCutPlan, type RoughCutSource } from "@vod-search/rough-cut"
import {
  BGE_EMBEDDING_VERSION,
  BgeEmbedder,
  buildSemanticPassage,
  CODEX_ENRICHMENT_VERSION,
  CodexEnricher,
  extractEmbeddedSubtitle,
  ModelManager,
  SHERPA_ENGINE_VERSION,
  SherpaManager,
  getSherpaNativeLibraryPath,
  type SherpaOptions,
  type SherpaResult,
  probeMedia,
  transcribeWithWhisper
} from "@vod-search/inference"
import type { RoughCutCandidateInput } from "@vod-search/inference"
import { scanSourceFolder } from "./scanner.js"
import { publishSharedMetadata } from "./shared-metadata.js"
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
const resourcesPath = process.env.VOD_SEARCH_RESOURCES_PATH
if (!resourcesPath) throw new Error("VOD_SEARCH_RESOURCES_PATH is required")
const sherpa = new SherpaManager(resourcesPath)
repository.recoverRunningJobs()
repository.cancelTranscriptionsBlockedByFailedProbe()
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
      const folder = repository.addSourceFolder(input.path, canonicalPath, input.publishSharedMetadata)
      ensureFolderWatcher(folder.id, folder.path)
      startFolderScan(folder.id, folder.path)
      return folder
    }
    case "library:list-folders": return repository.listSourceFolders()
    case "library:get-folder": return repository.getSourceFolder(String(payload))
    case "library:set-folder-sharing": {
      const input = setFolderSharingRequestSchema.parse(payload)
      repository.setSourceFolderSharing(input.folderId, input.publishSharedMetadata)
      const folder = repository.getSourceFolder(input.folderId)
      if (input.publishSharedMetadata) await publishSourceFolder(input.folderId)
      startFolderScan(folder.id, folder.path)
      notifyLibraryChanged()
      return repository.getSourceFolder(input.folderId)
    }
    case "library:list-media": return repository.listMedia(listMediaRequestSchema.parse(payload))
    case "library:stats": return repository.getStats()
    case "library:rescan": {
      const id = String(payload)
      const folder = repository.getSourceFolder(id)
      startFolderScan(id, folder.path, true)
      return undefined
    }
    case "library:remove-folder": {
      const id = String(payload)
      repository.getSourceFolder(id)
      rescanRequested.delete(id)
      const timer = rescanTimers.get(id)
      if (timer) clearTimeout(timer)
      rescanTimers.delete(id)
      const watcher = folderWatchers.get(id)
      if (watcher) await watcher.close()
      folderWatchers.delete(id)
      const activeScan = activeScans.get(id)
      if (activeScan) await activeScan
      repository.removeSourceFolder(id)
      notifyLibraryChanged()
      notifyJobsChanged()
      return undefined
    }
    case "search:query": {
      const input = searchRequestSchema.parse(payload)
      const activeEmbedder = input.mode === "keyword" ? null : await getEmbedder()
      const queryEmbedding = activeEmbedder ? await activeEmbedder.embedQuery(input.query) : undefined
      return search.search(input, queryEmbedding)
    }
    case "rough-cut:generate": return generateRoughCut(payload)
    case "jobs:list": return repository.listJobs()
    case "jobs:retry": repository.retryJob(retryJobRequestSchema.parse({ jobId: payload }).jobId); notifyJobsChanged(); return undefined
    case "jobs:pause-all": repository.pauseAllJobs(); notifyJobsChanged(); return undefined
    case "jobs:resume-all": repository.resumeAllJobs(); notifyJobsChanged(); return undefined
    case "jobs:set-resource-mode": repository.setResourceMode(resourceModeSchema.parse(payload)); return undefined
    case "jobs:get-processing-schedule": return repository.getProcessingSchedule()
    case "jobs:set-processing-schedule": {
      const schedule = repository.setProcessingSchedule(processingScheduleSchema.parse(payload))
      notifyJobsChanged()
      return schedule
    }
    case "models:list": return models.list()
    case "models:download": await models.install(String(payload)); return undefined
    case "models:cancel-download": models.cancel(String(payload)); return undefined
    case "speakers:status": return sherpa.status()
    case "speakers:review-queue": return repository.getSpeakerReviewQueue()
    case "speakers:create-profile": {
      const input = speakerCreateProfileRequestSchema.parse(payload)
      const profile = repository.createSpeakerProfile(input.mediaSpeakerId, input.name)
      notifyLibraryChanged()
      return profile
    }
    case "speakers:assign-profile": {
      const input = speakerAssignProfileRequestSchema.parse(payload)
      repository.assignMediaSpeakerProfile(input.mediaSpeakerId, input.profileId)
      notifyLibraryChanged()
      return undefined
    }
    case "speakers:rename-profile": {
      const input = speakerRenameProfileRequestSchema.parse(payload)
      const profile = repository.renameSpeakerProfile(input.profileId, input.name)
      notifyLibraryChanged()
      return profile
    }
    case "codex:refresh": {
      enricher = null
      nextEnricherAttemptAt = 0
      notifyJobsChanged()
      return undefined
    }
    case "media:path": return repository.getMediaPath(String(payload))
    case "media:detail": {
      const mediaId = String(payload)
      return {
        media: repository.getMedia(mediaId),
        transcript: repository.getTranscript(mediaId),
        summaries: repository.getMediaSummaries(mediaId),
        speakers: repository.getMediaSpeakers(mediaId),
        speakerProfiles: repository.listSpeakerProfiles(),
        speakerAnalysis: await getSpeakerAnalysis(mediaId)
      }
    }
    default: throw new Error(`Unknown indexer method: ${method}`)
  }
}

async function generateRoughCut(payload: unknown) {
  const request = roughCutGenerateRequestSchema.parse(payload)
  const activeEmbedder = await getEmbedder()
  if (!activeEmbedder) throw new Error("Install the semantic search model before generating a rough cut")
  const activeEnricher = await getEnricher()
  if (!activeEnricher) throw new Error("Sign in to Codex before generating a rough cut")

  const sources: RoughCutSource[] = request.mediaIds.map((mediaId) => {
    const media = repository.getMedia(mediaId)
    const path = repository.getMediaPath(mediaId)
    if (!path || media.availability !== "available") throw new Error(`${media.displayName} is offline or unavailable`)
    if (!media.durationMs || media.durationMs <= 0) throw new Error(`${media.displayName} does not have a usable duration`)
    const segments = repository.getTranscript(mediaId).filter((segment) => segment.text.trim())
    if (segments.length === 0) throw new Error(`${media.displayName} does not have an indexed transcript`)
    return {
      mediaId,
      path,
      title: media.displayName,
      durationMs: media.durationMs,
      segments: segments.map((segment) => ({
        id: segment.id,
        startMs: segment.startMs,
        endMs: segment.endMs,
        text: segment.text.trim().replace(/\s+/g, " ")
      }))
    }
  })

  const sourceById = new Map(sources.map((source) => [source.mediaId, source]))
  const candidates: RoughCutCandidateInput[] = []
  const seenWindows = new Set<string>()
  for (const query of extractRoughCutQueries(request.prompt)) {
    const queryEmbedding = await activeEmbedder.embedQuery(query)
    const response = search.search({
      query,
      mode: "hybrid",
      mediaIds: request.mediaIds,
      includeMissing: false,
      limit: 15
    }, queryEmbedding)
    for (const hit of response.hits) {
      if (candidates.length >= 120) break
      const source = sourceById.get(hit.mediaId)
      if (!source) continue
      const windowStart = Math.max(0, hit.startMs - 30_000)
      const windowEnd = Math.min(source.durationMs, hit.endMs + 30_000)
      const evidence = source.segments.filter((segment) => segment.endMs >= windowStart && segment.startMs <= windowEnd)
      if (evidence.length === 0) continue
      const key = `${hit.mediaId}:${evidence[0]!.id}:${evidence.at(-1)!.id}`
      if (seenWindows.has(key)) continue
      seenWindows.add(key)
      candidates.push({
        candidateId: `candidate-${candidates.length + 1}`,
        mediaId: hit.mediaId,
        title: hit.title,
        requestedBeat: query,
        summary: hit.summary,
        searchScore: hit.score,
        segments: evidence.map((segment) => ({ segmentId: segment.id, text: segment.text }))
      })
    }
  }
  if (candidates.length === 0) {
    throw new Error("No transcript moments in the selected videos matched this brief. Try more concrete spoken phrases or select additional videos.")
  }

  const selections = await activeEnricher.planRoughCut(request.prompt, candidates)
  const candidateById = new Map(candidates.map((candidate) => [candidate.candidateId, candidate]))
  const matches = selections.map((selection) => {
    const candidate = candidateById.get(selection.candidateId)
    if (!candidate) throw new Error(`Codex selected an unknown candidate: ${selection.candidateId}`)
    return {
      mediaId: candidate.mediaId,
      startSegmentId: selection.startSegmentId,
      endSegmentId: selection.endSegmentId,
      requestedText: selection.requestedText,
      matchRationale: selection.matchRationale
    }
  })
  if (matches.length === 0) {
    throw new Error("The selected videos did not contain enough transcript evidence for this rough-cut brief")
  }
  return buildRoughCutPlan({ request, sources, matches })
}

function extractRoughCutQueries(prompt: string): string[] {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  const beats = prompt
    .split(/\r?\n+|(?<=[.!?;])\s+/)
    .map((value) => value.trim().replace(/^[-*\d.)\s]+/, ""))
    .filter((value) => value.length >= 4)
    .map((value) => value.slice(0, 500))
  const ordered = normalized.length <= 500 ? [normalized, ...beats] : beats
  return [...new Set(ordered)].slice(0, 8)
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
    const processingSchedule = repository.getProcessingSchedule()
    drainScheduledScans(processingSchedule)
    const installations = await models.list()
    const ffprobePath = await findRuntimeExecutable("ffprobe")
    const ffmpegPath = await findRuntimeExecutable("ffmpeg")
    const transcriptionRuntime = await getTranscriptionRuntime(installations, ffmpegPath)
    const diarizationRuntime = ffmpegPath ? await sherpa.runtime() : null
    const hasEmbeddingModel = installations.some((model) =>
      model.modelId === "bge-small-en-v1.5" && model.status === "installed")
    const activeEnricher = await getEnricher()
    let reconciledJobs = repository.cancelTranscriptionsBlockedByFailedProbe()
    if (diarizationRuntime) reconciledJobs += repository.ensureDiarizationJobs(SHERPA_ENGINE_VERSION)
    else reconciledJobs += repository.cancelPendingJobsByStage("diarize")
    if (activeEnricher) reconciledJobs += repository.ensureEnrichmentJobs(CODEX_ENRICHMENT_VERSION)
    else reconciledJobs += repository.cancelPendingJobsByStage("enrich")
    if (hasEmbeddingModel) {
      reconciledJobs += repository.cancelEmbeddingsBlockedByEnrichment(CODEX_ENRICHMENT_VERSION)
      reconciledJobs += repository.ensureEmbeddingJobs(CODEX_ENRICHMENT_VERSION, BGE_EMBEDDING_VERSION)
    } else {
      reconciledJobs += repository.cancelPendingJobsByStage("embed")
    }
    if (reconciledJobs > 0) notifyJobsChanged()
    const now = new Date()
    const availableStages = [
      ...(ffprobePath ? ["probe" as const] : []),
      ...(transcriptionRuntime ? ["transcribe" as const] : []),
      ...(diarizationRuntime ? ["diarize" as const] : []),
      ...(activeEnricher ? ["enrich" as const] : []),
      ...(hasEmbeddingModel ? ["embed" as const] : [])
    ].filter((stage) => isJobStageAllowed(processingSchedule, stage, now))
    if (availableStages.length === 0) return
    const job = repository.claimNextJob(availableStages)
    if (!job?.mediaId) return
    notifyJobsChanged()
    try {
      if (job.stage === "probe" && ffprobePath) {
        await runProbeJob(job.id, job.mediaId, ffprobePath, ffmpegPath)
      } else if (job.stage === "transcribe" && transcriptionRuntime) {
        await runTranscriptionJob(job.id, job.mediaId, transcriptionRuntime)
      } else if (job.stage === "diarize" && diarizationRuntime && ffmpegPath) {
        await runDiarizationJob(job.id, job.mediaId, ffmpegPath, diarizationRuntime)
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

async function getSpeakerAnalysis(mediaId: string): Promise<SpeakerAnalysis> {
  if (repository.getDiarizationVersion(mediaId) === SHERPA_ENGINE_VERSION) {
    return { state: "ready", error: null }
  }
  const job = repository.getMediaJob(mediaId, "diarize")
  if (job?.status === "running") return { state: "running", error: null }
  if (job?.status === "failed") return { state: "failed", error: job.error }
  if (job?.status === "queued" || job?.status === "paused") return { state: "queued", error: null }
  const engine = await sherpa.status()
  if (engine.state === "ready") return { state: "queued", error: null }
  return { state: "setup-required", error: engine.error }
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
    const command = await findCodexCommand()
    const instance = new CodexEnricher()
    await instance.start({
      workspacePath: join(dirname(modelsPath), "codex-workspace"),
      executablePath: command.executablePath,
      executablePrefixArgs: command.prefixArgs
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
        repository.requeueJob(mediaId, "enrich")
        repository.cancelJob(mediaId, "transcribe")
      }
    } catch (error) {
      console.warn(`Embedded subtitles could not be extracted for ${mediaPath}; Whisper will be used instead.`, error)
    }
  }

  if (repository.getTranscriptVersion(mediaId) === null) repository.enqueueJob(mediaId, "transcribe")
  else repository.cancelJob(mediaId, "transcribe")

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
    repository.requeueJob(mediaId, "enrich")
    repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
    return
  }

  const segments = await transcribeWithWhisper({
    ffmpegPath: runtime.ffmpegPath,
    whisperPath: runtime.whisperPath,
    modelPath: runtime.modelPath,
    mediaPath,
    threads: diarizationThreads(repository.getResourceMode()),
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
    repository.requeueJob(mediaId, "enrich")
  }
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  notifyLibraryChanged()
}

async function runDiarizationJob(
  jobId: string,
  mediaId: string,
  ffmpegPath: string,
  runtime: NonNullable<Awaited<ReturnType<SherpaManager["runtime"]>>>
): Promise<void> {
  const mediaPath = repository.getMediaPath(mediaId)
  if (!mediaPath) throw new Error("The media file is no longer available")
  const fingerprint = repository.getMedia(mediaId).quickFingerprint
  const result = await runSherpaWorker({
    ...runtime,
    ffmpegPath,
    mediaPath,
    threads: transcriptionThreads(repository.getResourceMode()),
    onProgress: (progress) => {
      repository.updateJob(jobId, { progress: Math.max(0.02, Math.min(0.95, progress)) })
      notifyJobsChanged()
    }
  })
  if (repository.getMedia(mediaId).quickFingerprint !== fingerprint) {
    repository.requeueJob(mediaId, "diarize")
    return
  }
  repository.replaceSpeakerDiarization(mediaId, SHERPA_ENGINE_VERSION, result.speakers, result.turns)
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  notifyLibraryChanged()
}

function runSherpaWorker(options: Omit<SherpaOptions, "signal">): Promise<SherpaResult> {
  const { onProgress, ...workerData } = options
  return new Promise((resolve, reject) => {
    const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH"
    const worker = fork(join(__dirname, "sherpa-worker.js"), [], {
      execPath: process.execPath,
      env: {
        ...process.env,
        ELECTRON_RUN_AS_NODE: "1",
        [pathKey]: `${getSherpaNativeLibraryPath()};${process.env[pathKey] ?? ""}`
      },
      serialization: "advanced",
      stdio: ["ignore", "ignore", "pipe", "ipc"]
    })
    let settled = false
    let stderr = ""
    const finish = (callback: () => void): void => {
      if (settled) return
      settled = true
      callback()
    }
    worker.stderr?.setEncoding("utf8")
    worker.stderr?.on("data", (chunk: string) => { stderr += chunk })
    worker.on("message", (message: { type: string; progress?: number; result?: SherpaResult; error?: string }) => {
      if (message.type === "progress" && message.progress !== undefined) onProgress?.(message.progress)
      else if (message.type === "result" && message.result) finish(() => resolve(message.result!))
      else if (message.type === "error") finish(() => reject(new Error(message.error ?? "Sherpa diarization failed")))
    })
    worker.on("error", (error) => finish(() => reject(error)))
    worker.on("exit", (code) => {
      if (code !== 0) finish(() => reject(new Error(`Sherpa diarization process exited with code ${code}: ${stderr.slice(-1_000)}`)))
    })
    worker.send(workerData)
  })
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

function diarizationThreads(mode: "low" | "normal" | "high"): number {
  const cores = Math.max(1, availableParallelism())
  if (mode === "low") return 1
  if (mode === "high") return Math.min(4, cores)
  return Math.min(2, cores)
}

async function runEmbeddingJob(jobId: string, mediaId: string, activeEmbedder: BgeEmbedder): Promise<void> {
  if (!repository.isEnrichmentComplete(mediaId)) {
    repository.cancelJob(mediaId, "embed")
    return
  }
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
      BGE_EMBEDDING_VERSION
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
  const transcript = repository.getTranscript(mediaId).filter((segment) => segment.text.trim())
  if (transcript.length === 0) throw new Error("No generated subtitles are available for Codex enrichment")
  const transcriptVersion = repository.getTranscriptVersion(mediaId)
  if (!transcriptVersion) throw new Error("The transcript version is unavailable")
  const topics = await activeEnricher.enrichTranscript(transcript.map((segment) => ({
    segmentId: segment.id,
    text: segment.text.trim().replace(/\s+/g, " ")
  })))
  if (repository.getTranscriptVersion(mediaId) !== transcriptVersion) {
    repository.requeueJob(mediaId, "enrich")
    return
  }
  repository.replaceChunksWithTopics(mediaId, materializeTopicChunks(transcript, topics), CODEX_ENRICHMENT_VERSION)
  try {
    await publishSharedMetadata(repository, mediaId)
  } catch (error) {
    console.warn(`Shared VOD Search metadata could not be published for ${mediaId}:`, error)
  }
  repository.updateJob(jobId, { status: "succeeded", progress: 1, error: null })
  repository.requeueJob(mediaId, "embed")
  notifyLibraryChanged()
}

function materializeTopicChunks(transcript: TranscriptSegment[], topics: TranscriptTopic[]) {
  const positions = new Map(transcript.map((segment, index) => [segment.id, index]))
  return topics.map((topic, index) => {
    const startIndex = positions.get(topic.startSegmentId)
    if (startIndex === undefined) throw new Error(`Codex topic referenced an unknown transcript segment: ${topic.startSegmentId}`)
    const nextStartIndex = index + 1 < topics.length ? positions.get(topics[index + 1]!.startSegmentId) : transcript.length
    if (nextStartIndex === undefined || nextStartIndex <= startIndex) throw new Error("Codex topic boundaries are not ordered")
    const segments = transcript.slice(startIndex, nextStartIndex)
    const last = segments.at(-1)!
    return {
      startMs: segments[0]!.startMs,
      endMs: last.endMs,
      transcript: segments.map((segment) => segment.text.trim()).join(" ").replace(/\s+/g, " "),
      summary: topic.summary,
      entities: topic.entities,
      events: topic.events,
      aliases: topic.aliases,
      searchPhrases: topic.searchPhrases,
      confidence: topic.confidence
    }
  })
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

async function findCodexCommand(): Promise<{ executablePath: string; prefixArgs: string[] }> {
  const prefixArgs = parseCodexPrefixArgs(process.env.VOD_SEARCH_CODEX_PREFIX_ARGS)
  const candidates = [process.env.VOD_SEARCH_CODEX_PATH, process.env.VOD_SEARCH_CODEX_MANAGED_PATH]
  for (const candidate of candidates) {
    if (!candidate) continue
    try {
      await access(candidate)
      return {
        executablePath: candidate,
        prefixArgs: candidate === process.env.VOD_SEARCH_CODEX_PATH ? prefixArgs : []
      }
    } catch { /* Try the next Codex location. */ }
  }
  return { executablePath: process.platform === "win32" ? "codex.exe" : "codex", prefixArgs: [] }
}

function parseCodexPrefixArgs(value: string | undefined): string[] {
  if (!value) return []
  try {
    const parsed: unknown = JSON.parse(value)
    return Array.isArray(parsed) && parsed.every((item) => typeof item === "string") ? parsed : []
  } catch {
    return []
  }
}

function embeddingText(chunk: ReturnType<Repository["getChunksForEmbedding"]>[number]): string {
  return buildSemanticPassage({
    summary: chunk.summary,
    transcript: chunk.transcript,
    metadata: [
      safeJsonText(chunk.searchPhrasesJson),
      safeJsonText(chunk.aliasesJson),
      safeJsonText(chunk.entitiesJson),
      safeJsonText(chunk.eventsJson)
    ]
  })
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

function startFolderScan(folderId: string, path: string, force = false): void {
  if (activeScans.has(folderId)) {
    rescanRequested.add(folderId)
    return
  }
  if (!force && !isProcessingWindowOpen(repository.getProcessingSchedule().ingestion)) {
    rescanRequested.add(folderId)
    notifyJobsChanged()
    return
  }
  rescanRequested.delete(folderId)
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

function drainScheduledScans(schedule: ProcessingSchedule): void {
  if (!isProcessingWindowOpen(schedule.ingestion)) return
  for (const folderId of [...rescanRequested]) {
    if (activeScans.has(folderId)) continue
    try {
      const folder = repository.getSourceFolder(folderId)
      startFolderScan(folder.id, folder.path)
    } catch {
      rescanRequested.delete(folderId)
    }
  }
}

async function publishSourceFolder(folderId: string): Promise<void> {
  for (let offset = 0; ; offset += 500) {
    const batch = repository.listMedia({ sourceFolderId: folderId, offset, limit: 500 })
    for (const media of batch) {
      try {
        await publishSharedMetadata(repository, media.id)
      } catch (error) {
        console.warn(`Shared VOD Search metadata could not be published for ${media.id}:`, error)
      }
    }
    if (batch.length < 500) return
  }
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
