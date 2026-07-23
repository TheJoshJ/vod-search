import { type FormEvent, useEffect, useState } from "react"
import type { MediaDetail, MediaSpeaker, SpeakerProfile } from "@vod-search/contracts"
import { CheckCircle2, ChevronDown, CircleAlert, LoaderCircle, UserPlus, Users } from "lucide-react"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Popover, PopoverContent, PopoverDescription, PopoverHeader, PopoverTitle, PopoverTrigger } from "@/components/ui/popover"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { formatTimestamp } from "@/lib/format"
import { cn } from "@/lib/utils"

interface SpeakerActionProps {
  onChanged: () => Promise<void>
  onError: (reason: unknown) => void
}

export function TranscriptSpeakerAssignment({ speaker, profiles, onChanged, onError }: SpeakerActionProps & { speaker: MediaSpeaker; profiles: SpeakerProfile[] }): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const [feedback, setFeedback] = useState<string | null>(null)
  const { busy, run } = useSpeakerAction(onChanged, onError)
  const profile = profiles.find((candidate) => candidate.id === speaker.profileId)
  const suggestion = profiles.find((candidate) => candidate.id === speaker.suggestedProfileId)

  async function assign(profileId: string | null): Promise<void> {
    setFeedback(null)
    if (!await run(() => window.vodSearch.speakers.assignProfile(speaker.id, profileId))) return
    const profileName = profiles.find((candidate) => candidate.id === profileId)?.name
    setFeedback(profileName ? `Labeled ${speaker.turnCount} ${speaker.turnCount === 1 ? "turn" : "turns"} as ${profileName}.` : `Removed the label from ${speaker.turnCount} ${speaker.turnCount === 1 ? "turn" : "turns"}.`)
  }

  async function create(name: string): Promise<boolean> {
    setFeedback(null)
    const created = await run(() => window.vodSearch.speakers.createProfile(speaker.id, name))
    if (created) setFeedback(`Created ${name} and labeled ${speaker.turnCount} ${speaker.turnCount === 1 ? "turn" : "turns"}.`)
    return created
  }

  return (
    <Popover open={open} onOpenChange={(nextOpen) => { setOpen(nextOpen); if (nextOpen) setFeedback(null) }}>
      <PopoverTrigger asChild><Button variant="ghost" size="sm" className={cn("h-5 max-w-full gap-1 px-1.5 text-[9px] font-semibold text-muted-foreground hover:bg-background/80 hover:text-foreground", !profile && "text-primary")} aria-label={`${profile ? `Change ${profile.name}` : `Assign ${speaker.displayName}`} for this transcript voice`}>{profile ? <span className="size-1.5 shrink-0 rounded-full bg-primary/70" /> : <UserPlus className="size-3" />}<span className="truncate">{profile?.name ?? `${speaker.displayName} · Assign`}</span><ChevronDown className="size-3 shrink-0 opacity-65" /></Button></PopoverTrigger>
      <PopoverContent side="left" align="center" sideOffset={6} className="w-72 p-3">
        <PopoverHeader><PopoverTitle className="text-xs">Assign this detected voice</PopoverTitle><PopoverDescription className="text-[10px] leading-4">The change applies to {speaker.turnCount === 1 ? "the detected turn" : `all ${speaker.turnCount} turns`} for this voice in the video.</PopoverDescription></PopoverHeader>
        {suggestion && !profile && speaker.suggestionScore !== null && <div className="mt-3 flex items-center gap-2 border-y border-primary/20 bg-primary/5 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">Suggested: {suggestion.name}</div><div className="text-[9px] text-muted-foreground">{Math.round(speaker.suggestionScore * 100)}% voice similarity</div></div><Button size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => void assign(suggestion.id)}>Use</Button></div>}
        <div className="mt-3"><label className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Existing speaker</label><SpeakerProfileSelect speaker={speaker} profiles={profiles} busy={busy} onAssign={(profileId) => void assign(profileId)} /></div>
        <div className="mt-3 border-t pt-3"><label className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">New speaker</label><NewSpeakerProfileForm speaker={speaker} busy={busy} onCreate={create} /></div>
        {feedback && <p role="status" aria-live="polite" className="mt-3 flex items-center gap-1.5 border-t pt-2 text-[9px] leading-4 text-primary"><CheckCircle2 className="size-3 shrink-0" />{feedback}</p>}
      </PopoverContent>
    </Popover>
  )
}

