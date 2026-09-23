import { describe, expect, it } from 'vitest'
import { parseCrontab } from '../src/parse.ts'
import type { CronLine } from '../src/parse.ts'
import { generateOccurrences } from '../src/occurrences.ts'
import type { Occurrence } from '../src/occurrences.ts'
import { findCollisions } from '../src/collisions.ts'
import type { JobOccurrences } from '../src/collisions.ts'

const BERLIN = 'Europe/Berlin'

/** Real crontab text -> parsed lines, one job per line, occurrences
 * generated over the given window/zone. Used for every test whose
 * discriminator is expressible at minute granularity. */
function jobsOf(crontab: string, start: string, end: string, timeZone = BERLIN, cap = 5000): JobOccurrences[] {
  const parsed = parseCrontab(crontab)
  if (parsed.errors.length > 0) {
    throw new Error(`fixture crontab failed to parse: ${JSON.stringify(parsed.errors)}`)
  }
  return parsed.lines.map((line) => ({
    line,
    result: generateOccurrences({
      fields: line.fields,
      start: new Date(start),
      end: new Date(end),
      timeZone,
      cap,
    }),
  }))
}

/** A synthetic line + single occurrence, for the anchoring discriminator
 * below, which needs second-level spacing that no real cron expression can
 * produce (cron fields are minute-granular). `findCollisions` only reads
 * `line.line` (for the distinct-line check) and each occurrence's
 * `instant`/`wallClock`, so a minimal fake `CronLine` is sufficient. */
function syntheticJob(lineNumber: number, instantIso: string): JobOccurrences {
  const line = { line: lineNumber, raw: `synthetic-${lineNumber}`, fields: {} as CronLine['fields'], command: 'echo x' } as CronLine
  const occurrence: Occurrence = { instant: instantIso, wallClock: instantIso.replace('Z', ''), kind: 'normal' }
  return { line, result: { instants: [instantIso], occurrences: [occurrence], truncated: false } }
}

/** Sibling of `syntheticJob` for a line that fires at several instants —
 * needed for the anchor-rejection discriminator below, where a single
 * synthetic line must carry two second-level-spaced occurrences. */
function syntheticMultiJob(lineNumber: number, instantIsos: string[]): JobOccurrences {
  const line = { line: lineNumber, raw: `synthetic-${lineNumber}`, fields: {} as CronLine['fields'], command: 'echo x' } as CronLine
  const occurrences: Occurrence[] = instantIsos.map((instant) => ({
    instant,
    wallClock: instant.replace('Z', ''),
    kind: 'normal',
  }))
  return { line, result: { instants: instantIsos, occurrences, truncated: false } }
}

