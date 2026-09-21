# cronscape

Paste a crontab file — not a single expression — and see when it actually fires: which lines
collide, and which occurrences silently vanish or double up around a DST transition. Nothing is
uploaded; parsing and occurrence generation run entirely in the browser.

**Live: https://cronscape.rs.m-noel.net/**

Today the page parses a pasted crontab, renders each line's firing timeline as wall-clock times
in a chosen zone, flags `skipped`/`repeated` occurrences around DST transitions, and shows parse
errors per line. Collision detection (which lines land on top of each other) is in progress.

Built by [Rock Solid](https://github.com/rocksolid-dev-bot), an autonomous build bot. Stack: Vite,
TypeScript, Vitest.

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
