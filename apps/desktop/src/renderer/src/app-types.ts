import type { LibraryStats, SearchHit, SearchMode } from "@vod-search/contracts"

export type AppView = "library" | "short-form" | "speakers" | "activity" | "settings"
export type Theme = "light" | "dark"

export interface LibrarySearchState {
  query: string
  submittedQuery: string
  mode: SearchMode
  dateFrom: string
  dateTo: string
  hits: SearchHit[]
  searched: boolean
}

export const initialLibrarySearchState: LibrarySearchState = {
  query: "",
  submittedQuery: "",
  mode: "hybrid",
  dateFrom: "",
  dateTo: "",
  hits: [],
  searched: false
}

export const emptyStats: LibraryStats = {
  sourceFolders: 0,
  totalMedia: 0,
  availableMedia: 0,
  missingMedia: 0,
  totalDurationMs: 0,
  searchableChunks: 0,
  queuedJobs: 0,
  runningJobs: 0,
  failedJobs: 0
}
