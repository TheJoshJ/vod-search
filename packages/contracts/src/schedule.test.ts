import { describe, expect, it } from "vitest"
import {
  defaultProcessingSchedule,
  isJobStageAllowed,
  isProcessingWindowOpen,
  nextProcessingWindowStart,
  scheduleGroupForJobStage
} from "./schedule.js"

function localTime(hours: number, minutes = 0): Date {
  return new Date(2026, 6, 21, hours, minutes, 0, 0)
}

describe("processing schedule", () => {
  it("supports daytime and overnight windows", () => {
    const daytime = { enabled: true, startMinute: 9 * 60, endMinute: 17 * 60 }
    const overnight = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 }

    expect(isProcessingWindowOpen(daytime, localTime(9))).toBe(true)
    expect(isProcessingWindowOpen(daytime, localTime(17))).toBe(false)
    expect(isProcessingWindowOpen(overnight, localTime(23))).toBe(true)
    expect(isProcessingWindowOpen(overnight, localTime(6, 59))).toBe(true)
    expect(isProcessingWindowOpen(overnight, localTime(12))).toBe(false)
  })

  it("maps only scheduled work to its processing group", () => {
    expect(scheduleGroupForJobStage("probe")).toBe("ingestion")
    expect(scheduleGroupForJobStage("transcribe")).toBe("transcription")
    expect(scheduleGroupForJobStage("enrich")).toBe("summarization")
    expect(scheduleGroupForJobStage("embed")).toBeNull()
  })

  it("leaves all stages available by default", () => {
    for (const stage of ["probe", "transcribe", "enrich", "embed"] as const) {
      expect(isJobStageAllowed(defaultProcessingSchedule, stage, localTime(12))).toBe(true)
    }
  })

  it("finds the next local start after a closed window", () => {
    const window = { enabled: true, startMinute: 22 * 60, endMinute: 7 * 60 }
    expect(nextProcessingWindowStart(window, localTime(12))?.getTime()).toBe(localTime(22).getTime())
    expect(nextProcessingWindowStart(window, localTime(23))).toBeNull()
  })
})
