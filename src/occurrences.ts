// Generates the firing instants of one parsed cron line over a window, in a
// given IANA timezone. Timezone arithmetic goes through `Intl.DateTimeFormat`
// with a `timeZone` — never UTC-plus-offset addition, which is the shape
// that gets DST wrong. Each wall-clock candidate is resolved through
// `resolveWallClock`, which returns the true set of UTC instants (0, 1 or 2)
// instead of guessing one — see `dst.ts` and its own doc comment for why.

import type { CronFields } from './parse.ts'
import { resolveWallClock, type WallClockKind } from './dst.ts'

export interface GenerateOptions {
  fields: CronFields
  /** Inclusive start of the search window. */
  start: Date
  /** Inclusive end of the search window. */
  end: Date
  /** IANA timezone, e.g. `Europe/Berlin`. */
  timeZone: string
  /** Never return more than this many instants. */
  cap: number
}

export interface Occurrence {
  /** ISO-8601 UTC instant, or `null` for a `skipped` wall clock that never fires. */
  instant: string | null
  /** The wall-clock time that was resolved, as `YYYY-MM-DDTHH:mm` local (no zone suffix — it's a civil time, not a UTC instant). */
  wallClock: string
  kind: WallClockKind
}

export interface GenerateResult {
  /**
   * Firing instants, in order, as ISO-8601 UTC strings. Derived from
   * `occurrences`: every `normal` and `repeated` instant, in the same
   * order they appear there. Kept for existing consumers and the
   * differential oracle; `occurrences` is the fuller answer.
   */
  instants: string[]
  /** Every wall-clock candidate the window matched, each labelled with its DST kind. */
  occurrences: Occurrence[]
  /** True when the window held more than `cap` instants and some were cut. */
  truncated: boolean
}

interface ZonedParts {
  year: number
  month: number
  day: number
  hour: number
  minute: number
}

const formatterCache = new Map<string, Intl.DateTimeFormat>()

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let formatter = formatterCache.get(timeZone)
  if (!formatter) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
    })
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

/** Reads the wall-clock date/time a UTC instant shows as in `timeZone`. */
function zonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant)
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

function pad2(n: number): string {
  return n < 10 ? `0${n}` : `${n}`
}

/** Day of week (0 = Sunday) for a plain calendar date — independent of any zone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Generates the firing instants of `fields` between `start` and `end`, inclusive, in `timeZone`. */
export function generateOccurrences(opts: GenerateOptions): GenerateResult {
  const { fields, start, end, timeZone, cap } = opts
  const occurrences: Occurrence[] = []
  let truncated = false
  const startMs = start.getTime()
  const endMs = end.getTime()

  const domWild = fields.dayOfMonthIsWildcard
  const dowWild = fields.dayOfWeekIsWildcard

  // Walk calendar days (a pure civil-calendar counter, independent of any
  // zone's DST) across the window, widened by one day on each side so a
  // zone offset can never push a boundary instant out of range.
  const startDay = zonedParts(start, timeZone)
  const endDay = zonedParts(end, timeZone)
  let dayAnchor = Date.UTC(startDay.year, startDay.month - 1, startDay.day - 1, 12, 0, 0)
  const dayAnchorEnd = Date.UTC(endDay.year, endDay.month - 1, endDay.day + 1, 12, 0, 0)

  // A skipped wall clock has no instant to test against [startMs, endMs], so
  // it is kept when its *naive* UTC reading (wall clock read as if it were
  // already UTC) falls within a few hours of the window — generous enough
  // to survive any real zone offset, since the day loop above already did
  // the coarse day-level filtering.
  const SKIPPED_SLACK_MS = 3 * 60 * 60 * 1000

  let emittedCount = 0

  outer: while (dayAnchor <= dayAnchorEnd) {
    const d = new Date(dayAnchor)
    const year = d.getUTCFullYear()
    const month = d.getUTCMonth() + 1
    const day = d.getUTCDate()

    if (fields.month.includes(month)) {
      const domMatch = fields.dayOfMonth.includes(day)
      const dowMatch = fields.dayOfWeek.includes(weekdayOf(year, month, day))
      const dayOk =
        domWild && dowWild ? true : domWild ? dowMatch : dowWild ? domMatch : domMatch || dowMatch

      if (dayOk) {
        for (const hour of fields.hour) {
          for (const minute of fields.minute) {
            const wallClock = `${year}-${pad2(month)}-${pad2(day)}T${pad2(hour)}:${pad2(minute)}`
            const resolution = resolveWallClock(year, month, day, hour, minute, timeZone)

            if (resolution.kind === 'skipped') {
              const naiveMs = Date.UTC(year, month - 1, day, hour, minute)
              if (naiveMs < startMs - SKIPPED_SLACK_MS || naiveMs > endMs + SKIPPED_SLACK_MS) continue
              occurrences.push({ instant: null, wallClock, kind: 'skipped' })
              continue
            }

            for (const instant of resolution.instants) {
              const utcMs = new Date(instant).getTime()
              if (utcMs < startMs || utcMs > endMs) continue
              occurrences.push({ instant, wallClock, kind: resolution.kind })
              emittedCount += 1
              if (emittedCount > cap) {
                occurrences.pop()
                emittedCount -= 1
                truncated = true
                break outer
              }
            }
          }
        }
      }
    }

    dayAnchor += 24 * 60 * 60 * 1000
  }

  // Occurrences are appended day-by-day, hour-then-minute within a day, and
  // within one wall clock a `repeated` resolution's instants are already
  // ascending — so the list is already chronological by (instant ?? naive
  // wall-clock-as-UTC). Sort defensively anyway: one cheap call, no doubt.
  occurrences.sort((a, b) => {
    const aMs = a.instant ? new Date(a.instant).getTime() : Date.parse(`${a.wallClock}:00Z`)
    const bMs = b.instant ? new Date(b.instant).getTime() : Date.parse(`${b.wallClock}:00Z`)
    return aMs - bMs
  })

  const instants = occurrences.filter((o): o is Occurrence & { instant: string } => o.instant !== null).map((o) => o.instant)

  return { instants, occurrences, truncated }
}
