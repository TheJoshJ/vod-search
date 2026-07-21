import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process"

export interface ProcessResult {
  stdout: string
  stderr: string
  exitCode: number
}

export interface RunProcessOptions {
  cwd?: string | undefined
  env?: NodeJS.ProcessEnv | undefined
  signal?: AbortSignal | undefined
  stdin?: NodeJS.ReadableStream | undefined
  onStderr?: ((text: string) => void) | undefined
}

export function runProcess(
  executable: string,
  args: string[],
  options: RunProcessOptions = {}
): Promise<ProcessResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, {
      cwd: options.cwd,
      env: options.env,
      windowsHide: true,
      stdio: [options.stdin ? "pipe" : "ignore", "pipe", "pipe"]
    }) as ChildProcessWithoutNullStreams
    let stdout = ""
    let stderr = ""

    child.stdout.setEncoding("utf8")
    child.stderr.setEncoding("utf8")
    child.stdout.on("data", (chunk: string) => { stdout += chunk })
    child.stderr.on("data", (chunk: string) => {
      stderr += chunk
      options.onStderr?.(chunk)
    })

    options.stdin?.pipe(child.stdin)
    const abort = (): void => { child.kill("SIGTERM") }
    options.signal?.addEventListener("abort", abort, { once: true })

    child.once("error", reject)
    child.once("close", (exitCode) => {
      options.signal?.removeEventListener("abort", abort)
      const result = { stdout, stderr, exitCode: exitCode ?? -1 }
      if (exitCode === 0) resolve(result)
      else reject(new ProcessExecutionError(executable, args, result))
    })
  })
}

export class ProcessExecutionError extends Error {
  constructor(
    readonly executable: string,
    readonly args: string[],
    readonly result: ProcessResult
  ) {
    super(`${executable} exited with code ${result.exitCode}: ${result.stderr.slice(-1000)}`)
    this.name = "ProcessExecutionError"
  }
}
