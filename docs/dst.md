# DST behaviour

The DST behaviour is the reason this project exists. Every number below was read off
`test/dst.test.ts` and `test/differential.test.ts` at HEAD `916b369`, at the WAKE for day 9
(2026-09-22) — none of it is restated from memory, and nothing appears here that is not backed by
a committed test or the day-9 capture (`media/2026-09-22-day9.txt`).

## 1. The rule

A wall-clock time (a crontab line evaluated for a specific date, in a specific IANA timezone)
resolves to **0, 1, or 2** real UTC instants:

| Kind | Meaning | Instant count |
|---|---|---|
| `skipped` | The local clock jumps over this wall-clock time; it never happens. | 0 |
| `normal` | An ordinary day; the wall-clock time happens exactly once. | 1 |
| `repeated` | The local clock passes through this wall-clock time twice (fall-back). | 2 |

`src/dst.ts`'s `resolveWallClock` returns the whole set — it does not pick one. That is a
deliberate correction of an earlier internal function (`wallClockToUtcMs`, deleted day 3) whose
own doc comment admitted it returned "a plausible instant" and which was wrong on both `skipped`
and `repeated` days by construction.

## 2. The table

Every row below is a fixture in `test/dst.test.ts`, printed to stdout before being asserted (the
day-1 lesson: print before you assert, because a fixture written from your own model of the
format tests your model, not the format).

| Zone | Local time | Kind | Instants | Gap |
|---|---|---|---|---|
| `Europe/Berlin` | 2026-03-29 02:30 | `skipped` | 0 | — (`dst.test.ts:11-14`) |
| `Europe/Berlin` | 2026-10-25 02:30 | `repeated` | 2 | **3600000** ms (`dst.test.ts:17-23`) |
| `Pacific/Auckland` | 2026-09-27 02:30 | `skipped` | 0 | — (`dst.test.ts:44-47`) |
| `Australia/Lord_Howe` | 2026-04-05 01:45 | `repeated` | 2 | **1800000** ms, exactly `2026-04-04T14:45:00.000Z` and `2026-04-04T15:15:00.000Z` (`dst.test.ts:68-78`) |
| `Australia/Lord_Howe` | 2026-10-04 02:15 | `skipped` | 0 | — (`dst.test.ts:88-91`) |

The `Australia/Lord_Howe` row is the half-hour transition that broke the first version of the
resolver: an earlier probe ladder only checked offsets at 0 and whole hours around the naive
guess, which is correct for Berlin and Auckland (both hour-sized shifts) but silently wrong for
Lord Howe's 30-minute shift — it reported `normal` with one instant instead of `repeated` with
two. The fix widened the probe to 15-minute steps, which is why the ladder exists at all rather
than a simple "check ±1h" shortcut.

## 3. Where an independent implementation disagrees

`cron-parser` 5.10.1 is this project's differential oracle (devDependency only, MIT). For
`30 2 * * *` on Berlin's 2026-03-29 spring-forward day, it emits
`2026-03-29T01:30:00.000Z` (`differential.test.ts:141`) — that instant is **03:30 local**, an hour
after the wall-clock time the crontab line actually names. `cron-parser` walks wall-clock minutes
forward through `Intl` and reports whatever the underlying clock happens to produce for that
minute; it never asks whether `02:30` exists that day. cronscape asks that question directly and
answers: zero instants, one `skipped` occurrence, wall clock `02:30` carried on the anomaly so the
UI shows what was asked for, not an invented answer.

This is stated plainly as a disagreement cronscape asserts on purpose, not a bug fixed in someone
else's library — `cron-parser`'s answer is internally consistent for the question *it* answers
("what does my forward-walking clock produce"), just not the question this tool exists to answer
("does this wall-clock time happen, and if so when"). Both implementations walk wall-clock minutes
through `Intl.DateTimeFormat`, so agreement between them on an ordinary day is not independent
evidence of correctness anywhere — it only shows both clocks agree on what an ordinary minute
looks like, which is the easy case.

The fall-back day shows the same divergence from the other side: `cron-parser` reports **one**
instant for `30 2 * * *` on 2026-10-25, because its forward walk only visits each wall-clock minute
once; cronscape reports **both** real instants of `02:30` that day (`differential.test.ts`, same
describe block).

## 4. What it means downstream

`src/collisions.ts` is the consumer that makes this distinction load-bearing, not academic:

- A `skipped` occurrence carries no instant and is excluded from collision detection entirely —
  there is nothing for it to collide with (`src/collisions.ts:38-44`, the `if (occurrence.instant
  === null) continue` guard).
- A `repeated` occurrence contributes **both** of its instants as independent collision
  candidates (`src/collisions.ts:50-53`). An implementation that read only `instants[0]` would
  pass every ordinary-day fixture and be silently wrong exactly once a year, on the fall-back day
  — the one day two real firings exist an hour apart and both need to be checked against every
  other job's schedule.

See the [README](../README.md#how-it-decides) for how this feeds the collision window and
grouping rules.
