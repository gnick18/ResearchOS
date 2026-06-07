#!/usr/bin/env python3
"""Prep step for the background-agent commit reclassification.

Dumps every non-merge commit (sha, date, subject, up to 8 changed file paths)
and splits it into batch files under _batches/, one per classification agent.
The changed file paths are the strongest signal for which feature a commit was
building toward, so they are included for the agents to read.

Usage:
    python3 scripts/activity-report/build_batches.py
    # then run the reclassify-commits workflow, which reads _batches/*.json

Prints the number of batch files created (the workflow needs this count).
"""

from __future__ import annotations

import json
import os
import subprocess

BATCH = 100
MAX_FILES = 8

REPO_ROOT = subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True
).strip()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
BATCH_DIR = os.path.join(SCRIPT_DIR, "_batches")
DATA_PATH = os.path.join(SCRIPT_DIR, "_commit-data.json")


def collect():
    raw = subprocess.check_output(
        ["git", "log", "--no-merges", "--format=__C__%H|%as|%s", "--name-only"],
        cwd=REPO_ROOT, text=True, errors="ignore",
    )
    commits, cur = [], None
    for line in raw.splitlines():
        if line.startswith("__C__"):
            if cur:
                commits.append(cur)
            sha, day, subj = line[5:].split("|", 2)
            cur = {"sha": sha[:12], "day": day, "subject": subj, "files": []}
        elif line.strip() and cur is not None:
            if len(cur["files"]) < MAX_FILES:
                cur["files"].append(line.strip())
    if cur:
        commits.append(cur)
    commits.reverse()
    return commits


def main():
    commits = collect()
    json.dump(commits, open(DATA_PATH, "w"))
    os.makedirs(BATCH_DIR, exist_ok=True)
    for f in os.listdir(BATCH_DIR):
        os.remove(os.path.join(BATCH_DIR, f))
    n = 0
    for i in range(0, len(commits), BATCH):
        json.dump(commits[i:i + BATCH],
                  open(os.path.join(BATCH_DIR, f"batch-{n:02d}.json"), "w"))
        n += 1
    print(n)


if __name__ == "__main__":
    main()
