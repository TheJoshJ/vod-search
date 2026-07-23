import { describe, expect, it, vi } from "vitest"
import { restoreWindow, shouldHideWindowOnClose, type RestorableWindow } from "./tray-lifecycle.js"

describe("tray lifecycle", () => {
  it("hides close requests only while the tray is available and the app is not quitting", () => {
    expect(shouldHideWindowOnClose(false, true)).toBe(true)
    expect(shouldHideWindowOnClose(false, false)).toBe(false)
    expect(shouldHideWindowOnClose(true, true)).toBe(false)
  })

  it("restores, shows, and focuses a minimized window", () => {
    const window: RestorableWindow = {
      isDestroyed: () => false,
      isMinimized: () => true,
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }

    expect(restoreWindow(window)).toBe(true)
    expect(window.restore).toHaveBeenCalledOnce()
    expect(window.show).toHaveBeenCalledOnce()
    expect(window.focus).toHaveBeenCalledOnce()
  })

  it("does not act on a destroyed window", () => {
    const window: RestorableWindow = {
      isDestroyed: () => true,
      isMinimized: vi.fn(),
      restore: vi.fn(),
      show: vi.fn(),
      focus: vi.fn()
    }

    expect(restoreWindow(window)).toBe(false)
    expect(window.show).not.toHaveBeenCalled()
  })
})
