import { access, mkdtemp, rm } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, join, resolve } from "node:path"
import { createRequire } from "node:module"
import type { SpeakerEngineStatus } from "@vod-search/contracts"
import { runProcess } from "./process.js"

const require = createRequire(import.meta.url)

interface SpeakerEmbeddingStream {
  acceptWaveform(wave: { samples: Float32Array; sampleRate: number }): void
  inputFinished(): void
}

interface SherpaModule {
  readWave(path: string, enableExternalBuffer?: boolean): { samples: Float32Array; sampleRate: number }
  OfflineSpeakerDiarization: new (config: {
    segmentation: { pyannote: { model: string }; numThreads: number; provider: string }
    embedding: { model: string; numThreads: number; provider: string }
    clustering: { numClusters: number; threshold: number }
    minDurationOn: number
    minDurationOff: number
  }) => { process(samples: Float32Array): Array<{ start: number; end: number; speaker: number }> }
  SpeakerEmbeddingExtractor: new (config: {
    model: string
    numThreads: number
    provider: string
  }) => {
    createStream(): SpeakerEmbeddingStream
    isReady(stream: SpeakerEmbeddingStream): boolean
    compute(stream: SpeakerEmbeddingStream, enableExternalBuffer?: boolean): Float32Array
  }
}

let loadedSherpa: SherpaModule | null = null

export const SHERPA_ENGINE_VERSION = "sherpa-onnx:1.13.4:pyannote-segmentation-3.0:3dspeaker-eres2net-en-voxceleb:chunked-v4"

const DIARIZATION_CHUNK_SECONDS = 10
const LOCAL_SPEAKER_SEED_THRESHOLD = 0.78
const LOCAL_SPEAKER_CLUSTER_THRESHOLD = 0.5
const MINIMUM_SPEAKER_SPEECH_MS = 2_500

export interface SherpaSpeaker {
  label: string
  embedding: number[]
}

export interface SherpaTurn {
  label: string
  startMs: number
  endMs: number
}

export interface SherpaResult {
  speakers: SherpaSpeaker[]
  turns: SherpaTurn[]
}

export interface ClusteredSpeakers {
  speakers: SherpaSpeaker[]
  labels: Map<string, string>
}

export interface SherpaRuntime {
  segmentationModelPath: string
  embeddingModelPath: string
}

export interface SherpaOptions extends SherpaRuntime {
  ffmpegPath: string
  mediaPath: string
  threads?: number
  clusteringThreshold?: number
  signal?: AbortSignal
  onProgress?: (progress: number) => void
}

export class SherpaManager {
  constructor(private readonly resourcesPath: string) {}

  async status(): Promise<SpeakerEngineStatus> {
    return await this.runtime()
      ? { state: "ready", stage: "idle", error: null }
      : {
          state: "missing",
          stage: "idle",
          error: "The bundled Sherpa ONNX speaker models are missing from this build."
        }
  }

  async runtime(): Promise<SherpaRuntime | null> {
    const runtime = {
      segmentationModelPath: process.env.VOD_SEARCH_SHERPA_SEGMENTATION_MODEL_PATH
        ?? join(this.resourcesPath, "runtime", "windows", "sherpa-segmentation", "model.onnx"),
      embeddingModelPath: process.env.VOD_SEARCH_SHERPA_EMBEDDING_MODEL_PATH
        ?? join(this.resourcesPath, "runtime", "windows", "sherpa-embedding", "model.onnx")
    }
    return await pathsExist(Object.values(runtime)) ? runtime : null
  }
}

export function getSherpaNativeLibraryPath(): string {
  return resolve(dirname(require.resolve("sherpa-onnx-node")), "..", "sherpa-onnx-win-x64")
}

