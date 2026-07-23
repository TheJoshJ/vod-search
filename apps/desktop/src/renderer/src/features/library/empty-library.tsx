import { useState } from "react"
import { isProcessingWindowOpen, nextProcessingWindowStart, type CodexStatus, type ModelInstallation, type ProcessingSchedule, type SourceFolder } from "@vod-search/contracts"
import { CheckCircle2, Database, Download, FolderOpen, LoaderCircle, Settings, Share2 } from "lucide-react"
import { Button } from "@/components/ui/button"
import { Switch } from "@/components/ui/switch"
import { codexStatusLabel, formatNextScheduleStart } from "@/lib/format"
import { cn } from "@/lib/utils"

export function EmptyLibrary({ folders, models, codex, processingSchedule, onAddFolder, onPrepareModels, onOpenSettings }: {
  folders: SourceFolder[]
  models: ModelInstallation[]
  codex: CodexStatus
  processingSchedule: ProcessingSchedule
  onAddFolder: (publishSharedMetadata: boolean) => void
  onPrepareModels: () => void
  onOpenSettings: () => void
}): React.JSX.Element {
  const [publishSharedMetadata, setPublishSharedMetadata] = useState(false)
  const localModelsReady = models.length > 0 && models.every((model) => model.status === "installed")
  const modelsDownloading = models.some((model) => model.status === "downloading")
  const sourceConnected = folders.length > 0
  const sourceScanning = sourceConnected && folders.some((folder) => folder.lastScanAtMs === null)
  const ingestionOpen = isProcessingWindowOpen(processingSchedule.ingestion)
  const sourceWaitingForSchedule = sourceScanning && !ingestionOpen
  const nextIngestion = nextProcessingWindowStart(processingSchedule.ingestion)
  return (
    <div className="mx-auto max-w-[980px] pt-10">
      <div className="grid grid-cols-[minmax(0,1.35fr)_minmax(17rem,0.65fr)] border-y max-[980px]:grid-cols-1">
        <section className="border-r px-8 py-9 max-[980px]:border-b max-[980px]:border-r-0">
          <div className="font-mono text-[9px] uppercase tracking-[0.18em] text-primary">{sourceConnected ? "Preparing library" : "First run"}</div>
          <h2 className="mt-3 max-w-lg text-2xl font-semibold tracking-tight">{sourceConnected ? "Your first source is connected. We’re making it searchable." : "Connect the folder where your videos already live."}</h2>
          <p className="mt-3 max-w-xl text-xs leading-5 text-muted-foreground">{sourceConnected ? "Shared transcripts are imported first. Videos without reusable data then move through transcription, topic analysis, and semantic indexing." : "CutScout scans in place, reuses subtitles and shared metadata first, then queues only the work that is still missing."}</p>
          {!sourceConnected && <div className="mt-7 flex items-start gap-3 border-y py-4"><Share2 className="mt-0.5 size-4 shrink-0 text-primary" /><div className="min-w-0 flex-1"><label htmlFor="publish-shared-metadata" className="text-xs font-semibold">Contribute results to this folder</label><p className="mt-1 text-[10px] leading-4 text-muted-foreground">Write portable transcripts and topic summaries under <span className="font-mono">.vod-search</span> so other users of the same folder can skip transcription and Codex summarization.</p></div><Switch id="publish-shared-metadata" checked={publishSharedMetadata} onCheckedChange={setPublishSharedMetadata} /></div>}
          {sourceConnected ? <div className="mt-7 border-y"><ReadinessRow label="Folder connected" description={folders[0]!.path} ready /><ReadinessRow label="Shared data" description={sourceWaitingForSchedule ? `Waiting for ingestion window${nextIngestion ? ` · ${formatNextScheduleStart(nextIngestion)}` : ""}` : "Importing compatible transcripts and summaries first"} ready={!sourceScanning} busy={sourceScanning && ingestionOpen} /><ReadinessRow label="Remaining processing" description="Only missing transcription, topics, and embeddings will be queued" ready={false} busy={sourceScanning && ingestionOpen} /></div> : null}
          <Button className="mt-6" size="sm" variant={sourceConnected ? "outline" : "default"} onClick={() => onAddFolder(publishSharedMetadata)}><FolderOpen />{sourceConnected ? "Add another folder" : "Choose video folder"}</Button>
        </section>
        <aside className="px-6 py-7">
          <h3 className="text-xs font-semibold">This PC</h3>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Processing can start while setup finishes.</p>
          <div className="mt-5 divide-y border-y"><ReadinessRow label="Video folder" description={sourceWaitingForSchedule ? "Connected · ingestion scheduled" : sourceConnected ? `${folders.length} connected` : "Not connected"} ready={sourceConnected} busy={sourceScanning && ingestionOpen} /><ReadinessRow label="Local models" description={localModelsReady ? "Whisper and semantic search ready" : modelsDownloading ? "Downloading components" : "Setup required"} ready={localModelsReady} busy={modelsDownloading} /><ReadinessRow label="Codex summaries" description={codex.state === "ready" ? "Signed in and ready" : codexStatusLabel(codex)} ready={codex.state === "ready"} busy={["checking", "installing", "updating", "signing-in"].includes(codex.state)} /></div>
          {!localModelsReady && <Button variant="outline" size="sm" className="mt-4 w-full justify-start" disabled={modelsDownloading} onClick={onPrepareModels}>{modelsDownloading ? <LoaderCircle className="animate-spin" /> : <Download />}Prepare local models</Button>}
          {codex.state !== "ready" && <Button variant="ghost" size="sm" className="mt-1 w-full justify-start" onClick={onOpenSettings}><Settings />Review Codex setup</Button>}
        </aside>
      </div>
      <div className="flex items-center gap-2 px-2 py-3 text-[10px] text-muted-foreground"><Database className="size-3.5 text-primary" />Compatible shared bundles are always loaded automatically. Publishing remains opt-in per folder.</div>
    </div>
  )
}

function ReadinessRow({ label, description, ready, busy = false }: { label: string; description: string; ready: boolean; busy?: boolean }): React.JSX.Element {
  return <div className="flex items-center gap-3 py-3"><span className={cn("grid size-5 shrink-0 place-items-center rounded-full border", ready && "border-primary/35 bg-primary/10 text-primary")}>{busy ? <LoaderCircle className="size-3 animate-spin" /> : ready ? <CheckCircle2 className="size-3" /> : <span className="size-1.5 rounded-full bg-muted-foreground/45" />}</span><div className="min-w-0"><div className="text-[11px] font-medium">{label}</div><div className="mt-0.5 truncate text-[9px] text-muted-foreground">{description}</div></div></div>
}
