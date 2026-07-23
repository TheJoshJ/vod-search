import { useEffect, useState } from "react"
import {
  type CodexStatus,
  type ModelInstallation,
  type SourceFolder,
  type SpeakerEngineStatus
} from "@vod-search/contracts"
import { CheckCircle2, Clock3, EllipsisVertical, FolderOpen, FolderOutput, HardDrive, LoaderCircle, Plus, Settings, Sparkles, Trash2, Users } from "lucide-react"
import type { Theme } from "@/app-types"
import { WorkspacePage } from "@/components/app-shell"
import { AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent, AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle } from "@/components/ui/alert-dialog"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { DropdownMenu, DropdownMenuContent, DropdownMenuGroup, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu"
import { Progress } from "@/components/ui/progress"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { codexStatusLabel, formatBytes, formatRelative, modelDescription, modelName, speakerEngineLabel } from "@/lib/format"
import { cn } from "@/lib/utils"

export interface SettingsWorkspaceProps {
  folders: SourceFolder[]
  models: ModelInstallation[]
  codex: CodexStatus
  theme: Theme
  setTheme: (theme: Theme) => void
  onAddFolder: () => void
  onRefreshLibrary: () => Promise<void>
  onRefreshModels: () => Promise<void>
  onRefreshCodex: () => Promise<void>
  onError: (error: unknown) => void
}

export function SettingsWorkspace({ folders, models, codex, theme, setTheme, onAddFolder, onRefreshLibrary, onRefreshModels, onRefreshCodex, onError }: SettingsWorkspaceProps): React.JSX.Element {
  const [folderToRemove, setFolderToRemove] = useState<SourceFolder | null>(null)
  const [busyFolderId, setBusyFolderId] = useState<string | null>(null)
  const [clipOutputFolder, setClipOutputFolder] = useState<string | null>(null)
  const [clipFolderBusy, setClipFolderBusy] = useState(false)
  const [speakerEngine, setSpeakerEngine] = useState<SpeakerEngineStatus>({ state: "missing", stage: "idle", error: null })

  useEffect(() => {
    let active = true
    const refresh = async (): Promise<void> => {
      try {
        const status = await window.vodSearch.speakers.status()
        if (active) setSpeakerEngine(status)
      } catch (error) {
        if (active) onError(error)
      }
    }
    void refresh()
    return () => { active = false }
  }, [onError])

  useEffect(() => {
    let active = true
    void window.vodSearch.clips.getOutputFolder().then((path) => {
      if (active) setClipOutputFolder(path)
    }).catch((error: unknown) => {
      if (active) onError(error)
    })
    return () => { active = false }
  }, [onError])

  async function download(modelId: string): Promise<void> {
    try { await window.vodSearch.models.download(modelId) } catch (error) { onError(error) } finally { await onRefreshModels() }
  }

  async function runCodex(action: () => Promise<CodexStatus>): Promise<void> {
    try { await action() } catch (error) { onError(error) } finally { await onRefreshCodex() }
  }

  async function setFolderSharing(folderId: string, enabled: boolean): Promise<void> {
    try { await window.vodSearch.library.setFolderSharing(folderId, enabled) } catch (error) { onError(error) } finally { await onRefreshLibrary() }
  }

  async function runFolderAction(folderId: string, action: () => Promise<void>): Promise<void> {
    setBusyFolderId(folderId)
    try { await action() } catch (error) { onError(error) } finally { setBusyFolderId(null); await onRefreshLibrary() }
  }

  async function chooseClipOutputFolder(): Promise<void> {
    setClipFolderBusy(true)
    try {
      setClipOutputFolder(await window.vodSearch.clips.selectOutputFolder())
      await onRefreshLibrary()
    } catch (error) {
      onError(error)
    } finally {
      setClipFolderBusy(false)
    }
  }

  const codexBusy = ["checking", "installing", "updating", "signing-in"].includes(codex.state)
  return (
    <WorkspacePage title="Settings" description="Sources, processing components, and local preferences" actions={<Button size="sm" onClick={onAddFolder}><Plus />Add folder</Button>}>
      <SettingsSection title="Codex enrichment" description="Summaries and searchable event metadata generated from transcripts.">
        <SettingRow icon={Sparkles} title="Codex CLI" description={`Uses your ChatGPT or OpenAI account${codex.version ? ` · ${codex.version}` : ""}. Transcript batches are sent to OpenAI for enrichment.`}>
          <Badge variant={codex.state === "ready" ? "accent" : codex.state === "error" ? "destructive" : "secondary"}>{codexStatusLabel(codex)}</Badge>
          {codex.installed && !codex.authenticated && <Button size="sm" disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.login())}>{codex.state === "signing-in" ? <LoaderCircle className="animate-spin" /> : null}Sign in</Button>}
          {codex.state !== "unsupported" && <Button variant={codex.installed ? "outline" : "default"} size="sm" disabled={codexBusy} onClick={() => void runCodex(() => window.vodSearch.codex.install())}>{["installing", "updating"].includes(codex.state) ? <LoaderCircle className="animate-spin" /> : null}{codex.installed ? "Update" : "Install"}</Button>}
        </SettingRow>
        {codex.error && <div className="border-t py-2 text-[10px] text-destructive">{codex.error}</div>}
      </SettingsSection>

      <SettingsSection title="On-device components" description="Local transcription, speaker recognition, and semantic search models.">
        {models.map((model) => <SettingRow key={model.modelId} icon={HardDrive} title={modelName(model.modelId)} description={`${modelDescription(model.modelId)} · ${formatBytes(model.sizeBytes)}`}>{model.status === "installed" ? <Badge variant="accent"><CheckCircle2 />Installed</Badge> : model.status === "downloading" ? <Button variant="ghost" size="sm" onClick={() => void window.vodSearch.models.cancelDownload(model.modelId)}>Cancel</Button> : <Button variant="outline" size="sm" onClick={() => void download(model.modelId)}>Install</Button>}</SettingRow>)}
        {models.some((model) => model.status === "downloading") && <div className="border-t py-2">{models.filter((model) => model.status === "downloading").map((model) => <Progress key={model.modelId} className="h-1" value={model.bytesDownloaded / model.sizeBytes * 100} />)}</div>}
        <SettingRow icon={Users} title="Sherpa ONNX speaker recognition" description="Bundled local speaker separation and recurring voice matching. No account or setup required."><Badge variant={speakerEngine.state === "ready" ? "accent" : speakerEngine.state === "error" ? "destructive" : "secondary"}>{speakerEngine.state === "ready" ? <CheckCircle2 /> : null}{speakerEngineLabel(speakerEngine)}</Badge></SettingRow>
        {speakerEngine.error && <div className="py-2 text-[10px] text-destructive">{speakerEngine.error}</div>}
      </SettingsSection>

      <SettingsSection title="Source folders" description="Shared bundles are imported automatically. Publishing is controlled per folder.">
        {folders.length === 0 ? <div className="py-4 text-xs text-muted-foreground">No folders configured.</div> : folders.map((folder) => (
          <SettingRow key={folder.id} icon={FolderOpen} title={folder.path} titleMono description={`${folder.availableMediaCount} videos · ${folder.missingMediaCount} missing · ${folder.lastScanAtMs ? `scanned ${formatRelative(folder.lastScanAtMs)}` : "scanning"}`}>
            <div className="text-right"><div className="flex items-center justify-end gap-1.5"><Badge variant={folder.missingMediaCount > 0 ? "destructive" : folder.lastScanAtMs ? "accent" : "secondary"}>{folder.lastScanAtMs ? folder.missingMediaCount > 0 ? "Needs attention" : "Healthy" : "Scanning"}</Badge><span className="text-[9px] text-muted-foreground">{folder.publishSharedMetadata ? "Sharing transcripts" : "Import only"}</span></div><div className="mt-1 flex items-center justify-end gap-2"><span className="text-[9px] text-muted-foreground">Publish</span><Switch checked={folder.publishSharedMetadata} disabled={busyFolderId === folder.id} onCheckedChange={(enabled) => void setFolderSharing(folder.id, enabled)} /></div></div>
            <FolderActions folder={folder} busy={busyFolderId === folder.id} onAction={runFolderAction} onRemove={() => setFolderToRemove(folder)} />
          </SettingRow>
        ))}
      </SettingsSection>

      <SettingsSection title="Clip exports" description="Regular and Short form clips use one dedicated output location.">
        <SettingRow icon={FolderOutput} title={clipOutputFolder ?? "Choosing a default folder…"} titleMono description="This entire folder is excluded from indexing, even when it sits inside one of your source folders.">
          {clipOutputFolder && <Button variant="ghost" size="sm" disabled={clipFolderBusy} onClick={() => void window.vodSearch.clips.revealOutputFolder().catch(onError)}>Open</Button>}
          <Button variant="outline" size="sm" disabled={clipFolderBusy} onClick={() => void chooseClipOutputFolder()}>{clipFolderBusy ? <LoaderCircle className="animate-spin" /> : <FolderOpen />}{clipOutputFolder ? "Change folder" : "Choose folder"}</Button>
        </SettingRow>
      </SettingsSection>

      <SettingsSection title="Preferences" description="Appearance and background resource use.">
        <SettingRow title="Dark appearance" description="Use the dark workspace theme."><Switch checked={theme === "dark"} onCheckedChange={(checked) => setTheme(checked ? "dark" : "light")} /></SettingRow>
        <SettingRow title="Resource mode" description="Controls CPU resources available to local speech processing."><Select defaultValue="normal" onValueChange={(value) => void window.vodSearch.jobs.setResourceMode(value as "low" | "normal" | "high").catch(onError)}><SelectTrigger className="h-8 min-w-40 text-xs"><SelectValue /></SelectTrigger><SelectContent><SelectItem value="low">Low impact</SelectItem><SelectItem value="normal">Balanced</SelectItem><SelectItem value="high">High performance</SelectItem></SelectContent></Select></SettingRow>
      </SettingsSection>

      <SettingsSection title="Storage and privacy" description="How CutScout handles your data."><div className="py-3 text-xs leading-5 text-muted-foreground">Videos, transcripts, voice patterns, embeddings, and the search index remain in local application data. Speaker recognition runs entirely on this computer. Codex only receives transcript batches when it creates enrichment metadata.</div></SettingsSection>
      <RemoveFolderDialog folder={folderToRemove} onClose={() => setFolderToRemove(null)} onRemove={(folder) => void runFolderAction(folder.id, () => window.vodSearch.library.removeFolder(folder.id))} />
    </WorkspacePage>
  )
}

