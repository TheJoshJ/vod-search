import { useMemo, useState } from "react"
import {
  isJobStageAllowed,
  isProcessingWindowOpen,
  nextProcessingWindowStart,
  type Job,
  type MediaAsset,
  type ProcessingSchedule,
  type ProcessingScheduleGroup,
  type ProcessingWindow
} from "@vod-search/contracts"
import { CalendarClock, History, LoaderCircle, Pause, Play } from "lucide-react"
import { WorkspacePage } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Progress } from "@/components/ui/progress"
import { Switch } from "@/components/ui/switch"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cleanMediaTitle } from "@/components/search-workflow"
import {
  estimateJobRemaining,
  formatJobTiming,
  formatNextScheduleStart,
  humanize,
  jobStatusDescription,
  minuteToTime,
  processingGroupLabel,
  summarizeJobError,
  timeToMinute
} from "@/lib/format"
import { cn } from "@/lib/utils"

export function ActivityWorkspace({
  jobs,
  media,
  processingSchedule,
  onProcessingScheduleChange,
  onError
}: {
  jobs: Job[]
  media: MediaAsset[]
  processingSchedule: ProcessingSchedule
  onProcessingScheduleChange: (schedule: ProcessingSchedule) => void
  onError: (error: unknown) => void
}): React.JSX.Element {
  const names = useMemo(() => new Map(media.map((item) => [item.id, item.displayName])), [media])
  const active = jobs.filter((job) => ["queued", "running", "paused", "failed"].includes(job.status))
  const history = jobs.filter((job) => ["succeeded", "cancelled"].includes(job.status))
  const [filter, setFilter] = useState<"active" | "history" | "all" | "schedule">("active")
  const [savingSchedule, setSavingSchedule] = useState<ProcessingScheduleGroup | null>(null)
  const visibleJobs = filter === "active" ? active : filter === "history" ? history : jobs
  const hasRunning = jobs.some((job) => job.status === "running")
  const canResume = !hasRunning && jobs.some((job) => job.status === "paused")

  async function run(action: () => Promise<void>): Promise<void> {
    try {
      await action()
    } catch (error) {
      onError(error)
    }
  }

  async function updateProcessingWindow(group: ProcessingScheduleGroup, nextWindow: ProcessingWindow): Promise<void> {
    const previous = processingSchedule
    const next = { ...processingSchedule, [group]: nextWindow }
    onProcessingScheduleChange(next)
    setSavingSchedule(group)
    try {
      onProcessingScheduleChange(await window.vodSearch.jobs.setProcessingSchedule(next))
    } catch (error) {
      onProcessingScheduleChange(previous)
      onError(error)
    } finally {
      setSavingSchedule(null)
    }
  }

  return (
    <WorkspacePage
      title="Activity"
      description="Processing activity, recent history, and daily work windows"
      actions={hasRunning
        ? <Button variant="outline" size="sm" onClick={() => void run(() => window.vodSearch.jobs.pauseAll())}><Pause />Pause all</Button>
        : canResume
          ? <Button size="sm" onClick={() => void run(() => window.vodSearch.jobs.resumeAll())}><Play />Resume</Button>
          : undefined}
    >
      <div className="flex h-12 items-center justify-between border-b">
        <div><h2 className="text-xs font-semibold">{filter === "schedule" ? "Processing schedule" : "Processing activity"}</h2><p className="mt-0.5 text-[10px] text-muted-foreground">{filter === "schedule" ? "Control when each processing stage can run." : "Every stage explains whether it is running, waiting, complete, or blocked."}</p></div>
        <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(value) => { if (value) setFilter(value as typeof filter) }}>
          <ToggleGroupItem value="active">Active <span className="font-mono text-[9px]">{active.length}</span></ToggleGroupItem>
          <ToggleGroupItem value="history">History <span className="font-mono text-[9px]">{history.length}</span></ToggleGroupItem>
          <ToggleGroupItem value="all">All</ToggleGroupItem>
          <ToggleGroupItem value="schedule">Schedule</ToggleGroupItem>
        </ToggleGroup>
      </div>
      {filter === "schedule" ? (
        <ProcessingSchedulePanel
          schedule={processingSchedule}
          savingGroup={savingSchedule}
          onChange={(group, window) => void updateProcessingWindow(group, window)}
        />
      ) : visibleJobs.length === 0 ? (
        <div className="flex min-h-48 flex-col items-center justify-center gap-2 border-b text-xs text-muted-foreground">
          <History className="size-4" />
          <span>{filter === "active" ? "No active processing. The library is caught up." : "No processing history yet."}</span>
          {filter === "active" && history.length > 0 && <Button variant="ghost" size="sm" onClick={() => setFilter("history")}>View recent history</Button>}
        </div>
      ) : visibleJobs.map((job) => {
        const scheduleHeld = job.status === "queued" && !isJobStageAllowed(processingSchedule, job.stage)
        return (
          <div key={job.id} className="workspace-row grid grid-cols-[minmax(0,1fr)_8rem_8rem_auto] items-center gap-4 border-b px-2 py-3 hover:bg-accent/20 max-[1100px]:grid-cols-[minmax(0,1fr)_7rem_auto]">
            <div className="flex min-w-0 items-start gap-2.5">
              <span className={cn("mt-1 size-1.5 shrink-0 rounded-full", job.status === "running" || job.status === "succeeded" ? "bg-primary" : job.status === "failed" ? "bg-destructive" : "bg-muted-foreground/45")} />
              <div className="min-w-0"><div className="truncate text-xs font-semibold" title={names.get(job.mediaId ?? "")}>{cleanMediaTitle(names.get(job.mediaId ?? "") ?? "Library task")}</div><div className="mt-1 text-[10px] text-muted-foreground">{jobStatusDescription(job, processingSchedule)}</div>{job.error && <div className="mt-1 truncate text-[10px] text-destructive" title={job.error}>{summarizeJobError(job.error)}</div>}</div>
            </div>
            <div className="max-[1100px]:hidden"><div className="font-mono text-[9px] text-muted-foreground">{humanize(job.stage)}</div>{["running", "queued", "paused"].includes(job.status) ? <Progress className="mt-1.5 h-1" value={job.progress * 100} /> : <div className="mt-1 text-[9px] text-muted-foreground">{job.attempts} {job.attempts === 1 ? "attempt" : "attempts"}</div>}</div>
            <div className="max-[1100px]:hidden"><div className="font-mono text-[9px] text-muted-foreground">{formatJobTiming(job)}</div>{job.status === "running" && job.progress > 0.02 && <div className="mt-1 text-[9px] text-muted-foreground">{estimateJobRemaining(job)} remaining</div>}</div>
            <div className="flex items-center justify-self-end gap-1.5"><Badge variant={job.status === "failed" ? "destructive" : ["running", "succeeded"].includes(job.status) ? "accent" : "secondary"}>{scheduleHeld ? "scheduled" : job.status}</Badge>{job.status === "failed" && <Button variant="ghost" size="sm" className="h-7" onClick={() => void run(() => window.vodSearch.jobs.retry(job.id))}>Retry</Button>}</div>
          </div>
        )
      })}
    </WorkspacePage>
  )
}

