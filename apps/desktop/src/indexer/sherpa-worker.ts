import { diarizeWithSherpa, type SherpaOptions } from "../../../../packages/inference/src/sherpa.js"

interface WorkerInput extends Omit<SherpaOptions, "signal" | "onProgress"> {}

process.once("message", (message) => { void run(message as WorkerInput) })

async function run(input: WorkerInput): Promise<void> {
  try {
    const result = await diarizeWithSherpa({
      ...input,
      onProgress: (progress) => process.send?.({ type: "progress", progress })
    })
    process.send?.({ type: "result", result })
  } catch (error) {
    process.send?.({
      type: "error",
      error: error instanceof Error ? error.stack ?? error.message : String(error)
    })
  } finally {
    process.disconnect?.()
  }
}
