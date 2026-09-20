import { describe, expect, it } from 'vitest'
import { parseCrontab } from '../src/parse.ts'
import type { CronFields } from '../src/parse.ts'
import { generateOccurrences } from '../src/occurrences.ts'
import type { GenerateResult, Occurrence } from '../src/occurrences.ts'

const UTC = 'UTC'

function fieldsOf(expr: string): CronFields {
  const result = parseCrontab(`${expr} echo x`)
  if (result.errors.length > 0) throw new Error(`fixture expression failed to parse: ${expr}`)
  return result.lines[0].fields
}

function run(expr: string, startIso: string, endIso: string, timeZone = UTC, cap = 1000): GenerateResult {
  return generateOccurrences({
    fields: fieldsOf(expr),
    start: new Date(startIso),
    end: new Date(endIso),
    timeZone,
    cap,
  })
}

describe('generateOccurrences: dom/dow OR rule, one combination per test', () => {
  it('restricted-DOM only: fires on the 13th regardless of weekday', () => {
    const result = run('0 0 13 * *', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    console.log(JSON.stringify(result, null, 2))
    expect(result.instants).toEqual(['2026-01-13T00:00:00.000Z'])
  })

  it('restricted-DOW only: fires every Friday in the window', () => {
    const result = run('0 0 * * 5', '2026-01-01T00:00:00Z', '2026-01-31T00:00:00Z')
    // 2026-01-01 is a Thursday, so the Fridays are the 2nd, 9th, 16th, 23rd, 30th.
    expect(result.instants).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-09T00:00:00.000Z',
      '2026-01-16T00:00:00.000Z',
      '2026-01-23T00:00:00.000Z',
      '2026-01-30T00:00:00.000Z',
    ])
  })

  it('both restricted: OR — the 13th, plus every Friday, is strictly more than the 13th alone', () => {
    const both = run('0 0 13 * 5', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    const domOnly = run('0 0 13 * *', '2026-01-01T00:00:00Z', '2026-02-01T00:00:00Z')
    expect(both.instants).toEqual([
      '2026-01-02T00:00:00.000Z',
      '2026-01-09T00:00:00.000Z',
      '2026-01-13T00:00:00.000Z',
      '2026-01-16T00:00:00.000Z',
      '2026-01-23T00:00:00.000Z',
      '2026-01-30T00:00:00.000Z',
    ])
    expect(both.instants.length).toBeGreaterThan(domOnly.instants.length)
  })

  it('neither restricted: fires every day at the given time', () => {
    const result = run('0 0 * * *', '2026-01-01T00:00:00Z', '2026-01-05T00:00:00Z')
    expect(result.instants).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-02T00:00:00.000Z',
      '2026-01-03T00:00:00.000Z',
      '2026-01-04T00:00:00.000Z',
      '2026-01-05T00:00:00.000Z',
    ])
  })
})

describe('generateOccurrences: bounds', () => {
  it('an unsatisfiable expression (Feb 30) returns empty, not truncated, and finishes', () => {
    const result = run('0 0 30 2 *', '2025-01-01T00:00:00Z', '2028-01-01T00:00:00Z')
    expect(result).toEqual({ instants: [], occurrences: [], truncated: false })
  })

  it('a window with more matches than the cap returns exactly cap instants, truncated', () => {
    const result = run('* * * * *', '2026-01-01T00:00:00Z', '2026-01-01T02:00:00Z', UTC, 50)
    expect(result.instants).toHaveLength(50)
    expect(result.truncated).toBe(true)
  })

  it('*/15 * * * * over one hour yields the four quarter-hour instants', () => {
    // [00:00, 00:59:59] is "one hour" as a half-open window — the window end
    // is exclusive of the next hour's own :00, so this is 4 instants, not 5.
    const result = run('*/15 * * * *', '2026-01-01T00:00:00Z', '2026-01-01T00:59:59Z')
    expect(result.instants).toEqual([
      '2026-01-01T00:00:00.000Z',
      '2026-01-01T00:15:00.000Z',
      '2026-01-01T00:30:00.000Z',
      '2026-01-01T00:45:00.000Z',
    ])
  })
})

describe('generateOccurrences: DST — skipped/repeated firings, no invented instant', () => {
  const onlyOn = (result: GenerateResult, isoDatePrefix: string): Occurrence[] =>
    result.occurrences.filter((o) => (o.instant ?? `${o.wallClock}:00Z`).startsWith(isoDatePrefix))

  it('30 2 * * * on spring-forward day (Europe/Berlin, 2026-03-29): no valid instant', () => {
    const result = run('30 2 * * *', '2026-03-28T00:00:00Z', '2026-03-30T00:00:00Z', 'Europe/Berlin')
    const onThatDay = onlyOn(result, '2026-03-29')
    console.log(JSON.stringify(onThatDay, null, 2))
    expect(onThatDay).toHaveLength(1)
    expect(onThatDay[0].kind).toBe('skipped')
    expect(onThatDay[0].instant).toBe(null)
    const instantsOnThatDay = result.instants.filter((i) => i.startsWith('2026-03-29'))
    expect(instantsOnThatDay.length).toBe(0)
  })

  it('30 2 * * * on fall-back day (Europe/Berlin, 2026-10-25): two repeated instants', () => {
    const result = run('30 2 * * *', '2026-10-24T00:00:00Z', '2026-10-26T00:00:00Z', 'Europe/Berlin')
    const onThatDay = onlyOn(result, '2026-10-25')
    console.log(JSON.stringify(onThatDay, null, 2))
    expect(onThatDay).toHaveLength(2)
    expect(onThatDay[0].kind).toBe('repeated')
    expect(onThatDay[1].kind).toBe('repeated')
    expect(onThatDay.map((o) => o.instant)).toEqual(['2026-10-25T00:30:00.000Z', '2026-10-25T01:30:00.000Z'])
  })

  it('30 2 * * * on an ordinary day in the same window: one normal instant', () => {
    const result = run('30 2 * * *', '2026-10-24T00:00:00Z', '2026-10-26T00:00:00Z', 'Europe/Berlin')
    const onThatDay = onlyOn(result, '2026-10-24')
    expect(onThatDay).toHaveLength(1)
    expect(onThatDay[0].kind).toBe('normal')
  })
})
