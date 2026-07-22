const { app } = require("electron")
const { createRequire } = require("node:module")
const { join } = require("node:path")

const databaseRequire = createRequire(join(__dirname, "..", "packages", "database", "package.json"))
const Database = databaseRequire("better-sqlite3")

const cases = [
  { query: "Hungry Like the Wolf", expectedTitle: "Risking It All", expectedStartMs: 3 * 60_000 + 26_000 },
  { query: "Sure-footed aura", expectedTitle: "Risking It All", expectedStartMs: 6 * 60_000 + 59_000 },
  { query: "Guthan's Warspear", expectedTitle: "Risking It All", expectedStartMs: 18 * 60_000 + 55_000 },
  { query: "Bandos chest plate", expectedTitle: "Risking It All", expectedStartMs: 29 * 60_000 + 31_000 },
  { query: "Blackstone Dragon", expectedTitle: "Risking It All", expectedStartMs: 50 * 60_000 + 20_000 },
  { query: "Cosmic Focus", expectedTitle: "Risking It All", expectedStartMs: 46 * 60_000 + 22_000 },
  { query: "unlocks Cosmic Focus", expectedTitle: "Risking It All", expectedStartMs: 50 * 60_000 + 20_000 },
  { query: "harmonic dust", expectedTitle: "Midgame Rebalance", expectedStartMs: 37 * 60_000 + 16_000 },
  { query: "Jad pet", expectedTitle: "Midgame Rebalance", expectedStartMs: 41 * 60_000 + 10_000 },
  { query: "Dive ability", expectedTitle: "Midgame Rebalance", expectedStartMs: 31 * 60_000 + 25_000 },
  { query: "Dragon pickaxe", expectedTitle: "Midgame Rebalance", expectedStartMs: 43 * 60_000 + 44_000 },
  { query: "God Wars Dungeon 2 reputation", expectedTitle: "Midgame Rebalance", expectedStartMs: 24 * 60_000 },
  { query: "negative Invention perks", expectedTitle: "Midgame Rebalance", expectedStartMs: 29 * 60_000 + 30_000 },
  { query: "demonic skull", expectedTitle: "Midgame Rebalance", expectedStartMs: 26 * 60_000 + 52_000 },
  { query: "instance costs", expectedTitle: "Midgame Rebalance", expectedStartMs: 39 * 60_000 + 36_000 },
  { query: "upgraded Gem Bag", expectedTitle: "Midgame Rebalance", expectedStartMs: 42 * 60_000 + 38_000 },
  { query: "red sandstone", expectedTitle: "Midgame Rebalance", expectedStartMs: 34 * 60_000 + 21_000 }
]

const stopWords = new Set(["a", "an", "the", "to", "of", "in", "on", "at", "for", "and", "or"])

function quoteFts(value) {
  return `"${value.replaceAll('"', '""')}"`
}

