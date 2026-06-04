#!/usr/bin/env python3
"""ResearchOS activity report.

Mines two local data sources and produces a re-runnable, presentation-ready
snapshot of how this project was built over time.

  1. git history          -> commits, lines added/deleted, files touched, phases
  2. Claude Code transcripts -> prompts you typed, words, messages, tokens, cost

Everything is stdlib only (no pip, no venv). Charts are emitted as SVG, which
drops into PowerPoint / Keynote / Google Slides as a crisp, recolorable vector.

Privacy: this script never writes any message text or research content into its
outputs. It counts words and tokens only. The milestone labels come from public
git commit subjects.

Usage:
    python3 scripts/activity-report/generate.py
    open scripts/activity-report/out/index.html
"""

from __future__ import annotations

import csv
import glob
import html
import json
import os
import re
import subprocess
import sys
from collections import Counter, defaultdict
from datetime import datetime, date, timedelta

# --------------------------------------------------------------------------- #
# Config
# --------------------------------------------------------------------------- #

REPO_ROOT = subprocess.check_output(
    ["git", "rev-parse", "--show-toplevel"], text=True
).strip()
SCRIPT_DIR = os.path.dirname(os.path.abspath(__file__))
OUT_DIR = os.path.join(SCRIPT_DIR, "out")

# Claude Code stores per-project transcripts under ~/.claude/projects/<slug>,
# where <slug> is the absolute repo path with every "/" turned into "-".
TRANSCRIPT_DIR = os.path.join(
    os.path.expanduser("~/.claude/projects"),
    REPO_ROOT.replace("/", "-"),
)

# user "messages" that are machine-authored, not typed by a human
INJECTED_PREFIXES = (
    "<task-notification",
    "<command-name",
    "<command-message",
    "<command-args",
    "<local-command",
    "<system-reminder",
)
MACHINE_PREFIXES = (
    "From the orchestrator",            # sub-bot dispatch prompts authored by the master bot
    "This session is being continued",  # compaction continuation summaries
)

# Rough public list pricing, USD per 1M tokens. Edit to taste; clearly an
# estimate. cache-write is billed ~1.25x input, cache-read ~0.1x input.
PRICING = {
    "opus":   {"in": 15.0, "out": 75.0, "cache_write": 18.75, "cache_read": 1.50},
    "sonnet": {"in": 3.0,  "out": 15.0, "cache_write": 3.75,  "cache_read": 0.30},
    "haiku":  {"in": 1.0,  "out": 5.0,  "cache_write": 1.25,  "cache_read": 0.10},
}

def price_bucket(model: str) -> str:
    m = (model or "").lower()
    if "opus" in m:
        return "opus"
    if "haiku" in m:
        return "haiku"
    if "sonnet" in m:
        return "sonnet"
    return "opus"  # default to the priciest so cost is never understated

# Paths excluded from line/file rollups because they are not authored source
# (committed dependencies, generated installer artifacts, lockfiles). Commit
# COUNT is unaffected; only added/deleted/files-touched skip these.
EXCLUDE_PATH_RX = re.compile(
    r"(^|/)node_modules/"
    r"|(^|/)installer/out/"
    r"|(^|/)dist/"
    r"|package-lock\.json$|pnpm-lock\.yaml$|yarn\.lock$"
    r"|LICENSES?\.[a-z]+\.html$|LICENSES?\.chromium\.html$"
    r"|\.min\.(js|css)$"
)

# Milestone phases. Each entry: (label, regex matched against commit subjects).
# The milestone's date = the earliest commit whose subject matches. This is how
# we show "how many phases the project went through".
MILESTONES = [
    ("Project start",        r"."),
    ("Onboarding tour",      r"onboard|tour|walkthrough"),
    ("Gamification/streaks", r"gamif|streak"),
    ("Version control",      r"version[ -]control|\bvc\b|vc phase|version history"),
    ("Method/kit templates", r"kit template|method[ -]?catalog|method template|template library"),
    ("LC-MS templates",      r"lc-?ms|mass[ -]?spec"),
    ("Photo annotation",     r"annotat"),
    ("NIH sharing/Zenodo",   r"zenodo|\bnih\b|figshare|data.?sharing"),
    ("Cross-boundary share", r"cross-?boundary"),
    ("AGPL relicense",       r"agpl|relicens|\blicense\b"),
    ("Beta de-bloat",        r"de-?bloat|debloat"),
    ("Sequence editor",      r"sequence|seqviz|\bove\b|\balign|primer|cloning"),
    ("Typography system",    r"typograph|text-meta|type[ -]scale|type token"),
]


# --------------------------------------------------------------------------- #
# git
# --------------------------------------------------------------------------- #

