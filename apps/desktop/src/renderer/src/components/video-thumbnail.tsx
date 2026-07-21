import { useEffect, useRef, useState } from "react"
import { Film, Play } from "lucide-react"
import { cn } from "@/lib/utils"

export function VideoThumbnail({
  mediaId,
  seekMs = 4_000,
  className,
  showPlay = true
}: {
  mediaId: string
  seekMs?: number
  className?: string
  showPlay?: boolean
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const [source, setSource] = useState<string | null>(null)
  const [visible, setVisible] = useState(false)
  const [frameReady, setFrameReady] = useState(false)

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const observer = new IntersectionObserver(([entry]) => {
      if (entry?.isIntersecting) {
        setVisible(true)
        observer.disconnect()
      }
    }, { rootMargin: "240px" })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    if (!visible) return
    let cancelled = false
    void window.vodSearch.media.getPlaybackSource(mediaId).then((result) => {
      if (!cancelled && result.available) setSource(result.url)
    }).catch(() => {
      if (!cancelled) setSource(null)
    })
    return () => { cancelled = true }
  }, [mediaId, visible])

  return (
    <div ref={containerRef} className={cn("group/thumbnail relative overflow-hidden bg-muted", className)}>
      <div className="absolute inset-0 grid place-items-center text-muted-foreground/45">
        <Film className="size-9" strokeWidth={1.35} />
      </div>
      {source && (
        <video
          ref={videoRef}
          aria-hidden="true"
          className={cn("absolute inset-0 size-full object-cover transition duration-500", frameReady ? "opacity-100 scale-100" : "opacity-0 scale-[1.02]")}
          src={`${source}#t=${Math.max(0, seekMs / 1000)}`}
          muted
          playsInline
          preload="metadata"
          onLoadedMetadata={() => {
            const video = videoRef.current
            if (!video || !Number.isFinite(video.duration)) return
            video.currentTime = Math.min(Math.max(0, seekMs / 1000), Math.max(0, video.duration - 0.1))
          }}
          onSeeked={() => setFrameReady(true)}
          onLoadedData={() => setFrameReady(true)}
        />
      )}
      <div className="absolute inset-0 bg-gradient-to-t from-foreground/30 via-transparent to-transparent opacity-70" />
      {showPlay && (
        <div className="absolute inset-0 grid place-items-center opacity-0 transition-opacity group-hover/thumbnail:opacity-100">
          <span className="grid size-11 place-items-center rounded-full bg-background/90 text-foreground shadow-lg backdrop-blur-sm">
            <Play className="ml-0.5 size-4 fill-current" />
          </span>
        </div>
      )}
    </div>
  )
}
