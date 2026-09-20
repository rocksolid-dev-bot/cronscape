// Resolves a wall-clock date/time in an IANA timezone to the set of UTC
// instants it actually denotes. That set has exactly one member almost
// always, but twice a year it does not: a spring-forward local time can be
// **skipped** (0 instants — the clock jumps over it) or a fall-back local
// time can be **repeated** (2 instants — the clock passes through it
// twice). `occurrences.ts`'s old `wallClockToUtcMs` picked one instant
// unconditionally and its own doc comment admitted as much; this module
// replaces it with the honest answer.

export type WallClockKind = 'normal' | 'skipped' | 'repeated'

export interface WallClockResolution {
  kind: WallClockKind
  /** ISO-8601 UTC instants, sorted ascending. Length matches `kind`: 0 for
   * `skipped`, 1 for `normal`, 2 for `repeated`, never anything else. */
  instants: string[]
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
function zonedParts(instantMs: number, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(new Date(instantMs))
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value)
  return {
    year: get('year'),
    month: get('month'),
    day: get('day'),
    hour: get('hour'),
    minute: get('minute'),
  }
}

const HOUR_MS = 60 * 60 * 1000

/**
 * Resolves `year-month-day hour:minute` local time in `timeZone` to the set
 * of UTC instants it denotes.
 *
 * Method: take the naive UTC guess (as if the wall clock were UTC), then
 * probe candidate instants at the offsets that cover every real-world
 * transition (`guess`, `guess ± 1h`, `guess ± 2h`), and keep exactly the
 * candidates that **round-trip** — i.e. render back to the requested wall
 * clock when read back through `Intl` in `timeZone`. A skipped wall clock
 * round-trips to a different wall clock for every candidate, so it keeps
 * none; a repeated wall clock is rendered by two distinct UTC instants, so
 * it keeps two; an ordinary wall clock keeps exactly one. No dependency,
 * `Intl` only.
 */
export function resolveWallClock(
  year: number,
  month: number,
  day: number,
  hour: number,
  minute: number,
  timeZone: string,
): WallClockResolution {
  const desired = Date.UTC(year, month - 1, day, hour, minute)

  // First converge to a base guess near the true instant: treating the
  // wall clock as if it were already UTC is only a starting point (off by
  // the zone's whole fixed offset, e.g. +5:30 for Asia/Kolkata, not just a
  // DST hour) — one or two rounds of "read the offset back, subtract it"
  // lands within the zone's real offset regardless of its size.
  let baseGuess = desired
  for (let i = 0; i < 2; i++) {
    const observed = zonedParts(baseGuess, timeZone)
    const observedAsUtc = Date.UTC(observed.year, observed.month - 1, observed.day, observed.hour, observed.minute)
    const diff = desired - observedAsUtc
    if (diff === 0) break
    baseGuess += diff
  }

  // Around that converged base guess, probe the offsets that cover every
  // real-world DST transition size.
  const offsets = [0, -HOUR_MS, HOUR_MS, -2 * HOUR_MS, 2 * HOUR_MS]

  const kept = new Set<number>()
  for (const offset of offsets) {
    const candidate = baseGuess + offset
    const observed = zonedParts(candidate, timeZone)
    const matches =
      observed.year === year &&
      observed.month === month &&
      observed.day === day &&
      observed.hour === hour &&
      observed.minute === minute
    if (matches) kept.add(candidate)
  }

  const instants = [...kept].sort((a, b) => a - b)

  // Errors stay values: never observed in practice (it would mean two DST
  // transitions inside a 2h window of each other), but if more than two
  // candidates ever round-trip, keep the invariant true by capping to the
  // two closest to the naive guess rather than throwing past the caller.
  let kept2 = instants
  if (kept2.length > 2) {
    kept2 = [...kept2].sort((a, b) => Math.abs(a - desired) - Math.abs(b - desired)).slice(0, 2).sort((a, b) => a - b)
  }

  const kind: WallClockKind = kept2.length === 0 ? 'skipped' : kept2.length === 1 ? 'normal' : 'repeated'

  return { kind, instants: kept2.map((ms) => new Date(ms).toISOString()) }
}
