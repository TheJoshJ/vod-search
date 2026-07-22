import { spawn } from "node:child_process"
import { access, mkdtemp, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { dirname, isAbsolute, join, resolve } from "node:path"
import type { CodexStatus } from "@vod-search/contracts"

const installerUrl = "https://chatgpt.com/codex/install.ps1"

interface CommandResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface CodexCommandBinding {
  executablePath: string
  prefixArgs: string[]
}

type ActiveState = "installing" | "updating" | "signing-in"

export class CodexManager {
  private activeState: ActiveState | null = null
  private lastError: string | null = null

  constructor(
    readonly installDirectory: string,
    private readonly onChanged: () => void
  ) {}

  get managedExecutablePath(): string {
    return join(this.installDirectory, process.platform === "win32" ? "codex.exe" : "codex")
  }

  async getIndexerBinding(): Promise<CodexCommandBinding | null> {
    return this.resolveCommand()
  }

  async status(): Promise<CodexStatus> {
    const base = await this.probe()
    if (this.activeState) return { ...base, state: this.activeState, error: null }
    if (this.lastError) return { ...base, state: "error", error: this.lastError }
    if (!base.installed) {
      return {
        ...base,
        state: process.platform === "win32" ? "missing" : "unsupported",
        error: process.platform === "win32" ? null : "Automatic Codex installation is currently available on Windows only."
      }
    }
    return { ...base, state: base.authenticated ? "ready" : "signed-out", error: null }
  }

  async install(): Promise<CodexStatus> {
    if (process.platform !== "win32") {
      throw new Error("Automatic Codex installation is currently available on Windows only")
    }
    this.assertIdle()
    const current = await this.probe()
    this.activeState = current.installed ? "updating" : "installing"
    this.lastError = null
    this.onChanged()

    const temporaryPath = await mkdtemp(join(tmpdir(), "vod-search-codex-install-"))
    try {
      const response = await fetch(installerUrl, { redirect: "follow" })
      if (!response.ok) throw new Error(`Codex installer download failed with HTTP ${response.status}`)
      const script = await response.text()
      if (!script.includes("CODEX_INSTALL_DIR") || !script.includes("Test-ArchiveDigest")) {
        throw new Error("The downloaded Codex installer did not match the expected official installer")
      }
      const scriptPath = join(temporaryPath, "install.ps1")
      await writeFile(scriptPath, script, "utf8")
      const result = await runCommand("powershell.exe", [
        "-NoLogo",
        "-NoProfile",
        "-NonInteractive",
        "-ExecutionPolicy", "Bypass",
        "-File", scriptPath
      ], {
        ...process.env,
        CODEX_NON_INTERACTIVE: "1",
        CODEX_INSTALL_DIR: this.installDirectory
      }, 15 * 60_000)
      if (result.exitCode !== 0) throw commandError("Codex installation", result)
      this.activeState = null
      this.onChanged()
      return this.status()
    } catch (error) {
      this.activeState = null
      this.lastError = error instanceof Error ? error.message : String(error)
      this.onChanged()
      throw error
    } finally {
      await rm(temporaryPath, { recursive: true, force: true })
    }
  }

  async login(): Promise<CodexStatus> {
    this.assertIdle()
    const command = await this.resolveCommand()
    if (!command) throw new Error("Install Codex before signing in")
    this.activeState = "signing-in"
    this.lastError = null
    this.onChanged()
    try {
      const result = await runCommand(
        command.executablePath,
        [...command.prefixArgs, "login"],
        process.env,
        10 * 60_000
      )
      if (result.exitCode !== 0) throw commandError("Codex sign-in", result)
      this.activeState = null
      const next = await this.probe()
      if (!next.authenticated) throw new Error("Codex sign-in finished without an authenticated account")
      this.onChanged()
      return { ...next, state: "ready", error: null }
    } catch (error) {
      this.activeState = null
      this.lastError = error instanceof Error ? error.message : String(error)
      this.onChanged()
      throw error
    }
  }

  private assertIdle(): void {
    if (this.activeState) throw new Error(`Codex is already ${this.activeState.replace("-", " ")}`)
  }

  private async probe(): Promise<Omit<CodexStatus, "state" | "error">> {
    const command = await this.resolveCommand()
    if (!command) {
      return { installed: false, authenticated: false, version: null, managed: false }
    }
    const versionResult = await runCommand(
      command.executablePath,
      [...command.prefixArgs, "--version"],
      process.env,
      30_000
    )
    if (versionResult.exitCode !== 0) {
      return { installed: false, authenticated: false, version: null, managed: false }
    }
    const rawVersion = versionResult.stdout.trim()
    const version = rawVersion.match(/([0-9]+\.[0-9]+\.[0-9]+(?:[-+][^\s]+)?)$/)?.[1] ?? (rawVersion || null)
    const authResult = await runCommand(
      command.executablePath,
      [...command.prefixArgs, "login", "status"],
      process.env,
      30_000
    )
    return {
      installed: true,
      authenticated: authResult.exitCode === 0,
      version,
      managed: normalizePath(command.executablePath) === normalizePath(this.managedExecutablePath)
    }
  }

  private async resolveCommand(): Promise<CodexCommandBinding | null> {
    const override = process.env.VOD_SEARCH_CODEX_PATH
    if (override && await pathExists(override)) return { executablePath: override, prefixArgs: [] }
    if (await pathExists(this.managedExecutablePath)) {
      return { executablePath: this.managedExecutablePath, prefixArgs: [] }
    }

    if (process.platform === "win32") {
      const npmBinding = await resolveNpmCodexBinding()
      if (npmBinding) return npmBinding
    }

    const finder = process.platform === "win32" ? "where.exe" : "which"
    const result = await runCommand(finder, [process.platform === "win32" ? "codex.exe" : "codex"], process.env, 10_000)
    if (result.exitCode !== 0) return null
    const first = result.stdout.split(/\r?\n/).map((line) => line.trim()).find(Boolean)
    return first ? { executablePath: resolve(first), prefixArgs: [] } : null
  }
}

async function resolveNpmCodexBinding(): Promise<CodexCommandBinding | null> {
  const shimResult = await runCommand("where.exe", ["codex.cmd"], process.env, 10_000)
  if (shimResult.exitCode !== 0) return null
  const nodeResult = await runCommand("where.exe", ["node.exe"], process.env, 10_000)
  const nodePaths = nodeResult.exitCode === 0
    ? nodeResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)
    : []
  for (const shimPath of shimResult.stdout.split(/\r?\n/).map((line) => line.trim()).filter(Boolean)) {
    const directory = dirname(shimPath)
    const cliPath = join(directory, "node_modules", "@openai", "codex", "bin", "codex.js")
    if (!await pathExists(cliPath)) continue
    const adjacentNodePath = join(directory, "node.exe")
    let nodePath: string | undefined
    if (await pathExists(adjacentNodePath)) nodePath = adjacentNodePath
    else {
      for (const candidate of nodePaths) {
        if (isAbsolute(candidate) && await pathExists(candidate)) {
          nodePath = candidate
          break
        }
      }
    }
    if (nodePath) return { executablePath: nodePath, prefixArgs: [cliPath] }
  }
  return null
}

