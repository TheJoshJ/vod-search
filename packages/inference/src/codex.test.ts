import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, it } from "vitest"
import { CodexEnricher } from "./codex.js"

const temporaryPaths: string[] = []

afterEach(async () => {
  await Promise.all(temporaryPaths.splice(0).map((path) => rm(path, { recursive: true, force: true })))
})

describe("CodexEnricher", () => {
  it("uses a managed skill and validates structured transcript enrichment", async () => {
    const root = await mkdtemp(join(tmpdir(), "vod-search-codex-test-"))
    temporaryPaths.push(root)
    const fakeCodexPath = join(root, "fake-codex.mjs")
    const workspacePath = join(root, "workspace")
    await writeFile(fakeCodexPath, fakeCodexScript, "utf8")

    const enricher = new CodexEnricher()
    await enricher.start({
      executablePath: process.execPath,
      executablePrefixArgs: [fakeCodexPath],
      workspacePath
    })

    await expect(enricher.probe()).resolves.toEqual({
      installed: true,
      authenticated: true,
      version: "1.2.3"
    })
    await expect(enricher.enrichTranscript([{
      segmentId: 42,
      text: "I missed resonance and died to the Kalphite King."
    }, {
      segmentId: 43,
      text: "Then we discussed how to change the strategy."
    }])).resolves.toEqual([{
      startSegmentId: 42,
      summary: "The player says they missed Resonance and died to the Kalphite King.",
      entities: [{ name: "Kalphite King", type: "boss" }],
      events: [{ type: "player_death", subject: "player", object: "Kalphite King", confidence: 0.98 }],
      aliases: ["KK", "Kalphite King"],
      searchPhrases: ["death to Kalphite King", "missed resonance at KK"],
      confidence: 0.98
    }])

    const skill = await readFile(join(workspacePath, ".agents", "skills", "vod-transcript-enrichment", "SKILL.md"), "utf8")
    expect(skill).toContain("complete transcript in reading order")
    expect(skill).toContain("Do not split at a fixed time")
    expect(skill).toContain("Never claim to see the video")
  })
})

const fakeCodexScript = `
import { writeFileSync } from "node:fs"

const args = process.argv.slice(2)
if (args.includes("--version")) {
  process.stdout.write("codex-cli 1.2.3\\n")
  process.exit(0)
}
if (args[0] === "login" && args[1] === "status") {
  process.stdout.write("Logged in\\n")
  process.exit(0)
}

if (args[args.indexOf("--model") + 1] !== "gpt-5.4-mini") throw new Error("Expected the low-cost GPT-5.4 Mini synopsis model")
if (!args.includes('model_reasoning_effort="low"')) throw new Error("Expected low reasoning effort")
let input = ""
for await (const chunk of process.stdin) input += chunk
if (args.at(-1) !== "-") throw new Error("Expected Codex to read its complete prompt from stdin")
const match = input.match(/<untimed_transcript_segments_json>\\s*([\\s\\S]*?)\\s*<\\/untimed_transcript_segments_json>/)
if (!match) throw new Error("Untimed transcript JSON was missing from the Codex prompt")
if (input.includes("startMs") || input.includes("endMs")) throw new Error("Timestamps leaked into the Codex prompt")
const request = JSON.parse(match[1])
const outputPath = args[args.indexOf("--output-last-message") + 1]
const topics = [{
  startSegmentId: request.segments[0].segmentId,
  summary: "The player says they missed Resonance and died to the Kalphite King.",
  entities: [{ name: "Kalphite King", type: "boss" }],
  events: [{ type: "player_death", subject: "player", object: "Kalphite King", confidence: 0.98 }],
  aliases: ["KK", "Kalphite King"],
  searchPhrases: ["death to Kalphite King", "missed resonance at KK"],
  confidence: 0.98
}]
writeFileSync(outputPath, JSON.stringify({ topics }))
process.stdout.write(JSON.stringify({ topics }))
`
