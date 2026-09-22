#!/usr/bin/env python3
"""Extract every fenced code block in README.md that shows a real captured
command run (its first line is a `$ ` prompt) and assert every non-empty
line in that block appears verbatim in media/2026-09-22-day9.txt. Blocks
that are not a captured run (none expected in this README) are deliberately
not checked here - they were never claimed to be pasted output.

Ported from archive/blastradius/code/scripts/check_readme_capture.py. Two
adaptations only: the capture path is this cycle's capture file, and the
prompt marker is `$ ` instead of `$ blastradius` (cronscape has no binary
to invoke; every captured line is a shell command).

A prompt-keyed extractor that finds zero captured blocks would exit 0
having checked nothing - the day-3/day-4 defect shape, a criterion that
cannot fail. So this script also fails loudly below a minimum block count.
"""
import re
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
README = ROOT / "README.md"
CAPTURE = ROOT / "media" / "2026-09-22-day9.txt"
MIN_CAPTURED_BLOCKS = 2

readme_text = README.read_text()
capture_lines = set(CAPTURE.read_text().splitlines())

fence_re = re.compile(r"```(?:\w*)\n(.*?)```", re.DOTALL)
blocks = fence_re.findall(readme_text)

captured_blocks = [b for b in blocks if b.splitlines() and b.splitlines()[0].startswith("$ ")]

unmatched = []
checked = 0
for block in captured_blocks:
    for line in block.splitlines():
        if line.strip() == "":
            continue
        checked += 1
        if line not in capture_lines:
            unmatched.append(line)

print(f"fenced blocks total: {len(blocks)}")
print(f"captured-run blocks checked: {len(captured_blocks)}")
print(f"lines checked: {checked}")
print(f"unmatched: {len(unmatched)}")
for line in unmatched:
    print(f"  MISS: {line!r}")

if len(captured_blocks) < MIN_CAPTURED_BLOCKS:
    print(f"FAIL: only {len(captured_blocks)} captured-run block(s) found, need >= {MIN_CAPTURED_BLOCKS}")
    sys.exit(1)

sys.exit(1 if unmatched else 0)
