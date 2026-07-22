export interface TimelinePoint {
  id: string
  startMs: number
}

export interface TimelinePointGroup<T extends TimelinePoint> {
  id: string
  startMs: number
  points: T[]
}

export function clusterTimelinePoints<T extends TimelinePoint>(
  points: T[],
  durationMs: number,
  minimumVisualSeparationPercent = 0.85
): TimelinePointGroup<T>[] {
  if (points.length === 0) return []

  const sorted = [...points].sort((left, right) => left.startMs - right.startMs)
  const minimumSeparationMs = Math.max(1, durationMs * minimumVisualSeparationPercent / 100)
  const groups: TimelinePointGroup<T>[] = []

  for (const point of sorted) {
    const previous = groups.at(-1)
    if (previous && point.startMs - previous.startMs <= minimumSeparationMs) {
      previous.points.push(point)
      previous.startMs = Math.round(previous.points.reduce((total, item) => total + item.startMs, 0) / previous.points.length)
      continue
    }

    groups.push({ id: point.id, startMs: point.startMs, points: [point] })
  }

  return groups
}
