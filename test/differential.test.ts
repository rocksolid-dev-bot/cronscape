// A fixture I author tests my model of cron, not the format — which is
// exactly what produced the two-Sundays bug on day 1. This file cross-checks
// generateOccurrences against `cron-parser`, an independent implementation,
// over the same expressions and windows. Disagreement is the finding: if
// ours is right and the oracle is wrong, that is recorded inline, not
// deleted.
//
// cron-parser is a devDependency only (MIT, transitive dependency luxon
// MIT), pinned at ^5.10.1 (`engines: node >= 18`, satisfied by this
// container's 18.19.1) — this is a test oracle, not a feature, and must
// never appear in `dependencies`.

import { CronExpressionParser } from 'cron-parser'
import { describe, expect, it } from 'vitest'
import { parseCrontab } from '../src/parse.ts'
import type { CronFields } from '../src/parse.ts'
import { generateOccurrences } from '../src/occurrences.ts'

function fieldsOf(expr: string): CronFields {
  const result = parseCrontab(`${expr} echo x`)
  if (result.errors.length > 0) throw new Error(`fixture expression failed to parse: ${expr}`)
  return result.lines[0].fields
}

function ours(expr: string, start: Date, end: Date, timeZone: string): string[] {
  return generateOccurrences({ fields: fieldsOf(expr), start, end, timeZone, cap: 10_000 }).instants
}

/** cron-parser's `currentDate` is exclusive and `endDate` is inclusive, so
 * shift the start back by one minute to match our inclusive-both-ends
 * window. */
function oracle(expr: string, start: Date, end: Date, timeZone: string): string[] {
  const interval = CronExpressionParser.parse(expr, {
    currentDate: new Date(start.getTime() - 60_000),
    endDate: end,
    tz: timeZone,
  })
  const out: string[] = []
  while (interval.hasNext()) out.push(interval.next().toDate().toISOString())
  return out
}

// Every expression from the generator's own fixture table, plus the four
// TODAY.md names explicitly: dom/dow equality (0, 7), a step-on-hour, and a
// business-hours range.
const EXPRESSIONS = [
  '0 0 13 * *',
  '0 0 * * 5',
  '0 0 13 * 5',
  '0 0 * * *',
  '0 0 * * 0',
  '0 0 * * 7',
  '*/7 3 * * *',
  '0 9-17/2 * * MON-FRI',
  // Widened after all three items landed early (TODAY.md "Not today"):
  // more expressions the day's own fixture table didn't try.
  '@weekly',
  '5 4 * * SUN',
  '0 0 1-7 * 1',
]

// A DST-free stretch (January 2026, both in UTC and Europe/Berlin) so a
// disagreement means a grammar difference, not a clock-jump one.
const WINDOW_START = new Date('2026-01-01T00:00:00Z')
const WINDOW_END = new Date('2026-01-31T23:59:00Z')

describe('generateOccurrences vs cron-parser: differential oracle', () => {
  for (const timeZone of ['UTC', 'Europe/Berlin']) {
    for (const expr of EXPRESSIONS) {
      it(`agrees with cron-parser for "${expr}" in ${timeZone}`, () => {
        const mine = ours(expr, WINDOW_START, WINDOW_END, timeZone)
        const theirs = oracle(expr, WINDOW_START, WINDOW_END, timeZone)
        expect(mine).toEqual(theirs)
      })
    }
  }
})

describe('generateOccurrences vs cron-parser: a genuine disagreement, kept not deleted', () => {
  it('MON-SUN wrap-around: ours parses it, cron-parser rejects it as an inverted range', () => {
    // TODAY.md's own domain reading (and Vixie/POSIX cron) treat MON-SUN as
    // wrap-around for "every day", not an inverted range — ours handles it.
    // cron-parser 5.10.1 does not: it throws "Invalid range: 1-0, min(1) >
    // max(0)", reading it the way plain numeric range validation would.
    // Ours is right per the format's own semantics; the disagreement is
    // recorded here rather than silently dropping the case from the suite.
    const mine = ours(
      '0 0 * * MON-SUN',
      new Date('2026-01-01T00:00:00Z'),
      new Date('2026-01-08T00:00:00Z'),
      'UTC',
    )
    expect(mine).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
      '2026-01-06T00:00:00.000Z',
      '2026-01-07T00:00:00.000Z',
      '2026-01-08T00:00:00.000Z',
    ])
    expect(() =>
      oracle('0 0 * * MON-SUN', new Date('2026-01-01T00:00:00Z'), new Date('2026-01-08T00:00:00Z'), 'UTC'),
    ).toThrow(/Invalid range/)
  })
})

