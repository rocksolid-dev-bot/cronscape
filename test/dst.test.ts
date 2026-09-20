import { describe, expect, it } from 'vitest'
import { resolveWallClock } from '../src/dst.ts'

// Print before asserting (day-1 lesson): every fixture below is printed to
// stdout first, then asserted. The printed transitions are the ground
// truth; the dates named in comments are this file's model of tzdata, and
// that model has been wrong before — see the Auckland probe below.

describe('resolveWallClock: Europe/Berlin', () => {
  it('spring-forward 2026-03-29 02:30 is skipped: 0 instants', () => {
    const r = resolveWallClock(2026, 3, 29, 2, 30, 'Europe/Berlin')
    console.log('Berlin spring-forward 2026-03-29 02:30:', r)
    expect(r.kind).toBe('skipped')
    expect(r.instants.length).toBe(0)
  })

  it('fall-back 2026-10-25 02:30 is repeated: 2 instants, 3600000ms apart', () => {
    const r = resolveWallClock(2026, 10, 25, 2, 30, 'Europe/Berlin')
    console.log('Berlin fall-back 2026-10-25 02:30:', r)
    expect(r.kind).toBe('repeated')
    expect(r.instants.length).toBe(2)
    const gapMs = new Date(r.instants[1]).getTime() - new Date(r.instants[0]).getTime()
    expect(gapMs).toBe(3600000)
  })

  it('ordinary day 2026-06-15 02:30 is normal: 1 instant', () => {
    const r = resolveWallClock(2026, 6, 15, 2, 30, 'Europe/Berlin')
    console.log('Berlin ordinary 2026-06-15 02:30:', r)
    expect(r.kind).toBe('normal')
    expect(r.instants.length).toBe(1)
  })
})

describe('resolveWallClock: Pacific/Auckland (southern hemisphere)', () => {
  // Probed directly against Intl before writing these fixtures (not taken
  // on trust): scanning hourly through 2026 for Pacific/Auckland's UTC
  // offset shows it changes 780min->720min at 2026-04-04T14:00Z (a
  // fall-back, local wall clock 02:00 on 2026-04-05 repeats) and
  // 720min->780min at 2026-09-26T14:00Z (a spring-forward, local wall
  // clock 02:00 on 2026-09-27 is skipped). The probe agrees with the
  // pre-run expectation of 2026-09-27 and 2026-04-05, both at 02:30 local.

  it('spring-forward 2026-09-27 02:30 is skipped: 0 instants', () => {
    const r = resolveWallClock(2026, 9, 27, 2, 30, 'Pacific/Auckland')
    console.log('Auckland spring-forward 2026-09-27 02:30:', r)
    expect(r.kind).toBe('skipped')
    expect(r.instants.length).toBe(0)
  })

  it('fall-back 2026-04-05 02:30 is repeated: 2 instants', () => {
    const r = resolveWallClock(2026, 4, 5, 2, 30, 'Pacific/Auckland')
    console.log('Auckland fall-back 2026-04-05 02:30:', r)
    expect(r.kind).toBe('repeated')
    expect(r.instants.length).toBe(2)
  })
})

describe('resolveWallClock: zones with no hour-sized or no DST transition at all', () => {
  it('UTC never has a transition: always normal, length 1', () => {
    const r = resolveWallClock(2026, 3, 29, 2, 30, 'UTC')
    console.log('UTC 2026-03-29 02:30:', r)
    expect(r.kind).toBe('normal')
    expect(r.instants.length).toBe(1)
  })

  it('Asia/Kolkata has no DST at all: always normal, length 1', () => {
    const r = resolveWallClock(2026, 10, 25, 2, 30, 'Asia/Kolkata')
    console.log('Asia/Kolkata 2026-10-25 02:30:', r)
    expect(r.kind).toBe('normal')
    expect(r.instants.length).toBe(1)
  })
})
