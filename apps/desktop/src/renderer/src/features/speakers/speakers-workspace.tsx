import { type FormEvent, useEffect, useRef, useState } from "react"
import type { SpeakerProfile, SpeakerReviewItem, SpeakerReviewQueue } from "@vod-search/contracts"
import { LoaderCircle, Pause, Search, UserPlus, Users, Video, Volume2 } from "lucide-react"
import { InlineMetric, WorkspacePage } from "@/components/app-shell"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group"
import { cleanMediaTitle } from "@/components/search-workflow"
import { formatDate, formatTimestamp } from "@/lib/format"

interface SpeakerAudioPreviewState {
  itemId: number
  status: "loading" | "playing" | "paused"
  startMs: number
  endMs: number
  currentMs: number
}

export function SpeakersWorkspace({
  queue,
  onRefresh,
  onOpen,
  onError
}: {
  queue: SpeakerReviewQueue
  onRefresh: () => Promise<void>
  onOpen: (item: SpeakerReviewItem) => void
  onError: (error: unknown) => void
}): React.JSX.Element {
  const [query, setQuery] = useState("")
  const [filter, setFilter] = useState<"all" | "suggested">("all")
  const [audioPreview, setAudioPreview] = useState<SpeakerAudioPreviewState | null>(null)
  const audioRef = useRef<HTMLAudioElement>(null)
  const audioRequestRef = useRef(0)
  const suggestedCount = queue.items.filter((item) => item.suggestedProfileId !== null).length
  const normalizedQuery = query.trim().toLocaleLowerCase("en-US")
  const visibleItems = queue.items.filter((item) => {
    if (filter === "suggested" && item.suggestedProfileId === null) return false
    if (!normalizedQuery) return true
    return [item.mediaTitle, item.relativePath, item.sampleText ?? "", item.displayName]
      .some((value) => value.toLocaleLowerCase("en-US").includes(normalizedQuery))
  })

  useEffect(() => () => {
    audioRequestRef.current += 1
    audioRef.current?.pause()
  }, [])

  useEffect(() => {
    if (!audioPreview || queue.items.some((item) => item.id === audioPreview.itemId)) return
    audioRequestRef.current += 1
    audioRef.current?.pause()
    setAudioPreview(null)
  }, [audioPreview, queue.items])

  async function toggleAudioPreview(item: SpeakerReviewItem): Promise<void> {
    const audio = audioRef.current
    if (!audio) return
    if (audioPreview?.itemId === item.id) {
      if (audioPreview.status === "loading") return
      if (audioPreview.status === "playing") {
        audio.pause()
        setAudioPreview((current) => current ? { ...current, status: "paused", currentMs: Math.round(audio.currentTime * 1000) } : current)
        return
      }
      try {
        if (audio.currentTime * 1000 >= audioPreview.endMs - 50) audio.currentTime = audioPreview.startMs / 1000
        await audio.play()
        setAudioPreview((current) => current ? { ...current, status: "playing" } : current)
      } catch (error) {
        setAudioPreview(null)
        onError(error)
      }
      return
    }

    const requestId = audioRequestRef.current + 1
    audioRequestRef.current = requestId
    audio.pause()
    const [startMs, requestedEndMs] = speakerAudioPreviewRange(item)
    setAudioPreview({ itemId: item.id, status: "loading", startMs, endMs: requestedEndMs, currentMs: startMs })
    try {
      const source = await window.vodSearch.media.getPlaybackSource(item.mediaId)
      if (audioRequestRef.current !== requestId) return
      if (!source.available || !source.url) throw new Error("The source file is currently unavailable for audio preview.")
      audio.src = source.url
      audio.load()
      await waitForAudioMetadata(audio)
      if (audioRequestRef.current !== requestId) return
      const durationMs = Number.isFinite(audio.duration) ? Math.round(audio.duration * 1000) : requestedEndMs
      const playableStartMs = Math.min(startMs, Math.max(0, durationMs - 1))
      const playableEndMs = Math.min(requestedEndMs, durationMs)
      if (playableEndMs <= playableStartMs) throw new Error("That speaker sample falls outside the available media.")
      audio.currentTime = playableStartMs / 1000
      setAudioPreview({ itemId: item.id, status: "loading", startMs: playableStartMs, endMs: playableEndMs, currentMs: playableStartMs })
      await audio.play()
      if (audioRequestRef.current !== requestId) {
        audio.pause()
        return
      }
      setAudioPreview({ itemId: item.id, status: "playing", startMs: playableStartMs, endMs: playableEndMs, currentMs: playableStartMs })
    } catch (error) {
      if (audioRequestRef.current !== requestId) return
      setAudioPreview(null)
      onError(error)
    }
  }

  function handleAudioTimeUpdate(): void {
    const audio = audioRef.current
    if (!audio || !audioPreview) return
    const currentMs = Math.round(audio.currentTime * 1000)
    if (currentMs >= audioPreview.endMs) {
      audio.pause()
      audio.currentTime = audioPreview.startMs / 1000
      setAudioPreview(null)
      return
    }
    setAudioPreview((current) => current?.itemId === audioPreview.itemId ? { ...current, currentMs } : current)
  }

  return (
    <>
      <audio ref={audioRef} className="hidden" preload="metadata" onTimeUpdate={handleAudioTimeUpdate} onEnded={() => setAudioPreview(null)} />
      <WorkspacePage title="Speakers" description="Review and name detected voices across your local video library" actions={queue.items.length > 0 ? <Badge variant="secondary">{queue.items.length.toLocaleString()} unassigned</Badge> : undefined}>
        <div className="grid grid-cols-2 border-b">
          <InlineMetric label="Unassigned voices" value={queue.items.length} />
          <InlineMetric label="Suggested matches" value={suggestedCount} tone={suggestedCount > 0 ? "healthy" : "default"} />
        </div>
        <div className="flex min-h-14 items-center gap-3 border-b py-2.5">
          <div className="relative min-w-48 flex-1"><Search className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" /><Input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter videos or transcript text" aria-label="Filter unassigned speakers" className="h-8 pl-8 text-xs" /></div>
          <ToggleGroup type="single" variant="outline" size="sm" value={filter} onValueChange={(value) => { if (value) setFilter(value as typeof filter) }}>
            <ToggleGroupItem value="all">All <span className="font-mono text-[9px]">{queue.items.length}</span></ToggleGroupItem>
            <ToggleGroupItem value="suggested">Suggested <span className="font-mono text-[9px]">{suggestedCount}</span></ToggleGroupItem>
          </ToggleGroup>
        </div>
        {queue.items.length === 0
          ? <SpeakerReviewEmpty title="All detected voices are assigned" description="New voices will appear here after speaker analysis finishes for an ingested file." />
          : visibleItems.length === 0
            ? <SpeakerReviewEmpty title="No voices match this filter" description="Try a different video title, transcript phrase, or review all unassigned voices." />
            : <SpeakerReviewList items={visibleItems} profiles={queue.profiles} audioPreview={audioPreview} onRefresh={onRefresh} onOpen={onOpen} onToggleAudio={toggleAudioPreview} onError={onError} />}
      </WorkspacePage>
    </>
  )
}

