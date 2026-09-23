// @vitest-environment happy-dom
//
// jsdom (MIT) was tried first, per TODAY.md, and refused on this
// container's Node 18.19.1: a transitive dependency (html-encoding-sniffer
// -> @exodus/bytes) does `require()` of an ES module, which throws
// `ERR_REQUIRE_ESM` at environment setup, before any test runs. happy-dom
// (MIT) is the named fallback and works cleanly on this Node version
// (its own EBADENGINE warning wants Node >=20, but `npm test` still exits
// 0). This docblock scopes the DOM environment to this file only: the 65
// other tests run in the default node environment and must keep doing so,
// which is why this is a per-file docblock rather than a global vitest
// `environment` setting.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { parseCrontab } from '../src/parse.ts'
import { generateOccurrences } from '../src/occurrences.ts'
import { findCollisions } from '../src/collisions.ts'
import {
  renderShell,
  renderJobsTable,
  renderErrorRegion,
  renderEmptyState,
  renderCollisionsSection,
  collidingLineNumbers,
  type JobRowData,
} from '../src/ui.ts'

const FIXTURE = `# fixture crontab for ui.test.ts
CRON_TZ=Europe/Berlin
30 2 * * * /usr/bin/backup.sh
0 3 * * * /usr/bin/report-a.sh
0 3 * * * /usr/bin/report-b.sh
0 0 * * bogus /usr/bin/broken.sh
*/0 * * * * /usr/bin/also-broken.sh
`

let container: HTMLDivElement

beforeEach(() => {
  container = document.createElement('div')
  document.body.appendChild(container)
})

afterEach(() => {
  container.remove()
})

function rowsFor(fields: ReturnType<typeof parseCrontab>['lines'], start: Date, end: Date, timeZone: string): JobRowData[] {
  return fields.map((line) => ({
    line,
    result: generateOccurrences({ fields: line.fields, start, end, timeZone, cap: 10_000 }),
  }))
}

describe('renderJobsTable: DST anomalies', () => {
  it('spring-forward window: the 30 2 * * * row shows skipped and 02:30, never 03:30', () => {
    const crontab = parseCrontab(FIXTURE)
    const rows = rowsFor(crontab.lines, new Date('2026-03-28T00:00:00Z'), new Date('2026-03-30T00:00:00Z'), 'Europe/Berlin')
    const table = renderJobsTable(rows, 'Europe/Berlin')
    container.appendChild(table)

    const dstRow = [...table.querySelectorAll('tbody tr')].find((tr) =>
      tr.querySelector('code')?.textContent === '30 2 * * *',
    )!
    expect(dstRow).toBeTruthy()
    expect(dstRow.textContent).toContain('skipped')
    expect(dstRow.textContent).toContain('02:30')
    const occurrencesOf0330 = (dstRow.textContent!.match(/03:30/g) ?? []).length
    expect(occurrencesOf0330).toBe(0)
  })

  it('fall-back window: the 30 2 * * * row shows repeated with two listed firings', () => {
    const crontab = parseCrontab(FIXTURE)
    const rows = rowsFor(crontab.lines, new Date('2026-10-24T00:00:00Z'), new Date('2026-10-26T00:00:00Z'), 'Europe/Berlin')
    const table = renderJobsTable(rows, 'Europe/Berlin')
    container.appendChild(table)

    const dstRow = [...table.querySelectorAll('tbody tr')].find((tr) =>
      tr.querySelector('code')?.textContent === '30 2 * * *',
    )!
    expect(dstRow.textContent).toContain('repeated')
    const firings = dstRow.querySelectorAll('li.firing-repeated')
    expect(firings.length).toBe(2)
  })
})

describe('renderErrorRegion: malformed lines', () => {
  it('every malformed line produces an error entry with its line number, inside aria-live="polite"', () => {
    const crontab = parseCrontab(FIXTURE)
    // Fixture has two bad lines: `0 0 * * bogus ...` (line 5) and
    // `*/0 * * * * ...` (line 6, step 0).
    expect(crontab.errors.length).toBe(2)

    container.innerHTML = renderShell()
    const errorRegion = container.querySelector('#error-region')!
    expect(errorRegion.getAttribute('aria-live')).toBe('polite')
    errorRegion.appendChild(renderErrorRegion(crontab.errors))

    for (const error of crontab.errors) {
      const match = [...errorRegion.querySelectorAll('.error-item')].find((el) =>
        el.textContent!.includes(String(error.line)),
      )
      expect(match).toBeTruthy()
    }
    expect(errorRegion.querySelectorAll('.error-item').length).toBe(2)
  })
})

describe('renderEmptyState', () => {
  it('is a specific, non-empty element', () => {
    const empty = renderEmptyState()
    container.appendChild(empty)
    const found = container.querySelector('#empty-state')
    expect(found).toBeTruthy()
    expect(found!.textContent!.length).toBeGreaterThan(0)
  })
})

describe('renderCollisionsSection', () => {
  it('the fixture crontab (0 3 * * * on lines 4 and 5) renders both line numbers', () => {
    const crontab = parseCrontab(FIXTURE)
    const rows = rowsFor(crontab.lines, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-02T00:00:00Z'), 'Europe/Berlin')
    const groups = findCollisions(rows)
    const section = renderCollisionsSection(groups, 'Europe/Berlin', 60)
    container.appendChild(section)

    expect(section.textContent).toContain('4')
    expect(section.textContent).toContain('5')
    expect(collidingLineNumbers(groups)).toEqual(new Set([4, 5]))
  })

  it('a crontab with no collisions renders the empty-collisions state, present and non-empty', () => {
    const crontab = parseCrontab('0 3 * * * /usr/bin/only-one.sh\n')
    const rows = rowsFor(crontab.lines, new Date('2026-06-01T00:00:00Z'), new Date('2026-06-02T00:00:00Z'), 'UTC')
    const groups = findCollisions(rows)
    expect(groups.length).toBe(0)

    const section = renderCollisionsSection(groups, 'UTC', 60)
    container.appendChild(section)

    const empty = section.querySelector('#no-collisions')
    expect(empty).toBeTruthy()
    expect(empty!.textContent!.length).toBeGreaterThan(0)
  })
})

describe('renderShell: accessibility', () => {
  it('every textarea, select and input has an accessible name', () => {
    container.innerHTML = renderShell()
    const controls = container.querySelectorAll('textarea, select, input')
    expect(controls.length).toBeGreaterThan(0)

    let unnamed = 0
    for (const control of controls) {
      const id = control.getAttribute('id')
      const hasLabelFor = id !== null && container.querySelector(`label[for="${id}"]`) !== null
      const hasAriaLabel = control.hasAttribute('aria-label')
      if (!hasLabelFor && !hasAriaLabel) unnamed++
    }
    expect(unnamed).toBe(0)
  })
})