def collect_git():
    """Return list of commit dicts and per-day rollups."""
    sep = "\x1e"   # record sep
    fmt = sep + "%H|%aI|%s"
    raw = subprocess.check_output(
        ["git", "log", "--no-merges", "--numstat", "--date=iso-strict", f"--format={fmt}"],
        cwd=REPO_ROOT, text=True, errors="ignore",
    )
    commits = []
    for chunk in raw.split(sep):
        chunk = chunk.strip("\n")
        if not chunk:
            continue
        lines = chunk.split("\n")
        head = lines[0]
        try:
            h, iso, subject = head.split("|", 2)
        except ValueError:
            continue
        added = deleted = files = 0
        for ln in lines[1:]:
            ln = ln.strip()
            if not ln:
                continue
            parts = ln.split("\t")
            if len(parts) != 3:
                continue
            a, d, fpath = parts
            if EXCLUDE_PATH_RX.search(fpath):
                continue
            files += 1
            if a.isdigit():
                added += int(a)
            if d.isdigit():
                deleted += int(d)
        day = iso[:10]
        commits.append({
            "hash": h, "iso": iso, "day": day, "subject": subject,
            "added": added, "deleted": deleted, "files": files,
        })
    commits.reverse()  # chronological
    return commits


def detect_milestones(commits):
    out = []
    for label, pat in MILESTONES:
        rx = re.compile(pat, re.I)
        hit = next((c for c in commits if rx.search(c["subject"])), None)
        if hit:
            out.append({"label": label, "day": hit["day"], "subject": hit["subject"], "pat": pat})
    # de-dupe by day keeping first, sort
    out.sort(key=lambda m: m["day"])
    seen_label = set()
    dedup = []
    for m in out:
        if m["label"] in seen_label:
            continue
        seen_label.add(m["label"])
        dedup.append(m)
    for i, m in enumerate(dedup):
        m["n"] = i + 1   # phase number, shared between roadmap and chart badges
    return dedup


# --------------------------------------------------------------------------- #
# transcripts
# --------------------------------------------------------------------------- #

def local_day(iso_ts: str) -> str | None:
    if not iso_ts:
        return None
    try:
        dt = datetime.fromisoformat(iso_ts.replace("Z", "+00:00"))
        return dt.astimezone().date().isoformat()
    except ValueError:
        return None


def classify_user_text(text: str) -> str:
    s = text.lstrip()
    if s.startswith(INJECTED_PREFIXES):
        return "injected"
    if s.startswith(MACHINE_PREFIXES):
        return "machine"
    return "human"


def collect_transcripts():
    per_day = defaultdict(lambda: defaultdict(float))
    totals = defaultdict(float)
    tokens_by_model = defaultdict(lambda: defaultdict(int))
    tool_counter = Counter()
    sessions = set()
    active_days = set()
    seen_uuids = set()

    files = glob.glob(os.path.join(TRANSCRIPT_DIR, "*.jsonl"))
    for path in files:
        try:
            fh = open(path, errors="ignore")
        except OSError:
            continue
        with fh:
            for line in fh:
                try:
                    o = json.loads(line)
                except (json.JSONDecodeError, ValueError):
                    continue
                t = o.get("type")
                if t not in ("user", "assistant"):
                    continue
                if o.get("isSidechain"):
                    # sub-agent (Task/Agent) chatter inside a session
                    pass  # still count tokens? keep it as "your project" cost -> yes for assistant
                uid = o.get("uuid")
                if uid and uid in seen_uuids:
                    continue
                if uid:
                    seen_uuids.add(uid)

                if o.get("sessionId"):
                    sessions.add(o["sessionId"])
                day = local_day(o.get("timestamp"))
                if day:
                    active_days.add(day)

                msg = o.get("message") or {}

                if t == "assistant":
                    usage = msg.get("usage") or {}
                    it = int(usage.get("input_tokens", 0) or 0)
                    ot = int(usage.get("output_tokens", 0) or 0)
                    cc = int(usage.get("cache_creation_input_tokens", 0) or 0)
                    cr = int(usage.get("cache_read_input_tokens", 0) or 0)
                    model = msg.get("model") or ""
                    bucket = price_bucket(model)
                    if day:
                        per_day[day]["input_tokens"] += it
                        per_day[day]["output_tokens"] += ot
                        per_day[day]["cache_write_tokens"] += cc
                        per_day[day]["cache_read_tokens"] += cr
                        per_day[day]["assistant_msgs"] += 1
                    totals["input_tokens"] += it
                    totals["output_tokens"] += ot
                    totals["cache_write_tokens"] += cc
                    totals["cache_read_tokens"] += cr
                    totals["assistant_msgs"] += 1
                    tokens_by_model[bucket]["in"] += it
                    tokens_by_model[bucket]["out"] += ot
                    tokens_by_model[bucket]["cache_write"] += cc
                    tokens_by_model[bucket]["cache_read"] += cr

                    stu = usage.get("server_tool_use") or {}
                    ws = int(stu.get("web_search_requests", 0) or 0)
                    wf = int(stu.get("web_fetch_requests", 0) or 0)
                    if day:
                        per_day[day]["web_searches"] += ws
                        per_day[day]["web_fetches"] += wf
                    totals["web_searches"] += ws
                    totals["web_fetches"] += wf

                    content = msg.get("content")
                    if isinstance(content, list):
                        for b in content:
                            if isinstance(b, dict) and b.get("type") == "tool_use":
                                tool_counter[b.get("name", "?")] += 1
                                if day:
                                    per_day[day]["tool_calls"] += 1
                                totals["tool_calls"] += 1

                elif t == "user":
                    if o.get("isSidechain"):
                        continue  # sub-agent's inbound prompts are not your typing
                    content = msg.get("content")
                    text = None
                    if isinstance(content, str):
                        text = content
                    elif isinstance(content, list):
                        parts = [
                            b.get("text", "")
                            for b in content
                            if isinstance(b, dict) and b.get("type") == "text"
                        ]
                        if parts:
                            text = "\n".join(parts)
                    if text is None:
                        continue  # tool_result / image-only -> not typed
                    kind = classify_user_text(text)
                    if kind != "human":
                        continue
                    words = len(text.split())
                    if day:
                        per_day[day]["your_prompts"] += 1
                        per_day[day]["your_words"] += words
                    totals["your_prompts"] += 1
                    totals["your_words"] += words

    return {
        "per_day": per_day,
        "totals": totals,
        "tokens_by_model": tokens_by_model,
        "tool_counter": tool_counter,
        "sessions": sessions,
        "active_days": active_days,
        "file_count": len(files),
    }


