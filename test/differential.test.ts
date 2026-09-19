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

describe('generateOccurrences: exploratory DST print (recorded, not asserted)', () => {
  it('prints our instants for 30 2 * * * across the 2026 spring-forward and fall-back days', () => {
    // Europe/Berlin: spring-forward is 2026-03-29 (02:00 -> 03:00, so 02:30
    // does not exist that day); fall-back is 2026-10-25 (03:00 -> 02:00, so
    // 02:30 happens twice). This run is deliberately NOT turned into an
    // assertion today — day 3 classifies skipped/repeated; today's generator
    // only produces instants, and whatever it does here is day 3's input,
    // not a bug to fix now.
    const spring = ours(
      '30 2 * * *',
      new Date('2026-03-29T00:00:00Z'),
      new Date('2026-03-29T23:59:00Z'),
      'Europe/Berlin',
    )
    const fall = ours(
      '30 2 * * *',
      new Date('2026-10-25T00:00:00Z'),
      new Date('2026-10-25T23:59:00Z'),
      'Europe/Berlin',
    )
    console.log('spring-forward 2026-03-29 (Europe/Berlin):', spring)
    console.log('fall-back 2026-10-25 (Europe/Berlin):', fall)

    const oracleSpring = (() => {
      try {
        return oracle(
          '30 2 * * *',
          new Date('2026-03-29T00:00:00Z'),
          new Date('2026-03-29T23:59:00Z'),
          'Europe/Berlin',
        )
      } catch (e) {
        return [`oracle error: ${(e as Error).message}`]
      }
    })()
    const oracleFall = (() => {
      try {
        return oracle(
          '30 2 * * *',
          new Date('2026-10-25T00:00:00Z'),
          new Date('2026-10-25T23:59:00Z'),
          'Europe/Berlin',
        )
      } catch (e) {
        return [`oracle error: ${(e as Error).message}`]
      }
    })()
    console.log('oracle spring-forward:', oracleSpring)
    console.log('oracle fall-back:', oracleFall)
    // This console output is copied by hand into the capture file
    // (media/2026-09-19-day2.txt) at close-out — the test itself does not
    // write to that file, so re-running the suite never duplicates it.

    // Recorded, not asserted — the only "expectation" here is that the call
    // completed without throwing, which the test reaching this line proves.
    expect(true).toBe(true)
  })
})
