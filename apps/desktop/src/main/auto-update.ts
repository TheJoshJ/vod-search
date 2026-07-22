import { dialog, type BrowserWindow } from "electron"
import electronUpdater, { type UpdateDownloadedEvent } from "electron-updater"

const { autoUpdater } = electronUpdater

const initialCheckDelayMs = 15_000
const recurringCheckIntervalMs = 4 * 60 * 60 * 1000

export function registerAutoUpdates(
  isPackaged: boolean,
  getMainWindow: () => BrowserWindow | null
): () => void {
  if (!isPackaged) return () => undefined

  autoUpdater.autoDownload = true
  autoUpdater.autoInstallOnAppQuit = true
  autoUpdater.disableWebInstaller = true
  autoUpdater.logger = console

  let checking = false
  let prompting = false

  const check = async (): Promise<void> => {
    if (checking) return
    checking = true
    try {
      await autoUpdater.checkForUpdates()
    } catch (error) {
      console.warn("VOD Search could not check for updates:", error)
    } finally {
      checking = false
    }
  }

  const onError = (error: Error): void => {
    console.warn("VOD Search auto-update failed:", error)
  }

  const onDownloaded = (update: UpdateDownloadedEvent): void => {
    if (prompting) return
    prompting = true
    void showUpdateReady(update.version, getMainWindow()).finally(() => {
      prompting = false
    })
  }

  autoUpdater.on("error", onError)
  autoUpdater.on("update-downloaded", onDownloaded)

  const initialTimer = setTimeout(() => void check(), initialCheckDelayMs)
  const recurringTimer = setInterval(() => void check(), recurringCheckIntervalMs)
  initialTimer.unref()
  recurringTimer.unref()

  return () => {
    clearTimeout(initialTimer)
    clearInterval(recurringTimer)
    autoUpdater.removeListener("error", onError)
    autoUpdater.removeListener("update-downloaded", onDownloaded)
  }
}

async function showUpdateReady(version: string, mainWindow: BrowserWindow | null): Promise<void> {
  const options = {
    type: "info" as const,
    title: "VOD Search update ready",
    message: `VOD Search ${version} has been downloaded.`,
    detail: "Restart now to finish installing it, or choose Later to install when you next close the app.",
    buttons: ["Restart now", "Later"],
    defaultId: 0,
    cancelId: 1,
    noLink: true
  }
  const result = mainWindow && !mainWindow.isDestroyed()
    ? await dialog.showMessageBox(mainWindow, options)
    : await dialog.showMessageBox(options)
  if (result.response === 0) autoUpdater.quitAndInstall(false, true)
}