def estimate_cost(tokens_by_model):
    total = 0.0
    by_model = {}
    for bucket, tk in tokens_by_model.items():
        p = PRICING.get(bucket, PRICING["opus"])
        c = (
            tk["in"] / 1e6 * p["in"]
            + tk["out"] / 1e6 * p["out"]
            + tk["cache_write"] / 1e6 * p["cache_write"]
            + tk["cache_read"] / 1e6 * p["cache_read"]
        )
        by_model[bucket] = round(c, 2)
        total += c
    return round(total, 2), by_model


# --------------------------------------------------------------------------- #
# timeline assembly
# --------------------------------------------------------------------------- #

TIMELINE_FIELDS = [
    "commits", "lines_added", "lines_deleted", "net_lines", "files_touched",
    "your_prompts", "your_words", "assistant_msgs",
    "input_tokens", "output_tokens", "cache_write_tokens", "cache_read_tokens",
    "total_tokens", "tool_calls", "web_searches", "web_fetches",
]


def build_timeline(commits, tx):
    git_day = defaultdict(lambda: defaultdict(int))
    for c in commits:
        d = git_day[c["day"]]
        d["commits"] += 1
        d["lines_added"] += c["added"]
        d["lines_deleted"] += c["deleted"]
        d["files_touched"] += c["files"]

    all_days = set(git_day) | set(tx["per_day"])
    if not all_days:
        return []
    start = min(all_days)
    end = max(all_days)
    d0 = date.fromisoformat(start)
    d1 = date.fromisoformat(end)

    rows = []
    cur = d0
    while cur <= d1:
        key = cur.isoformat()
        g = git_day.get(key, {})
        p = tx["per_day"].get(key, {})
        added = int(g.get("lines_added", 0))
        deleted = int(g.get("lines_deleted", 0))
        it = int(p.get("input_tokens", 0))
        ot = int(p.get("output_tokens", 0))
        cw = int(p.get("cache_write_tokens", 0))
        cr = int(p.get("cache_read_tokens", 0))
        rows.append({
            "date": key,
            "commits": int(g.get("commits", 0)),
            "lines_added": added,
            "lines_deleted": deleted,
            "net_lines": added - deleted,
            "files_touched": int(g.get("files_touched", 0)),
            "your_prompts": int(p.get("your_prompts", 0)),
            "your_words": int(p.get("your_words", 0)),
            "assistant_msgs": int(p.get("assistant_msgs", 0)),
            "input_tokens": it,
            "output_tokens": ot,
            "cache_write_tokens": cw,
            "cache_read_tokens": cr,
            "total_tokens": it + ot + cw + cr,
            "tool_calls": int(p.get("tool_calls", 0)),
            "web_searches": int(p.get("web_searches", 0)),
            "web_fetches": int(p.get("web_fetches", 0)),
        })
        cur += timedelta(days=1)
    return rows


# --------------------------------------------------------------------------- #
# tiny SVG charting (stdlib only)
# --------------------------------------------------------------------------- #

PALETTE = {
    "ink": "#1f2933",
    "grid": "#e4e7eb",
    "axis": "#9aa5b1",
    "bar": "#2f80ed",
    "bar2": "#56ccf2",
    "accent": "#eb5757",
    "green": "#27ae60",
    "amber": "#f2994a",
    "violet": "#9b51e0",
    "bg": "#ffffff",
}

W, H = 1100, 460
PAD_L, PAD_R, PAD_T, PAD_B = 70, 30, 74, 70


def _esc(s):
    return html.escape(str(s), quote=True)


def _nice_max(v):
    if v <= 0:
        return 1
    import math
    exp = math.floor(math.log10(v))
    base = 10 ** exp
    for m in (1, 2, 2.5, 5, 10):
        if v <= m * base:
            return m * base
    return 10 * base


def _fmt_short(v):
    v = float(v)
    for unit, div in (("M", 1e6), ("k", 1e3)):
        if abs(v) >= div:
            return f"{v/div:.1f}".rstrip("0").rstrip(".") + unit
    return f"{v:.0f}"


def _date_ticks(dates, n=8):
    if not dates:
        return []
    idxs = sorted(set(round(i * (len(dates) - 1) / (n - 1)) for i in range(n)))
    return [(i, dates[i][5:]) for i in idxs]  # MM-DD


