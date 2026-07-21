import { createHash } from "node:crypto"
import { createReadStream } from "node:fs"
import { readdir, readFile, rename, rm, stat, writeFile, mkdir } from "node:fs/promises"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import extract from "extract-zip"
import { downloadVerifiedFile } from "../packages/inference/src/models.js"

interface RuntimeArchive {
  id: string
  url: string
  sizeBytes: number
  sha256: string
  flattenSingleDirectory?: boolean
  removeAfterExtract?: string[]
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const cacheRoot = join(projectRoot, ".cache", "runtimes")
const runtimeRoot = join(projectRoot, "resources", "runtime", "windows")

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
    id: "llama-vulkan",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b10075/llama-b10075-bin-win-vulkan-x64.zip",
    sizeBytes: 33_280_315,
    sha256: "763a46cf514443d597e7dc04330012d4e401e40cdb4d61af1fb6145909ad41ae"
  },
  {
    id: "llama-cpu",
    url: "https://github.com/ggml-org/llama.cpp/releases/download/b10075/llama-b10075-bin-win-cpu-x64.zip",
    sizeBytes: 18_013_666,
    sha256: "67ccd320365193e5fa5e2778773a30ee3fc19802b2a9f324023641d160a1e802"
  }
]

await mkdir(cacheRoot, { recursive: true })
await mkdir(runtimeRoot, { recursive: true })

for (const archive of archives) {
  const targetPath = join(runtimeRoot, archive.id)
  const markerPath = join(targetPath, ".runtime.json")
  const marker = JSON.stringify({
    layoutVersion: 2,
    url: archive.url,
    sizeBytes: archive.sizeBytes,
    sha256: archive.sha256
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
  console.info(`${archive.id}: extracting`)
  await extract(archivePath, { dir: targetPath })
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
