import { describe, expect, it } from "vitest"
import { areDisplayTextsEquivalent, getSearchResultCopy } from "./search-presentation"

describe("getSearchResultCopy", () => {
  it("shows one passage when the transcript and summary are equivalent", () => {
    expect(getSearchResultCopy("The raid starts here.", "the raid starts here"))
      .toEqual({ transcript: "The raid starts here.", summary: null })
  })

  it("keeps a distinct synopsis alongside the matching transcript", () => {
    expect(getSearchResultCopy(
      "We should head back before the timer ends.",
      "The team decides to retreat before time expires."
    )).toEqual({
      transcript: "We should head back before the timer ends.",
      summary: "The team decides to retreat before time expires."
    })
  })

  it("falls back to the summary when transcript context is unavailable", () => {
    expect(getSearchResultCopy("", "The team enters the arena."))
      .toEqual({ transcript: "The team enters the arena.", summary: null })
  })
})

describe("areDisplayTextsEquivalent", () => {
  it("ignores casing, spacing, and punctuation", () => {
    expect(areDisplayTextsEquivalent("  A boss fight—starts!", "a BOSS fight starts"))
      .toBe(true)
  })
})
