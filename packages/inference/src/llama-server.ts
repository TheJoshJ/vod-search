import { spawn, type ChildProcess } from "node:child_process"
import { createServer } from "node:net"

export interface LlamaServerOptions {
  executablePath: string
  modelPath: string
  port?: number
  useGpu?: boolean
  contextSize?: number
  signal?: AbortSignal
}

export class LlamaServer {
  private child: ChildProcess | null = null
  private _baseUrl: string | null = null

  get baseUrl(): string {
    if (!this._baseUrl) throw new Error("llama-server is not running")
    return this._baseUrl
  }

  async start(options: LlamaServerOptions): Promise<string> {
    if (this.child) return this.baseUrl
    const port = options.port ?? await findFreePort()
    const args = [
      "--model", options.modelPath,
      "--host", "127.0.0.1",
      "--port", String(port),
      "--ctx-size", String(options.contextSize ?? 16_384),
      "--parallel", "1",
      "--alias", "qwen3-4b",
      "--jinja",
      "--no-webui",
      "--log-colors", "off",
      "--gpu-layers", options.useGpu === false ? "0" : "99"
    ]
    const child = spawn(options.executablePath, args, {
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"]
    })
    this.child = child
    this._baseUrl = `http://127.0.0.1:${port}`
    child.stdout!.on("data", (chunk) => console.info(`[llama] ${String(chunk).trimEnd()}`))
    child.stderr!.on("data", (chunk) => console.info(`[llama] ${String(chunk).trimEnd()}`))
    child.once("exit", () => {
      this.child = null
      this._baseUrl = null
    })
    const abort = (): void => this.close()
    options.signal?.addEventListener("abort", abort, { once: true })
    await waitForHealth(this.baseUrl, child, options.signal)
    return this.baseUrl
  }

  close(): void {
    this.child?.kill("SIGTERM")
    this.child = null
    this._baseUrl = null
  }
}

export function findFreePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const server = createServer()
    server.once("error", reject)
    server.listen(0, "127.0.0.1", () => {
      const address = server.address()
      if (!address || typeof address === "string") {
        server.close()
        reject(new Error("Could not allocate a loopback port"))
        return
      }
      const port = address.port
      server.close((error) => error ? reject(error) : resolve(port))
    })
  })
}

async function waitForHealth(baseUrl: string, child: ChildProcess, signal?: AbortSignal): Promise<void> {
  const startedAt = Date.now()
  while (Date.now() - startedAt < 120_000) {
    if (signal?.aborted) throw new Error("llama-server startup was cancelled")
    if (child.exitCode !== null) throw new Error(`llama-server exited during startup with code ${child.exitCode}`)
    try {
      const response = await fetch(`${baseUrl}/health`, signal ? { signal } : {})
      if (response.ok) return
    } catch {
      // The server is expected to refuse connections while loading the model.
    }
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  child.kill("SIGTERM")
  throw new Error("Timed out waiting for llama-server to load the model")
}
