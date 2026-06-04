#!/usr/bin/env python3
"""Snapshot Kilo Code activity for this repo into a text-free aggregate file.

Kilo Code (a Roo/Cline-lineage VS Code extension) keeps full task history in the
editor's global storage. This was the AI tool used in the early phase of the
project, before Claude Code. Kilo can prune old tasks, so this script copies the
numbers we need into `kilo_snapshot.json` next to it, which generate.py reads.

The snapshot stores aggregates only (per-day token counts, word counts, prompt
counts, cost). It never stores prompt text or research content, so it is safe to
keep or even commit.

Sources (all local, no export needed):
  <editor>/User/globalStorage/state.vscdb        -> taskHistory index (authoritative)
  <editor>/User/globalStorage/kilocode.kilo-code/tasks/<id>/ui_messages.json

Usage:
    python3 scripts/activity-report/snapshot_kilo.py
"""

from __future__ import annotations

import json
import os
import re
import sqlite3
import subprocess
import sys
from collections import defaultdict
from datetime import datetime, timezone

REPO_ROOT = subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True
).strip()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_PATH = os.path.join(SCRIPT_DIR, "kilo_snapshot.json")

# editors that may host the Kilo extension, in preference order
EDITOR_ROOTS = [
    "~/Library/Application Support/Code/User/globalStorage",
    "~/Library/Application Support/Code - Insiders/User/globalStorage",
    "~/Library/Application Support/Cursor/User/globalStorage",
    "~/Library/Application Support/Windsurf/User/globalStorage",
    "~/Library/Application Support/VSCodium/User/globalStorage",
    "~/.config/Code/User/globalStorage",
    "~/.config/Cursor/User/globalStorage",
]
KILO_EXT = "kilocode.kilo-code"
STATE_KEY = "kilocode.kilo-code"

METRICS = ["prompts", "words", "requests",
           "input_tokens", "output_tokens", "cache_write", "cache_read", "cost"]


def find_kilo():
    for root in EDITOR_ROOTS:
        root = os.path.expanduser(root)
        ext = os.path.join(root, KILO_EXT)
        db = os.path.join(root, "state.vscdb")
        if os.path.isdir(ext) and os.path.isfile(db):
            return ext, db
    return None, None


def local_day(ms):
    try:
        return datetime.fromtimestamp(ms / 1000, tz=timezone.utc).astimezone().date().isoformat()
    except (TypeError, ValueError, OSError):
        return None


def strip_noise(text):
    """Drop auto-injected file dumps / environment details / tags before counting
    words, so we measure what you actually typed."""
    if not text:
        return ""
    text = re.sub(r"<file_content[^>]*>.*?</file_content>", " ", text, flags=re.S)
    text = re.sub(r"<environment_details>.*?</environment_details>", " ", text, flags=re.S)
    text = re.sub(r"<[^>]+>", " ", text)
    return text


def load_task_history(db_path):
    con = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cur = con.execute("SELECT value FROM ItemTable WHERE key=?", (STATE_KEY,))
        row = cur.fetchone()
    finally:
        con.close()
    if not row:
        return []
    state = json.loads(row[0])
    return state.get("taskHistory") or []


def main():
    ext_dir, db_path = find_kilo()
    if not ext_dir:
        print("!! Kilo Code storage not found on this machine.", file=sys.stderr)
        sys.exit(1)
    print(f"Reading Kilo task history from {db_path}")

    history = load_task_history(db_path)
    target = REPO_ROOT.rstrip("/")
    tasks = [t for t in history if (t.get("workspace") or "").rstrip("/") == target]
    print(f"taskHistory: {len(history)} total, {len(tasks)} for {target}")
    if not tasks:
        print("!! no Kilo tasks matched this repo; nothing to snapshot.", file=sys.stderr)
        sys.exit(1)

    per_day = defaultdict(lambda: defaultdict(float))
    modes = defaultdict(int)
    missing_ui = 0

    for t in tasks:
        day = local_day(t.get("ts"))
        if not day:
            continue
        modes[t.get("mode") or "?"] += 1
        # token + cost totals are authoritative in taskHistory; attribute to the
        # task's start day (Kilo tasks are effectively single-session).
        d = per_day[day]
        d["input_tokens"] += int(t.get("tokensIn", 0) or 0)
        d["output_tokens"] += int(t.get("tokensOut", 0) or 0)
        d["cache_write"] += int(t.get("cacheWrites", 0) or 0)
        d["cache_read"] += int(t.get("cacheReads", 0) or 0)
        d["cost"] += float(t.get("totalCost", 0) or 0)

        # words/prompts/requests come from the per-task ui_messages
        words = len(strip_noise(t.get("task", "")).split())
        prompts = 1
        requests = 0
        ui = os.path.join(ext_dir, "tasks", t["id"], "ui_messages.json")
        if os.path.isfile(ui):
            try:
                msgs = json.load(open(ui, errors="ignore"))
            except (json.JSONDecodeError, ValueError, OSError):
                msgs = []
                missing_ui += 1
            for m in msgs:
                if m.get("type") == "say" and m.get("say") == "user_feedback":
                    prompts += 1
                    words += len(strip_noise(m.get("text", "")).split())
                elif m.get("say") == "api_req_started":
                    requests += 1
        else:
            missing_ui += 1
        d["words"] += words
        d["prompts"] += prompts
        d["requests"] += requests

    days = sorted(per_day)
    totals = {k: 0.0 for k in METRICS}
    for day in days:
        for k in METRICS:
            totals[k] += per_day[day][k]
    # cast counts back to int
    def tidy(d):
        return {k: (round(d[k], 2) if k == "cost" else int(d[k])) for k in METRICS}

    snapshot = {
        "source": "kilo-code",
        "extension_dir": ext_dir,
        "workspace": target,
        "task_count": len(tasks),
        "ui_messages_missing": missing_ui,
        "date_span": {"start": days[0], "end": days[-1], "active_days": len(days)},
        "modes": dict(modes),
        "totals": tidy(totals),
        "per_day": {day: tidy(per_day[day]) for day in days},
        "note": "aggregates only; no prompt text or research content stored",
    }
    with open(OUT_PATH, "w") as f:
        json.dump(snapshot, f, indent=2)

    tt = snapshot["totals"]
    print("=" * 56)
    print(f"  Kilo Code snapshot  ({days[0]} -> {days[-1]}, {len(days)} active days)")
    print("=" * 56)
    print(f"  Tasks ............ {len(tasks):>10,}")
    print(f"  Prompts typed .... {tt['prompts']:>10,}")
    print(f"  Words typed ...... {tt['words']:>10,}")
    print(f"  AI requests ...... {tt['requests']:>10,}")
    print(f"  Input tokens ..... {tt['input_tokens']:>10,}")
    print(f"  Output tokens .... {tt['output_tokens']:>10,}")
    print(f"  Cache read ....... {tt['cache_read']:>10,}")
    print(f"  Actual cost ...... ${tt['cost']:>9,.2f}   (real spend, pay-per-token)")
    print(f"  Modes ............ {snapshot['modes']}")
    print("=" * 56)
    print(f"  Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
