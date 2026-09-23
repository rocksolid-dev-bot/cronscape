# cronscape

Paste a crontab file — not a single expression — and see when every line actually fires: which
lines collide within 60 seconds of each other, and which occurrences silently vanish or double up
around a DST transition. Nothing is uploaded; parsing and occurrence generation run entirely in
the browser.

**Live: https://cronscape.rs.m-noel.net/**

## The build and test run, pasted

cronscape is a client-rendered webapp, not a CLI, so there is no `--help` output to paste. The
captured-output section a CLI README would put first is here instead: the build, the test suite,
and the three checks that prove the deployed site matches this commit.

```sh
$ node -v
v18.19.1
exit=0

$ npm ci
npm WARN EBADENGINE Unsupported engine {
npm WARN EBADENGINE   package: 'happy-dom@20.14.5',
npm WARN EBADENGINE   required: { node: '>=20.0.0' },
npm WARN EBADENGINE   current: { node: 'v18.19.1', npm: '9.2.0' }
npm WARN EBADENGINE }
added 63 packages, and audited 64 packages in 8s
exit=0

$ npx tsc --noEmit
exit=0

$ npm test
 Test Files  6 passed (6)
      Tests  78 passed (78)
exit=0

$ npm run build
dist/index.html                  0.39 kB │ gzip: 0.27 kB
dist/assets/index-04HRkU5Y.css   3.98 kB │ gzip: 1.17 kB
dist/assets/index-Drxw0ibp.js   14.37 kB │ gzip: 5.35 kB
✓ built in 295ms
exit=0
```

The last line of `npm run build` names `dist/assets/index-Drxw0ibp.js`. The live checks below,
run in the same cycle, confirm the deployed site is serving that exact bundle.

```sh
$ curl -sS -o /dev/null -w "%{http_code}\n" https://cronscape.rs.m-noel.net/
200
exit=0
$ curl -sS -o /dev/null -w "%{http_code}\n" http://cronscape.rs.m-noel.net/
301
exit=0
$ curl -s https://cronscape.rs.m-noel.net/ | grep -o 'assets/index-[^"]*\.js'
assets/index-Drxw0ibp.js
exit=0
```

HTTPS answers `200`, plain HTTP redirects `301`, and the asset path served by the live site is
the same hash the local build just produced — the running app is this commit, not a stale deploy.

## Install / run

```sh
git clone https://github.com/rocksolid-dev-bot/cronscape.git
cd cronscape/code
npm ci
npm test
npm run build
```

Node 18.19.1 is the floor — see "Node version note" below for why and what that pins.

## Usage

There is no CLI flag surface; the whole interface is the page at the live URL:

1. Paste a crontab file (not a single expression — a whole file, comments and blanks included)
   into the text area.
2. Pick an IANA timezone to render wall-clock times in.
3. Set a window in days (1–365, default 7) — how far forward occurrences are generated.
4. The page renders one row per crontab line: its next occurrences in the chosen zone, each one
   badged `skipped`/`repeated` when it falls on a DST transition, plus a collisions section
   listing every group of occurrences from two or more distinct lines that land within 60 seconds
   of each other.

Parse errors (bad fields, unsupported Quartz-style 6/7-field lines, out-of-range values) are
reported per line, with line and column, in an `aria-live="polite"` region — a malformed line
never stops the rest of the file from rendering.

## How it decides

| Concept | Rule |
|---|---|
| Collision window | Fixed at **60 seconds**, not exposed as a UI control in this version. Two occurrences from **different** crontab lines within that window of each other are a collision; one line firing twice in its own window is not. |
| Collision grouping | Anchored, not chained: the earliest ungrouped occurrence anchors a group, and every later occurrence within 60s **of that anchor** joins it. Bounds every group's spread to at most 60s — chaining would let a train of jobs 50s apart each collapse into one group spanning far more than the window. |
| `skipped` wall-clock time | 0 real instants (spring-forward: the local time never happens). Excluded from collision detection — it has no instant to collide with. |
| `normal` wall-clock time | 1 real instant. |
| `repeated` wall-clock time | 2 real instants (fall-back: the local time happens twice). **Both** instants are generated and **both** participate in collision detection. |
| Occurrence cap | **500** per crontab line per generation window (`src/main.ts`). A window that would produce more is truncated and flagged, never silently cut off. |
| Generation window | 1–365 days, default 7, set in the UI. |

See [`docs/dst.md`](docs/dst.md) for the full DST rule, a worked table across five timezones,
and where an independent cron implementation disagrees with cronscape by design.

## What it does not do

- No cron daemon — nothing here schedules or runs a job, it only tells you when a pasted line
  *would* fire.
- No schedule editing — the crontab text is parsed, not mutated; there's no "add a job" form.
- No persistence and no accounts — the pasted crontab is parsed in the browser tab and never
  leaves it; refresh the page and it's gone.
- The 60-second collision window is fixed in this version; there is no control to change it.
- Occurrence generation is capped at 500 per job over a window of 1–365 days
  (`MAX_OCCURRENCES_PER_JOB` and `windowDays()` in `src/main.ts`) — a job with a huge window and a
  tight schedule gets truncated, flagged, not silently dropped.

## Node version note

The build container caps out at Node 18.19.1. The current `create-vite` and `vitest` majors
require Node 20+, so this project is pinned to the last majors that still run on Node 18:
`create-vite@6.5.0` (scaffolding only, not a runtime dependency) and `vitest@3.2.7`. `vite@6.3.5`
and `typescript@5.8.3` both support Node 18 natively.

## Development

```sh
npm ci
npm test
npm run build
```

Built by [Rock Solid](https://github.com/rocksolid-dev-bot), an autonomous build bot. Stack: Vite,
TypeScript, Vitest.

## License

MIT — see [LICENSE](./LICENSE).
