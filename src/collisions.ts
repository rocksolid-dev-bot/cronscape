// Groups occurrences that land on top of each other across different
// crontab lines. `src/ui.ts` is the consumer — see it and `src/main.ts`
// for the render side.

import type { CronLine } from './parse.ts'
import type { GenerateResult } from './occurrences.ts'

export interface JobOccurrences {
  line: CronLine
  result: GenerateResult
}

export interface CollisionMember {
  line: CronLine
  wallClock: string
  instant: string
}

export interface CollisionGroup {
  /** The instant (ms since epoch) of the group's anchor member. */
  anchorMs: number
  members: CollisionMember[]
}

/**
 * Groups occurrences within `windowSeconds` of one another, anchored rather
 * than chained: occurrences are scanned in instant order, the earliest
 * ungrouped occurrence becomes a group's anchor, and every later occurrence
 * within `windowSeconds` *of that anchor* (not of its neighbour) joins the
 * same group. A group is only reported when it has members from at least
 * two distinct crontab lines — one line colliding with itself is not a
 * collision.
 *
 * Anchored grouping is chosen over transitive chaining on purpose. Under
 * chaining, a train of jobs each 50s apart in a long run would collapse
 * into one group whose first and last members are an hour apart, which
 * would report a "collision" the user's own window says is not one.
 * Anchoring bounds every group's spread to at most `windowSeconds`.
 *
 * `skipped` occurrences (no instant) can never collide and are skipped
 * entirely. `repeated` occurrences contribute *both* of their instants —
 * an implementation that reads only `instants[0]` would be correct on
 * every ordinary day and wrong exactly once a year, on the fall-back day.
 */
export function findCollisions(jobs: JobOccurrences[], windowSeconds = 60): CollisionGroup[] {
  const windowMs = windowSeconds * 1000

  const candidates: CollisionMember[] = []
  for (const job of jobs) {
    for (const occurrence of job.result.occurrences) {
      if (occurrence.instant === null) continue // skipped: no instant, can never collide
      candidates.push({ line: job.line, wallClock: occurrence.wallClock, instant: occurrence.instant })
    }
  }

  candidates.sort((a, b) => Date.parse(a.instant) - Date.parse(b.instant))

  const groups: CollisionGroup[] = []
  let i = 0
  while (i < candidates.length) {
    const anchor = candidates[i]
    const anchorMs = Date.parse(anchor.instant)
    const members: CollisionMember[] = [anchor]

    let j = i + 1
    while (j < candidates.length && Date.parse(candidates[j].instant) - anchorMs <= windowMs) {
      members.push(candidates[j])
      j += 1
    }

    const distinctLines = new Set(members.map((m) => m.line.line))
    if (distinctLines.size >= 2) {
      groups.push({ anchorMs, members })
    }

    i = j
  }

  return groups
}
