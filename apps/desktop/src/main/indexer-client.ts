import { randomUUID } from "node:crypto"
import { join } from "node:path"
import { utilityProcess, type UtilityProcess } from "electron"

interface RpcRequest {
  type: "request"
  id: string
  method: string
  payload: unknown
}

interface RpcResponse {
  type: "response"
  id: string
  result?: unknown
  error?: string
}

interface IndexerEvent {
  type: "event"
  name: "ready" | "library-changed" | "jobs-changed" | "models-changed"
  payload?: unknown
}

export class IndexerClient {
  private child: UtilityProcess | null = null
  private readonly pending = new Map<string, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timer: NodeJS.Timeout
  }>()
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>()

  async start(databasePath: string, modelsPath: string, resourcesPath: string): Promise<void> {
    if (this.child) return
    const entry = join(__dirname, "indexer.js")
    const child = utilityProcess.fork(entry, [], {
      serviceName: "VOD Search Indexer",
      env: {
        ...process.env,
        VOD_SEARCH_DB_PATH: databasePath,
        VOD_SEARCH_MODELS_PATH: modelsPath,
        VOD_SEARCH_RESOURCES_PATH: resourcesPath,
        OPENCODE_DISABLE_CLAUDE_CODE: "1"
      },
      stdio: "pipe"
    })
    this.child = child
    child.on("message", (message: RpcResponse | IndexerEvent) => this.onMessage(message))
    child.on("exit", (code) => {
      const error = new Error(`Indexer exited with code ${code}`)
      for (const pending of this.pending.values()) {
        clearTimeout(pending.timer)
        pending.reject(error)
      }
      this.pending.clear()
      this.child = null
    })
    child.stderr?.on("data", (chunk) => console.error(`[indexer] ${String(chunk).trimEnd()}`))
    child.stdout?.on("data", (chunk) => console.info(`[indexer] ${String(chunk).trimEnd()}`))
    await this.waitForEvent("ready", 15_000)
  }

  request<T>(method: string, payload?: unknown, timeoutMs = 30_000): Promise<T> {
    if (!this.child) return Promise.reject(new Error("Indexer is not running"))
    const id = randomUUID()
    return new Promise<T>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id)
        reject(new Error(`Indexer request timed out: ${method}`))
      }, timeoutMs)
      this.pending.set(id, {
        resolve: (value) => resolve(value as T),
        reject,
        timer
      })
      const request: RpcRequest = { type: "request", id, method, payload }
      this.child!.postMessage(request)
    })
  }

  on(name: IndexerEvent["name"], listener: (payload: unknown) => void): () => void {
    const listeners = this.listeners.get(name) ?? new Set()
    listeners.add(listener)
    this.listeners.set(name, listeners)
    return () => listeners.delete(listener)
  }

  stop(): void {
    this.child?.kill()
    this.child = null
  }

  private onMessage(message: RpcResponse | IndexerEvent): void {
    if (message.type === "event") {
      for (const listener of this.listeners.get(message.name) ?? []) listener(message.payload)
      return
    }
    const pending = this.pending.get(message.id)
    if (!pending) return
    clearTimeout(pending.timer)
    this.pending.delete(message.id)
    if (message.error) pending.reject(new Error(message.error))
    else pending.resolve(message.result)
  }

  private waitForEvent(name: IndexerEvent["name"], timeoutMs: number): Promise<void> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        unsubscribe()
        reject(new Error(`Timed out waiting for indexer event: ${name}`))
      }, timeoutMs)
      const unsubscribe = this.on(name, () => {
        clearTimeout(timer)
        unsubscribe()
        resolve()
      })
    })
  }
}
