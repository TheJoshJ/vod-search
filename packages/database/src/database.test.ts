import { describe, expect, it, vi } from "vitest"
import { resolveSqliteVecExtensionPath } from "./database.js"

describe("resolveSqliteVecExtensionPath", () => {
  it("redirects packaged native extensions to Electron's unpacked directory", () => {
    const exists = vi.fn(() => true)

    expect(resolveSqliteVecExtensionPath(
      "C:\\CutScout\\resources\\app.asar\\node_modules\\sqlite-vec-windows-x64\\vec0.dll",
      exists
    )).toBe("C:\\CutScout\\resources\\app.asar.unpacked\\node_modules\\sqlite-vec-windows-x64\\vec0.dll")
    expect(exists).toHaveBeenCalledWith(
      "C:\\CutScout\\resources\\app.asar.unpacked\\node_modules\\sqlite-vec-windows-x64\\vec0.dll"
    )
  })

  it("keeps development and incomplete package paths unchanged", () => {
    expect(resolveSqliteVecExtensionPath("C:\\workspace\\node_modules\\sqlite-vec\\vec0.dll")).toBe(
      "C:\\workspace\\node_modules\\sqlite-vec\\vec0.dll"
    )
    expect(resolveSqliteVecExtensionPath(
      "C:\\CutScout\\resources\\app.asar\\node_modules\\sqlite-vec-windows-x64\\vec0.dll",
      () => false
    )).toBe("C:\\CutScout\\resources\\app.asar\\node_modules\\sqlite-vec-windows-x64\\vec0.dll")
  })
})
