// Pure rendering functions over the existing domain types (`CronFields` via
// `CrontabFile`, `GenerateResult`, `Occurrence`). Every function here returns
// a detached DOM node or an HTML string; none of them read or write the live
// page (`document.querySelector('#app')`, event listeners, `location`, …).
// `src/main.ts` is the only file that does that — it calls these functions
// and decides where their output goes.

import type { CronLine, ParseError } from './parse.ts'
import type { GenerateResult } from './occurrences.ts'
import type { CollisionGroup } from './collisions.ts'

/**
 * The textarea's initial content. Eight lines on purpose: a comment, a
 * `CRON_TZ=` assignment, the DST-anomaly job this project exists for, two
 * jobs at the same instant (`0 3 * * *` ×2, so a future collisions view has
 * something to find), a step/range job, and one malformed line so the error
 * region has something to show without the user typing a mistake first.
 */
const SAMPLE_CRONTAB = `# cronscape example crontab — edit or paste your own
CRON_TZ=Europe/Berlin
30 2 * * * /usr/bin/backup.sh
0 3 * * * /usr/bin/report-a.sh
0 3 * * * /usr/bin/report-b.sh
*/15 9-17 * * 1-5 /usr/bin/poll.sh
0 0 * * bogus /usr/bin/broken.sh
`

/** Short, deliberately mixed list: two DST-heavy zones, one with none, one with a 30-minute shift. */
const TIMEZONE_OPTIONS = ['Europe/Berlin', 'UTC', 'Pacific/Auckland', 'Australia/Lord_Howe']

const DEFAULT_WINDOW_DAYS = 7

/** Renders the full page shell: the crontab textarea and its controls, plus
 * two empty output regions that `main.ts` fills in on every recompute. All
 * three interactive controls carry a `<label for>` bound to their id —
 * semantic HTML before ARIA, per the design skill's hard rule. */
export function renderShell(): string {
  const tzOptions = TIMEZONE_OPTIONS.map((tz) => `<option value="${tz}">${tz}</option>`).join('')
  return `
    <header class="app-header">
      <h1>cronscape</h1>
      <p class="tagline">Paste a crontab. See when it actually fires — collisions and the DST jump, on paper, before production finds them.</p>
    </header>
    <main>
      <section class="controls">
        <div class="field field-crontab">
          <label for="crontab-input">Crontab file</label>
          <textarea id="crontab-input" rows="9" spellcheck="false">${SAMPLE_CRONTAB}</textarea>
        </div>
        <div class="field-row">
          <div class="field">
            <label for="tz-select">Timezone</label>
            <select id="tz-select">${tzOptions}</select>
          </div>
          <div class="field">
            <label for="window-days">Window (days)</label>
            <input id="window-days" type="number" min="1" max="365" step="1" value="${DEFAULT_WINDOW_DAYS}" />
          </div>
        </div>
      </section>
      <section id="error-region" class="errors" aria-live="polite"></section>
      <section id="jobs-region" class="jobs" aria-label="Firings"></section>
      <div id="collisions-mount"></div>
    </main>
  `
}

export interface JobRowData {
  line: CronLine
  result: GenerateResult
}

/** The five-field expression as written, recovered from the raw source line
 * by trimming its known command suffix — reconstructing it from the parsed
 * (and normalised) field sets would show `9-17/2`-style input as its
 * expanded set instead of what the user typed. */
function expressionOf(line: CronLine): string {
  const trimmed = line.raw.trim()
  if (line.command.length === 0) return trimmed
  const idx = trimmed.lastIndexOf(line.command)
  return idx > 0 ? trimmed.slice(0, idx).trim() : trimmed
}

/** `YYYY-MM-DDTHH:mm` -> `YYYY-MM-DD HH:mm`, readable without being ambiguous with the UTC ISO string next to it. */
function humanWallClock(wallClock: string): string {
  return wallClock.replace('T', ' ')
}

function buildFiringItem(occurrence: GenerateResult['occurrences'][number]): HTMLLIElement {
  const li = document.createElement('li')
  li.className = `firing firing-${occurrence.kind}`

  const time = document.createElement('span')
  time.className = 'wall-clock'
  time.textContent = humanWallClock(occurrence.wallClock)
  if (occurrence.instant) time.title = occurrence.instant
  li.appendChild(time)

  if (occurrence.kind !== 'normal') {
    const badge = document.createElement('span')
    badge.className = `badge badge-${occurrence.kind}`
    badge.textContent = occurrence.kind
    li.appendChild(badge)
  }

  if (occurrence.kind === 'skipped') {
    const note = document.createElement('span')
    note.className = 'note'
    note.textContent = 'this wall clock does not exist that day — no instant fires'
    li.appendChild(note)
  } else if (occurrence.instant) {
    const utc = document.createElement('span')
    utc.className = 'utc'
    utc.textContent = occurrence.instant
    li.appendChild(utc)
  }

  return li
}

/** One `<tr>` per crontab job: expression, command, and its firings as
 * wall-clock times in the selected zone, each with the UTC instant in a
 * `title` attribute and, for anomalies, a second visible column.
 * `collidingLines` marks rows whose line number appears in at least one
 * collision group — border/outline only, per the design skill's own AA
 * conflict rule, never a `color:` declaration. */
