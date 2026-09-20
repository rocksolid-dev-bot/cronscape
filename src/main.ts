// The only file in this project that touches `document` or wires events.
// Everything it renders comes from pure functions in `ui.ts` over the
// existing parse/occurrence types; this file's job is state (what the user
// typed, which zone, which window) and wiring, nothing else.

import './style.css'
import { parseCrontab } from './parse.ts'
import { generateOccurrences } from './occurrences.ts'
import {
  renderShell,
  renderJobsTable,
  renderErrorRegion,
  renderEmptyState,
  renderTruncatedNotice,
  type JobRowData,
} from './ui.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const MAX_OCCURRENCES_PER_JOB = 500

const app = document.querySelector<HTMLDivElement>('#app')!
app.innerHTML = renderShell()

const textarea = document.querySelector<HTMLTextAreaElement>('#crontab-input')!
const tzSelect = document.querySelector<HTMLSelectElement>('#tz-select')!
const windowInput = document.querySelector<HTMLInputElement>('#window-days')!
const errorRegion = document.querySelector<HTMLElement>('#error-region')!
const jobsRegion = document.querySelector<HTMLElement>('#jobs-region')!

function windowDays(): number {
  const parsed = Number.parseInt(windowInput.value, 10)
  if (!Number.isFinite(parsed) || parsed < 1) return 7
  return Math.min(parsed, 365)
}

function recompute(): void {
  const text = textarea.value

  if (text.trim().length === 0) {
    errorRegion.replaceChildren()
    jobsRegion.replaceChildren(renderEmptyState())
    return
  }

  const timeZone = tzSelect.value
  const crontab = parseCrontab(text)
  errorRegion.replaceChildren(renderErrorRegion(crontab.errors))

  const start = new Date()
  const end = new Date(start.getTime() + windowDays() * DAY_MS)

  const rows: JobRowData[] = crontab.lines.map((line) => ({
    line,
    result: generateOccurrences({
      fields: line.fields,
      start,
      end,
      timeZone,
      cap: MAX_OCCURRENCES_PER_JOB,
    }),
  }))

  const nodes: Node[] = []
  if (rows.length > 0) {
    nodes.push(renderJobsTable(rows, timeZone))
    if (rows.some((row) => row.result.truncated)) nodes.push(renderTruncatedNotice())
  }
  jobsRegion.replaceChildren(...nodes)
}

textarea.addEventListener('input', recompute)
tzSelect.addEventListener('change', recompute)
windowInput.addEventListener('input', recompute)

recompute()