function toFtsQuery(query) {
  const normalized = query.trim().replace(/\s+/g, " ")
  const phrase = quoteFts(normalized)
  const terms = [...new Set(normalized.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+(?:['’-][\p{L}\p{N}]+)*/gu) ?? [])]
    .filter((term) => !stopWords.has(term))
  return terms.length === 0 ? phrase : `${phrase} OR (${terms.map(quoteFts).join(" AND ")})`
}

function parseStringValues(json, objectKey) {
  try {
    const value = JSON.parse(json)
    if (!Array.isArray(value)) return []
    return value.flatMap((item) => {
      if (typeof item === "string") return [item]
      const candidate = objectKey && item && typeof item === "object" ? item[objectKey] : undefined
      return typeof candidate === "string" ? [candidate] : []
    })
  } catch {
    return []
  }
}

function formatTimestamp(milliseconds) {
  const seconds = Math.floor(milliseconds / 1000)
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function search(database, query, limit = 5) {
  const rows = database.prepare(`
    SELECT sc.id AS chunk_id, sc.media_id, ma.display_name AS title,
           sc.start_ms, sc.end_ms, sc.transcript, sc.summary,
           sc.entities_json, sc.events_json, sc.aliases_json,
           bm25(search_chunks_fts, 0.0, 3.0, 2.0, 1.5, 2.0) AS rank
    FROM search_chunks_fts
    JOIN search_chunks sc ON sc.id = search_chunks_fts.chunk_id
    JOIN media_assets ma ON ma.id = sc.media_id
    WHERE search_chunks_fts MATCH ? AND ma.availability = 'available'
    ORDER BY rank
    LIMIT 100
  `).all(toFtsQuery(query))

  const queryLower = query.toLocaleLowerCase("en-US")
  const ranked = rows.map((row, index) => {
    const searchable = [
      row.title,
      row.transcript,
      row.summary ?? "",
      ...parseStringValues(row.entities_json, "name"),
      ...parseStringValues(row.events_json, "type"),
      ...parseStringValues(row.aliases_json)
    ].join(" ").toLocaleLowerCase("en-US")
    const exact = searchable.includes(queryLower)
    return { ...row, exact, score: 1 / (61 + index) + (exact ? 0.02 : 0) }
  }).sort((left, right) => right.score - left.score)

  const merged = []
  for (const hit of ranked) {
    const duplicate = merged.some(
      (candidate) => candidate.media_id === hit.media_id && Math.abs(candidate.start_ms - hit.start_ms) <= 15_000
    )
    if (!duplicate) merged.push(hit)
  }
  return merged.slice(0, limit)
}

async function main() {
  const databasePath = process.env.VOD_SEARCH_DB || join(
    process.env.LOCALAPPDATA || "",
    "VOD Search",
    "index",
    "vod-search.db"
  )
  const database = new Database(databasePath, { readonly: true, fileMustExist: true })
  let exitCode = 0

  try {
    if (process.argv.includes("--status")) {
      const chunks = database.prepare(`
        SELECT COUNT(*) AS total,
               SUM(CASE WHEN embedding_version IS NOT NULL THEN 1 ELSE 0 END) AS embedded
        FROM search_chunks
      `).get()
      const jobs = database.prepare(`
        SELECT stage, status, ROUND(progress * 100) AS progress, error
        FROM jobs
        WHERE stage = 'embed'
        ORDER BY updated_at_ms DESC
      `).all()
      const versions = database.prepare(`
        SELECT embedding_version AS version, COUNT(*) AS chunks
        FROM search_chunks
        GROUP BY embedding_version
        ORDER BY embedding_version
      `).all()
      const folders = database.prepare(`
        SELECT path, publish_shared_metadata AS publishSharedMetadata
        FROM source_folders
        ORDER BY added_at_ms
      `).all().map((folder) => ({
        ...folder,
        publishSharedMetadata: folder.publishSharedMetadata === 1
      }))
      console.log(JSON.stringify({ chunks, versions, jobs, folders }, null, 2))
      return
    }

    const dumpTitleAt = process.argv.indexOf("--dump-title")
    if (dumpTitleAt >= 0) {
      const titleFragment = process.argv[dumpTitleAt + 1]
      if (!titleFragment) throw new Error("--dump-title requires a title fragment")
      const topics = database.prepare(`
        SELECT sc.start_ms, sc.summary, ma.display_name AS title
        FROM search_chunks sc
        JOIN media_assets ma ON ma.id = sc.media_id
        WHERE ma.display_name LIKE ?
        ORDER BY sc.start_ms
      `).all(`%${titleFragment}%`)
      for (const topic of topics) {
        console.log(`${formatTimestamp(topic.start_ms)}  ${topic.summary ?? "(no summary)"}`)
      }
      return
    }

    const indexedChunkCount = database.prepare("SELECT COUNT(*) AS count FROM search_chunks").get().count
    const results = cases.map((testCase) => {
      const hits = search(database, testCase.query)
      const top = hits[0]
      const passed = Boolean(
        top &&
        top.title.includes(testCase.expectedTitle) &&
        Math.abs(top.start_ms - testCase.expectedStartMs) <= 2_000
      )
      return { ...testCase, passed, hits }
    })

    console.log(`Live keyword search evaluation: ${indexedChunkCount} indexed moments`)
    console.log("")
    for (const result of results) {
      const top = result.hits[0]
      console.log(`${result.passed ? "PASS" : "FAIL"}  ${result.query}`)
      if (!top) {
        console.log("      no results")
        continue
      }
      console.log(`      #1 ${formatTimestamp(top.start_ms)}  ${top.title}`)
      console.log(`         ${top.summary ?? top.transcript.slice(0, 180)}`)
      for (const [index, hit] of result.hits.slice(1, 3).entries()) {
        console.log(`      #${index + 2} ${formatTimestamp(hit.start_ms)}  ${hit.title}`)
      }
    }

    const passedCount = results.filter((result) => result.passed).length
    console.log("")
    console.log(`${passedCount}/${results.length} expected moments ranked first`)
    exitCode = passedCount === results.length ? 0 : 1
  } finally {
    database.close()
    app.exit(exitCode)
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
