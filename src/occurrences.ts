// Generates the firing instants of one parsed cron line over a window, in a
// given IANA timezone. Timezone arithmetic goes through `Intl.DateTimeFormat`
// with a `timeZone` — never UTC-plus-offset addition, which is the shape
// that gets DST wrong. DST *classification* (skipped/repeated) is a later
// day's job: this module only produces instants, and never labels one.

import type { CronFields } from './parse.ts'

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

export interface GenerateResult {
  /** Firing instants, in order, as ISO-8601 UTC strings. */
  instants: string[]
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

/**
 * Finds the UTC instant (in minutes) for a wall-clock date/time in
 * `timeZone`. Converges in at most two passes for ordinary offset changes;
 * near a DST jump this returns *a* plausible instant rather than flagging
 * the ambiguity — that flag is day 3's job, not this function's.
 */
function wallClockToUtcMs(year: number, month: number, day: number, hour: number, minute: number, timeZone: string): number {
  const desired = Date.UTC(year, month - 1, day, hour, minute)
  let guess = desired
  for (let i = 0; i < 2; i++) {
    const observed = zonedParts(new Date(guess), timeZone)
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute)
    const diff = desired - observedAsUtc
    if (diff === 0) break
    guess += diff
  }
  return guess
}

/** Day of week (0 = Sunday) for a plain calendar date — independent of any zone. */
function weekdayOf(year: number, month: number, day: number): number {
  return new Date(Date.UTC(year, month - 1, day)).getUTCDay()
}

/** Generates the firing instants of `fields` between `start` and `end`, inclusive, in `timeZone`. */
export function generateOccurrences(opts: GenerateOptions): GenerateResult {
  const { fields, start, end, timeZone, cap } = opts
  const instants: string[] = []
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
            const utcMs = wallClockToUtcMs(year, month, day, hour, minute, timeZone)
            if (utcMs < startMs || utcMs > endMs) continue
            instants.push(new Date(utcMs).toISOString())
            if (instants.length > cap) {
              instants.pop()
              truncated = true
              break outer
            }
          }
        }
      }
    }

    dayAnchor += 24 * 60 * 60 * 1000
  }

  // Instants are appended day-by-day, hour-then-minute within a day, so they
  // are already chronological — but the widened scan can visit the trailing
  // buffer day before a not-yet-visited earlier one only if dates are out of
  // order, which they never are here. Sort defensively anyway: it is one
  // cheap call and removes any doubt.
  instants.sort()

  return { instants, truncated }
}