function ProcessingSchedulePanel({
  schedule,
  savingGroup,
  onChange
}: {
  schedule: ProcessingSchedule
  savingGroup: ProcessingScheduleGroup | null
  onChange: (group: ProcessingScheduleGroup, window: ProcessingWindow) => void
}): React.JSX.Element {
  return (
    <section className="border-b">
      <div className="grid grid-cols-[13rem_minmax(0,1fr)] gap-8 py-6 max-[1100px]:grid-cols-[11rem_minmax(0,1fr)]">
        <div>
          <h3 className="text-xs font-semibold">Daily processing windows</h3>
          <p className="mt-1 text-[10px] leading-4 text-muted-foreground">Times use this computer&apos;s local clock. Overnight ranges are supported.</p>
        </div>
        <div className="min-w-0 divide-y">
          <ScheduleRow group="ingestion" title="Ingestion and subtitles" description="Discover files, inspect media, and import available subtitle data." window={schedule.ingestion} busy={savingGroup === "ingestion"} onChange={(window) => onChange("ingestion", window)} />
          <ScheduleRow group="transcription" title="Speech processing" description="Run Whisper when subtitles are missing, then identify speakers locally with Sherpa ONNX." window={schedule.transcription} busy={savingGroup === "transcription"} onChange={(window) => onChange("transcription", window)} />
          <ScheduleRow group="summarization" title="AI summaries" description="Send completed transcript text to Codex for topic analysis and summaries." window={schedule.summarization} busy={savingGroup === "summarization"} onChange={(window) => onChange("summarization", window)} />
        </div>
      </div>
    </section>
  )
}

function ScheduleRow({
  group,
  title,
  description,
  window,
  busy,
  onChange
}: {
  group: ProcessingScheduleGroup
  title: string
  description: string
  window: ProcessingWindow
  busy: boolean
  onChange: (window: ProcessingWindow) => void
}): React.JSX.Element {
  const open = isProcessingWindowOpen(window)
  const next = nextProcessingWindowStart(window)
  const status = !window.enabled ? "Any time" : open ? "Open now" : next ? formatNextScheduleStart(next).replace(/^starts /, "Next ") : "Scheduled"

  return (
    <div className="workspace-row flex min-h-16 items-center gap-3 px-2 py-3 hover:bg-accent/20 first:pt-0 last:pb-0">
      <CalendarClock className="size-3.5 shrink-0 text-muted-foreground" />
      <div className="min-w-0 flex-1">
        <div className="truncate text-xs font-semibold">{title}</div>
        <div className="mt-1 text-[10px] leading-4 text-muted-foreground">{description}</div>
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <Badge variant={open ? "accent" : "secondary"}>{busy ? <LoaderCircle className="animate-spin" /> : null}{status}</Badge>
        <Switch aria-label={`Schedule ${processingGroupLabel(group)}`} checked={window.enabled} disabled={busy} onCheckedChange={(enabled) => onChange({ ...window, enabled })} />
        <Input aria-label={`${title} start time`} type="time" step={900} value={minuteToTime(window.startMinute)} disabled={!window.enabled || busy} onChange={(event) => onChange({ ...window, startMinute: timeToMinute(event.target.value) })} className="h-8 w-[6.75rem] font-mono text-[10px]" />
        <span className="text-[9px] text-muted-foreground">to</span>
        <Input aria-label={`${title} end time`} type="time" step={900} value={minuteToTime(window.endMinute)} disabled={!window.enabled || busy} onChange={(event) => onChange({ ...window, endMinute: timeToMinute(event.target.value) })} className="h-8 w-[6.75rem] font-mono text-[10px]" />
      </div>
    </div>
  )
}