async function pathExists(path: string): Promise<boolean> {
  if (!isAbsolute(path)) return false
  try {
    await access(path)
    return true
  } catch {
    return false
  }
}

function normalizePath(path: string): string {
  const normalized = resolve(path)
  return process.platform === "win32" ? normalized.toLowerCase() : normalized
}

function runCommand(
  executable: string,
  args: string[],
  env: NodeJS.ProcessEnv,
  timeoutMs: number
): Promise<CommandResult> {
  return new Promise((resolveCommand) => {
    let child: ReturnType<typeof spawn>
    try {
      child = spawn(executable, args, {
        env,
        windowsHide: true,
        stdio: ["ignore", "pipe", "pipe"]
      })
    } catch (error) {
      resolveCommand({
        stdout: "",
        stderr: error instanceof Error ? error.message : String(error),
        exitCode: -1
      })
      return
    }
    if (!child.stdout || !child.stderr) {
      child.kill()
      resolveCommand({ stdout: "", stderr: "The Codex process did not expose output streams", exitCode: -1 })
      return
    }
    let stdout = ""
    let stderr = ""
    let settled = false
    const finish = (result: CommandResult): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      resolveCommand(result)
    }
    const timer = setTimeout(() => {
      child.kill("SIGTERM")
      finish({ stdout, stderr: `${stderr}\nCommand timed out after ${Math.round(timeoutMs / 1000)} seconds.`, exitCode: -1 })
    }, timeoutMs)
    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout = `${stdout}${chunk}`.slice(-20_000) })
    child.stderr.on("data", (chunk: string) => { stderr = `${stderr}${chunk}`.slice(-20_000) })
    child.once("error", (error) => finish({ stdout, stderr: error.message, exitCode: -1 }))
    child.once("close", (exitCode) => finish({ stdout, stderr, exitCode: exitCode ?? -1 }))
  })
}

function commandError(action: string, result: CommandResult): Error {
  const detail = (result.stderr || result.stdout).trim().slice(-2_000)
  return new Error(`${action} failed${detail ? `: ${detail}` : ` with exit code ${result.exitCode}`}`)
}
