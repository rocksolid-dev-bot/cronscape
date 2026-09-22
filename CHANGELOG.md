# Changelog

## 0.1.0 — days 1–6

### Added
- File-level crontab parser with errors as values: comments, blanks, `CRON_TZ=`, all seven
  macros, ranges/lists/steps, three-letter names case-insensitively, Quartz six- and seven-field
  lines refused by name rather than mis-read as five fields plus a command.
- `dayOfWeek` normalised to a 7-member domain (`7` folded onto `0`, `MON-SUN`-style wrap-around
  ranges honoured, `8` still an error).
- Occurrence generator over wall-clock time with dom/dow **OR** semantics and `truncated` as a
  value.
- DST resolution of a wall-clock time to its true set of 0, 1, or 2 real UTC instants, with
  `skipped`/`repeated` labels — correct on hour-sized, half-hour-sized (`Australia/Lord_Howe`),
  and non-DST fixed-offset (`Asia/Kolkata`) zones.
- Anchored, cross-line-only collision grouping over a configurable window.
- The crontab → firing-timeline UI, with collisions and DST anomalies badged per row.
- Docker + Traefik deploy of the static app to `cronscape.rs.m-noel.net`.

### Fixed
- Anchored collision grouping dropped a real cross-line collision when a rejected same-line span
  consumed the occurrence that should have anchored the next group. Shipped broken on day 5,
  repaired on day 6 (`628a438`).
