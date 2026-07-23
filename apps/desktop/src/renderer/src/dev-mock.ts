import type {
  CodexStatus,
  Job,
  LibraryStats,
  MediaAsset,
  MediaDetail,
  ModelInstallation,
  ProcessingSchedule,
  SearchHit,
  SpeakerProfile,
  SourceFolder,
  VodSearchApi
} from "@vod-search/contracts"

const now = Date.now()
const sourceFolder: SourceFolder = {
  id: "archive",
  path: "D:\\Capture Archive\\RuneScape",
  addedAtMs: now - 1000 * 60 * 60 * 24 * 180,
  lastScanAtMs: now - 1000 * 60 * 4,
  publishSharedMetadata: true,
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

let speakerProfiles: SpeakerProfile[] = [
  { id: "11111111-1111-4111-8111-111111111111", name: "Alex", sampleCount: 3, createdAtMs: now - 8_000_000, updatedAtMs: now - 80_000 },
  { id: "22222222-2222-4222-8222-222222222222", name: "Jordan", sampleCount: 2, createdAtMs: now - 6_000_000, updatedAtMs: now - 120_000 }
]
const speakerAssignments = new Map<number, string | null>()

let processingSchedule: ProcessingSchedule = {
  ingestion: { enabled: false, startMinute: 8 * 60, endMinute: 22 * 60 },
  transcription: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60 },
  summarization: { enabled: false, startMinute: 22 * 60, endMinute: 7 * 60 }
}