def svg_open(title, subtitle=""):
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" '
        f'viewBox="0 0 {W} {H}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">',
        f'<rect width="{W}" height="{H}" fill="{PALETTE["bg"]}"/>',
        f'<text x="{PAD_L}" y="28" font-size="20" font-weight="700" '
        f'fill="{PALETTE["ink"]}">{_esc(title)}</text>',
    ]
    if subtitle:
        s.append(
            f'<text x="{PAD_L}" y="46" font-size="12.5" fill="{PALETTE["axis"]}">'
            f'{_esc(subtitle)}</text>'
        )
    return s


def axes(s, ymax, dates, ylabel=""):
    plot_w = W - PAD_L - PAD_R
    plot_h = H - PAD_T - PAD_B
    # gridlines + y labels
    for i in range(6):
        yval = ymax * i / 5
        y = PAD_T + plot_h - plot_h * i / 5
        s.append(
            f'<line x1="{PAD_L}" y1="{y:.1f}" x2="{W-PAD_R}" y2="{y:.1f}" '
            f'stroke="{PALETTE["grid"]}" stroke-width="1"/>'
        )
        s.append(
            f'<text x="{PAD_L-8}" y="{y+4:.1f}" font-size="11" text-anchor="end" '
            f'fill="{PALETTE["axis"]}">{_fmt_short(yval)}</text>'
        )
    # x ticks
    for i, lbl in _date_ticks(dates):
        x = PAD_L + (plot_w * i / max(1, len(dates) - 1))
        s.append(
            f'<text x="{x:.1f}" y="{H-PAD_B+18}" font-size="11" text-anchor="middle" '
            f'fill="{PALETTE["axis"]}">{_esc(lbl)}</text>'
        )
    if ylabel:
        s.append(
            f'<text x="16" y="{PAD_T+plot_h/2}" font-size="11.5" fill="{PALETTE["axis"]}" '
            f'transform="rotate(-90 16 {PAD_T+plot_h/2})" text-anchor="middle">{_esc(ylabel)}</text>'
        )
    return plot_w, plot_h


def milestone_markers(s, dates, milestones, plot_w, plot_h):
    """Dashed phase-start lines topped with a small numbered badge. Badges match
    the numbering in phases.svg; they de-collide horizontally so clustered phases
    stay legible (the roadmap is the legend)."""
    idx = {d: i for i, d in enumerate(dates)}
    n = len(dates)
    marks = []
    for m in milestones:
        if m["day"] in idx:
            i = idx[m["day"]]
        else:
            cand = [d for d in dates if d >= m["day"]]
            if not cand:
                continue
            i = idx[cand[0]]
        x = PAD_L + (plot_w * i / max(1, n - 1))
        marks.append((x, m.get("n", "")))
    marks.sort()
    # push badges apart so circles don't overlap
    min_gap = 17
    bx = []
    for x, _num in marks:
        nx = x
        if bx and nx < bx[-1] + min_gap:
            nx = bx[-1] + min_gap
        bx.append(nx)
    for (x, num), badge_x in zip(marks, bx):
        s.append(
            f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{x:.1f}" y2="{PAD_T+plot_h}" '
            f'stroke="{PALETTE["accent"]}" stroke-width="1" stroke-dasharray="3 3" opacity="0.45"/>'
        )
        cy = PAD_T - 8
        if abs(badge_x - x) > 0.5:
            s.append(f'<line x1="{x:.1f}" y1="{PAD_T}" x2="{badge_x:.1f}" y2="{cy+6:.1f}" '
                     f'stroke="{PALETTE["accent"]}" stroke-width="0.7" opacity="0.4"/>')
        s.append(f'<circle cx="{badge_x:.1f}" cy="{cy:.1f}" r="7.5" fill="{PALETTE["accent"]}"/>')
        s.append(f'<text x="{badge_x:.1f}" y="{cy+3.5:.1f}" font-size="9.5" font-weight="700" '
                 f'text-anchor="middle" fill="#ffffff">{num}</text>')


def bar_chart(path, title, subtitle, dates, values, color, ylabel, milestones=None):
    s = svg_open(title, subtitle)
    ymax = _nice_max(max(values) if values else 1)
    plot_w, plot_h = axes(s, ymax, dates, ylabel)
    n = len(dates)
    bw = max(1.0, plot_w / max(1, n) * 0.82)
    for i, v in enumerate(values):
        if v <= 0:
            continue
        x = PAD_L + plot_w * i / max(1, n - 1) - bw / 2
        bh = plot_h * v / ymax
        y = PAD_T + plot_h - bh
        s.append(
            f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" '
            f'fill="{color}" rx="1"/>'
        )
    if milestones:
        milestone_markers(s, dates, milestones, plot_w, plot_h)
    s.append("</svg>")
    _write(path, "\n".join(s))


