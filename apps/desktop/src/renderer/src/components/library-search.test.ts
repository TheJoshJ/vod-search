import { describe, expect, it } from "vitest"
import { getLibrarySearchSubmitAction } from "./library-search"

describe("library search submission", () => {
  it("searches a trimmed non-empty query", () => {
    expect(getLibrarySearchSubmitAction("  kalphite king  ", false)).toBe("search")
  })

  it("clears an active results view when an empty query is submitted", () => {
    expect(getLibrarySearchSubmitAction("   ", true)).toBe("clear")
  })

  it("does nothing for an empty query in the normal library view", () => {
    expect(getLibrarySearchSubmitAction("", false)).toBe("none")
  })
})
