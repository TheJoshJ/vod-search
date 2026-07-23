import Database from "better-sqlite3"
import * as sqliteVec from "sqlite-vec"
import { existsSync } from "node:fs"
import { migrate } from "./migrations.js"

export interface VodDatabase {
  db: Database.Database
  vectorSearchAvailable: boolean
  close(): void
}

export function openDatabase(path: string): VodDatabase {
  const db = new Database(path)
  db.pragma("foreign_keys = ON")
  db.pragma("journal_mode = WAL")
  db.pragma("synchronous = NORMAL")
  db.pragma("busy_timeout = 5000")
  migrate(db)

  let vectorSearchAvailable = false
  try {
    db.loadExtension(resolveSqliteVecExtensionPath(sqliteVec.getLoadablePath()))
    db.exec(`
      CREATE VIRTUAL TABLE IF NOT EXISTS search_chunk_vectors USING vec0(
        chunk_id INTEGER PRIMARY KEY,
        embedding FLOAT[384]
      );
    `)
    vectorSearchAvailable = true
  } catch {
    // Raw full-text search remains functional if a platform-specific vector
    // extension cannot be loaded. The UI surfaces this degraded state.
  }

  return {
    db,
    vectorSearchAvailable,
    close: () => db.close()
  }
}

export function resolveSqliteVecExtensionPath(
  loadablePath: string,
  pathExists: (path: string) => boolean = existsSync
): string {
  const unpackedPath = loadablePath.replace(/\.asar([\\/])/, ".asar.unpacked$1")
  return unpackedPath !== loadablePath && pathExists(unpackedPath) ? unpackedPath : loadablePath
}

