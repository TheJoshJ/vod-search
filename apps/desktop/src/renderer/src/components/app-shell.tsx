import type { LibraryStats } from "@vod-search/contracts"
import { Activity, CircleAlert, Clapperboard, Library, Moon, Settings, Smartphone, Sun, Users, X } from "lucide-react"
import type { AppView, Theme } from "@/app-types"
import { Badge } from "@/components/ui/badge"
import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

export function ErrorNotice({ error, onClose }: { error: string | null; onClose: () => void }): React.JSX.Element | null {
  if (!error) return null
  return (
    <div className="absolute left-1/2 top-3 z-50 flex max-w-xl -translate-x-1/2 items-center gap-2 rounded-md border border-destructive/35 bg-popover/95 px-3 py-2 text-xs shadow-lg backdrop-blur">
      <CircleAlert className="size-3.5 shrink-0 text-destructive" />
      <span className="min-w-0 flex-1 truncate">{error}</span>
      <Button variant="ghost" size="icon-sm" className="size-6" aria-label="Dismiss error" onClick={onClose}><X /></Button>
    </div>
  )
}

export function AppSidebar({
  view,
  onViewChange,
  stats,
  unassignedSpeakerCount,
  theme,
  onThemeChange
}: {
  view: AppView
  onViewChange: (view: AppView) => void
  stats: LibraryStats
  unassignedSpeakerCount: number
  theme: Theme
  onThemeChange: (theme: Theme) => void
}): React.JSX.Element {
  return (
    <aside className="app-sidebar flex w-[13.75rem] shrink-0 flex-col border-r border-sidebar-border bg-sidebar px-3.5 py-3.5 text-sidebar-foreground max-[1050px]:w-[4.25rem] max-[1050px]:px-2.5">
      <div className="flex h-11 items-center gap-2.5 px-1.5">
        <div className="grid size-8 shrink-0 place-items-center rounded-md bg-sidebar-primary text-sidebar-primary-foreground shadow-sm"><Clapperboard className="size-4" /></div>
        <div className="min-w-0 max-[1050px]:hidden">
          <div className="truncate text-sm font-semibold tracking-[-0.025em]">CutScout</div>
          <div className="truncate font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">Local video index</div>
        </div>
      </div>
      <nav className="mt-5 flex flex-col gap-1">
        <div className="mb-1 px-2 font-mono text-[8px] uppercase tracking-[0.16em] text-muted-foreground max-[1050px]:hidden">Workspace</div>
        <SidebarButton active={view === "library"} icon={Library} label="Library" onClick={() => onViewChange("library")} />
        <SidebarButton active={view === "short-form"} icon={Smartphone} label="Short form" onClick={() => onViewChange("short-form")} />
        <SidebarButton active={view === "speakers"} icon={Users} label="Speakers" badge={unassignedSpeakerCount || undefined} onClick={() => onViewChange("speakers")} />
        <SidebarButton active={view === "activity"} icon={Activity} label="Activity" badge={stats.runningJobs + stats.queuedJobs || undefined} onClick={() => onViewChange("activity")} />
        <div className="mt-2 border-t border-sidebar-border pt-2">
          <SidebarButton active={view === "settings"} icon={Settings} label="Settings" badge={stats.failedJobs || undefined} onClick={() => onViewChange("settings")} />
        </div>
      </nav>
      <div className="mt-auto border-t border-sidebar-border pt-3">
        <div className="px-2 max-[1050px]:hidden">
          <div className="flex items-center gap-2 text-[11px] font-medium"><span className="status-dot size-1.5 rounded-full bg-primary text-primary" />Index ready</div>
          <div className="mt-1 font-mono text-[9px] leading-4 text-muted-foreground">{stats.searchableChunks.toLocaleString()} moments · {stats.totalMedia.toLocaleString()} videos</div>
        </div>
        <Button aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} title={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"} variant="ghost" size="sm" className="mt-2 w-full justify-start px-2 font-normal max-[1050px]:justify-center" onClick={() => onThemeChange(theme === "dark" ? "light" : "dark")}>
          {theme === "dark" ? <Sun data-icon="inline-start" /> : <Moon data-icon="inline-start" />}<span className="max-[1050px]:hidden">{theme === "dark" ? "Light theme" : "Dark theme"}</span>
        </Button>
      </div>
    </aside>
  )
}

function SidebarButton({ active, icon: Icon, label, badge, onClick }: { active: boolean; icon: typeof Library; label: string; badge?: number | undefined; onClick: () => void }): React.JSX.Element {
  return (
    <Button aria-label={label} title={label} data-active={active} aria-current={active ? "page" : undefined} variant="ghost" size="sm" className={cn("app-nav-button h-9 w-full justify-start px-2 text-sidebar-foreground hover:bg-sidebar-accent hover:text-sidebar-accent-foreground max-[1050px]:justify-center", active && "bg-sidebar-accent text-sidebar-accent-foreground")} onClick={onClick}>
      <Icon data-icon="inline-start" />
      <span className="max-[1050px]:hidden">{label}</span>
      {badge ? <Badge variant={label === "Settings" ? "destructive" : "secondary"} className="ml-auto h-4 min-w-4 px-1 max-[1050px]:absolute max-[1050px]:-right-0.5 max-[1050px]:-top-0.5">{badge}</Badge> : null}
    </Button>
  )
}

export function PageHeader({ title, description, actions }: { title: string; description: string; actions?: React.ReactNode }): React.JSX.Element {
  return <header data-slot="page-header" className="page-header flex h-[4.5rem] shrink-0 items-center justify-between border-b px-5"><div className="min-w-0"><h1 className="text-[17px] font-semibold tracking-[-0.03em]">{title}</h1><p className="mt-0.5 truncate text-[10px] text-muted-foreground">{description}</p></div>{actions}</header>
}

export function WorkspacePage({ title, description, actions, children }: { title: string; description: string; actions?: React.ReactNode; children: React.ReactNode }): React.JSX.Element {
  return <div className="flex h-full min-h-0 flex-col"><PageHeader title={title} description={description} actions={actions} /><div className="min-h-0 flex-1 overflow-y-auto"><div className="mx-auto max-w-[1240px] px-5 pb-8">{children}</div></div></div>
}

export function InlineMetric({ label, value, tone = "default" }: { label: string; value: number; tone?: "default" | "healthy" | "danger" }): React.JSX.Element {
  return <div className="border-r px-4 py-3.5 last:border-r-0"><div className="font-mono text-[8px] uppercase tracking-[0.12em] text-muted-foreground">{label}</div><div className={cn("mt-1 font-mono text-lg font-semibold tabular-nums", tone === "healthy" && "text-primary", tone === "danger" && "text-destructive")}>{value.toLocaleString()}</div></div>
}
