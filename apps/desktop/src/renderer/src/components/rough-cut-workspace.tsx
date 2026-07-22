import { useMemo, useState } from "react"
import type {
  CodexStatus,
  MediaAsset,
  RoughCutFrameRate,
  RoughCutPlan,
  RoughCutPlanItem
} from "@vod-search/contracts"
import {
  ArrowDown,
  ArrowUp,
  Check,
  FileOutput,
  Film,
  LoaderCircle,
  Play,
  Search,
  Sparkles,
  Trash2
} from "lucide-react"
import type { MediaWorkspaceSelection } from "@/components/media-workspace"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { cn } from "@/lib/utils"

const searchableStages = new Set<MediaAsset["highestCompletedStage"]>(["chunked", "embedded", "enriched", "ready"])
const frameRates: RoughCutFrameRate[] = ["23.976", "24", "25", "29.97", "30", "50", "59.94", "60"]

export function RoughCutWorkspace({
  media,
  codex,
  plan,
  onPlanChange,
  onOpen,
  onError
}: {
  media: MediaAsset[]
  codex: CodexStatus
  plan: RoughCutPlan | null
  onPlanChange: (plan: RoughCutPlan | null) => void
  onOpen: (selection: MediaWorkspaceSelection) => void
  onError: (reason: unknown) => void
}): React.JSX.Element {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set(plan?.selectedMediaIds ?? []))
  const [filter, setFilter] = useState("")
  const [title, setTitle] = useState(plan?.title ?? "")
  const [brief, setBrief] = useState(plan?.brief ?? "")
  const [handleBeforeSeconds, setHandleBeforeSeconds] = useState((plan?.handleBeforeMs ?? 15_000) / 1_000)
  const [handleAfterSeconds, setHandleAfterSeconds] = useState((plan?.handleAfterMs ?? 15_000) / 1_000)
  const [frameRate, setFrameRate] = useState<RoughCutFrameRate>(plan?.frameRate ?? "30")
  const [generating, setGenerating] = useState(false)
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)

  const eligibleMedia = useMemo(() => media.filter((item) =>
    item.availability === "available" && searchableStages.has(item.highestCompletedStage) && item.durationMs), [media])
  const visibleMedia = useMemo(() => {
    const needle = filter.trim().toLocaleLowerCase("en-US")
    return needle
      ? eligibleMedia.filter((item) => `${item.displayName} ${item.relativePath}`.toLocaleLowerCase("en-US").includes(needle))
      : eligibleMedia
  }, [eligibleMedia, filter])
  const selectedMedia = eligibleMedia.filter((item) => selectedIds.has(item.id))
  const ready = codex.state === "ready" && selectedIds.size > 0 && brief.trim().length > 0 && !generating

  function toggleMedia(mediaId: string): void {
    setSelectedIds((current) => {
      const next = new Set(current)
      if (next.has(mediaId)) next.delete(mediaId)
      else next.add(mediaId)
      return next
    })
    onPlanChange(null)
    setExportedPath(null)
  }

  async function generate(): Promise<void> {
    if (!ready) return
    setGenerating(true)
    setExportedPath(null)
    try {
      const next = await window.vodSearch.roughCut.generate({
        title: title.trim() || undefined,
        prompt: brief,
        mediaIds: [...selectedIds],
        handleBeforeMs: clampSeconds(handleBeforeSeconds) * 1_000,
        handleAfterMs: clampSeconds(handleAfterSeconds) * 1_000,
        frameRate
      })
      onPlanChange(next)
    } catch (reason) {
      onError(reason)
    } finally {
      setGenerating(false)
    }
  }

  async function exportPlan(): Promise<void> {
    if (!plan || exporting) return
    setExporting(true)
    try {
      const result = await window.vodSearch.roughCut.export(plan)
      if (result.xmlPath) setExportedPath(result.xmlPath)
    } catch (reason) {
      onError(reason)
    } finally {
      setExporting(false)
    }
  }

  function editItems(items: RoughCutPlanItem[]): void {
    if (!plan || items.length === 0) {
      onPlanChange(null)
      return
    }
    onPlanChange(resequence(plan, items))
    setExportedPath(null)
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex h-16 shrink-0 items-center justify-between border-b bg-background px-5">
        <div className="min-w-0">
          <h1 className="text-base font-semibold tracking-tight">Rough cut</h1>
          <p className="mt-0.5 truncate text-[11px] text-muted-foreground">Turn an editorial brief into a grounded Premiere paper edit</p>
        </div>
        <div className="flex items-center gap-2">
          {plan && <Badge variant="secondary">{plan.items.length} cuts · {formatDuration(plan.totalDurationMs)}</Badge>}
          <Button size="sm" disabled={!plan || exporting} onClick={() => void exportPlan()}>
            {exporting ? <LoaderCircle className="animate-spin" /> : <FileOutput />}
            Export Premiere XML
          </Button>
        </div>
      </header>

      <div className="grid min-h-0 flex-1 grid-cols-[20rem_minmax(0,1fr)] max-[1050px]:grid-cols-[16rem_minmax(0,1fr)]">
        <aside className="flex min-h-0 flex-col border-r bg-muted/15">
          <div className="border-b px-4 py-3">
            <div className="flex items-center justify-between">
              <div><h2 className="text-xs font-semibold">Source bin</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{selectedIds.size} of {eligibleMedia.length} videos selected</p></div>
              <Button variant="ghost" size="sm" className="h-7 text-[10px]" onClick={() => { setSelectedIds(new Set(selectedIds.size === eligibleMedia.length ? [] : eligibleMedia.map((item) => item.id))); onPlanChange(null); setExportedPath(null) }}>
                {selectedIds.size === eligibleMedia.length && eligibleMedia.length > 0 ? "Clear" : "Select all"}
              </Button>
            </div>
            <div className="relative mt-3"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3 -translate-y-1/2 text-muted-foreground" /><Input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter indexed videos" className="h-8 pl-8 text-xs" /></div>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto">
            {visibleMedia.length === 0 ? (
              <div className="px-4 py-8 text-center text-[11px] leading-5 text-muted-foreground">No searchable, available videos match this filter.</div>
            ) : visibleMedia.map((item) => {
              const selected = selectedIds.has(item.id)
              return (
                <button key={item.id} type="button" aria-pressed={selected} onClick={() => toggleMedia(item.id)} className={cn("flex w-full items-start gap-2.5 border-b px-4 py-3 text-left outline-none transition-colors hover:bg-muted/40 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/30", selected && "bg-primary/6")}>
                  <span className={cn("mt-0.5 grid size-4 shrink-0 place-items-center rounded-[4px] border", selected ? "border-primary bg-primary text-primary-foreground" : "border-border bg-background")}>{selected && <Check className="size-2.5" />}</span>
                  <span className="min-w-0 flex-1"><span className="line-clamp-2 text-[11px] font-medium leading-4">{displayTitle(item.displayName)}</span><span className="mt-1 block font-mono text-[9px] text-muted-foreground">{formatDuration(item.durationMs ?? 0)} · {stageLabel(item.highestCompletedStage)}</span></span>
                </button>
              )
            })}
          </div>
        </aside>

        <section className="min-h-0 overflow-y-auto">
          <div className="mx-auto max-w-[1080px] px-5 pb-10">
            <section className="grid grid-cols-[minmax(0,1fr)_15rem] gap-6 border-b py-5 max-[1150px]:grid-cols-1">
              <div>
                <div className="flex items-center gap-2"><Sparkles className="size-3.5 text-primary" /><h2 className="text-xs font-semibold">Editorial brief</h2></div>
                <Input value={title} onChange={(event) => { setTitle(event.target.value); onPlanChange(null); setExportedPath(null) }} maxLength={120} placeholder="Optional sequence title" className="mt-3 h-8 text-xs" />
                <textarea value={brief} onChange={(event) => { setBrief(event.target.value); onPlanChange(null); setExportedPath(null) }} maxLength={4_000} rows={7} placeholder={'Describe the episode in order. For example:\n\nOpen with the failed boss attempt. Explain what went wrong, then move into the new strategy and finish on the successful retry.'} className="mt-2 w-full resize-y rounded-md border bg-background px-3 py-2 text-xs leading-5 outline-none placeholder:text-muted-foreground focus-visible:ring-2 focus-visible:ring-ring/30" />
                <div className="mt-2 flex items-center justify-between text-[10px] text-muted-foreground"><span>Codex sees only locally retrieved transcript windows from the selected videos.</span><span className="font-mono">{brief.length.toLocaleString()} / 4,000</span></div>
              </div>
              <div className="border-l pl-6 max-[1150px]:border-l-0 max-[1150px]:border-t max-[1150px]:pl-0 max-[1150px]:pt-4">
                <h2 className="text-xs font-semibold">Cut settings</h2>
                <label className="mt-3 block text-[10px] text-muted-foreground">Handle before (seconds)<Input type="number" min={0} max={120} value={handleBeforeSeconds} onChange={(event) => { setHandleBeforeSeconds(Number(event.target.value)); onPlanChange(null); setExportedPath(null) }} className="mt-1 h-8 font-mono text-xs" /></label>
                <label className="mt-3 block text-[10px] text-muted-foreground">Handle after (seconds)<Input type="number" min={0} max={120} value={handleAfterSeconds} onChange={(event) => { setHandleAfterSeconds(Number(event.target.value)); onPlanChange(null); setExportedPath(null) }} className="mt-1 h-8 font-mono text-xs" /></label>
                <label className="mt-3 block text-[10px] text-muted-foreground">Sequence rate<Select value={frameRate} onValueChange={(value) => { setFrameRate(value as RoughCutFrameRate); onPlanChange(null); setExportedPath(null) }}><SelectTrigger className="mt-1 h-8 font-mono text-xs"><SelectValue /></SelectTrigger><SelectContent>{frameRates.map((rate) => <SelectItem key={rate} value={rate}>{rate} fps</SelectItem>)}</SelectContent></Select></label>
                <Button className="mt-4 w-full" disabled={!ready} onClick={() => void generate()}>{generating ? <LoaderCircle className="animate-spin" /> : <Film />}{generating ? "Building paper edit…" : "Generate rough cut"}</Button>
                {codex.state !== "ready" && <p className="mt-2 text-[10px] leading-4 text-destructive">Codex must be installed and signed in from Settings.</p>}
              </div>
            </section>

            {generating ? (
              <div className="grid min-h-64 place-items-center py-16 text-center"><div><LoaderCircle className="mx-auto size-5 animate-spin text-primary" /><h2 className="mt-3 text-sm font-semibold">Retrieving and arranging transcript moments</h2><p className="mt-1 text-[11px] text-muted-foreground">Selected sources: {selectedMedia.length}. This can take a few minutes.</p></div></div>
            ) : plan ? (
              <section className="py-5">
                <div className="flex items-end justify-between border-b pb-3"><div><h2 className="text-xs font-semibold">Paper edit</h2><p className="mt-1 text-[10px] text-muted-foreground">Review the grounded sequence, then reorder or remove any cut before export.</p></div><div className="font-mono text-[10px] text-muted-foreground">{formatDuration(plan.totalDurationMs)} · {plan.frameRate} fps</div></div>
                <ol className="divide-y">
                  {plan.items.map((item, index) => (
                    <li key={item.id} className="grid grid-cols-[2.25rem_minmax(0,1fr)_auto] gap-3 py-4">
                      <div className="font-mono text-[11px] text-muted-foreground">{String(index + 1).padStart(2, "0")}</div>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2"><h3 className="text-xs font-semibold">{item.requestedText}</h3><Badge variant="secondary" className="font-mono text-[9px]">{formatTimestamp(item.sourceInMs)}–{formatTimestamp(item.sourceOutMs)}</Badge></div>
                        <div className="mt-1 truncate text-[10px] text-muted-foreground" title={item.sourcePath}>{displayTitle(item.sourceTitle)} · match {formatTimestamp(item.contentStartMs)}–{formatTimestamp(item.contentEndMs)} · handles {Math.round(item.handleBeforeMs / 1_000)}s / {Math.round(item.handleAfterMs / 1_000)}s</div>
                        <p className="mt-2 text-[11px] leading-4">{item.matchRationale}</p>
                        <blockquote className="mt-2 border-l-2 border-primary/35 pl-2 text-[10px] italic leading-4 text-muted-foreground">“{item.transcriptExcerpt}”</blockquote>
                      </div>
                      <div className="flex items-start gap-0.5">
                        <Button variant="ghost" size="icon-sm" aria-label={`Preview cut ${index + 1}`} onClick={() => onOpen({ mediaId: item.mediaId, title: item.sourceTitle, initialMs: item.contentStartMs, returnLabel: "rough cut" })}><Play /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Move cut ${index + 1} up`} disabled={index === 0} onClick={() => editItems(move(plan.items, index, index - 1))}><ArrowUp /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Move cut ${index + 1} down`} disabled={index === plan.items.length - 1} onClick={() => editItems(move(plan.items, index, index + 1))}><ArrowDown /></Button>
                        <Button variant="ghost" size="icon-sm" aria-label={`Remove cut ${index + 1}`} onClick={() => editItems(plan.items.filter((candidate) => candidate.id !== item.id))}><Trash2 /></Button>
                      </div>
                    </li>
                  ))}
                </ol>
                {exportedPath && <div className="mt-4 border border-primary/25 bg-primary/5 px-3 py-2 text-[10px] text-muted-foreground"><span className="font-semibold text-foreground">Exported.</span> Premiere XML and its rough-cut JSON sidecar were saved beside each other.</div>}
              </section>
            ) : (
              <div className="grid min-h-64 place-items-center py-16 text-center"><div><Film className="mx-auto size-5 text-muted-foreground" /><h2 className="mt-3 text-sm font-semibold">Build a paper edit from spoken moments</h2><p className="mx-auto mt-1 max-w-md text-[11px] leading-5 text-muted-foreground">Select source videos, describe the sequence in natural language, and keep generous handles for the real edit in Premiere.</p></div></div>
            )}
          </div>
        </section>
      </div>
    </div>
  )
}

