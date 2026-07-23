const { app } = require("electron")
const { existsSync } = require("node:fs")
const { createRequire } = require("node:module")
const { join } = require("node:path")
const { pathToFileURL } = require("node:url")

const databaseRequire = createRequire(join(__dirname, "..", "packages", "database", "package.json"))
const Database = databaseRequire("better-sqlite3")
const sqliteVec = databaseRequire("sqlite-vec")

function appDataRoot() {
  const localAppData = process.env.LOCALAPPDATA || ""
  const current = join(localAppData, "CutScout")
  const legacy = join(localAppData, ["VOD", "Search"].join(" "))
  return existsSync(current) || !existsSync(legacy) ? current : legacy
}

const cases = [
  {
    query: "food that can overflow your normal health without draining adrenaline",
    expectedTitle: "Risking It All",
    expectedStartMs: 3 * 60_000 + 26_000
  },
  {
    query: "getting strong melee stats quickly in a dangerous training area",
    expectedTitle: "Risking It All",
    expectedStartMs: 12 * 60_000 + 34_000
  },
  {
    query: "finally getting valuable equipment after many dry crypt runs",
    expectedTitle: "Risking It All",
    expectedStartMs: 18 * 60_000 + 55_000
  },
  {
    query: "a long dinosaur island quest unlocked easier archaeology",
    expectedTitle: "Risking It All",
    expectedStartMs: 50 * 60_000 + 20_000
  },
  {
    query: "make boss attempts free for players who are still learning",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 39 * 60_000 + 36_000
  },
  {
    query: "bad upgrades can no longer make augmented equipment worse",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 29 * 60_000 + 30_000
  },
  {
    query: "unlock a useful movement skill much earlier",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 31 * 60_000 + 25_000
  },
  {
    query: "the crystal tool grind was shortened but is still excessive",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 37 * 60_000 + 16_000
  },
  {
    query: "keep boss kill count between trips",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 21 * 60_000 + 42_000
  },
  {
    query: "the energy-gathering skill got a small success-rate buff but kept its real problems",
    expectedTitle: "Midgame Rebalance",
    expectedStartMs: 17 * 60_000 + 31_000
  },
  {
    query: "bandos legs",
    expectedTitle: "Risking It All",
    expectedStartMs: 50 * 60_000 + 20_000
  }
]

function formatTimestamp(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

async function main() {
  const root = join(__dirname, "..")
  const dataRoot = appDataRoot()
  const databasePath = process.env.VOD_SEARCH_DB || join(
    dataRoot,
    "index",
    "vod-search.db"
  )
  const modelPath = process.env.VOD_SEARCH_BGE_PATH || join(
    dataRoot,
    "models",
    "bge-small-en-v1.5",
    "5c38ec7c405ec4b44b94cc5a9bb96e735b38267a"
  )
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  sqliteVec.load(database)
  const [{ Repository }, { SearchService }, { BgeEmbedder }] = await Promise.all([
    import(pathToFileURL(join(root, "packages", "database", "dist", "repository.js")).href),
    import(pathToFileURL(join(root, "packages", "search", "dist", "service.js")).href),
    import(pathToFileURL(join(root, "packages", "inference", "dist", "embeddings.js")).href)
  ])
  const service = new SearchService(new Repository(database))
  const embedder = new BgeEmbedder(modelPath)
  let exitCode = 0

  try {
    await embedder.start()
    const results = []
    for (const testCase of cases) {
      const queryEmbedding = await embedder.embedQuery(testCase.query)
      const response = service.search({
        query: testCase.query,
        mode: "hybrid",
        includeMissing: false,
        limit: 5
      }, queryEmbedding)
      const top = response.hits[0]
      results.push({
        ...testCase,
        hits: response.hits,
        passed: Boolean(
          top &&
          top.title.includes(testCase.expectedTitle) &&
          Math.abs(top.startMs - testCase.expectedStartMs) <= 2_000
        )
      })
    }

    console.log("Live hybrid search evaluation")
    console.log("")
    for (const result of results) {
      const top = result.hits[0]
      console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.query}`)
      if (!top) {
        console.log("      no results")
        continue
      }
      console.log(`      #1 ${formatTimestamp(top.startMs)}  ${top.title}`)
      const breakdown = Object.entries(top.scoreBreakdown)
        .filter(([, score]) => score > 0)
        .map(([name, score]) => `${name} ${score.toFixed(1)}`)
        .join(" + ")
      console.log(`         ${top.matchReasons.join(", ")} · ${top.score.toFixed(1)} / 100 · ${breakdown}`)
      console.log(`         ${top.transcriptExcerpt.slice(0, 180)}`)
      for (const [index, hit] of result.hits.slice(1, 3).entries()) {
        console.log(`      #${index + 2} ${formatTimestamp(hit.startMs)}  ${hit.title}`)
      }
    }

    const passedCount = results.filter((result) => result.passed).length
    console.log("")
    console.log(`${passedCount}/${results.length} expected moments ranked first`)
    exitCode = passedCount === results.length ? 0 : 1
  } finally {
    await embedder.close()
    database.close()
    app.exit(exitCode)
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
