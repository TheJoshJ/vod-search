import { createHash } from "node:crypto"
import { createReadStream, createWriteStream } from "node:fs"
import { mkdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ModelInstallation, ModelRole } from "@vod-search/contracts"

export interface ModelFileManifest {
  path: string
  url: string
  sizeBytes: number
  sha256: string
}

export interface ModelPackageManifest {
  id: string
  version: string
  role: ModelRole
  displayName: string
  license: string
  licenseUrl: string
  files: ModelFileManifest[]
}

const whisperRevision = "5359861c739e955e79d9a303bcbc70fb988958b1"
const qwenRevision = "bc640142c66e1fdd12af0bd68f40445458f3869b"
const bgeRevision = "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"

export const defaultModelPackages: ModelPackageManifest[] = [
  {
    id: "whisper-small-en",
    version: whisperRevision,
    role: "transcription",
    displayName: "Whisper small.en",
    license: "MIT",
    licenseUrl: "https://github.com/openai/whisper/blob/main/LICENSE",
    files: [{
      path: "ggml-small.en.bin",
      url: `https://huggingface.co/ggerganov/whisper.cpp/resolve/${whisperRevision}/ggml-small.en.bin`,
      sizeBytes: 487_614_201,
      sha256: "c6138d6d58ecc8322097e0f987c32f1be8bb0a18532a3f88f734d1bbf9c41e5d"
    }]
  },
  {
    id: "qwen3-4b-q4-k-m",
    version: qwenRevision,
    role: "enrichment",
    displayName: "Qwen3 4B Q4_K_M",
    license: "Apache-2.0",
    licenseUrl: "https://huggingface.co/Qwen/Qwen3-4B-GGUF/blob/main/LICENSE",
    files: [{
      path: "Qwen3-4B-Q4_K_M.gguf",
      url: `https://huggingface.co/Qwen/Qwen3-4B-GGUF/resolve/${qwenRevision}/Qwen3-4B-Q4_K_M.gguf`,
      sizeBytes: 2_497_280_256,
      sha256: "7485fe6f11af29433bc51cab58009521f205840f5b4ae3a32fa7f92e8534fdf5"
    }]
  },
  {
    id: "bge-small-en-v1.5",
    version: bgeRevision,
    role: "embedding",
    displayName: "BGE small English v1.5",
    license: "MIT",
    licenseUrl: "https://huggingface.co/BAAI/bge-small-en-v1.5",
    files: [
      {
        path: "onnx/model.onnx",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/onnx/model.onnx`,
        sizeBytes: 133_093_490,
        sha256: "828e1496d7fabb79cfa4dcd84fa38625c0d3d21da474a00f08db0f559940cf35"
      },
      {
        path: "config.json",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/config.json`,
        sizeBytes: 743,
        sha256: "094f8e891b932f2000c92cfc663bac4c62069f5d8af5b5278c4306aef3084750"
      },
      {
        path: "tokenizer.json",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/tokenizer.json`,
        sizeBytes: 711_396,
        sha256: "d241a60d5e8f04cc1b2b3e9ef7a4921b27bf526d9f6050ab90f9267a1f9e5c66"
      },
      {
        path: "tokenizer_config.json",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/tokenizer_config.json`,
        sizeBytes: 366,
        sha256: "9261e7d79b44c8195c1cada2b453e55b00aeb81e907a6664974b4d7776172ab3"
      },
      {
        path: "special_tokens_map.json",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/special_tokens_map.json`,
        sizeBytes: 125,
        sha256: "b6d346be366a7d1d48332dbc9fdf3bf8960b5d879522b7799ddba59e76237ee3"
      },
      {
        path: "vocab.txt",
        url: `https://huggingface.co/BAAI/bge-small-en-v1.5/resolve/${bgeRevision}/vocab.txt`,
        sizeBytes: 231_508,
        sha256: "07eced375cec144d27c900241f3e339478dec958f92fddbc551f295c992038a3"
      }
    ]
  }
]

interface InstalledMarker {
  id: string
  version: string
  files: Array<{ path: string; sha256: string }>
}

export class ModelManager {
  private readonly active = new Map<string, { controller: AbortController; bytesDownloaded: number; error: string | null }>()

  constructor(
    private readonly rootPath: string,
    private readonly packages: ModelPackageManifest[] = defaultModelPackages,
    private readonly onChanged?: (() => void) | undefined
  ) {}

  async list(): Promise<ModelInstallation[]> {
    return Promise.all(this.packages.map(async (manifest): Promise<ModelInstallation> => {
      const totalSize = packageSize(manifest)
      const active = this.active.get(manifest.id)
      if (active) {
        return {
          modelId: manifest.id,
          version: manifest.version,
          role: manifest.role,
          status: active.error ? "invalid" : "downloading",
          bytesDownloaded: active.bytesDownloaded,
          sizeBytes: totalSize,
          path: null,
          error: active.error
        }
      }
      const installPath = this.packagePath(manifest)
      const marker = await readMarker(join(installPath, "installed.json"))
      const installed = marker?.id === manifest.id && marker.version === manifest.version &&
        marker.files.length === manifest.files.length
      return {
        modelId: manifest.id,
        version: manifest.version,
        role: manifest.role,
        status: installed ? "installed" : "missing",
        bytesDownloaded: installed ? totalSize : await partialBytes(installPath, manifest),
        sizeBytes: totalSize,
        path: installed ? installPath : null,
        error: null
      }
    }))
  }

