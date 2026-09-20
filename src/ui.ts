// Pure rendering functions over the existing domain types (`CronFields` via
// `CrontabFile`, `GenerateResult`, `Occurrence`). Every function here returns
// a detached DOM node or an HTML string; none of them read or write the live
// page (`document.querySelector('#app')`, event listeners, `location`, …).
// `src/main.ts` is the only file that does that — it calls these functions
// and decides where their output goes.

import type { CronLine, ParseError } from './parse.ts'
import type { GenerateResult } from './occurrences.ts'

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
 * `title` attribute and, for anomalies, a second visible column. */
function buildJobRow(data: JobRowData): HTMLTableRowElement {
  const { line, result } = data
  const tr = document.createElement('tr')

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
 * decisions, not this function's — it renders what it's given. */
export function renderJobsTable(rows: JobRowData[], timeZone: string): HTMLElement {
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
  for (const row of rows) tbody.appendChild(buildJobRow(row))
  table.appendChild(tbody)

  return table
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