def line_chart(path, title, subtitle, dates, values, color, ylabel, milestones=None, fill=True):
    s = svg_open(title, subtitle)
    ymax = _nice_max(max(values) if values else 1)
    plot_w, plot_h = axes(s, ymax, dates, ylabel)
    n = len(dates)
    pts = []
    for i, v in enumerate(values):
        x = PAD_L + plot_w * i / max(1, n - 1)
        y = PAD_T + plot_h - plot_h * v / ymax
        pts.append((x, y))
    if fill and pts:
        d = f"M {pts[0][0]:.1f} {PAD_T+plot_h:.1f} " + " ".join(
            f"L {x:.1f} {y:.1f}" for x, y in pts
        ) + f" L {pts[-1][0]:.1f} {PAD_T+plot_h:.1f} Z"
        s.append(f'<path d="{d}" fill="{color}" opacity="0.12"/>')
    if pts:
        d = "M " + " L ".join(f"{x:.1f} {y:.1f}" for x, y in pts)
        s.append(f'<path d="{d}" fill="none" stroke="{color}" stroke-width="2.5"/>')
    if milestones:
        milestone_markers(s, dates, milestones, plot_w, plot_h)
    s.append("</svg>")
    _write(path, "\n".join(s))


def stacked_bar(path, title, subtitle, dates, series, ylabel, milestones=None):
    """series = list of (label, color, values[])."""
    s = svg_open(title, subtitle)
    totals = [sum(series[j][2][i] for j in range(len(series))) for i in range(len(dates))]
    ymax = _nice_max(max(totals) if totals else 1)
    plot_w, plot_h = axes(s, ymax, dates, ylabel)
    n = len(dates)
    bw = max(1.0, plot_w / max(1, n) * 0.82)
    for i in range(n):
        x = PAD_L + plot_w * i / max(1, n - 1) - bw / 2
        acc = 0.0
        for _label, color, vals in series:
            v = vals[i]
            if v <= 0:
                continue
            bh = plot_h * v / ymax
            y = PAD_T + plot_h - bh - acc
            s.append(
                f'<rect x="{x:.1f}" y="{y:.1f}" width="{bw:.1f}" height="{bh:.1f}" fill="{color}"/>'
            )
            acc += bh
    # legend: horizontal strip below the x-axis, out of the data area
    ly = H - 14
    lx = PAD_L
    for label, color, _vals in series:
        s.append(f'<rect x="{lx}" y="{ly-9}" width="11" height="11" fill="{color}" rx="2"/>')
        s.append(f'<text x="{lx+16}" y="{ly}" font-size="11" fill="{PALETTE["ink"]}">{_esc(label)}</text>')
        lx += 26 + len(label) * 7
    if milestones:
        milestone_markers(s, dates, milestones, plot_w, plot_h)
    s.append("</svg>")
    _write(path, "\n".join(s))


def hbar_chart(path, title, subtitle, rows):
    """rows = list of (label, value, color). Horizontal bars."""
    h = max(260, 90 + len(rows) * 34)
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" '
        f'viewBox="0 0 {W} {h}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">',
        f'<rect width="{W}" height="{h}" fill="{PALETTE["bg"]}"/>',
        f'<text x="{PAD_L}" y="28" font-size="20" font-weight="700" fill="{PALETTE["ink"]}">{_esc(title)}</text>',
    ]
    if subtitle:
        s.append(f'<text x="{PAD_L}" y="46" font-size="12.5" fill="{PALETTE["axis"]}">{_esc(subtitle)}</text>')
    vmax = max((v for _l, v, _c in rows), default=1) or 1
    label_w = 190
    track_x = PAD_L + label_w
    track_w = W - PAD_R - track_x - 70
    for i, (label, v, color) in enumerate(rows):
        y = 70 + i * 34
        bw = track_w * v / vmax
        s.append(f'<text x="{PAD_L}" y="{y+15}" font-size="12.5" fill="{PALETTE["ink"]}">{_esc(label)}</text>')
        s.append(f'<rect x="{track_x}" y="{y}" width="{track_w:.1f}" height="20" fill="{PALETTE["grid"]}" rx="3"/>')
        s.append(f'<rect x="{track_x}" y="{y}" width="{bw:.1f}" height="20" fill="{color}" rx="3"/>')
        s.append(f'<text x="{track_x+bw+8:.1f}" y="{y+15}" font-size="12" fill="{PALETTE["axis"]}">{_fmt_short(v)}</text>')
    s.append("</svg>")
    _write(path, "\n".join(s))