export function SpeakersPanel({ detail, onChanged, onError }: SpeakerActionProps & { detail: MediaDetail }): React.JSX.Element {
  const analysis = detail.speakerAnalysis
  if (analysis.state === "setup-required") return <SpeakerEmptyState icon={Users} title="Speaker recognition is unavailable" description="The bundled Sherpa ONNX models are missing from this build. Reinstall CutScout to restore local speaker analysis." />
  if (analysis.state === "queued" || analysis.state === "running") return <SpeakerEmptyState icon={LoaderCircle} spinning title={analysis.state === "running" ? "Identifying speakers" : "Speaker analysis queued"} description="The transcript stays available while local speaker analysis runs in the background." />
  if (analysis.state === "failed") return <SpeakerEmptyState icon={CircleAlert} title="Speaker analysis stopped" description={analysis.error ?? "Retry the diarization job from Activity."} destructive />
  if (detail.speakers.length === 0) return <SpeakerEmptyState icon={Users} title="No distinct speakers found" description="Local analysis completed, but it did not return a usable voice pattern for this clip." />
  return <div><div className="border-b bg-muted/20 px-3 py-3"><p className="text-[10px] leading-4 text-muted-foreground">Tag a detected voice once, then reuse or accept that pattern in later clips. Every correction updates the local pattern.</p></div><div className="divide-y">{detail.speakers.map((speaker, index) => <SpeakerEditor key={speaker.id} speaker={speaker} index={index} profiles={detail.speakerProfiles} onChanged={onChanged} onError={onError} />)}</div></div>
}

function SpeakerEditor({ speaker, index, profiles, onChanged, onError }: SpeakerActionProps & { speaker: MediaSpeaker; index: number; profiles: SpeakerProfile[] }): React.JSX.Element {
  const profile = profiles.find((candidate) => candidate.id === speaker.profileId)
  const suggestion = profiles.find((candidate) => candidate.id === speaker.suggestedProfileId)
  const [profileName, setProfileName] = useState(profile?.name ?? "")
  const { busy, run } = useSpeakerAction(onChanged, onError)
  useEffect(() => setProfileName(profile?.name ?? ""), [profile?.name])
  return <section className="px-3 py-3"><div className="flex items-start gap-2.5"><div className="grid size-7 shrink-0 place-items-center rounded-full bg-primary/10 text-[10px] font-semibold text-primary">{index + 1}</div><div className="min-w-0 flex-1"><div className="flex items-center gap-2"><h3 className="truncate text-xs font-semibold">{speaker.displayName}</h3>{profile ? <Badge variant="accent" className="h-4 px-1.5 text-[8px]">Tagged</Badge> : <Badge variant="secondary" className="h-4 px-1.5 text-[8px]">Detected</Badge>}</div><div className="mt-1 flex gap-2 font-mono text-[9px] text-muted-foreground"><span>{formatTimestamp(speaker.speechMs)} speaking</span><span>{speaker.turnCount} {speaker.turnCount === 1 ? "turn" : "turns"}</span><span>first at {formatTimestamp(speaker.firstStartMs)}</span></div></div>{busy && <LoaderCircle className="mt-1 size-3.5 animate-spin text-muted-foreground" />}</div>{suggestion && speaker.suggestionScore !== null && <div className="mt-3 flex items-center gap-2 border border-primary/20 bg-primary/5 px-2 py-2"><div className="min-w-0 flex-1"><div className="truncate text-[10px] font-semibold">Looks like {suggestion.name}</div><div className="mt-0.5 text-[9px] text-muted-foreground">{Math.round(speaker.suggestionScore * 100)}% pattern match</div></div><Button size="sm" className="h-7 px-2 text-[10px]" disabled={busy} onClick={() => void run(() => window.vodSearch.speakers.assignProfile(speaker.id, suggestion.id))}>Use match</Button></div>}<div className="mt-3"><label className="text-[9px] font-medium uppercase tracking-wide text-muted-foreground">Speaker pattern</label><SpeakerProfileSelect speaker={speaker} profiles={profiles} busy={busy} onAssign={(profileId) => void run(() => window.vodSearch.speakers.assignProfile(speaker.id, profileId))} /></div>{profile ? <div className="mt-2 flex gap-1.5"><Input value={profileName} disabled={busy} onChange={(event) => setProfileName(event.target.value)} aria-label={`Rename ${profile.name}`} className="h-8 text-xs" /><Button variant="outline" size="sm" disabled={busy || !profileName.trim() || profileName.trim() === profile.name} onClick={() => void run(() => window.vodSearch.speakers.renameProfile(profile.id, profileName.trim()))}>Rename</Button></div> : <NewSpeakerProfileForm speaker={speaker} busy={busy} onCreate={(name) => run(() => window.vodSearch.speakers.createProfile(speaker.id, name))} />}</section>
}

