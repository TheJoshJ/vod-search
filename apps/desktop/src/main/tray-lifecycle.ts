export interface RestorableWindow {
  isDestroyed(): boolean
  isMinimized(): boolean
  restore(): void
  show(): void
  focus(): void
}

export function shouldHideWindowOnClose(quitting: boolean, trayReady: boolean): boolean {
  return !quitting && trayReady
}

export function restoreWindow(window: RestorableWindow | null): boolean {
  if (!window || window.isDestroyed()) return false
  if (window.isMinimized()) window.restore()
  window.show()
  window.focus()
  return true
}