def phases_chart(path, title, subtitle, milestones, commits, end_day):
    """Vertical roadmap: phases in date order, each with a commit-volume bar.

    Phase volume = commits whose subject matches that initiative (not a linear
    "until next phase" window), because initiatives ran in parallel. The first
    "Project start" phase counts the foundational commits before initiative #2.
    """
    row_h = 44
    top = 78
    h = top + len(milestones) * row_h + 20
    s = [
        f'<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{h}" '
        f'viewBox="0 0 {W} {h}" font-family="Inter, Segoe UI, Helvetica, Arial, sans-serif">',
        f'<rect width="{W}" height="{h}" fill="{PALETTE["bg"]}"/>',
        f'<text x="{PAD_L}" y="28" font-size="20" font-weight="700" fill="{PALETTE["ink"]}">{_esc(title)}</text>',
    ]
    if subtitle:
        s.append(f'<text x="{PAD_L}" y="46" font-size="12.5" fill="{PALETTE["axis"]}">{_esc(subtitle)}</text>')
    if not milestones:
        s.append("</svg>")
        _write(path, "\n".join(s))
        return

    # phase volume = commits whose subject matches that initiative's pattern;
    # phase #1 ("Project start") = foundational commits before initiative #2.
    second_day = milestones[1]["day"] if len(milestones) > 1 else end_day
    counts = []
    for i, m in enumerate(milestones):
        if i == 0:
            c = sum(1 for cm in commits if cm["day"] < second_day)
        else:
            rx = re.compile(m.get("pat", r"$^"), re.I)
            c = sum(1 for cm in commits if rx.search(cm["subject"]))
        counts.append(c)
    cmax = max(counts) if counts else 1

    spine_x = PAD_L + 12
    name_x = spine_x + 22
    bar_x = PAD_L + 360
    bar_w = W - PAD_R - bar_x - 120  # reserve room for the "N commits" label
    colors = [PALETTE["bar"], PALETTE["green"], PALETTE["amber"], PALETTE["violet"],
              PALETTE["bar2"], PALETTE["accent"]]

    # spine
    y_first = top + row_h // 2
    y_last = top + (len(milestones) - 1) * row_h + row_h // 2
    s.append(f'<line x1="{spine_x}" y1="{y_first}" x2="{spine_x}" y2="{y_last}" '
             f'stroke="{PALETTE["grid"]}" stroke-width="2"/>')

    for i, m in enumerate(milestones):
        cy = top + i * row_h + row_h // 2
        color = colors[i % len(colors)]
        s.append(f'<circle cx="{spine_x}" cy="{cy}" r="5.5" fill="{color}" '
                 f'stroke="{PALETTE["bg"]}" stroke-width="2"/>')
        s.append(f'<text x="{name_x}" y="{cy-2}" font-size="13.5" font-weight="600" '
                 f'fill="{PALETTE["ink"]}">{i+1}. {_esc(m["label"])}</text>')
        s.append(f'<text x="{name_x}" y="{cy+13}" font-size="10.5" '
                 f'fill="{PALETTE["axis"]}">started {m["day"]}</text>')
        bw = bar_w * counts[i] / cmax if cmax else 0
        s.append(f'<rect x="{bar_x}" y="{cy-9}" width="{bar_w:.1f}" height="18" '
                 f'fill="{PALETTE["grid"]}" rx="3"/>')
        s.append(f'<rect x="{bar_x}" y="{cy-9}" width="{bw:.1f}" height="18" '
                 f'fill="{color}" rx="3" opacity="0.9"/>')
        s.append(f'<text x="{bar_x+max(bw,4)+8:.1f}" y="{cy+4}" font-size="11" '
                 f'fill="{PALETTE["axis"]}">{counts[i]:,} commits</text>')
    s.append("</svg>")
    _write(path, "\n".join(s))


def _write(path, content):
    with open(path, "w") as f:
        f.write(content)


# --------------------------------------------------------------------------- #
# outputs
# --------------------------------------------------------------------------- #

def write_csv(rows):
    path = os.path.join(OUT_DIR, "timeline.csv")
    with open(path, "w", newline="") as f:
        w = csv.DictWriter(f, fieldnames=["date"] + TIMELINE_FIELDS)
        w.writeheader()
        w.writerows(rows)
    return path


def rolling(values, k=7):
    out = []
    for i in range(len(values)):
        lo = max(0, i - k + 1)
        win = values[lo:i + 1]
        out.append(sum(win) / len(win))
    return out


def cumulative(values):
    out, acc = [], 0
    for v in values:
        acc += v
        out.append(acc)
    return out


def trim_window(dates, *value_lists):
    """Slice off leading/trailing days where every series is zero, so charts
    over a sparse range (e.g. transcripts only cover recent weeks) stay legible."""
    n = len(dates)
    nz = [i for i in range(n) if any(vl[i] for vl in value_lists)]
    if not nz:
        return dates, list(value_lists)
    lo, hi = nz[0], nz[-1]
    return dates[lo:hi + 1], [vl[lo:hi + 1] for vl in value_lists]


def milestones_in(milestones, wdates):
    if not wdates:
        return []
    lo, hi = wdates[0], wdates[-1]
    return [m for m in milestones if lo <= m["day"] <= hi]