function SpeakerProfileSelect({ speaker, profiles, busy, onAssign }: { speaker: MediaSpeaker; profiles: SpeakerProfile[]; busy: boolean; onAssign: (profileId: string | null) => void }): React.JSX.Element {
  return <Select value={speaker.profileId ?? "unassigned"} disabled={busy} onValueChange={(value) => onAssign(value === "unassigned" ? null : value)}><SelectTrigger className="mt-1 h-8 w-full text-xs" aria-label={`Speaker profile for ${speaker.displayName}`}><SelectValue /></SelectTrigger><SelectContent><SelectItem value="unassigned">Not tagged</SelectItem>{profiles.map((candidate) => <SelectItem key={candidate.id} value={candidate.id}>{candidate.name} · {candidate.sampleCount} {candidate.sampleCount === 1 ? "sample" : "samples"}</SelectItem>)}</SelectContent></Select>
}

function NewSpeakerProfileForm({ speaker, busy, onCreate }: { speaker: MediaSpeaker; busy: boolean; onCreate: (name: string) => Promise<boolean> }): React.JSX.Element {
  const [name, setName] = useState("")
  async function submit(event: FormEvent): Promise<void> { event.preventDefault(); const nextName = name.trim(); if (!nextName || busy) return; if (await onCreate(nextName)) setName("") }
  return <form className="mt-1 flex gap-1.5" onSubmit={(event) => void submit(event)}><Input value={name} disabled={busy} onChange={(event) => setName(event.target.value)} aria-label={`Create a new profile for ${speaker.displayName}`} placeholder="Name this speaker" className="h-8 text-xs" /><Button type="submit" size="sm" disabled={busy || !name.trim()}>{busy ? <LoaderCircle className="animate-spin" /> : <UserPlus />}Create</Button></form>
}

function useSpeakerAction(onChanged: () => Promise<void>, onError: (reason: unknown) => void): { busy: boolean; run: (action: () => Promise<unknown>) => Promise<boolean> } {
  const [busy, setBusy] = useState(false)
  async function run(action: () => Promise<unknown>): Promise<boolean> { setBusy(true); try { await action(); await onChanged(); return true } catch (reason) { onError(reason); return false } finally { setBusy(false) } }
  return { busy, run }
}

function SpeakerEmptyState({ icon: Icon, title, description, spinning = false, destructive = false }: { icon: typeof Users; title: string; description: string; spinning?: boolean; destructive?: boolean }): React.JSX.Element {
  return <div className="grid min-h-56 place-items-center px-6 text-center"><div><Icon className={cn("mx-auto size-5 text-muted-foreground", spinning && "animate-spin", destructive && "text-destructive")} /><p className="mt-3 text-xs font-semibold">{title}</p><p className="mt-1 max-w-64 text-[10px] leading-4 text-muted-foreground">{description}</p></div></div>
}