function SpeakerReviewList({ items, profiles, audioPreview, onRefresh, onOpen, onToggleAudio, onError }: {
  items: SpeakerReviewItem[]
  profiles: SpeakerProfile[]
  audioPreview: SpeakerAudioPreviewState | null
  onRefresh: () => Promise<void>
  onOpen: (item: SpeakerReviewItem) => void
  onToggleAudio: (item: SpeakerReviewItem) => Promise<void>
  onError: (error: unknown) => void
}): React.JSX.Element {
  return (
    <div>
      <div className="grid grid-cols-[minmax(12rem,1.2fr)_minmax(11rem,1fr)_minmax(15rem,1.1fr)] gap-4 border-b py-2 font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground"><span>File and voice</span><span>Transcript evidence</span><span>Assign speaker</span></div>
      {items.map((item) => <SpeakerReviewRow key={item.id} item={item} profiles={profiles} audioPreview={audioPreview?.itemId === item.id ? audioPreview : null} onRefresh={onRefresh} onOpen={() => onOpen(item)} onToggleAudio={() => void onToggleAudio(item)} onError={onError} />)}
    </div>
  )
}

function SpeakerReviewRow({ item, profiles, audioPreview, onRefresh, onOpen, onToggleAudio, onError }: {
  item: SpeakerReviewItem
  profiles: SpeakerProfile[]
  audioPreview: SpeakerAudioPreviewState | null
  onRefresh: () => Promise<void>
  onOpen: () => void
  onToggleAudio: () => void
  onError: (error: unknown) => void
}): React.JSX.Element {
  const [newName, setNewName] = useState("")
  const [busy, setBusy] = useState(false)
  const suggestion = profiles.find((profile) => profile.id === item.suggestedProfileId)

  async function run(action: () => Promise<unknown>): Promise<void> {
    setBusy(true)
    try {
      await action()
      await onRefresh()
    } catch (error) {
      onError(error)
    } finally {
      setBusy(false)
    }
  }

  function createProfile(event?: FormEvent): void {
    event?.preventDefault()
    if (!newName.trim() || busy) return
    void run(() => window.vodSearch.speakers.createProfile(item.id, newName.trim()))
  }

  return (
    <section data-media-title={cleanMediaTitle(item.mediaTitle)} data-speaker-name={item.displayName} className="workspace-row grid grid-cols-[minmax(12rem,1.2fr)_minmax(11rem,1fr)_minmax(15rem,1.1fr)] items-start gap-4 border-b px-2 py-4 hover:bg-accent/20">
      <div className="flex min-w-0 items-start gap-2.5">
        <div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{speakerInitial(item)}</div>
        <div className="min-w-0">
          <div className="truncate text-xs font-semibold" title={item.mediaTitle}>{cleanMediaTitle(item.mediaTitle)}</div>
          <div className="mt-1 truncate font-mono text-[9px] text-muted-foreground" title={item.relativePath}>{item.relativePath}</div>
          <div className="mt-2 flex flex-wrap items-center gap-x-2 gap-y-1 text-[9px] text-muted-foreground"><span>{item.displayName}</span><span>{formatTimestamp(item.speechMs)} speaking</span><span>{item.turnCount} {item.turnCount === 1 ? "turn" : "turns"}</span></div>
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" onClick={onOpen}><Video />Open at {formatTimestamp(item.sampleStartMs)}</Button>
            <Button variant="ghost" size="sm" className="h-7 px-2 text-[10px]" disabled={audioPreview?.status === "loading"} aria-label={`${audioPreview?.status === "playing" ? "Pause" : "Play"} audio-only preview for ${item.displayName}`} aria-pressed={audioPreview?.status === "playing"} onClick={onToggleAudio}>
              {audioPreview?.status === "loading" ? <LoaderCircle className="animate-spin" /> : audioPreview?.status === "playing" ? <Pause /> : <Volume2 />}
              {audioPreview?.status === "loading" ? "Loading audio" : audioPreview?.status === "playing" ? "Pause audio" : audioPreview?.status === "paused" ? "Resume audio" : "Play audio"}
            </Button>
            {audioPreview && audioPreview.status !== "loading" && <span className="font-mono text-[9px] tabular-nums text-muted-foreground">{formatTimestamp(Math.max(0, audioPreview.currentMs - audioPreview.startMs))} / {formatTimestamp(audioPreview.endMs - audioPreview.startMs)}</span>}
          </div>
        </div>
      </div>
      <div className="min-w-0"><blockquote className="line-clamp-3 text-[11px] leading-5 text-foreground/85">{item.sampleText ? `“${item.sampleText}”` : "No transcript sample overlaps this voice yet."}</blockquote><div className="mt-2 font-mono text-[9px] text-muted-foreground">{formatDate(item.mediaCreatedAtMs)} / starts {formatTimestamp(item.firstStartMs)}</div></div>
      <div className="min-w-0">
        {suggestion && item.suggestionScore !== null && <div className="mb-2 flex items-center gap-2 border border-primary/20 bg-primary/5 px-2 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">Looks like {suggestion.name}</div><div className="mt-0.5 font-mono text-[9px] text-muted-foreground">{Math.round(item.suggestionScore * 100)}% pattern match</div></div><Button size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => void run(() => window.vodSearch.speakers.assignProfile(item.id, suggestion.id))}>Use match</Button></div>}
        <Select value="choose" disabled={busy || profiles.length === 0} onValueChange={(profileId) => { if (profileId !== "choose") void run(() => window.vodSearch.speakers.assignProfile(item.id, profileId)) }}>
          <SelectTrigger className="h-8 w-full text-xs"><SelectValue /></SelectTrigger>
          <SelectContent><SelectItem value="choose">{profiles.length === 0 ? "No saved speakers yet" : "Choose existing speaker"}</SelectItem>{profiles.map((profile) => <SelectItem key={profile.id} value={profile.id}>{profile.name} / {profile.sampleCount} {profile.sampleCount === 1 ? "sample" : "samples"}</SelectItem>)}</SelectContent>
        </Select>
        <form className="mt-2 flex gap-1.5" onSubmit={createProfile}><Input value={newName} disabled={busy} onChange={(event) => setNewName(event.target.value)} placeholder="Name this speaker" aria-label={`Name ${item.displayName} in ${cleanMediaTitle(item.mediaTitle)}`} className="h-8 min-w-0 text-xs" /><Button type="submit" size="sm" className="h-8" disabled={busy || !newName.trim()}>{busy ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Add</Button></form>
      </div>
    </section>
  )
}

