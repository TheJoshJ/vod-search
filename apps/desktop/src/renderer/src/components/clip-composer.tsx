import { useState } from "react"
import { Download, Eye, LoaderCircle, Scissors, Smartphone } from "lucide-react"
import { Button } from "@/components/ui/button"
import {
  Popover,
  PopoverContent,
  PopoverDescription,
  PopoverHeader,
  PopoverTitle,
  PopoverTrigger
} from "@/components/ui/popover"
import { Slider } from "@/components/ui/slider"
import { formatTimestamp } from "@/lib/format"
import { contextWindowAroundPlayhead } from "./short-form-project"

const DEFAULT_CONTEXT_MS = 30_000
const CONTEXT_OPTIONS_MS = [15_000, 30_000, 60_000]

export function ClipComposer({
  mediaId,
  currentMs,
  durationMs,
  disabled,
  onPreview,
  onEditShort
}: {
  mediaId: string
  currentMs: number
  durationMs: number
  disabled: boolean
  onPreview: (startMs: number, endMs: number) => void
  onEditShort: (startMs: number, endMs: number) => void
}): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [contextMs, setContextMs] = useState(DEFAULT_CONTEXT_MS)
  const [exporting, setExporting] = useState(false)
  const [exportedPath, setExportedPath] = useState<string | null>(null)
  const [exportError, setExportError] = useState<string | null>(null)
  const range = contextWindowAroundPlayhead(currentMs, durationMs, contextMs)

  async function exportClip(): Promise<void> {
    setExporting(true)
    setExportError(null)
    try {
      const result = await window.vodSearch.media.exportClip(mediaId, range[0], range[1])
      if (result.path) setExportedPath(result.path)
    } catch (reason) {
      setExportError(reason instanceof Error ? reason.message : String(reason))
    } finally {
      setExporting(false)
    }
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => {
      setOpen(nextOpen)
      if (nextOpen) {
        setContextMs(DEFAULT_CONTEXT_MS)
        setExportError(null)
      }
    }}>
      <PopoverTrigger asChild>
        <Button variant="outline" size="sm" disabled={disabled}><Scissors />Clip</Button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-96">
        <PopoverHeader>
          <PopoverTitle>Create a clip</PopoverTitle>
          <PopoverDescription>Choose how much source context to bring in on each side of the current playhead. Set the final in and out points in Short form.</PopoverDescription>
        </PopoverHeader>

        <div className="mt-4 space-y-4">
          <div className="border-y bg-muted/20 py-3">
            <div className="flex items-center justify-between text-[10px]">
              <span className="font-medium">Context on each side</span>
              <span className="font-mono tabular-nums text-foreground">{formatTimestamp(contextMs)}</span>
            </div>
            <Slider
              className="mt-3"
              min={5_000}
              max={120_000}
              step={5_000}
              value={[contextMs]}
              onValueChange={(value) => setContextMs(value[0] ?? DEFAULT_CONTEXT_MS)}
              aria-label="Context on each side of playhead"
            />
            <div className="mt-3 flex items-center gap-1.5">
              <span className="mr-auto text-[9px] text-muted-foreground">Before + after playhead</span>
              {CONTEXT_OPTIONS_MS.map((optionMs) => (
                <Button
                  key={optionMs}
                  variant={contextMs === optionMs ? "secondary" : "ghost"}
                  size="sm"
                  className="h-7 px-2"
                  onClick={() => setContextMs(optionMs)}
                >
                  {formatTimestamp(optionMs)}
                </Button>
              ))}
            </div>
          </div>

          <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-3 font-mono text-[10px] tabular-nums">
            <div><span className="block text-[8px] uppercase tracking-wide text-muted-foreground">Window start</span>{formatTimestamp(range[0])}</div>
            <div className="text-center text-muted-foreground"><span className="block text-[8px] uppercase tracking-wide">Playhead</span>{formatTimestamp(currentMs)}</div>
            <div className="text-right"><span className="block text-[8px] uppercase tracking-wide text-muted-foreground">Window end</span>{formatTimestamp(range[1])}</div>
          </div>
          <p className="text-[9px] leading-4 text-muted-foreground">The available window is {formatTimestamp(range[1] - range[0])}. It is automatically shortened when the playhead is near the beginning or end of the source.</p>

          {exportedPath && <p className="truncate text-[10px] text-muted-foreground" title={exportedPath}>Saved {exportedPath.split(/[\\/]/).at(-1)}</p>}
          {exportError && <p className="text-[10px] leading-4 text-destructive">{exportError}</p>}

          <div className="flex justify-end gap-2 border-t pt-3">
            <Button variant="outline" size="sm" onClick={() => onPreview(range[0], range[1])}><Eye />Preview window</Button>
            <Button variant="outline" size="sm" disabled={exporting || range[1] - range[0] < 1_000} onClick={() => void exportClip()}>
              {exporting ? <LoaderCircle className="animate-spin" /> : <Download />}
              {exporting ? "Exporting" : "Export window"}
            </Button>
            <Button size="sm" disabled={range[1] - range[0] < 1_000} onClick={() => {
              setOpen(false)
              onEditShort(range[0], range[1])
            }}>
              <Smartphone />Edit as short
            </Button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  )
}
