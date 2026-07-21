import type { VodSearchApi } from "@vod-search/contracts"

declare global {
  interface Window {
    vodSearch: VodSearchApi
  }
}

export {}
