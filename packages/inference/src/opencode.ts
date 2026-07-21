import { spawn, type ChildProcess } from "node:child_process"
import { createOpencodeClient, type OpencodeClient } from "@opencode-ai/sdk/v2/client"
import { enrichedChunkSchema, type EnrichedChunk } from "@vod-search/contracts"
import { z } from "zod"

const enrichmentBatchSchema = z.object({
  chunks: z.array(enrichedChunkSchema).max(8)
})

const enrichmentJsonSchema = {
  type: "object",
  additionalProperties: false,
  required: ["chunks"],
  properties: {
    chunks: {
      type: "array",
      maxItems: 8,
      items: {
        type: "object",
        additionalProperties: false,
        required: ["chunkId", "summary", "entities", "events", "aliases", "searchPhrases", "confidence"],
        properties: {
          chunkId: { type: "integer", minimum: 0 },
          summary: { type: "string", maxLength: 320 },
          entities: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["name", "type"],
              properties: {
                name: { type: "string", minLength: 1, maxLength: 120 },
                type: { type: "string", minLength: 1, maxLength: 60 }
              }
            }
          },
          events: {
            type: "array",
            maxItems: 20,
            items: {
              type: "object",
              additionalProperties: false,
              required: ["type", "subject", "object", "confidence"],
              properties: {
                type: { type: "string", minLength: 1, maxLength: 80 },
                subject: { type: ["string", "null"], maxLength: 120 },
                object: { type: ["string", "null"], maxLength: 120 },
                confidence: { type: "number", minimum: 0, maximum: 1 }
              }
            }
          },
          aliases: { type: "array", maxItems: 30, items: { type: "string", minLength: 1, maxLength: 80 } },
          searchPhrases: { type: "array", maxItems: 20, items: { type: "string", minLength: 1, maxLength: 160 } },
          confidence: { type: "number", minimum: 0, maximum: 1 }
        }
      }
    }
  }
} as const

export interface EnrichmentInputChunk {
  chunkId: number
  startMs: number
  endMs: number
  transcript: string
}

export interface OpenCodeEnricherOptions {
  workspacePath: string
  llamaBaseUrl: string
  port: number
  executablePath: string
}

export class OpenCodeEnricher {
  private client: OpencodeClient | null = null
  private server: ChildProcess | null = null

  async start(options: OpenCodeEnricherOptions): Promise<void> {
    if (this.client) return
    process.chdir(options.workspacePath)
    const providerID = "vod-local"
    const modelID = "qwen3-4b"
    const config = {
        logLevel: "WARN",
        share: "disabled",
        autoupdate: false,
        snapshot: false,
        plugin: [],
        mcp: {},
        formatter: false,
        lsp: false,
        enabled_providers: [providerID],
        model: `${providerID}/${modelID}`,
        small_model: `${providerID}/${modelID}`,
        provider: {
          [providerID]: {
            name: "VOD Search Local",
            npm: "@ai-sdk/openai-compatible",
            options: {
              baseURL: `${options.llamaBaseUrl.replace(/\/$/, "")}/v1`,
              apiKey: "local-only",
              timeout: 300_000
            },
            models: {
              [modelID]: {
                name: "Qwen3 4B Local",
                tool_call: true,
                limit: { context: 32_768, output: 4_096 }
              }
            }
          }
        },
        permission: "deny",
        tools: { "*": false },
        default_agent: "vod-enricher",
        agent: {
          "vod-enricher": {
            description: "Extracts searchable metadata from supplied transcript chunks only.",
            mode: "primary",
            hidden: true,
            temperature: 0.1,
            maxSteps: 1,
            model: `${providerID}/${modelID}`,
            tools: { "*": false },
            permission: "deny",
            prompt: enrichmentSystemPrompt
          }
        },
        experimental: {
          openTelemetry: false,
          continue_loop_on_deny: false
        }
      }
    const server = spawn(options.executablePath, [
      "serve",
      "--hostname=127.0.0.1",
      `--port=${options.port}`,
      "--log-level=WARN"
    ], {
      cwd: options.workspacePath,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
      env: { ...process.env, OPENCODE_CONFIG_CONTENT: JSON.stringify(config) }
    })
    this.server = server
    const baseUrl = await waitForOpenCodeServer(server, 30_000)
    this.client = createOpencodeClient({ baseUrl, directory: options.workspacePath })
  }

  async enrich(chunks: EnrichmentInputChunk[]): Promise<EnrichedChunk[]> {
    if (!this.client) throw new Error("OpenCode enricher has not been started")
    if (chunks.length === 0) return []
    if (chunks.length > 8) throw new Error("An enrichment batch cannot contain more than eight chunks")
    const characters = chunks.reduce((total, chunk) => total + chunk.transcript.length, 0)
    if (characters > 12_000) throw new Error("An enrichment batch cannot exceed 12,000 transcript characters")

    const session = await this.client.session.create({ title: "VOD enrichment batch" }, { throwOnError: true })
    const sessionID = session.data.id
    try {
      const result = await this.client.session.prompt({
        sessionID,
        agent: "vod-enricher",
        model: { providerID: "vod-local", modelID: "qwen3-4b" },
        tools: { "*": false },
        format: { type: "json_schema", schema: enrichmentJsonSchema, retryCount: 2 },
        parts: [{ type: "text", text: JSON.stringify({ chunks }) }]
      }, { throwOnError: true })
      if (result.data.info.error) {
        throw new Error(`OpenCode enrichment failed: ${result.data.info.error.name}`)
      }
      return enrichmentBatchSchema.parse(result.data.info.structured).chunks
    } finally {
      await this.client.session.delete({ sessionID }).catch(() => undefined)
    }
  }

  close(): void {
    this.server?.kill("SIGTERM")
    this.server = null
    this.client = null
  }
}

function waitForOpenCodeServer(child: ChildProcess, timeoutMs: number): Promise<string> {
  return new Promise((resolve, reject) => {
    let output = ""
    let settled = false
    const timeout = setTimeout(() => finish(new Error(`Timed out waiting for OpenCode after ${timeoutMs}ms`)), timeoutMs)
    const onData = (chunk: Buffer): void => {
      output = `${output}${chunk.toString()}`.slice(-8_000)
      for (const line of output.split(/\r?\n/)) {
        if (!line.includes("opencode server listening")) continue
        const match = line.match(/on\s+(https?:\/\/[^\s]+)/)
        if (match?.[1]) finish(null, match[1])
      }
    }
    const finish = (error: Error | null, url?: string): void => {
      if (settled) return
      settled = true
      clearTimeout(timeout)
      child.off("error", onError)
      child.off("exit", onExit)
      if (error) {
        child.kill("SIGTERM")
        reject(error)
      } else {
        resolve(url!)
      }
    }
    const onError = (error: Error): void => finish(error)
    const onExit = (code: number | null): void => finish(
      new Error(`OpenCode exited during startup with code ${code}: ${output.trim().slice(-2_000)}`)
    )
    child.stdout?.on("data", onData)
    child.stderr?.on("data", onData)
    child.on("error", onError)
    child.on("exit", onExit)
  })
}

const enrichmentSystemPrompt = `You extract search metadata from timestamped transcript chunks.
Use only the supplied spoken or caption text. Never claim to see the video and never infer a silent visual event.
Return exactly one record for every supplied chunkId. Keep summaries factual and concise.
Normalize event types as lowercase snake_case. Add aliases only when they are supported by context or common expansions.
Confidence measures how directly the transcript supports the metadata.`
