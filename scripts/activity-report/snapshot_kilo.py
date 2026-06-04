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

IDLE_GAP = 1800   # seconds; a gap longer than this means you stepped away

# Extra Kilo workspace paths that belong to THIS project under earlier names.
# ResearchManager_GANNT (Feb 12-15) is ResearchOS's founding sprint before the
# folder was renamed.
EXTRA_WORKSPACES = [
    "/Users/gnickles/Desktop/ResearchManager_GANNT",
]


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


def hours_from_groups(groups):
    """hands_on = time between your consecutive messages (reviewing/supervising
    counts); agent_runtime = gaps leading into agent work; wall_clock = union of
    active gaps. Gaps over IDLE_GAP are 'away' and dropped."""
    hands_on = agent = 0.0
    intervals = []
    all_humans = []
    for ev in groups:
        ev = sorted(ev)
        all_humans.extend(t for t, k in ev if k == "human")
        for i in range(len(ev) - 1):
            a = ev[i][0]
            b, kind = ev[i + 1]
            g = b - a
            if 0 < g <= IDLE_GAP:
                if kind != "human":
                    agent += g
                intervals.append((a, b))
    all_humans.sort()
    for i in range(len(all_humans) - 1):
        g = all_humans[i + 1] - all_humans[i]
        if 0 < g <= IDLE_GAP:
            hands_on += g
    intervals.sort()
    merged = 0.0
    cs = ce = None
    for a, b in intervals:
        if cs is None:
            cs, ce = a, b
        elif a <= ce:
            ce = max(ce, b)
        else:
            merged += ce - cs
            cs, ce = a, b
    if cs is not None:
        merged += ce - cs
    return {"hands_on_hours": round(hands_on / 3600, 1),
            "agent_runtime_hours": round(agent / 3600, 1),
            "wall_clock_hours": round(merged / 3600, 1)}


def checkpoint_stats(ext_dir, tasks):
    """Walk each task's checkpoint shadow git repo. Skip the per-task baseline
    (root) commit so we count only the incremental edits Kilo made."""
    total = incr = added = deleted = repos = 0
    for t in tasks:
        gd = os.path.join(ext_dir, "tasks", t["id"], "checkpoints", ".git")
        if not os.path.isdir(gd):
            continue
        repos += 1
        try:
            out = subprocess.run(
                ["git", "--git-dir", gd, "log", "--numstat", "--format=__%H|%P"],
                capture_output=True, text=True, timeout=60).stdout
        except (subprocess.SubprocessError, OSError):
            continue
        cur_child = False
        for line in out.splitlines():
            if line.startswith("__"):
                total += 1
                cur_child = bool(line[2:].split("|", 1)[1].strip())  # has a parent
                if cur_child:
                    incr += 1
            elif cur_child and line.strip():
                parts = line.split("\t")
                if (len(parts) == 3 and "node_modules" not in parts[2]
                        and not parts[2].endswith(("package-lock.json", "pnpm-lock.yaml"))):
                    if parts[0].isdigit():
                        added += int(parts[0])
                    if parts[1].isdigit():
                        deleted += int(parts[1])
    return {"tasks_with_checkpoints": repos, "total_checkpoints": total,
            "incremental_checkpoints": incr, "lines_added": added,
            "lines_deleted": deleted, "net_lines": added - deleted}


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
    workspaces = {target} | {w.rstrip("/") for w in EXTRA_WORKSPACES}
    tasks = [t for t in history if (t.get("workspace") or "").rstrip("/") in workspaces]
    print(f"taskHistory: {len(history)} total, {len(tasks)} for {sorted(workspaces)}")
    if not tasks:
        print("!! no Kilo tasks matched this repo; nothing to snapshot.", file=sys.stderr)
        sys.exit(1)

    per_day = defaultdict(lambda: defaultdict(float))
    modes = defaultdict(int)
    providers = defaultdict(lambda: {"requests": 0, "output_tokens": 0, "cost": 0.0})
    event_groups = []
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

        # words/prompts/requests + provider + per-event times from ui_messages
        words = len(strip_noise(t.get("task", "")).split())
        prompts = 1
        requests = 0
        events = []
        if t.get("ts"):
            events.append((t["ts"] / 1000, "human"))   # the initial prompt
        ui = os.path.join(ext_dir, "tasks", t["id"], "ui_messages.json")
        if os.path.isfile(ui):
            try:
                msgs = json.load(open(ui, errors="ignore"))
            except (json.JSONDecodeError, ValueError, OSError):
                msgs = []
                missing_ui += 1
            for m in msgs:
                ts = m.get("ts")
                is_feedback = m.get("type") == "say" and m.get("say") == "user_feedback"
                if is_feedback:
                    prompts += 1
                    words += len(strip_noise(m.get("text", "")).split())
                elif m.get("say") == "api_req_started":
                    requests += 1
                    try:
                        p = json.loads(m["text"])
                        prov = p.get("inferenceProvider") or "(unknown)"
                        providers[prov]["requests"] += 1
                        providers[prov]["output_tokens"] += int(p.get("tokensOut", 0) or 0)
                        providers[prov]["cost"] += float(p.get("cost", 0) or 0)
                    except (json.JSONDecodeError, ValueError, KeyError):
                        pass
                if ts:
                    events.append((ts / 1000, "human" if is_feedback else "machine"))
        else:
            missing_ui += 1
        d["words"] += words
        d["prompts"] += prompts
        d["requests"] += requests
        if events:
            event_groups.append(events)

    print("Walking checkpoint shadow repos ...")
    checkpoints = checkpoint_stats(ext_dir, tasks)
    hours = hours_from_groups(event_groups)
    providers = {k: {"requests": v["requests"], "output_tokens": v["output_tokens"],
                     "cost": round(v["cost"], 2)}
                 for k, v in sorted(providers.items(), key=lambda kv: -kv[1]["cost"])}

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
        "workspaces": sorted(workspaces),
        "task_count": len(tasks),
        "ui_messages_missing": missing_ui,
        "date_span": {"start": days[0], "end": days[-1], "active_days": len(days)},
        "modes": dict(modes),
        "totals": tidy(totals),
        "hours": hours,
        "providers": providers,
        "checkpoints": checkpoints,
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
    print(f"  Hands-on hours ... {hours['hands_on_hours']:>10,.1f}   (between your messages)")
    print(f"  Agent runtime .... {hours['agent_runtime_hours']:>10,.1f}   (agent generating/tools)")
    print(f"  Wall-clock ....... {hours['wall_clock_hours']:>10,.1f}   (elapsed, idle-trimmed)")
    print(f"  Checkpoints ...... {checkpoints['total_checkpoints']:>10,}   "
          f"(+{checkpoints['lines_added']:,} / -{checkpoints['lines_deleted']:,} lines)")
    print(f"  Modes ............ {snapshot['modes']}")
    top_prov = list(providers.items())[:4]
    print(f"  Top providers .... " + ", ".join(f"{k} (${v['cost']:.0f})" for k, v in top_prov))
    print("=" * 56)
    print(f"  Wrote {OUT_PATH}")


if __name__ == "__main__":
    main()