def main():
    if not os.path.isdir(TRANSCRIPT_DIR):
        print(f"!! transcript dir not found: {TRANSCRIPT_DIR}", file=sys.stderr)
    os.makedirs(OUT_DIR, exist_ok=True)

    print("Reading git history ...")
    commits = collect_git()
    milestones = detect_milestones(commits)

    print(f"Reading transcripts from {TRANSCRIPT_DIR} ...")
    tx = collect_transcripts()

    rows = build_timeline(commits, tx)
    dates = [r["date"] for r in rows]
    cost_total, cost_by_model = estimate_cost(tx["tokens_by_model"])

    # ---- summary.json ----
    t = tx["totals"]
    summary = {
        "generated_for": REPO_ROOT,
        "date_range": {"start": dates[0] if dates else None, "end": dates[-1] if dates else None,
                       "calendar_days": len(rows)},
        "git": {
            "commits": len(commits),
            "lines_added": sum(c["added"] for c in commits),
            "lines_deleted": sum(c["deleted"] for c in commits),
            "net_lines": sum(c["added"] - c["deleted"] for c in commits),
            "files_touched": sum(c["files"] for c in commits),
        },
        "your_effort": {
            "prompts_typed": int(t["your_prompts"]),
            "words_typed": int(t["your_words"]),
            "active_days": len(tx["active_days"]),
            "sessions": len(tx["sessions"]),
            "transcript_files": tx["file_count"],
            "avg_words_per_prompt": round(t["your_words"] / t["your_prompts"], 1) if t["your_prompts"] else 0,
        },
        "ai_usage": {
            "assistant_messages": int(t["assistant_msgs"]),
            "tool_calls": int(t["tool_calls"]),
            "web_searches": int(t["web_searches"]),
            "web_fetches": int(t["web_fetches"]),
            "tokens": {
                "input": int(t["input_tokens"]),
                "output": int(t["output_tokens"]),
                "cache_write": int(t["cache_write_tokens"]),
                "cache_read": int(t["cache_read_tokens"]),
                "total": int(t["input_tokens"] + t["output_tokens"]
                              + t["cache_write_tokens"] + t["cache_read_tokens"]),
            },
            "estimated_cost_usd": cost_total,
            "estimated_cost_by_model_usd": cost_by_model,
            "top_tools": tx["tool_counter"].most_common(15),
        },
        "milestones": milestones,
        "pricing_note": "estimated_cost is a rough list-price estimate; edit PRICING in generate.py",
    }
    with open(os.path.join(OUT_DIR, "summary.json"), "w") as f:
        json.dump(summary, f, indent=2)

    csv_path = write_csv(rows)

    # ---- charts ----
    print("Rendering charts ...")
    # git-based: span the full repo history
    commits_v = [r["commits"] for r in rows]
    wd, (wv,) = trim_window(dates, commits_v)
    bar_chart(os.path.join(OUT_DIR, "commits_per_day.svg"),
              "Commits per day", "git history, with project phases marked",
              wd, wv, PALETTE["bar"], "commits / day", milestones_in(milestones, wd))

    cum_loc = cumulative([r["net_lines"] for r in rows])
    wd, (wv,) = trim_window(dates, cum_loc)
    line_chart(os.path.join(OUT_DIR, "cumulative_loc.svg"),
               "Cumulative net lines of code", "added minus deleted; deps/lockfiles/installer excluded",
               wd, wv, PALETTE["green"], "net lines", milestones_in(milestones, wd))

    # effort-based: trims to the window where you were actually typing
    words_v = [r["your_words"] for r in rows]
    wd, (wv,) = trim_window(dates, words_v)
    bar_chart(os.path.join(OUT_DIR, "your_words_per_day.svg"),
              "Words you typed per day", "your chat prompts only (machine-authored dispatches excluded)",
              wd, wv, PALETTE["violet"], "words / day", milestones_in(milestones, wd))

    # re-cumulate within the window so the curve starts at 0
    wd2, (raw,) = trim_window(dates, words_v)
    line_chart(os.path.join(OUT_DIR, "cumulative_words.svg"),
               "Cumulative words you typed", "your total written input over the project",
               wd2, cumulative(raw), PALETTE["violet"], "words", milestones_in(milestones, wd2))

    cr = [r["cache_read_tokens"] for r in rows]
    cw = [r["cache_write_tokens"] for r in rows]
    ti = [r["input_tokens"] for r in rows]
    to = [r["output_tokens"] for r in rows]
    wd, (wcr, wcw, wti, wto) = trim_window(dates, cr, cw, ti, to)
    stacked_bar(os.path.join(OUT_DIR, "tokens_per_day.svg"),
                "Tokens per day", "AI token throughput (cache reads dominate, as expected)",
                wd,
                [("cache read", PALETTE["grid"], wcr),
                 ("cache write", PALETTE["bar2"], wcw),
                 ("input", PALETTE["amber"], wti),
                 ("output", PALETTE["accent"], wto)],
                "tokens / day", milestones_in(milestones, wd))

    # output tokens alone tell the "AI writing" story more cleanly
    wd, (wto,) = trim_window(dates, to)
    line_chart(os.path.join(OUT_DIR, "output_tokens_per_day.svg"),
               "AI output tokens per day (7-day average)", "smoothed; what the model actually wrote",
               wd, rolling(wto), PALETTE["accent"], "output tokens / day",
               milestones_in(milestones, wd), fill=True)

    phases_chart(os.path.join(OUT_DIR, "phases.svg"),
                 "Project phases",
                 f"{len(milestones)} initiatives in date order; bar = commits matching that initiative",
                 milestones, commits, dates[-1] if dates else "")

    # model token mix
    mix_rows = []
    for bucket in ("opus", "sonnet", "haiku"):
        tkm = tx["tokens_by_model"].get(bucket)
        if not tkm:
            continue
        total = tkm["in"] + tkm["out"] + tkm["cache_write"] + tkm["cache_read"]
        color = {"opus": PALETTE["violet"], "sonnet": PALETTE["bar"], "haiku": PALETTE["green"]}[bucket]
        mix_rows.append((bucket, total, color))
    if mix_rows:
        hbar_chart(os.path.join(OUT_DIR, "model_mix.svg"),
                   "Tokens by model tier", "total tokens (input + output + cache)", mix_rows)

    # top tools
    tool_rows = [(name, n, PALETTE["bar"]) for name, n in tx["tool_counter"].most_common(12)]
    if tool_rows:
        hbar_chart(os.path.join(OUT_DIR, "top_tools.svg"),
                   "Most-used tools", "tool calls across all sessions", tool_rows)

    write_index_html(summary)

    # ---- console summary ----
    g = summary["git"]; e = summary["your_effort"]; a = summary["ai_usage"]
    print("\n" + "=" * 62)
    print(f"  ResearchOS activity report  ({summary['date_range']['start']} -> {summary['date_range']['end']})")
    print("=" * 62)
    print(f"  Commits ............. {g['commits']:>10,}")
    print(f"  Net lines of code ... {g['net_lines']:>10,}   (+{g['lines_added']:,} / -{g['lines_deleted']:,})")
    print(f"  Files touched ....... {g['files_touched']:>10,}")
    print(f"  Prompts you typed ... {e['prompts_typed']:>10,}")
    print(f"  Words you typed ..... {e['words_typed']:>10,}   ({e['avg_words_per_prompt']} avg/prompt)")
    print(f"  Active days ......... {e['active_days']:>10,}   over {len(tx['sessions']):,} sessions")
    print(f"  AI messages ......... {a['assistant_messages']:>10,}")
    print(f"  Tool calls .......... {a['tool_calls']:>10,}")
    print(f"  Total tokens ........ {a['tokens']['total']:>10,}")
    print(f"     output tokens .... {a['tokens']['output']:>10,}")
    print(f"  List-price value .... ${cost_total:>9,.2f}   (notional; not what you paid on a plan)")
    print(f"  Phases detected ..... {len(milestones):>10,}")
    print("=" * 62)
    print(f"  CSV     -> {csv_path}")
    print(f"  JSON    -> {os.path.join(OUT_DIR, 'summary.json')}")
    print(f"  Charts  -> {OUT_DIR}/*.svg")
    print(f"  Viewer  -> open {os.path.join(OUT_DIR, 'index.html')}")
    print("=" * 62)


