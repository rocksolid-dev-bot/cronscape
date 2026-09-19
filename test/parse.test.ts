import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { parseCrontab } from '../src/parse.ts'
import type { CronFields, CronLine, CrontabFile, FieldName, ParseError } from '../src/parse.ts'

// Exercises every exported type, not just the parseCrontab function, so the
// per-commit consumer rule (`grep -rn <symbol> src/ test/`) has something to
// find outside src/parse.ts itself.
const FIELD_ORDER: FieldName[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek']

function fieldValues(fields: CronFields, name: FieldName): number[] {
  return fields[name]
}

function describeLine(line: CronLine): string {
  return `line ${line.line}: ${line.command}`
}

function describeError(error: ParseError): string {
  return `line ${error.line}, col ${error.column}: ${error.message}`
}

function summarize(file: CrontabFile): { parsed: number; failed: number } {
  return { parsed: file.lines.length, failed: file.errors.length }
}

const fixturePath = fileURLToPath(new URL('./fixtures/mixed.crontab', import.meta.url))

describe('parseCrontab: single-line field sets', () => {
  it('parses a step expression across every field', () => {
    const result = parseCrontab('*/15 * * * * echo tick')
    // Printed once, on purpose, before any assertion below is written against
    // its shape — asserting an unexamined AST shape burned a run on the last
    // project.
    console.log(JSON.stringify(result, null, 2))

    expect(result.errors).toEqual([])
    expect(result.lines).toHaveLength(1)
    const [line] = result.lines
    console.log(describeLine(line))
    for (const name of FIELD_ORDER) expect(fieldValues(line.fields, name).length).toBeGreaterThan(0)
    expect(line.fields.minute).toEqual([0, 15, 30, 45])
    expect(line.fields.hour).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23,
    ])
    expect(line.fields.dayOfMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
    expect(line.fields.month).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    // `dayOfWeek` normalises `7` to `0` as the last step of parsing that
    // field only, so `*` is 7 distinct weekdays, not 8 — the length is
    // asserted separately from the members so a future duplicate fails on
    // cardinality alone, not just on which numbers happen to be present.
    expect(line.fields.dayOfWeek).toHaveLength(7)
    expect(line.fields.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(line.command).toBe('echo tick')
  })

  it('parses a fixed day-of-month plus named day-of-week', () => {
    const result = parseCrontab('0 0 13 * 5 echo friday13')
    const [line] = result.lines
    expect(line.fields.minute).toEqual([0])
    expect(line.fields.hour).toEqual([0])
    expect(line.fields.dayOfMonth).toEqual([13])
    expect(line.fields.month).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(line.fields.dayOfWeek).toEqual([5])
    expect(line.command).toBe('echo friday13')
  })

  it('parses a fixed time', () => {
    const result = parseCrontab('30 2 * * * echo nightly')
    const [line] = result.lines
    expect(line.fields.minute).toEqual([30])
    expect(line.fields.hour).toEqual([2])
  })

  it('parses a stepped range plus a named range', () => {
    const result = parseCrontab('0 9-17/2 * * MON-FRI echo business')
    const [line] = result.lines
    expect(line.fields.minute).toEqual([0])
    expect(line.fields.hour).toEqual([9, 11, 13, 15, 17])
    expect(line.fields.dayOfWeek).toEqual([1, 2, 3, 4, 5])
  })

  it('expands @daily to midnight every day', () => {
    const result = parseCrontab('@daily echo backup')
    expect(result.errors).toEqual([])
    const [line] = result.lines
    expect(line.fields.minute).toEqual([0])
    expect(line.fields.hour).toEqual([0])
    expect(line.fields.dayOfMonth).toEqual(Array.from({ length: 31 }, (_, i) => i + 1))
    expect(line.fields.month).toEqual(Array.from({ length: 12 }, (_, i) => i + 1))
    expect(line.fields.dayOfWeek).toHaveLength(7)
    expect(line.fields.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
    expect(line.command).toBe('echo backup')
  })

  it('normalises dayOfWeek 7 to 0, so `0` and `7` mean the same Sunday', () => {
    const zero = parseCrontab('0 0 * * 0 echo sun0')
    const seven = parseCrontab('0 0 * * 7 echo sun7')
    expect(zero.lines[0].fields.dayOfWeek).toEqual(seven.lines[0].fields.dayOfWeek)
    expect(zero.lines[0].fields.dayOfWeek).toEqual([0])
  })

  it('agrees on Sunday across the numeral, the alias, and the name', () => {
    const zero = parseCrontab('0 0 * * 0 echo a')
    const seven = parseCrontab('0 0 * * 7 echo b')
    const named = parseCrontab('0 0 * * SUN echo c')
    expect(zero.lines[0].fields.dayOfWeek).toEqual(seven.lines[0].fields.dayOfWeek)
    expect(seven.lines[0].fields.dayOfWeek).toEqual(named.lines[0].fields.dayOfWeek)
  })

  it('treats MON-SUN as wrap-around for "every day", not an inverted range', () => {
    const wrap = parseCrontab('0 0 * * MON-SUN echo everyday')
    const star = parseCrontab('0 0 * * * echo everyday')
    expect(wrap.errors).toEqual([])
    expect(wrap.lines[0].fields.dayOfWeek).toHaveLength(7)
    expect(wrap.lines[0].fields.dayOfWeek).toEqual(star.lines[0].fields.dayOfWeek)
  })

  it('leaves SUN-SAT unchanged at length 7 (already a forward range)', () => {
    const result = parseCrontab('0 0 * * SUN-SAT echo everyday')
    expect(result.errors).toEqual([])
    expect(result.lines[0].fields.dayOfWeek).toHaveLength(7)
    expect(result.lines[0].fields.dayOfWeek).toEqual([0, 1, 2, 3, 4, 5, 6])
  })

  it('wraps FRI-MON through the weekend into next week', () => {
    const result = parseCrontab('0 0 * * FRI-MON echo weekend')
    expect(result.errors).toEqual([])
    expect(result.lines[0].fields.dayOfWeek).toEqual([0, 1, 5, 6])
  })

  it('still errors on dayOfWeek 8, naming the range 0-7 with a numeric line', () => {
    const result = parseCrontab('0 0 * * 8 echo baddow')
    expect(result.lines).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/out of range/)
    expect(result.errors[0].message).toMatch(/0-7/)
    expect(typeof result.errors[0].line).toBe('number')
  })

  it('pins every field\'s `*` expansion by cardinality, not just its members', () => {
    const result = parseCrontab('* * * * * echo everything')
    const [line] = result.lines
    expect(line.fields.minute).toHaveLength(60)
    expect(line.fields.hour).toHaveLength(24)
    expect(line.fields.dayOfMonth).toHaveLength(31)
    expect(line.fields.month).toHaveLength(12)
    expect(line.fields.dayOfWeek).toHaveLength(7)
  })

  it('reads a CRON_TZ assignment as the file timezone, not a schedule line', () => {
    const result = parseCrontab('CRON_TZ=Europe/Berlin\n0 3 * * * echo tz')
    expect(result.timezone).toBe('Europe/Berlin')
    expect(result.lines).toHaveLength(1)
    expect(result.errors).toEqual([])
  })
})

describe('parseCrontab: a file mixing valid and malformed lines', () => {
  const fixture = readFileSync(fixturePath, 'utf8')
  const result = parseCrontab(fixture)

  it('parses exactly the 4 valid lines and reports exactly the 3 malformed ones', () => {
    const summary = summarize(result)
    expect(summary.parsed).toBe(4)
    expect(summary.failed).toBe(3)
  })

  it('attributes each error to its real line number in the fixture', () => {
    for (const error of result.errors) console.log(describeError(error))
    const lineNumbers = result.errors.map((e) => e.line)
    expect(lineNumbers).toEqual([9, 10, 11])
  })

  it('reads the CRON_TZ line from the fixture', () => {
    expect(result.timezone).toBe('Europe/Berlin')
  })
})

describe('parseCrontab: distinct error messages by content', () => {
  it('reports an out-of-range day-of-month', () => {
    const result = parseCrontab('0 0 32 * * echo badday')
    expect(result.lines).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/out of range/)
    expect(result.errors[0].message).toMatch(/dayOfMonth/)
  })

  it('reports a non-positive step', () => {
    const result = parseCrontab('*/0 * * * * echo badstep')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/step must be a positive integer/)
  })

  it('refuses a 6-field Quartz-style line by name', () => {
    const result = parseCrontab('0 0 * * * * echo quartz')
    expect(result.lines).toHaveLength(0)
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/Quartz-style/)
    expect(result.errors[0].message).toMatch(/6-field/)
  })

  it('refuses a 7-field Quartz-style line by name', () => {
    const result = parseCrontab('0 0 * * * * * echo quartz')
    expect(result.errors).toHaveLength(1)
    expect(result.errors[0].message).toMatch(/Quartz-style/)
    expect(result.errors[0].message).toMatch(/7-field/)
  })
})

describe('parseCrontab: comments and blank lines', () => {
  it('ignores comments and blank lines without producing errors or lines', () => {
    const result = parseCrontab('# a comment\n\n   \n# another\n')
    expect(result.lines).toEqual([])
    expect(result.errors).toEqual([])
  })
})