function FolderActions({ folder, busy, onAction, onRemove }: { folder: SourceFolder; busy: boolean; onAction: (id: string, action: () => Promise<void>) => Promise<void>; onRemove: () => void }): React.JSX.Element {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="icon-sm" aria-label={`Actions for ${folder.path}`} disabled={busy}>{busy ? <LoaderCircle className="animate-spin" /> : <EllipsisVertical />}</Button></DropdownMenuTrigger><DropdownMenuContent align="end" className="w-48"><DropdownMenuGroup><DropdownMenuItem onSelect={() => void onAction(folder.id, () => window.vodSearch.library.rescanFolder(folder.id))}><Clock3 />Rescan now</DropdownMenuItem><DropdownMenuItem onSelect={() => void onAction(folder.id, () => window.vodSearch.library.revealFolder(folder.id))}><FolderOpen />Open folder</DropdownMenuItem></DropdownMenuGroup><DropdownMenuSeparator /><DropdownMenuGroup><DropdownMenuItem variant="destructive" onSelect={onRemove}><Trash2 />Remove source</DropdownMenuItem></DropdownMenuGroup></DropdownMenuContent></DropdownMenu>
}

function RemoveFolderDialog({ folder, onClose, onRemove }: { folder: SourceFolder | null; onClose: () => void; onRemove: (folder: SourceFolder) => void }): React.JSX.Element {
  return <AlertDialog open={Boolean(folder)} onOpenChange={(open) => { if (!open) onClose() }}><AlertDialogContent size="sm"><AlertDialogHeader><AlertDialogTitle>Remove this source?</AlertDialogTitle><AlertDialogDescription>The folder and video files will stay on disk. CutScout will remove only its local index, transcript copies, summaries, and processing history for this source.</AlertDialogDescription></AlertDialogHeader><AlertDialogFooter><AlertDialogCancel>Keep source</AlertDialogCancel><AlertDialogAction variant="destructive" onClick={() => { if (folder) onRemove(folder); onClose() }}>Remove source</AlertDialogAction></AlertDialogFooter></AlertDialogContent></AlertDialog>
}

function SettingsSection({ title, description, children }: { title: string; description: string; children: React.ReactNode }): React.JSX.Element {
  return <section className="grid grid-cols-[13rem_minmax(0,1fr)] gap-8 border-b py-6 max-[1100px]:grid-cols-[11rem_minmax(0,1fr)]"><div><h2 className="text-xs font-semibold">{title}</h2><p className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</p></div><div className="min-w-0 divide-y">{children}</div></section>
}

function SettingRow({ icon: Icon, title, titleMono = false, description, children }: { icon?: typeof Settings; title: string; titleMono?: boolean; description: string; children: React.ReactNode }): React.JSX.Element {
  return <div className="workspace-row flex min-h-14 items-center gap-3 px-2 py-3 hover:bg-accent/20 first:pt-0 last:pb-0">{Icon && <Icon className="size-3.5 shrink-0 text-muted-foreground" />}<div className="min-w-0 flex-1"><div className={cn("truncate text-xs font-semibold", titleMono && "font-mono text-[10px]")}>{title}</div><div className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</div></div><div className="flex shrink-0 items-center gap-1.5">{children}</div></div>
}
