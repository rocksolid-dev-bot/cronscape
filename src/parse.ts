// Parses a whole crontab file (not a single expression) into a typed structure
// plus a list of per-line errors. Never throws: a malformed line becomes a
// ParseError, not an exception, so one bad line never takes down the rest of
// the file.

export type FieldName = 'minute' | 'hour' | 'dayOfMonth' | 'month' | 'dayOfWeek'

export interface CronFields {
  minute: number[]
  hour: number[]
  dayOfMonth: number[]
  month: number[]
  dayOfWeek: number[]
  /**
   * True only when the source token for `dayOfMonth` was the literal `*`.
   * An explicit full enumeration (`1-31`) is not the same thing — cron's
   * dom/dow OR rule (occurrences.ts) keys off whether the field was
   * *written* unrestricted, not off whether it happens to resolve to every
   * value, so this is captured here at parse time rather than reconstructed
   * later from the resolved set.
   */
  dayOfMonthIsWildcard: boolean
  /** Same rule as `dayOfMonthIsWildcard`, for the `dayOfWeek` field. */
  dayOfWeekIsWildcard: boolean
}

export interface CronLine {
  /** 1-based line number in the source file. */
  line: number
  /** The raw source line, unmodified. */
  raw: string
  /** Normalised, expanded field sets (sorted, de-duplicated). */
  fields: CronFields
  /** Everything after the five schedule fields. */
  command: string
}

export interface ParseError {
  /** 1-based line number in the source file. */
  line: number
  /** 1-based column where the problem starts. */
  column: number
  /** Human-readable description of what went wrong. */
  message: string
  /** What the parser expected instead, when that is meaningful. */
  expected?: string
}

export interface CrontabFile {
  /** Set by a `CRON_TZ=` or `TZ=` assignment line, if present. */
  timezone?: string
  lines: CronLine[]
  errors: ParseError[]
}

interface FieldSpec {
  min: number
  max: number
  /** Three-letter names, index 0 maps to `nameBase`. */
  names?: string[]
  nameBase?: number
}

const MONTH_NAMES = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const DOW_NAMES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

const FIELD_ORDER: FieldName[] = ['minute', 'hour', 'dayOfMonth', 'month', 'dayOfWeek']

const FIELD_SPECS: Record<FieldName, FieldSpec> = {
  minute: { min: 0, max: 59 },
  hour: { min: 0, max: 23 },
  dayOfMonth: { min: 1, max: 31 },
  month: { min: 1, max: 12, names: MONTH_NAMES, nameBase: 1 },
  dayOfWeek: { min: 0, max: 7, names: DOW_NAMES, nameBase: 0 },
}

const MACROS: Record<string, string> = {
  '@yearly': '0 0 1 1 *',
  '@annually': '0 0 1 1 *',
  '@monthly': '0 0 1 * *',
  '@weekly': '0 0 * * 0',
  '@daily': '0 0 * * *',
  '@midnight': '0 0 * * *',
  '@hourly': '0 * * * *',
}

/** A single field element: a number, a name, `*`, optionally with a range and/or a step. */
const FIELD_TOKEN = /^(\*|\d+|[A-Za-z]{3})(?:-(\*|\d+|[A-Za-z]{3}))?(?:\/(\d+))?$/

function resolveValue(token: string, spec: FieldSpec): number | null {
  if (/^\d+$/.test(token)) return Number.parseInt(token, 10)
  if (spec.names) {
    const idx = spec.names.indexOf(token.toLowerCase())
    if (idx >= 0) return idx + (spec.nameBase ?? 0)
  }
  return null
}

/** Parses one comma-separated field (e.g. `9-17/2` or `MON-FRI` or `*`). */
function parseField(
  text: string,
  spec: FieldSpec,
  isDayOfWeek = false,
): { values: number[] } | { error: string } {
  const out = new Set<number>()
  for (const part of text.split(',')) {
    if (part.length === 0) return { error: `empty item in "${text}"` }
    const match = FIELD_TOKEN.exec(part)
    if (!match) return { error: `malformed field item "${part}"` }
    const [, startTok, endTok, stepTok] = match

    let step = 1
    if (stepTok !== undefined) {
      step = Number.parseInt(stepTok, 10)
      if (!Number.isFinite(step) || step <= 0) {
        return { error: `step must be a positive integer, got "${stepTok}" in "${part}"` }
      }
    }

    let lo: number
    let hi: number
    if (startTok === '*') {
      lo = spec.min
      hi = spec.max
    } else {
      const loVal = resolveValue(startTok, spec)
      if (loVal === null) return { error: `unrecognised value "${startTok}" in "${part}"` }
      lo = loVal
      if (endTok !== undefined) {
        if (endTok === '*') return { error: `"*" cannot end a range in "${part}"` }
        const hiVal = resolveValue(endTok, spec)
        if (hiVal === null) return { error: `unrecognised value "${endTok}" in "${part}"` }
        hi = hiVal
      } else {
        hi = stepTok !== undefined ? spec.max : lo
      }
    }

    if (lo < spec.min || lo > spec.max) {
      return { error: `value ${lo} out of range ${spec.min}-${spec.max} in "${part}"` }
    }
    if (hi < spec.min || hi > spec.max) {
      return { error: `value ${hi} out of range ${spec.min}-${spec.max} in "${part}"` }
    }
    if (hi < lo) {
      // `MON-SUN` (1..0) and `FRI-MON` (5..1) are the wrap-around way of
      // writing "every day" / "Friday through Monday", not an inverted
      // range: dayOfWeek only, continue from lo through the real end of
      // the week (6, Saturday) and pick up again at 0 (Sunday) through hi.
      if (!isDayOfWeek) return { error: `range end before start in "${part}"` }
      for (let v = lo; v <= 6; v += step) out.add(v)
      for (let v = 0; v <= hi; v += step) out.add(v)
      continue
    }

    for (let v = lo; v <= hi; v += step) out.add(v)
  }
  return { values: [...out].sort((a, b) => a - b) }
}