export function createDevMockApi(): VodSearchApi {
  return {
    library: {
      selectFolder: async () => null,
      addFolder: async () => sourceFolder,
      listFolders: async () => [sourceFolder],
      listMedia: async (input) => media.slice(input?.offset ?? 0, (input?.offset ?? 0) + (input?.limit ?? 100)),
      stats: async () => stats,
      setFolderSharing: async (_folderId, publishSharedMetadata) => ({ ...sourceFolder, publishSharedMetadata }),
      rescanFolder: async () => undefined,
      revealFolder: async () => undefined,
      removeFolder: async () => undefined
    },
    clips: {
      getOutputFolder: async () => "D:\\CutScout Clips",
      selectOutputFolder: async () => "D:\\CutScout Clips",
      revealOutputFolder: async () => undefined
    },
    search: {
      query: async () => ({ hits, elapsedMs: 38, indexedChunkCount: stats.searchableChunks })
    },
    shortForm: {
      export: async () => ({ path: "D:\\Exports\\vertical-short.mp4" })
    },
    jobs: {
      list: async () => jobs,
      retry: async () => undefined,
      pauseAll: async () => undefined,
      resumeAll: async () => undefined,
      setResourceMode: async () => undefined,
      getProcessingSchedule: async () => processingSchedule,
      setProcessingSchedule: async (schedule) => {
        processingSchedule = schedule
        return processingSchedule
      }
    },
    models: {
      list: async () => models,
      download: async () => undefined,
      cancelDownload: async () => undefined
    },
    speakers: {
      status: async () => ({ state: "ready", stage: "idle", error: null }),
      reviewQueue: async () => ({
        profiles: speakerProfiles,
        items: media.flatMap((item) => {
          const detail = detailFor(item)
          return detail.speakers.filter((speaker) => speaker.profileId === null).map((speaker) => {
            const sample = detail.transcript.find((segment) => segment.mediaSpeakerId === speaker.id)
            return {
              ...speaker,
              mediaTitle: item.displayName,
              relativePath: item.relativePath,
              mediaCreatedAtMs: item.createdAtMs,
              sampleStartMs: sample?.startMs ?? speaker.firstStartMs,
              sampleEndMs: sample?.endMs ?? speaker.firstStartMs + Math.max(1_000, Math.min(speaker.speechMs, 12_000)),
              sampleText: sample?.text ?? null
            }
          })
        })
      }),
      createProfile: async (mediaSpeakerId, name) => {
        const timestamp = Date.now()
        const profile: SpeakerProfile = { id: crypto.randomUUID(), name, sampleCount: 1, createdAtMs: timestamp, updatedAtMs: timestamp }
        speakerProfiles = [...speakerProfiles, profile]
        speakerAssignments.set(mediaSpeakerId, profile.id)
        return profile
      },
      assignProfile: async (mediaSpeakerId, profileId) => { speakerAssignments.set(mediaSpeakerId, profileId) },
      renameProfile: async (profileId, name) => {
        speakerProfiles = speakerProfiles.map((profile) => profile.id === profileId ? { ...profile, name, updatedAtMs: Date.now() } : profile)
        return speakerProfiles.find((profile) => profile.id === profileId)!
      }
    },
    codex: {
      status: async () => codex,
      install: async () => codex,
      login: async () => codex
    },
    media: {
      getPlaybackSource: async () => ({ url: "", available: false }),
      getDetail: async (mediaId) => detailFor(media.find((item) => item.id === mediaId) ?? media[0]!),
      revealInExplorer: async () => undefined,
      openExternal: async () => ({ mode: "default-player", playerName: null }),
      openExternalAt: async () => ({ mode: "generated-clip", playerName: null }),
      exportClip: async () => ({ path: "D:\\Capture Archive\\clip.mp4" })
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
    score: 82,
    scoreBreakdown: {
      semantic: 31,
      lexical: 12,
      transcript: 39,
      summary: 0,
      metadata: 0
    }
  }
}

function detailFor(item: MediaAsset): MediaDetail {
  const mediaIndex = media.findIndex((candidate) => candidate.id === item.id)
  const speakerBase = mediaIndex * 10 + 1
  const primaryProfileId = speakerAssignments.has(speakerBase)
    ? speakerAssignments.get(speakerBase) ?? null
    : speakerProfiles[0]!.id
  const guestProfileId = speakerAssignments.get(speakerBase + 1) ?? null
  const thirdProfileId = speakerAssignments.get(speakerBase + 2) ?? null
  const transcript = Array.from({ length: 18 }, (_, index) => ({
    id: index + 1,
    mediaId: item.id,
    startMs: index * 35_000,
    endMs: index * 35_000 + 31_000,
    text: index === 14
      ? "I missed the resonance there—the Kalphite King switched, and that is the death we need to review."
      : `The team continues the encounter while discussing positioning, cooldowns, and the next mechanic in the rotation.`,
    source: "whisper" as const,
    confidence: 0.94,
    mediaSpeakerId: [4, 9, 14].includes(index) ? speakerBase + 1 : index === 12 ? speakerBase + 2 : speakerBase
  }))
  return {
    media: item,
    transcript,
    summaries: [
      { startMs: 0, endMs: 600_000, summary: "The session opens with gear checks and several early attempts while the group settles on roles.", entities: ["Kalphite King"], events: ["gear_setup"] },
      { startMs: 600_000, endMs: 1_500_000, summary: "Several close attempts highlight missed defensive timings and one death during a style switch.", entities: ["Resonance", "Kalphite King"], events: ["player_death", "strategy_change"] },
      { startMs: 1_500_000, endMs: item.durationMs ?? 2_600_000, summary: "The group improves consistency, reviews the difficult moments, and completes the remaining attempts.", entities: ["team"], events: ["successful_attempt"] }
    ],
    speakers: [
      { id: speakerBase, mediaId: item.id, diarizationLabel: "SPEAKER_00", profileId: primaryProfileId, displayName: speakerProfiles.find((profile) => profile.id === primaryProfileId)?.name ?? "Speaker 1", speechMs: 465_000, turnCount: 14, firstStartMs: 0, suggestedProfileId: null, suggestionScore: null },
      { id: speakerBase + 1, mediaId: item.id, diarizationLabel: "SPEAKER_01", profileId: guestProfileId, displayName: speakerProfiles.find((profile) => profile.id === guestProfileId)?.name ?? "Speaker 2", speechMs: 93_000, turnCount: 3, firstStartMs: 140_000, suggestedProfileId: guestProfileId ? null : speakerProfiles[1]!.id, suggestionScore: guestProfileId ? null : 0.87 },
      { id: speakerBase + 2, mediaId: item.id, diarizationLabel: "SPEAKER_02", profileId: thirdProfileId, displayName: speakerProfiles.find((profile) => profile.id === thirdProfileId)?.name ?? "Speaker 3", speechMs: 31_000, turnCount: 1, firstStartMs: 420_000, suggestedProfileId: null, suggestionScore: null }
    ],
    speakerProfiles,
    speakerAnalysis: { state: "ready", error: null }
  }
}