def write_index_html(summary):
    g = summary["git"]; e = summary["your_effort"]; a = summary["ai_usage"]
    charts = [
        "phases.svg", "commits_per_day.svg", "cumulative_loc.svg",
        "your_words_per_day.svg", "cumulative_words.svg",
        "output_tokens_per_day.svg", "tokens_per_day.svg",
        "model_mix.svg", "top_tools.svg",
    ]
    cards = [
        ("Commits", f"{g['commits']:,}"),
        ("Net lines of code", f"{g['net_lines']:,}"),
        ("Files touched", f"{g['files_touched']:,}"),
        ("Prompts you typed", f"{e['prompts_typed']:,}"),
        ("Words you typed", f"{e['words_typed']:,}"),
        ("Active days", f"{e['active_days']:,}"),
        ("Sessions", f"{e['sessions']:,}"),
        ("AI messages", f"{a['assistant_messages']:,}"),
        ("Tool calls", f"{a['tool_calls']:,}"),
        ("Total tokens", f"{a['tokens']['total']:,}"),
        ("List-price value", f"${a['estimated_cost_usd']:,.0f}"),
        ("Phases", f"{len(summary['milestones'])}"),
    ]
    rng = summary["date_range"]
    card_html = "\n".join(
        f'<div class="card"><div class="v">{html.escape(v)}</div>'
        f'<div class="k">{html.escape(k)}</div></div>' for k, v in cards
    )
    img_html = "\n".join(
        f'<figure><img src="{c}" alt="{c}"/></figure>' for c in charts
    )
    doc = f"""<!doctype html>
<html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>ResearchOS activity report</title>
<style>
  :root {{ color-scheme: light; }}
  body {{ margin:0; background:#f5f7fa; color:#1f2933;
         font-family: Inter, "Segoe UI", Helvetica, Arial, sans-serif; }}
  header {{ padding:28px 32px 8px; }}
  h1 {{ margin:0 0 4px; font-size:24px; }}
  .sub {{ color:#7b8794; font-size:13px; }}
  .grid {{ display:grid; grid-template-columns:repeat(auto-fit,minmax(150px,1fr));
           gap:12px; padding:16px 32px; }}
  .card {{ background:#fff; border:1px solid #e4e7eb; border-radius:10px;
           padding:14px 16px; }}
  .card .v {{ font-size:22px; font-weight:700; }}
  .card .k {{ font-size:12px; color:#7b8794; margin-top:2px; }}
  figure {{ margin:0; padding:14px 18px; background:#fff; border:1px solid #e4e7eb;
            border-radius:12px; }}
  .charts {{ display:grid; gap:18px; padding:16px 32px 48px; }}
  img {{ width:100%; height:auto; display:block; }}
  footer {{ padding:0 32px 40px; color:#9aa5b1; font-size:12px; }}
</style></head>
<body>
<header>
  <h1>ResearchOS activity report</h1>
  <div class="sub">{html.escape(str(rng['start']))} &rarr; {html.escape(str(rng['end']))}
    &middot; {rng['calendar_days']} calendar days
    &middot; SVG charts paste straight into slides</div>
</header>
<div class="grid">{card_html}</div>
<div class="charts">{img_html}</div>
<footer>Generated by scripts/activity-report/generate.py &middot;
  cost is a rough list-price estimate &middot; no message text is stored in any output.</footer>
</body></html>"""
    _write(os.path.join(OUT_DIR, "index.html"), doc)


if __name__ == "__main__":
    main()