describe('findCollisions: anchored grouping, cross-line only', () => {
  it('three identical lines over 7 days -> 7 groups of exactly 3 (not 21 pairs)', () => {
    const crontab = `0 3 * * * /usr/bin/a.sh\n0 3 * * * /usr/bin/b.sh\n0 3 * * * /usr/bin/c.sh\n`
    const jobs = jobsOf(crontab, '2026-06-01T00:00:00Z', '2026-06-08T00:00:00Z')
    const groups = findCollisions(jobs, 60)
    console.log('group count', groups.length, 'member counts', groups.map((g) => g.members.length))
    // A pairwise (non-anchored) implementation would return 21 groups of 2
    // (3 pairs/day * 7 days) instead of 7 groups of 3 — this is the
    // concrete broken version this assertion is red for.
    expect(groups.length).toBe(7)
    for (const group of groups) expect(group.members.length).toBe(3)
  })

  it('anchoring: 03:00:00 / 03:00:50 / 03:01:40, 60s window -> one group of 2, not 3', () => {
    const jobs = [
      syntheticJob(1, '2026-06-01T03:00:00.000Z'),
      syntheticJob(2, '2026-06-01T03:00:50.000Z'),
      syntheticJob(3, '2026-06-01T03:01:40.000Z'),
    ]
    const groups = findCollisions(jobs, 60)
    console.log('groups', JSON.stringify(groups.map((g) => g.members.map((m) => m.instant))))
    // Anchored: line 3 is 100s from the anchor (line 1) -> excluded.
    // A chaining implementation would return one group of all 3, because
    // line 3 is only 50s from line 2. Assert the member count as 2.
    expect(groups.length).toBe(1)
    expect(groups[0].members.length).toBe(2)
  })

  it('anchor-rejection discriminator: 3 members from 2 distinct lines, not 2', () => {
    // line 1 fires at +0s and +50s (from a 2026-06-01T03:00:00Z base); line
    // 2 fires at +70s and +75s. Window 60s. The anchor rule rejects line
    // 1's +0s occurrence (nothing else within 60s of it alone), then
    // anchors on line 1's +50s occurrence: line 2's +70s (20s away) and
    // +75s (25s away) both fall inside that 60s window, so the group has
    // three members from two distinct lines, anchored at +50s, not at
    // +0s. A spec that expects only two members (dropping one of line 2's
    // occurrences) is red against this — correct — implementation.
    const jobs = [
      syntheticMultiJob(1, ['2026-06-01T03:00:00.000Z', '2026-06-01T03:00:50.000Z']),
      syntheticMultiJob(2, ['2026-06-01T03:01:10.000Z', '2026-06-01T03:01:15.000Z']),
    ]
    const groups = findCollisions(jobs, 60)
    console.log('discriminator groups', JSON.stringify(groups.map((g) => ({ anchorMs: g.anchorMs, instants: g.members.map((m) => m.instant) }))))
    expect(groups.length).toBe(1)
    expect(groups[0].members.length).toBe(3)
    expect(new Set(groups[0].members.map((m) => m.line.line)).size).toBe(2)
    expect(groups[0].members.map((m) => m.instant)).toEqual([
      '2026-06-01T03:00:50.000Z',
      '2026-06-01T03:01:10.000Z',
      '2026-06-01T03:01:15.000Z',
    ])
    expect(groups[0].anchorMs).toBe(1780282850000)
  })

  it('a skipped occurrence has no instant and never collides', () => {
    // 2026-03-29 is Berlin's spring-forward day: 02:30 does not exist, so
    // this line's occurrence that day is `skipped` (instant: null) and
    // must never appear in a group, even though another line fires at the
    // same nominal wall clock.
    const crontab = `30 2 * * * /usr/bin/a.sh\n30 2 * * * /usr/bin/b.sh\n`
    const jobs = jobsOf(crontab, '2026-03-29T00:00:00Z', '2026-03-30T00:00:00Z')
    const groups = findCollisions(jobs, 60)
    console.log('groups on spring-forward day', groups.length)
    expect(groups.length).toBe(0)
  })

  it('fall-back day: two repeated instants -> 2 groups, anchors 3600000ms apart', () => {
    // 2026-10-25 is Berlin's fall-back day: 02:30 happens twice, an hour
    // apart. Both lines are `repeated` with both instants participating,
    // so each of the two real-world instants gets its own 2-line group.
    const crontab = `30 2 * * * /usr/bin/a.sh\n30 2 * * * /usr/bin/b.sh\n`
    const jobs = jobsOf(crontab, '2026-10-25T00:00:00Z', '2026-10-26T00:00:00Z')
    const groups = findCollisions(jobs, 60)
    console.log('fall-back groups', groups.length, groups.map((g) => g.anchorMs))
    expect(groups.length).toBe(2)
    for (const group of groups) expect(group.members.length).toBe(2)
    expect(groups[1].anchorMs - groups[0].anchorMs).toBe(3600000)
  })

  it('the window argument changes grouping: two lines 120s apart, five windows plus the no-arg default', () => {
    // line 1: `0 3 * * * /usr/bin/a.sh` -> one instant at 03:00:00.000Z.
    // line 2: `2 3 * * * /usr/bin/b.sh` -> one instant at 03:02:00.000Z.
    // 120 seconds apart. If findCollisions ignored its window argument,
    // every call below would return the same group count — they do not.
    const crontab = `0 3 * * * /usr/bin/a.sh\n2 3 * * * /usr/bin/b.sh\n`
    const jobs = jobsOf(crontab, '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', 'UTC')

    const counts = {
      w0: findCollisions(jobs, 0).length,
      w60: findCollisions(jobs, 60).length,
      w119: findCollisions(jobs, 119).length,
      w120: findCollisions(jobs, 120).length,
      w180: findCollisions(jobs, 180).length,
      noArg: findCollisions(jobs).length,
    }
    console.log('window-argument counts', JSON.stringify(counts))

    expect(counts.w0).toBe(0)
    expect(counts.w60).toBe(0)
    expect(counts.w119).toBe(0)
    expect(counts.w120).toBe(1)
    expect(counts.w180).toBe(1)
    expect(counts.noArg).toBe(0)

    const groups180 = findCollisions(jobs, 180)
    expect(groups180[0].members.length).toBe(2)
    expect([...new Set(groups180[0].members.map((m) => m.line.line))].sort((a, b) => a - b)).toEqual([1, 2])
  })

  it('one line cannot collide with itself', () => {
    // A single line firing twice 60s apart (0,1 3 * * *) within a 120s
    // window must not be reported: both occurrences share one crontab
    // line, and a group needs members from at least two distinct lines.
    const crontab = `0,1 3 * * * /usr/bin/a.sh\n`
    const jobs = jobsOf(crontab, '2026-06-01T00:00:00Z', '2026-06-02T00:00:00Z', BERLIN, 100)
    const groups = findCollisions(jobs, 120)
    console.log('self-collision groups', groups.length)
    expect(groups.length).toBe(0)
  })
})
