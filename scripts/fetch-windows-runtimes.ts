import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { copyFile, readdir, readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import extract from "extract-zip"
import { downloadVerifiedFile } from "../packages/inference/src/models.js"
import { runProcess } from "../packages/inference/src/process.js"

interface RuntimeArchive {
  id: string
  url: string
  sizeBytes: number
  sha256: string
  format?: "zip" | "tar-bz2" | "file"
  outputFileName?: string
  flattenSingleDirectory?: boolean
  removeAfterExtract?: string[]
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cacheRoot = join(projectRoot, ".cache", "runtimes")
const runtimeRoot = join(projectRoot, "resources", "runtime", "windows")
const obsoleteRuntimeIds = ["llama-cpu", "llama-vulkan", "uv", "sherpa"]

const archives: RuntimeArchive[] = [
  {
    id: "ffmpeg",
    url: "https://github.com/BtbN/FFmpeg-Builds/releases/download/autobuild-2026-07-20-14-10/ffmpeg-n7.1.5-9-gb9a218bc1e-win64-lgpl-shared-7.1.zip",
    sizeBytes: 62_417_342,
    sha256: "4576b35688220a29818a5b0f2ebc8b69f5a0af91b6af739c9d888c6cd26e5724",
    flattenSingleDirectory: true,
    removeAfterExtract: ["doc", "include", "lib"]
  },
  {
    id: "whisper",
    url: "https://github.com/ggml-org/whisper.cpp/releases/download/v1.9.1/whisper-bin-x64.zip",
    sizeBytes: 7_982_101,
    sha256: "7d8be46ecd31828e1eb7a2ecdd0d6b314feafd82163038ab6092594b0a063539"
  },
  {
    id: "sherpa-segmentation",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-segmentation-models/sherpa-onnx-pyannote-segmentation-3-0.tar.bz2",
    sizeBytes: 6_958_444,
    sha256: "24615ee884c897d9d2ba09bb4d30da6bb1b15e685065962db5b02e76e4996488",
    format: "tar-bz2",
    flattenSingleDirectory: true,
    removeAfterExtract: [
      "model.int8.onnx",
      "README.md",
      "export-onnx.py",
      "run.sh",
      "show-onnx.py",
      "speaker-diarization-onnx.py",
      "speaker-diarization-torch.py",
      "vad-onnx.py",
      "vad-torch.py"
    ]
  },
  {
    id: "sherpa-embedding",
    url: "https://github.com/k2-fsa/sherpa-onnx/releases/download/speaker-recongition-models/3dspeaker_speech_eres2net_sv_en_voxceleb_16k.onnx",
    sizeBytes: 26_485_263,
    sha256: "c59158379255ad66e161679cca6af8d52d51e389e3224ab7d7a7baae295c2db5",
    format: "file",
    outputFileName: "model.onnx"
  }
]

await mkdir(cacheRoot, { recursive: true })
await mkdir(runtimeRoot, { recursive: true })
for (const runtimeId of obsoleteRuntimeIds) {
  await rm(join(runtimeRoot, runtimeId), { recursive: true, force: true })
}

for (const archive of archives) {
  const targetPath = join(runtimeRoot, archive.id)
  const markerPath = join(targetPath, ".runtime.json")
  const marker = JSON.stringify({
    layoutVersion: 3,
    url: archive.url,
    sizeBytes: archive.sizeBytes,
    sha256: archive.sha256,
    format: archive.format ?? "zip",
    outputFileName: archive.outputFileName ?? null
  }, null, 2)
  if (await markerMatches(markerPath, marker)) {
    console.info(`${archive.id}: already prepared`)
    continue
  }

  const archivePath = join(cacheRoot, basename(new URL(archive.url).pathname))
  if (await isVerifiedArchive(archivePath, archive)) {
    console.info(`${archive.id}: using verified cached archive`)
  } else {
    console.info(`${archive.id}: downloading verified archive`)
    await downloadVerifiedFile(
      { path: basename(archivePath), url: archive.url, sizeBytes: archive.sizeBytes, sha256: archive.sha256 },
      archivePath,
      new AbortController().signal,
      createProgressReporter(archive.id, archive.sizeBytes)
    )
  }

  await rm(targetPath, { recursive: true, force: true })
  await mkdir(targetPath, { recursive: true })
  console.info(`${archive.id}: preparing`)
  if (archive.format === "file") {
    await copyFile(archivePath, join(targetPath, archive.outputFileName ?? basename(archivePath)))
  } else if (archive.format === "tar-bz2") {
    await runProcess("tar", ["-xjf", archivePath, "-C", targetPath])
  } else {
    await extract(archivePath, { dir: targetPath })
  }
  if (archive.flattenSingleDirectory) await flattenSingleDirectory(targetPath)
  for (const relativePath of archive.removeAfterExtract ?? []) {
    await rm(join(targetPath, relativePath), { recursive: true, force: true })
  }
  await writeFile(markerPath, marker, "utf8")
}

console.info(`Windows runtimes are ready in ${runtimeRoot}`)

async function markerMatches(path: string, expected: string): Promise<boolean> {
  try { return await readFile(path, "utf8") === expected } catch { return false }
}

async function isVerifiedArchive(path: string, archive: RuntimeArchive): Promise<boolean> {
  try {
    if ((await stat(path)).size !== archive.sizeBytes) return false
    const hash = createHash("sha256")
    for await (const chunk of createReadStream(path)) hash.update(chunk as Buffer)
    return hash.digest("hex") === archive.sha256
  } catch {
    return false
  }
}

async function flattenSingleDirectory(path: string): Promise<void> {
  const entries = await readdir(path)
  if (entries.length !== 1) return
  const nestedPath = join(path, entries[0]!)
  if (!(await stat(nestedPath)).isDirectory()) return
  for (const entry of await readdir(nestedPath)) {
    await rename(join(nestedPath, entry), join(path, entry))
  }
  await rm(nestedPath, { recursive: true, force: true })
}

function createProgressReporter(id: string, totalBytes: number): (downloaded: number) => void {
  let lastPercent = -1
  return (downloaded) => {
    const percent = Math.floor((downloaded / totalBytes) * 100)
    if (percent === lastPercent || percent % 10 !== 0) return
    lastPercent = percent
    console.info(`${id}: ${percent}%`)
  }
}
