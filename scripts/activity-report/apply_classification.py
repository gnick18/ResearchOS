#!/usr/bin/env python3
"""Post-process step for the background-agent commit reclassification.

Reads the JSON output of the reclassify-commits workflow (an object with a
"classifications" array of {sha, label}, or the workflow task-output wrapper
that nests it under "result") and writes scripts/activity-report/commit-map.json,
keyed by full 40-char sha. The workflow emits 12-char shas, so they are mapped
back to full shas here. Any commit the agents missed is left for
classify_commits.py to fill via the cheap scope heuristic.

Usage:
    python3 scripts/activity-report/apply_classification.py <workflow-output.json>
"""

from __future__ import annotations

import json
import os
import subprocess
import sys
from collections import Counter

REPO_ROOT = subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True
).strip()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
MAP_PATH = os.path.join(SCRIPT_DIR, "commit-map.json")


def main():
    if len(sys.argv) != 2:
        sys.exit("usage: apply_classification.py <workflow-output.json>")
    raw = json.load(open(sys.argv[1]))
    # Accept either the raw {classifications:[...]} or the task-output wrapper.
    payload = raw.get("result", raw) if isinstance(raw, dict) else raw
    cls = payload["classifications"]

    full_by_pre = {}
    for h in subprocess.check_output(
        ["git", "log", "--no-merges", "--format=%H"],
        cwd=REPO_ROOT, text=True,
    ).split():
        full_by_pre[h[:12]] = h

    new_map = {}
    unmapped = 0
    for c in cls:
        full = full_by_pre.get(c["sha"])
        if full:
            new_map[full] = c["label"]
        else:
            unmapped += 1

    json.dump(new_map, open(MAP_PATH, "w"), indent=2)

    total = len(full_by_pre)
    covered = sum(1 for h in full_by_pre.values() if h in new_map)
    print(f"wrote {len(new_map)} labels to commit-map.json "
          f"({covered}/{total} commits covered, {unmapped} unmapped shas)")
    if covered < total:
        print(f"  {total - covered} commits unclassified -- run classify_commits.py "
              f"to fill them via the scope heuristic.")
    print("\nDistribution:")
    for label, n in Counter(new_map.values()).most_common():
        print(f"  {n:4d}  {label}")


if __name__ == "__main__":
    main()