function buildJobRow(data: JobRowData, collidingLines: ReadonlySet<number>): HTMLTableRowElement {
  const { line, result } = data
  const tr = document.createElement('tr')
  if (collidingLines.has(line.line)) tr.className = 'row-collision'

  const exprCell = document.createElement('td')
  const exprCode = document.createElement('code')
  exprCode.textContent = expressionOf(line)
  exprCell.appendChild(exprCode)
  tr.appendChild(exprCell)

  const cmdCell = document.createElement('td')
  const cmdCode = document.createElement('code')
  cmdCode.textContent = line.command
  cmdCell.appendChild(cmdCode)
  tr.appendChild(cmdCell)

  const firingsCell = document.createElement('td')
  if (result.occurrences.length === 0) {
    const span = document.createElement('span')
    span.className = 'note'
    span.textContent = 'no firings in this window'
    firingsCell.appendChild(span)
  } else {
    const list = document.createElement('ul')
    list.className = 'firings'
    for (const occurrence of result.occurrences) list.appendChild(buildFiringItem(occurrence))
    firingsCell.appendChild(list)
  }
  tr.appendChild(firingsCell)

  return tr
}

/** The whole jobs table for a parsed crontab. Callers only reach this with
 * `rows.length > 0`; the empty-textarea and all-errors cases are `main.ts`
 * decisions, not this function's — it renders what it's given.
 * `collidingLines` (default: none) marks rows involved in a collision. */
export function renderJobsTable(
  rows: JobRowData[],
  timeZone: string,
  collidingLines: ReadonlySet<number> = new Set(),
): HTMLElement {
  const table = document.createElement('table')
  table.className = 'jobs-table'

  const caption = document.createElement('caption')
  caption.textContent = `Firings over the selected window, in ${timeZone}`
  table.appendChild(caption)

  const thead = document.createElement('thead')
  const headRow = document.createElement('tr')
  for (const label of ['Expression', 'Command', 'Firings']) {
    const th = document.createElement('th')
    th.scope = 'col'
    th.textContent = label
    headRow.appendChild(th)
  }
  thead.appendChild(headRow)
  table.appendChild(thead)

  const tbody = document.createElement('tbody')
  for (const row of rows) tbody.appendChild(buildJobRow(row, collidingLines))
  table.appendChild(tbody)

  return table
}

/** `YYYY-MM-DDTHH:mm:ss.sssZ` -> `YYYY-MM-DD HH:mm` in `timeZone`, for the
 * collisions section's group heading — the anchor is a UTC instant
 * (`anchorMs`), read back as the wall clock a person would recognise. */
function formatAnchor(anchorMs: number, timeZone: string): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(anchorMs))
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? ''
  return `${get('year')}-${get('month')}-${get('day')} ${get('hour')}:${get('minute')}:${get('second')}`
}

/** Every crontab line number that appears in at least one collision group. */
export function collidingLineNumbers(groups: CollisionGroup[]): Set<number> {
  const lines = new Set<number>()
  for (const group of groups) for (const member of group.members) lines.add(member.line.line)
  return lines
}

/** The collisions section: one entry per group, its wall-clock time (in
 * `timeZone`) and the crontab line numbers involved. Rendered with text in
 * both the collisions and no-collisions case — an empty region reads as a
 * loading state, not as "checked, none found". */
export function renderCollisionsSection(groups: CollisionGroup[], timeZone: string): HTMLElement {
  const section = document.createElement('section')
  section.id = 'collisions-region'
  section.className = 'collisions'
  section.setAttribute('aria-label', 'Collisions')

  const heading = document.createElement('h2')
  heading.textContent = 'Collisions'
  section.appendChild(heading)

  if (groups.length === 0) {
    const p = document.createElement('p')
    p.id = 'no-collisions'
    p.className = 'note'
    p.textContent = 'No jobs land on the same instant in this window.'
    section.appendChild(p)
    return section
  }

  const list = document.createElement('ul')
  list.className = 'collision-list'
  for (const group of groups) {
    const li = document.createElement('li')
    li.className = 'collision-item'

    const time = document.createElement('span')
    time.className = 'wall-clock'
    time.textContent = formatAnchor(group.anchorMs, timeZone)
    li.appendChild(time)

    const lineNumbers = [...new Set(group.members.map((m) => m.line.line))].sort((a, b) => a - b)
    const lines = document.createElement('span')
    lines.className = 'collision-lines'
    lines.textContent = `lines ${lineNumbers.join(', ')}`
    li.appendChild(lines)

    list.appendChild(li)
  }
  section.appendChild(list)

  return section
}

/** The parse-error region's contents. Returns an empty, still-live
 * container when there are no errors, so `aria-live="polite"` keeps
 * announcing future changes rather than being replaced wholesale. */
export function renderErrorRegion(errors: ParseError[]): DocumentFragment {
  const fragment = document.createDocumentFragment()
  if (errors.length === 0) return fragment

  const heading = document.createElement('p')
  heading.className = 'errors-heading'
  heading.textContent = `${errors.length} line${errors.length === 1 ? '' : 's'} could not be parsed:`
  fragment.appendChild(heading)

  const list = document.createElement('ul')
  list.className = 'error-list'
  for (const error of errors) {
    const li = document.createElement('li')
    li.className = 'error-item'
    li.textContent = `Line ${error.line}, column ${error.column}: ${error.message}`
    list.appendChild(li)
  }
  fragment.appendChild(list)

  return fragment
}

/** Rendered deliberately, with text, rather than an empty region — an
 * empty textarea is a state, not the absence of one. */
export function renderEmptyState(): HTMLElement {
  const div = document.createElement('div')
  div.id = 'empty-state'
  div.className = 'empty-state'
  div.textContent =
    'Paste a crontab above to see when its jobs actually fire — including the day the clock jumps.'
  return div
}

/** Rendered deliberately when `GenerateResult.truncated` is true, rather than silently dropping the tail. */
export function renderTruncatedNotice(): HTMLElement {
  const p = document.createElement('p')
  p.className = 'truncated-notice'
  p.textContent = 'This window produced more firings than shown here; results were truncated.'
  return p
}