/** Loosely recognises a cron-field-shaped token, used only to spot Quartz-style lines. */
const FIELD_SHAPED = /^(\*|\d+|[A-Za-z]{3})(?:[-,/](?:\*|\d+|[A-Za-z]{3}))*$/

function leadingFieldShapedCount(tokens: string[]): number {
  let n = 0
  for (const t of tokens) {
    if (FIELD_SHAPED.test(t)) n++
    else break
  }
  return n
}

/** Parses one non-empty, non-comment, non-assignment line into a CronLine or a ParseError. */
function parseLine(raw: string, lineNo: number): CronLine | ParseError {
  const trimmed = raw.trim()
  const leadingWs = raw.length - raw.trimStart().length

  const tokens = trimmed.split(/\s+/)

  // @macro shorthand: first token is a known macro, rest is the command.
  if (tokens[0]?.startsWith('@')) {
    const macro = tokens[0].toLowerCase()
    const expansion = MACROS[macro]
    if (expansion === undefined) {
      return {
        line: lineNo,
        column: leadingWs + 1,
        message: `unknown macro "${tokens[0]}"`,
        expected: Object.keys(MACROS).join(', '),
      }
    }
    const command = trimmed.slice(tokens[0].length).trim()
    return parseFiveFieldLine(expansion.split(' '), command, raw, lineNo, leadingWs + 1)
  }

  // Quartz-style (6 or 7 leading fields, seconds and/or year) is refused by name.
  const shapedCount = leadingFieldShapedCount(tokens)
  if ((shapedCount === 6 || shapedCount === 7) && tokens.length > shapedCount) {
    return {
      line: lineNo,
      column: leadingWs + 1,
      message: `${shapedCount}-field Quartz-style cron expressions are not supported; this parser only accepts standard 5-field crontab lines`,
      expected: '5 fields (minute hour day-of-month month day-of-week)',
    }
  }

  if (tokens.length < 6) {
    return {
      line: lineNo,
      column: leadingWs + 1,
      message: `expected 5 fields plus a command, found ${tokens.length} token(s)`,
      expected: '5 fields (minute hour day-of-month month day-of-week) followed by a command',
    }
  }

  const fieldTokens = tokens.slice(0, 5)
  const command = tokens.slice(5).join(' ')
  return parseFiveFieldLine(fieldTokens, command, raw, lineNo, leadingWs + 1)
}

function parseFiveFieldLine(
  fieldTokens: string[],
  command: string,
  raw: string,
  lineNo: number,
  column: number,
): CronLine | ParseError {
  const fields: Partial<CronFields> = {}
  for (let i = 0; i < FIELD_ORDER.length; i++) {
    const name = FIELD_ORDER[i]
    const result = parseField(fieldTokens[i], FIELD_SPECS[name], name === 'dayOfWeek')
    if ('error' in result) {
      return { line: lineNo, column, message: `${name} field: ${result.error}` }
    }
    // dayOfWeek only: `7` is legal input (POSIX/Vixie both accept it as a
    // second name for Sunday) but is the same real day as `0`, so it is
    // normalised to `0` here, as the last step of parsing this field only,
    // then the set is re-deduplicated and re-sorted. `max: 7` stays in
    // FIELD_SPECS so `7` stays legal input and `8` still errors as out of
    // range against `0-7`.
    if (name === 'dayOfWeek') {
      const normalised = new Set(result.values.map((v) => (v === 7 ? 0 : v)))
      fields[name] = [...normalised].sort((a, b) => a - b)
    } else {
      fields[name] = result.values
    }
    if (name === 'dayOfMonth') fields.dayOfMonthIsWildcard = fieldTokens[i] === '*'
    if (name === 'dayOfWeek') fields.dayOfWeekIsWildcard = fieldTokens[i] === '*'
  }
  return {
    line: lineNo,
    raw,
    fields: fields as CronFields,
    command,
  }
}

/** Parses a whole crontab file. Comments, blank lines, and TZ assignments are consumed silently. */
export function parseCrontab(input: string): CrontabFile {
  const lines: CronLine[] = []
  const errors: ParseError[] = []
  let timezone: string | undefined

  const rawLines = input.split('\n')
  for (let i = 0; i < rawLines.length; i++) {
    const raw = rawLines[i]
    const lineNo = i + 1
    const trimmed = raw.trim()

    if (trimmed.length === 0) continue
    if (trimmed.startsWith('#')) continue

    const tzMatch = /^(?:CRON_TZ|TZ)=(\S+)$/.exec(trimmed)
    if (tzMatch) {
      timezone = tzMatch[1]
      continue
    }

    const result = parseLine(raw, lineNo)
    if ('error' in result || 'message' in result) {
      errors.push(result as ParseError)
    } else {
      lines.push(result)
    }
  }

  return { timezone, lines, errors }
}
