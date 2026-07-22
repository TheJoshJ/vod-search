import { resolve } from "node:path"
import react from "@vitejs/plugin-react"
import tailwindcss from "@tailwindcss/vite"
import { defineConfig, externalizeDepsPlugin } from "electron-vite"

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin({
      exclude: [
        "@vod-search/contracts",
        "@vod-search/database",
        "@vod-search/inference",
        "@vod-search/search"
      ]
    })],
    build: {
      rollupOptions: {
        input: {
          index: resolve("src/main/index.ts"),
          indexer: resolve("src/indexer/index.ts")
        }
      }
    }
  },
  preload: {
    plugins: [externalizeDepsPlugin({ exclude: ["@vod-search/contracts", "zod"] })],
    build: {
      rollupOptions: {
        input: resolve("src/preload/index.ts"),
        output: {
          entryFileNames: "[name].cjs",
          format: "cjs"
        }
      }
    }
  },
  renderer: {
    root: resolve("src/renderer"),
    plugins: [react(), tailwindcss()],
    resolve: {
      alias: {
        "@": resolve("src/renderer/src")
      }
    }
  }
})
