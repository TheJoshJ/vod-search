import type {
  CodexStatus,
  Job,
  LibraryStats,
  MediaAsset,
  MediaDetail,
  ModelInstallation,
  SearchHit,
  SourceFolder,
  VodSearchApi
} from "@vod-search/contracts"

const now = Date.now()
const sourceFolder: SourceFolder = {
  id: "archive",
  path: "D:\\Capture Archive\\RuneScape",
  addedAtMs: now - 1000 * 60 * 60 * 24 * 180,
  lastScanAtMs: now - 1000 * 60 * 4,
  availableMediaCount: 9,
  missingMediaCount: 0
}

const sampleNames = [
  "Kalphite King duo attempts",
  "Araxxor streak — evening session",
  "Telos practice and loadout notes",
  "Clan raid night",
  "Solak progression day three",
  "Hard-mode Kerapac kills",
  "Nex: Angel of Death learner hour",
  "Elite dungeon route testing",
  "Bank cleanup and gear prep"
]

const media: MediaAsset[] = sampleNames.map((displayName, index) => ({
  id: `sample-${index + 1}`,
  sourceFolderId: sourceFolder.id,
  displayName,
  relativePath: `2026\\July\\${displayName.replaceAll(/[—:]/g, "-")}.mp4`,
  durationMs: 2_640_000 + index * 317_000,
  sizeBytes: 1_800_000_000 + index * 83_000_000,
  createdAtMs: now - index * 1000 * 60 * 60 * 19,
  modifiedAtMs: now - index * 1000 * 60 * 60 * 18,
  quickFingerprint: `sample-fingerprint-${index}`,
  availability: "available",
  highestCompletedStage: index > 6 ? "transcribed" : "ready"
}))

const hits: SearchHit[] = [
  createHit(media[0]!, 522_000, 548_000, "The player misses the resonance timing and dies as the Kalphite King switches styles.", ["death", "Kalphite King"]),
  createHit(media[0]!, 1_376_000, 1_405_000, "A second attempt ends after the green shield mechanic catches both players.", ["death", "green shield"]),
  createHit(media[3]!, 867_000, 904_000, "The group discusses the Kalphite King death before changing the team setup.", ["Kalphite King", "team setup"]),
  createHit(media[6]!, 1_942_000, 1_969_000, "A teammate compares the failed Nex rotation to an earlier Kalphite King attempt.", ["death", "rotation"])
]

const jobs: Job[] = [
  { id: "job-1", mediaId: media[7]!.id, stage: "transcribe", status: "running", priority: 10, progress: 0.68, attempts: 1, error: null, createdAtMs: now - 480_000, updatedAtMs: now - 4_000 },
  { id: "job-2", mediaId: media[8]!.id, stage: "embed", status: "queued", priority: 5, progress: 0, attempts: 0, error: null, createdAtMs: now - 300_000, updatedAtMs: now - 300_000 }
]

const models: ModelInstallation[] = [
  { modelId: "whisper-small-en", version: "1", role: "transcription", status: "installed", bytesDownloaded: 488_000_000, sizeBytes: 488_000_000, path: "models/whisper-small-en", error: null },
  { modelId: "bge-small-en-v1.5", version: "1", role: "embedding", status: "installed", bytesDownloaded: 133_000_000, sizeBytes: 133_000_000, path: "models/bge-small", error: null }
]

const codex: CodexStatus = {
  state: "ready",
  installed: true,
  authenticated: true,
  version: "0.144.5",
  managed: true,
  error: null
}

const stats: LibraryStats = {
  sourceFolders: 1,
  totalMedia: media.length,
  availableMedia: media.length,
  missingMedia: 0,
  totalDurationMs: media.reduce((total, item) => total + (item.durationMs ?? 0), 0),
  searchableChunks: 2_184,
  queuedJobs: 1,
  runningJobs: 1,
  failedJobs: 0
}

export function createDevMockApi(): VodSearchApi {
  return {
    library: {
      selectFolder: async () => null,
      addFolder: async () => sourceFolder,
      listFolders: async () => [sourceFolder],
      listMedia: async (input) => media.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 100)),
      stats: async () => stats
    },
    search: {
      query: async () => ({ hits, elapsedMs: 38, indexedChunkCount: stats.searchableChunks })
    },
    jobs: {
      list: async () => jobs,
      pauseAll: async () => undefined,
      resumeAll: async () => undefined,
      setResourceMode: async () => undefined
    },
    models: {
      list: async () => models,
      download: async () => undefined,
      cancelDownload: async () => undefined
    },
    codex: {
      status: async () => codex,
      install: async () => codex,
      login: async () => codex
    },
    media: {
      getPlaybackSource: async () => ({ url: "", available: false }),
      getDetail: async (mediaId) => detailFor(media.find((item) => item.id === mediaId) ?? media[0]!)
    },
    events: {
      onLibraryChanged: () => () => undefined,
      onJobsChanged: () => () => undefined,
      onModelsChanged: () => () => undefined,
      onCodexChanged: () => () => undefined
    }
  }
}

function createHit(item: MediaAsset, startMs: number, endMs: number, summary: string, entities: string[]): SearchHit {
  return {
    mediaId: item.id,
    title: item.displayName,
    relativePath: item.relativePath,
    createdAtMs: item.createdAtMs,
    startMs,
    endMs,
    transcriptExcerpt: summary,
    summary,
    entities,
    events: ["player_death"],
    availability: "available",
    matchReasons: ["semantic", "transcript"],
    score: 0.91
  }
}

function detailFor(item: MediaAsset): MediaDetail {
  const transcript = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    mediaId: item.id,
    startMs: index * 35_000,
    endMs: index * 35_000 + 31_000,
    text: index === 14
      ? "I missed the resonance there—the Kalphite King switched, and that is the death we need to review."
      : `The team continues the encounter while discussing positioning, cooldowns, and the next mechanic in the rotation.`,
    source: "whisper" as const,
    confidence: 0.94
  }))
  return {
    media: item,
    transcript,
    summaries: [
      { startMs: 0, endMs: 600_000, summary: "The session opens with gear checks and several early attempts while the group settles on roles.", entities: ["Kalphite King"], events: ["gear_setup"] },
      { startMs: 600_000, endMs: 1_500_000, summary: "Several close attempts highlight missed defensive timings and one death during a style switch.", entities: ["Resonance", "Kalphite King"], events: ["player_death", "strategy_change"] },
      { startMs: 1_500_000, endMs: item.durationMs ?? 2_600_000, summary: "The group improves consistency, reviews the difficult moments, and completes the remaining attempts.", entities: ["team"], events: ["successful_attempt"] }
    ]
  }
}