export async function diarizeWithSherpa(options: SherpaOptions): Promise<SherpaResult> {
  const workingDirectory = await mkdtemp(join(tmpdir(), "vod-search-sherpa-"))
  const wavPath = join(workingDirectory, "audio.wav")
  try {
    options.signal?.throwIfAborted()
    await runProcess(options.ffmpegPath, [
      "-hide_banner", "-loglevel", "error", "-y",
      "-i", options.mediaPath,
      "-vn", "-ar", "16000", "-ac", "1", "-c:a", "pcm_s16le",
      wavPath
    ], { signal: options.signal })
    options.onProgress?.(0.08)
    options.signal?.throwIfAborted()

    const sherpa = loadSherpa()
    const wave = sherpa.readWave(wavPath, false)
    const diarizer = new sherpa.OfflineSpeakerDiarization({
      segmentation: {
        pyannote: { model: options.segmentationModelPath },
        numThreads: options.threads ?? 4,
        provider: "cpu"
      },
      embedding: {
        model: options.embeddingModelPath,
        numThreads: options.threads ?? 4,
        provider: "cpu"
      },
      clustering: {
        numClusters: -1,
        threshold: options.clusteringThreshold ?? 0.5
      },
      minDurationOn: 0.2,
      minDurationOff: 0.5
    })
    const durationMs = Math.round(wave.samples.length / wave.sampleRate * 1000)
    const chunkSamples = DIARIZATION_CHUNK_SECONDS * wave.sampleRate
    const chunkCount = Math.max(1, Math.ceil(wave.samples.length / chunkSamples))
    const turns: SherpaTurn[] = []
    for (let chunkIndex = 0; chunkIndex < chunkCount; chunkIndex += 1) {
      options.signal?.throwIfAborted()
      const sampleOffset = chunkIndex * chunkSamples
      const chunk = wave.samples.subarray(sampleOffset, Math.min(wave.samples.length, sampleOffset + chunkSamples))
      const timeOffsetSeconds = sampleOffset / wave.sampleRate
      const rawSegments = diarizer.process(chunk)
      turns.push(...rawSegments.map((segment) => ({
        label: `chunk-${chunkIndex + 1}-speaker-${segment.speaker + 1}`,
        startMs: Math.max(0, Math.round((timeOffsetSeconds + segment.start) * 1000)),
        endMs: Math.min(durationMs, Math.round((timeOffsetSeconds + segment.end) * 1000))
      })).filter((turn) => turn.endMs > turn.startMs))
      options.onProgress?.(0.08 + 0.62 * ((chunkIndex + 1) / chunkCount))
    }
    turns.sort((left, right) => left.startMs - right.startMs || left.endMs - right.endMs)
    options.signal?.throwIfAborted()

    const labels = [...new Set(turns.map((turn) => turn.label))]
    const extractor = new sherpa.SpeakerEmbeddingExtractor({
      model: options.embeddingModelPath,
      numThreads: options.threads ?? 4,
      provider: "cpu"
    })
    const speakers: SherpaSpeaker[] = []
    for (const [index, label] of labels.entries()) {
      options.signal?.throwIfAborted()
      const samples = collectSpeakerSamples(wave.samples, wave.sampleRate, turns, label)
      if (samples.length === 0) continue
      const stream = extractor.createStream()
      stream.acceptWaveform({ samples, sampleRate: wave.sampleRate })
      stream.inputFinished()
      if (!extractor.isReady(stream)) throw new Error(`Not enough speech was available to identify ${label}.`)
      const embedding = Array.from(extractor.compute(stream, false))
      speakers.push({ label, embedding })
      options.onProgress?.(0.70 + 0.29 * ((index + 1) / labels.length))
    }

    const speechMsByLabel = new Map<string, number>()
    for (const turn of turns) {
      speechMsByLabel.set(turn.label, (speechMsByLabel.get(turn.label) ?? 0) + turn.endMs - turn.startMs)
    }
    const clustered = clusterLocalSpeakers(speakers, LOCAL_SPEAKER_CLUSTER_THRESHOLD, speechMsByLabel)
    return {
      speakers: clustered.speakers,
      turns: turns.flatMap((turn) => {
        const label = clustered.labels.get(turn.label)
        return label ? [{ ...turn, label }] : []
      })
    }
  } finally {
    await rm(workingDirectory, { recursive: true, force: true })
  }
}

