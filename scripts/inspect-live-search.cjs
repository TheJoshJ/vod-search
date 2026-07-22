const { app } = require("electron")
const { createRequire } = require("node:module")
const { join } = require("node:path")
const { pathToFileURL } = require("node:url")

const databaseRequire = createRequire(join(__dirname, "..", "packages", "database", "package.json"))
const Database = databaseRequire("better-sqlite3")
const sqliteVec = databaseRequire("sqlite-vec")

function timestamp(milliseconds) {
  const seconds = Math.max(0, Math.floor(milliseconds / 1000))
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`
}

function compact(value, length = 240) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim()
  return text.length > length ? `${text.slice(0, length - 1)}…` : text
}

async function main() {
  const query = process.argv.slice(2).join(" ").trim()
  if (!query) throw new Error("Usage: electron scripts/inspect-live-search.cjs <query>")

  const root = join(__dirname, "..")
  const databasePath = process.env.VOD_SEARCH_DB || join(
    process.env.LOCALAPPDATA || "",
    "VOD Search",
    "index",
    "vod-search.db"
  )
  const modelPath = process.env.VOD_SEARCH_BGE_PATH || join(
    process.env.LOCALAPPDATA || "",
    "VOD Search",
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
  const repository = new Repository(database)
  const search = new SearchService(repository)
  const embedder = new BgeEmbedder(modelPath)

  try {
    await embedder.start()
    const embedding = await embedder.embedQuery(query)
    console.log(`Live search inspection: “${query}”`)
    for (const mode of ["keyword", "semantic", "hybrid"]) {
      const response = search.search({ query, mode, includeMissing: false, limit: 10 }, mode === "keyword" ? undefined : embedding)
      console.log(`\n${mode.toUpperCase()}`)
      response.hits.forEach((hit, index) => {
        console.log(`${index + 1}. ${timestamp(hit.startMs)}–${timestamp(hit.endMs)} ${hit.title}`)
        const breakdown = Object.entries(hit.scoreBreakdown)
          .filter(([, score]) => score > 0)
          .map(([name, score]) => `${name} ${score.toFixed(1)}`)
          .join(" + ")
        console.log(`   ${hit.matchReasons.join(", ")} · score ${hit.score.toFixed(1)} / 100 · ${breakdown}`)
        console.log(`   transcript: ${compact(hit.transcriptExcerpt)}`)
        console.log(`   summary: ${compact(hit.summary)}`)
      })
    }

    const vectorRows = repository.semanticSearch(embedding, false, 100)
    console.log("\nVECTOR DISTANCE DIAGNOSTIC")
    vectorRows.slice(0, 10).forEach((row, index) => {
      console.log(`${index + 1}. ${timestamp(row.startMs)} distance ${row.rank.toFixed(6)} ${row.title}`)
    })
    const asrTarget = vectorRows.find((row) => row.transcript.toLocaleLowerCase("en-US").includes("robleggs"))
    if (asrTarget) {
      console.log(`target. ${timestamp(asrTarget.startMs)} distance ${asrTarget.rank.toFixed(6)} rank ${vectorRows.indexOf(asrTarget) + 1}`)
    }

    const terms = query.toLocaleLowerCase("en-US").match(/[\p{L}\p{N}]+/gu) ?? []
    if (terms.length > 0) {
      const conditions = terms.map(() => "LOWER(sc.transcript || ' ' || COALESCE(sc.summary, '') || ' ' || fts.tags) LIKE ?").join(" AND ")
      const rows = database.prepare(`
        SELECT sc.start_ms, sc.end_ms, sc.transcript, sc.summary, ma.display_name AS title, fts.tags
        FROM search_chunks sc
        JOIN media_assets ma ON ma.id = sc.media_id
        JOIN search_chunks_fts fts ON fts.chunk_id = sc.id
        WHERE ${conditions}
        ORDER BY ma.display_name, sc.start_ms
      `).all(...terms.map((term) => `%${term}%`))
      console.log(`\nCHUNKS CONTAINING ALL TERMS (${rows.length})`)
      rows.forEach((row) => {
        console.log(`${timestamp(row.start_ms)}–${timestamp(row.end_ms)} ${row.title}`)
        console.log(`   transcript: ${compact(row.transcript, 420)}`)
        console.log(`   summary: ${compact(row.summary, 320)}`)
        console.log(`   tags: ${compact(row.tags, 320)}`)
      })

      console.log("\nINDIVIDUAL TERM LOCATIONS IN TIMED TRANSCRIPT")
      for (const term of terms) {
        const segments = database.prepare(`
          SELECT ts.start_ms, ts.end_ms, ts.text, ma.display_name AS title
          FROM transcript_segments ts
          JOIN media_assets ma ON ma.id = ts.media_id
          WHERE LOWER(ts.text) LIKE ?
          ORDER BY ma.display_name, ts.start_ms
          LIMIT 30
        `).all(`%${term}%`)
        console.log(`${term} (${segments.length})`)
        segments.forEach((segment) => {
          console.log(`   ${timestamp(segment.start_ms)} ${segment.title}: ${compact(segment.text, 300)}`)
        })
      }
    }
  } finally {
    await embedder.close()
    database.close()
    app.exit(0)
  }
}

app.whenReady().then(main).catch((error) => {
  console.error(error)
  app.exit(1)
})