describe('generateOccurrences: 30 2 * * * disagrees with the oracle on both DST days', () => {
  // Day 3 built the classifier this asserts. cron-parser walks wall-clock
  // minutes forward and reports whatever the underlying JS Date happens to
  // produce for that minute; cronscape reports the wall clock the crontab
  // actually asked for, resolved to its true set of 0/1/2 UTC instants. The
  // two answers are not "one is buggy" — they are two different questions,
  // and this test asserts both sides' real, printed behaviour rather than
  // adjudicating a winner or deleting the disagreement to get green.

  it('spring-forward 2026-03-29: oracle invents an instant, we correctly emit none', () => {
    const result = generateOccurrences({
      fields: fieldsOf('30 2 * * *'),
      start: new Date('2026-03-29T00:00:00Z'),
      end: new Date('2026-03-29T23:59:00Z'),
      timeZone: 'Europe/Berlin',
      cap: 10_000,
    })
    console.log('ours spring-forward 2026-03-29:', result.occurrences)

    const oracleSpring = oracle(
      '30 2 * * *',
      new Date('2026-03-29T00:00:00Z'),
      new Date('2026-03-29T23:59:00Z'),
      'Europe/Berlin',
    )
    console.log('oracle spring-forward 2026-03-29:', oracleSpring)

    // The oracle's one instant is 03:30 local Berlin time (Berlin jumps
    // 02:00 -> 03:00 at 01:00 UTC that day) — an hour after the 02:30 the
    // crontab actually asks for. cron-parser walked its internal clock
    // forward past the gap and fired anyway; it never asked "does 02:30
    // exist today".
    expect(oracleSpring).toEqual(['2026-03-29T01:30:00.000Z'])

    // We report the wall clock the crontab asked for: it does not exist
    // that day, so no instant fires and the anomaly carries the impossible
    // wall clock instead. Asserted as counts, not membership, per the
    // day-1 lesson that element checks can't verify the domain is right.
    expect(result.instants.length).toBe(0)
    const skipped = result.occurrences.filter((o) => o.kind === 'skipped')
    expect(skipped.length).toBe(1)
    expect(skipped[0].wallClock).toBe('2026-03-29T02:30')
  })

  it('fall-back 2026-10-25: oracle reports one instant, we correctly report both', () => {
    const result = generateOccurrences({
      fields: fieldsOf('30 2 * * *'),
      start: new Date('2026-10-25T00:00:00Z'),
      end: new Date('2026-10-25T23:59:00Z'),
      timeZone: 'Europe/Berlin',
      cap: 10_000,
    })
    console.log('ours fall-back 2026-10-25:', result.occurrences)

    const oracleFall = oracle(
      '30 2 * * *',
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-10-25T23:59:00Z'),
      'Europe/Berlin',
    )
    console.log('oracle fall-back 2026-10-25:', oracleFall)

    // The oracle picks one side of the repeated hour (the first walk past
    // 02:30 that minute) and reports it as the only firing. Vixie cron's
    // actual behaviour is a separate, unverified claim that does not
    // belong in this file (see BRIEF.md / docs/dst.md, day 5) — this
    // assertion is only about what cron-parser, specifically, returns.
    expect(oracleFall).toEqual(['2026-10-25T00:30:00.000Z'])

    // 02:30 local happens twice that day; we report both instants, both
    // labelled repeated.
    expect(result.instants.length).toBe(2)
    const repeated = result.occurrences.filter((o) => o.kind === 'repeated')
    expect(repeated.length).toBe(2)
    expect(result.instants).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'])
  })
})