function resequence(plan: RoughCutPlan, items: RoughCutPlanItem[]): RoughCutPlan {
  let cursor = 0
  const sequenced = items.map((item, order) => {
    const duration = item.sourceOutMs - item.sourceInMs
    const next = { ...item, order, sequenceStartMs: cursor, sequenceEndMs: cursor + duration }
    cursor += duration
    return next
  })
  return { ...plan, items: sequenced, totalDurationMs: cursor }
}

function move<T>(items: T[], from: number, to: number): T[] {
  const next = [...items]
  const [item] = next.splice(from, 1)
  if (item !== undefined) next.splice(to, 0, item)
  return next
}

function clampSeconds(value: number): number {
  return Math.max(0, Math.min(120, Number.isFinite(value) ? Math.round(value) : 0))
}

function formatDuration(milliseconds: number): string {
  const seconds = Math.max(0, Math.round(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return hours ? `${hours}h ${minutes}m` : minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function formatTimestamp(milliseconds: number): string {
  const seconds = Math.max(0, Math.floor(milliseconds / 1_000))
  const hours = Math.floor(seconds / 3_600)
  const minutes = Math.floor(seconds % 3_600 / 60)
  const remainder = seconds % 60
  return hours ? `${hours}:${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}` : `${minutes}:${String(remainder).padStart(2, "0")}`
}

function displayTitle(value: string): string {
  return value.replace(/\.[^.]+$/, "").replace(/^\d{8}\s*-\s*/, "").trim()
}

function stageLabel(stage: MediaAsset["highestCompletedStage"]): string {
  return stage === "ready" ? "Ready" : stage === "embedded" || stage === "enriched" ? "Searchable" : "Indexed"
}