export function clusterLocalSpeakers(
  localSpeakers: readonly SherpaSpeaker[],
  threshold = LOCAL_SPEAKER_CLUSTER_THRESHOLD,
  speechMsByLabel?: ReadonlyMap<string, number>
): ClusteredSpeakers {
  const normalizedSpeakers = localSpeakers.flatMap((speaker) => {
    const embedding = normalizeEmbedding(speaker.embedding)
    return embedding ? [{ ...speaker, embedding }] : []
  })
  const seeds: Array<{ embedding: number[]; sampleCount: number; memberIndices: number[] }> = []
  for (const [speakerIndex, speaker] of normalizedSpeakers.entries()) {
    let bestSeedIndex = -1
    let bestSimilarity = -1
    for (const [seedIndex, seed] of seeds.entries()) {
      const similarity = cosineSimilarity(seed.embedding, speaker.embedding) ?? -1
      if (similarity > bestSimilarity) {
        bestSimilarity = similarity
        bestSeedIndex = seedIndex
      }
    }
    if (bestSeedIndex < 0 || bestSimilarity < LOCAL_SPEAKER_SEED_THRESHOLD) {
      seeds.push({ embedding: speaker.embedding, sampleCount: 1, memberIndices: [speakerIndex] })
      continue
    }
    const seed = seeds[bestSeedIndex]!
    seed.embedding = normalizeEmbedding(seed.embedding.map((value, dimension) =>
      (value * seed.sampleCount + speaker.embedding[dimension]!) / (seed.sampleCount + 1))) ?? seed.embedding
    seed.sampleCount += 1
    seed.memberIndices.push(speakerIndex)
  }

  const parents = seeds.map((_, index) => index)
  const find = (index: number): number => {
    let root = index
    while (parents[root] !== root) root = parents[root]!
    while (parents[index] !== index) {
      const parent = parents[index]!
      parents[index] = root
      index = parent
    }
    return root
  }
  const union = (left: number, right: number): void => {
    const leftRoot = find(left)
    const rightRoot = find(right)
    if (leftRoot !== rightRoot) parents[rightRoot] = leftRoot
  }
  for (let left = 0; left < seeds.length; left += 1) {
    for (let right = 0; right < left; right += 1) {
      if ((cosineSimilarity(seeds[left]!.embedding, seeds[right]!.embedding) ?? -1) >= threshold) {
        union(left, right)
      }
    }
  }

  const components = new Map<number, number[]>()
  for (let index = 0; index < seeds.length; index += 1) {
    const root = find(index)
    const members = components.get(root) ?? []
    members.push(index)
    components.set(root, members)
  }

  const speakers: SherpaSpeaker[] = []
  const labels = new Map<string, string>()
  for (const seedIndices of components.values()) {
    const memberIndices = seedIndices.flatMap((seedIndex) => seeds[seedIndex]!.memberIndices)
    const speechMs = memberIndices.reduce((total, index) =>
      total + (speechMsByLabel?.get(normalizedSpeakers[index]!.label) ?? 1), 0)
    if (speechMsByLabel && speechMs < MINIMUM_SPEAKER_SPEECH_MS) continue
    const weightedEmbedding = new Array<number>(normalizedSpeakers[memberIndices[0]!]!.embedding.length).fill(0)
    for (const index of memberIndices) {
      const member = normalizedSpeakers[index]!
      const weight = speechMsByLabel?.get(member.label) ?? 1
      for (let dimension = 0; dimension < weightedEmbedding.length; dimension += 1) {
        weightedEmbedding[dimension] = weightedEmbedding[dimension]! + member.embedding[dimension]! * weight
      }
    }
    const embedding = normalizeEmbedding(weightedEmbedding)
    if (!embedding) continue
    const label = `speaker-${speakers.length + 1}`
    speakers.push({ label, embedding })
    for (const index of memberIndices) labels.set(normalizedSpeakers[index]!.label, label)
  }
  return { speakers, labels }
}

export function collectSpeakerSamples(
  samples: Float32Array,
  sampleRate: number,
  turns: readonly SherpaTurn[],
  label: string,
  maximumSeconds = 30,
  minimumSeconds = 4
): Float32Array {
  const maximumSamples = Math.max(1, Math.floor(maximumSeconds * sampleRate))
  const minimumSamples = Math.max(1, Math.floor(minimumSeconds * sampleRate))
  const parts: Float32Array[] = []
  let totalLength = 0
  for (const turn of turns) {
    if (turn.label !== label || totalLength >= maximumSamples) continue
    const start = Math.max(0, Math.floor(turn.startMs / 1000 * sampleRate))
    const end = Math.min(samples.length, Math.ceil(turn.endMs / 1000 * sampleRate), start + maximumSamples - totalLength)
    if (end <= start) continue
    const part = samples.subarray(start, end)
    parts.push(part)
    totalLength += part.length
  }
  if (totalLength === 0) return new Float32Array()

  const collected = new Float32Array(totalLength)
  let offset = 0
  for (const part of parts) {
    collected.set(part, offset)
    offset += part.length
  }
  if (totalLength >= minimumSamples) return collected

  const padded = new Float32Array(minimumSamples)
  for (let target = 0; target < padded.length; target += collected.length) {
    padded.set(collected.subarray(0, Math.min(collected.length, padded.length - target)), target)
  }
  return padded
}

export function cosineSimilarity(left: readonly number[], right: readonly number[]): number | null {
  if (left.length === 0 || left.length !== right.length) return null
  let dot = 0
  let leftNorm = 0
  let rightNorm = 0
  for (let index = 0; index < left.length; index += 1) {
    const a = left[index]!
    const b = right[index]!
    dot += a * b
    leftNorm += a * a
    rightNorm += b * b
  }
  if (leftNorm === 0 || rightNorm === 0) return null
  return dot / Math.sqrt(leftNorm * rightNorm)
}

function normalizeEmbedding(embedding: readonly number[]): number[] | null {
  let norm = 0
  for (const value of embedding) norm += value * value
  if (norm === 0) return null
  const scale = Math.sqrt(norm)
  return embedding.map((value) => value / scale)
}

async function pathsExist(paths: string[]): Promise<boolean> {
  return (await Promise.all(paths.map(pathExists))).every(Boolean)
}

function loadSherpa(): SherpaModule {
  loadedSherpa ??= require("sherpa-onnx-node") as SherpaModule
  return loadedSherpa
}

async function pathExists(path: string): Promise<boolean> {
  try { await access(path); return true } catch { return false }
}