function SpeakerReviewEmpty({ title, description }: { title: string; description: string }): React.JSX.Element {
  return <div className="grid min-h-64 place-items-center border-b px-6 text-center"><div><Users className="mx-auto size-5 text-muted-foreground" /><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 max-w-sm text-[10px] leading-4 text-muted-foreground">{description}</p></div></div>
}

function speakerInitial(item: SpeakerReviewItem): string {
  const number = item.diarizationLabel.match(/(\d+)$/)?.[1]
  return number === undefined ? "?" : String(Number(number) + 1)
}

function speakerAudioPreviewRange(item: SpeakerReviewItem): [number, number] {
  const startMs = Math.max(0, item.sampleStartMs - 500)
  const naturalEndMs = Math.max(item.sampleEndMs + 750, startMs + 4_000)
  return [startMs, Math.min(naturalEndMs, startMs + 15_000)]
}

function waitForAudioMetadata(audio: HTMLAudioElement): Promise<void> {
  if (audio.readyState >= HTMLMediaElement.HAVE_METADATA) return Promise.resolve()
  return new Promise((resolve, reject) => {
    const cleanup = (): void => {
      audio.removeEventListener("loadedmetadata", handleLoaded)
      audio.removeEventListener("error", handleError)
    }
    const handleLoaded = (): void => { cleanup(); resolve() }
    const handleError = (): void => { cleanup(); reject(new Error("The audio preview could not be loaded.")) }
    audio.addEventListener("loadedmetadata", handleLoaded)
    audio.addEventListener("error", handleError)
  })
}