  async install(modelId: string): Promise<void> {
    const manifest = this.packages.find((candidate) => candidate.id === modelId)
    if (!manifest) throw new Error(`Unknown model package: ${modelId}`)
    const previous = this.active.get(modelId)
    if (previous && !previous.error) return
    if (previous?.error) this.active.delete(modelId)
    const controller = new AbortController()
    const state = { controller, bytesDownloaded: 0, error: null as string | null }
    this.active.set(modelId, state)
    this.onChanged?.()

    try {
      const destinationRoot = this.packagePath(manifest)
      await mkdir(destinationRoot, { recursive: true })
      for (const file of manifest.files) {
        const destination = join(destinationRoot, file.path)
        await downloadVerifiedFile(file, destination, controller.signal, (completed) => {
          state.bytesDownloaded = completed + manifest.files
            .slice(0, manifest.files.indexOf(file))
            .reduce((total, previous) => total + previous.sizeBytes, 0)
          this.onChanged?.()
        })
      }
      const marker: InstalledMarker = {
        id: manifest.id,
        version: manifest.version,
        files: manifest.files.map((file) => ({ path: file.path, sha256: file.sha256 }))
      }
      await writeFile(join(destinationRoot, "installed.json"), JSON.stringify(marker, null, 2), "utf8")
      this.active.delete(modelId)
      this.onChanged?.()
    } catch (error) {
      if (controller.signal.aborted) {
        this.active.delete(modelId)
        this.onChanged?.()
        return
      }
      state.error = error instanceof Error ? error.message : String(error)
      this.onChanged?.()
      throw error
    }
  }

  cancel(modelId: string): void {
    this.active.get(modelId)?.controller.abort()
  }

  getInstalledFile(modelId: string, relativePath: string): string | null {
    const manifest = this.packages.find((candidate) => candidate.id === modelId)
    if (!manifest || !manifest.files.some((file) => file.path === relativePath)) return null
    return join(this.packagePath(manifest), relativePath)
  }

  private packagePath(manifest: ModelPackageManifest): string {
    return join(this.rootPath, manifest.id, manifest.version)
  }
}

export async function downloadVerifiedFile(
  manifest: ModelFileManifest,
  destination: string,
  signal: AbortSignal,
  onProgress?: ((bytesDownloaded: number) => void) | undefined
): Promise<void> {
  await mkdir(dirname(destination), { recursive: true })
  const partialPath = `${destination}.partial`
  let offset = await fileSize(partialPath)
  if (offset > manifest.sizeBytes) {
    await rm(partialPath, { force: true })
    offset = 0
  }

  const response = await fetch(manifest.url, {
    ...(offset > 0 ? { headers: { Range: `bytes=${offset}-` } } : {}),
    signal
  })
  if (!response.ok || !response.body) throw new Error(`Model download failed with HTTP ${response.status}`)
  if (offset > 0 && response.status !== 206) {
    await rm(partialPath, { force: true })
    return downloadVerifiedFile(manifest, destination, signal, onProgress)
  }

  const output = createWriteStream(partialPath, { flags: offset > 0 ? "a" : "w" })
  let downloaded = offset
  const readable = Readable.fromWeb(response.body as import("node:stream/web").ReadableStream)
  readable.on("data", (chunk: Buffer) => {
    downloaded += chunk.length
    onProgress?.(downloaded)
  })
  await pipeline(readable, output, { signal })

  if (downloaded !== manifest.sizeBytes) {
    throw new Error(`Downloaded size mismatch for ${manifest.path}: expected ${manifest.sizeBytes}, got ${downloaded}`)
  }
  const actualHash = await sha256File(partialPath)
  if (actualHash !== manifest.sha256.toLowerCase()) {
    await rm(partialPath, { force: true })
    throw new Error(`Checksum mismatch for ${manifest.path}`)
  }
  await rm(destination, { force: true })
  await rename(partialPath, destination)
}

function packageSize(manifest: ModelPackageManifest): number {
  return manifest.files.reduce((total, file) => total + file.sizeBytes, 0)
}

async function partialBytes(rootPath: string, manifest: ModelPackageManifest): Promise<number> {
  let total = 0
  for (const file of manifest.files) {
    total += Math.min(file.sizeBytes, await fileSize(join(rootPath, `${file.path}.partial`)))
  }
  return total
}

async function fileSize(path: string): Promise<number> {
  try { return (await stat(path)).size } catch { return 0 }
}

async function sha256File(path: string): Promise<string> {
  const hash = createHash("sha256")
  for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
  return hash.digest("hex")
}

async function readMarker(path: string): Promise<InstalledMarker | null> {
  try { return JSON.parse(await readFile(path, "utf8")) as InstalledMarker } catch { return null }
}
