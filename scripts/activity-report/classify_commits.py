#!/usr/bin/env python3
"""Classify every git commit into a feature bucket using conventional-commit scopes.

No API key needed. Parses feat(scope): / fix(scope): prefixes, falls back to
keyword matching for commits that don't follow the convention.

Usage:
    python3 scripts/activity-report/classify_commits.py

Writes: scripts/activity-report/commit-map.json
Re-running is safe -- only unclassified commits are re-processed.
"""

from __future__ import annotations

import json
import re
import subprocess
from collections import Counter
from pathlib import Path

# --------------------------------------------------------------------------- #
# Scope -> feature label map
# Edit this to add new initiatives or rename labels.
# --------------------------------------------------------------------------- #

SCOPE_MAP = {
    # Sequence editor
    "sequences":        "Sequence editor",
    "sequence":         "Sequence editor",
    "seqviz":           "Sequence editor",
    "ove":              "Sequence editor",
    "aligner":          "Sequence editor",
    "primer":           "Sequence editor",
    "cloning":          "Sequence editor",
    "molbio":           "Sequence editor",

    # Sharing / collab
    "sharing":          "Cross-boundary sharing",
    "cross-boundary":   "Cross-boundary sharing",
    "relay":            "Cross-boundary sharing",
    "directory":        "Cross-boundary sharing",
    "external-collab":  "Cross-boundary sharing",

    # Real-time collab (notes / experiments)
    "collab":           "Real-time collab",
    "loro":             "Real-time collab (Loro/notes)",
    "unified-model":    "Real-time collab (Loro/notes)",
    "vc":               "Version control",

    # Dark mode / theming
    "theme":            "Dark mode",
    "dark-mode":        "Dark mode",
    "dark":             "Dark mode",

    # Welcome / landing page
    "welcome":          "Welcome / landing page",
    "welcome-preview":  "Welcome / landing page",
    "landing":          "Welcome / landing page",

    # Auth / identity / passkeys
    "auth":             "Auth / identity",
    "identity":         "Auth / identity",
    "passkey":          "Auth / identity",
    "login":            "Auth / identity",
    "profile":          "Auth / identity",
    "password":         "Auth / identity",

    # Onboarding tour
    "onboarding":       "Onboarding tour",
    "onboarding-v4":    "Onboarding tour",
    "tour":             "Onboarding tour",
    "walkthrough":      "Onboarding tour",

    # Method / kit templates
    "templates":        "Method / kit templates",
    "template":         "Method / kit templates",
    "method-catalog":   "Method / kit templates",
    "kit":              "Method / kit templates",
    "lcms":             "LC-MS templates",
    "lc-ms":            "LC-MS templates",
    "mass-spec":        "LC-MS templates",
    "pcr":              "Method / kit templates",
    "notebooks":        "Notebooks",

    # Photo annotation
    "annotations":      "Photo annotation",
    "annotation":       "Photo annotation",

    # NIH / Zenodo
    "zenodo":           "NIH sharing / Zenodo",
    "nih":              "NIH sharing / Zenodo",
    "figshare":         "NIH sharing / Zenodo",

    # Billing / business
    "billing":          "Metered storage / billing",
    "stripe":           "Metered storage / billing",
    "storage-budget":   "Metered storage / billing",
    "llc":              "LLC / business ops",
    "business":         "LLC / business ops",
    "admin":            "Admin / analytics",
    "metrics":          "Admin / analytics",

    # Storage migration
    "d1":               "Storage migration (D1/DO)",
    "do":               "Storage migration (D1/DO)",
    "durable-objects":  "Storage migration (D1/DO)",
    "migration":        "Storage migration (D1/DO)",

    # Gamification
    "streak":           "Gamification / streaks",
    "gamif":            "Gamification / streaks",
    "badge":            "Gamification / streaks",

    # Transparency / OSS credits
    "transparency":     "Transparency / OSS credits",
    "credits":          "Transparency / OSS credits",
    "open-source":      "Transparency / OSS credits",

    # Brand / design
    "brand":            "Brand / design",
    "beakerbot":        "Brand / design",
    "typography":       "Typography system",
    "type-scale":       "Typography system",

    # Wiki / docs
    "wiki":             "Wiki / docs",
    "docs":             "Wiki / docs",
    "roadmap":          "Wiki / docs",
    "handoff":          "Wiki / docs",

    # Settings / UI polish
    "settings":         "Settings / UI",
    "ui":               "Bug fix / polish",
    "ux":               "Bug fix / polish",

    # Demo / screenshots
    "demo":             "Demo / screenshots",
    "screenshots":      "Demo / screenshots",
    "wikishots":        "Demo / screenshots",

    # Infra / chore
    "deps":             "Chore / deps / config",
    "ci":               "Chore / deps / config",
    "config":           "Chore / deps / config",
    "chore":            "Chore / deps / config",
    "infra":            "Chore / deps / config",
    "vercel":           "Chore / deps / config",
    "gitignore":        "Chore / deps / config",

    # Proposal docs
    "proposal":         "Wiki / docs",
    "proposals":        "Wiki / docs",

    # Spike / research
    "spike":            "Research / spike",
    "research":         "Research / spike",

    # Method catalog / templates
    "methods":          "Method / kit templates",
    "method":           "Method / kit templates",
    "catalog":          "Method / kit templates",

    # ELN / LabArchives import
    "eln":              "ELN import (LabArchives)",
    "labarchives":      "ELN import (LabArchives)",
    "lab-archives":     "ELN import (LabArchives)",

    # Telegram
    "telegram":         "Telegram integration",

    # Calendar
    "calendar":         "Calendar / scheduling",

    # AI helper
    "ai-helper":        "AI helper",
    "ai":               "AI helper",

    # Tasks / experiments
    "tasks":            "Tasks / experiments",
    "task":             "Tasks / experiments",
    "experiments":      "Tasks / experiments",
    "experiment":       "Tasks / experiments",
    "workbench":        "Tasks / experiments",

    # Notes
    "notes":            "Notes editor",
    "note":             "Notes editor",
    "hybrid-editor":    "Notes editor",
    "hybrid":           "Notes editor",

    # Folder / file system
    "folder":           "Folder / file system",
    "files":            "Folder / file system",
    "file":             "Folder / file system",
    "r2":               "Storage migration (D1/DO)",

    # Search
    "search":           "Search",

    # Feedback / misc
    "feedback":         "Bug fix / polish",
}

# Fallback: keyword match against full commit subject when no scope is found
KEYWORD_MAP = [
    (r"sequence|seqviz|\bove\b|aligner|primer|cloning|molbio",  "Sequence editor"),
    (r"loro|crdt|unified.model|version.control|\bvc\b|vc phase", "Real-time collab (Loro/notes)"),
    (r"collab|relay|websocket|durable.object",                   "Real-time collab"),
    (r"cross.?boundary|sharing|zenodo|figshare",                 "Cross-boundary sharing"),
    (r"dark.mode|theming|\btheme\b",                             "Dark mode"),
    (r"welcome|landing.page",                                    "Welcome / landing page"),
    (r"onboard|walkthrough|\btour\b",                            "Onboarding tour"),
    (r"kit.template|method.catalog|template.library|lcms|lc-ms", "Method / kit templates"),
    (r"annotat",                                                  "Photo annotation"),
    (r"passkey|webauthn|identity",                               "Auth / identity"),
    (r"billing|stripe|metered",                                  "Metered storage / billing"),
    (r"d1.migration|durable.objects|r2.storage",                 "Storage migration (D1/DO)"),
    (r"gamif|streak|\bbadge\b",                                  "Gamification / streaks"),
    (r"typograph|text-meta|type.scale",                          "Typography system"),
    (r"transparency|oss.credit",                                 "Transparency / OSS credits"),
    (r"beakerbot|\bbrand\b",                                     "Brand / design"),
    (r"\bwiki\b|wiki.page",                                      "Wiki / docs"),
    (r"notebook",                                                 "Notebooks"),
    (r"\badmin\b|analytics|metrics",                             "Admin / analytics"),
    (r"installer|electron|cross.?platform|onedrive",             "Early desktop app (Kilo era)"),
    (r"vercel.migration",                                        "Vercel web migration"),
    (r"labarchives|lab.?archives|\beln\b",                       "ELN import (LabArchives)"),
    (r"telegram",                                                "Telegram integration"),
    (r"calendar|scheduling",                                     "Calendar / scheduling"),
    (r"ai.helper|ai_helper",                                     "AI helper"),
    (r"agents\.md|handoff|sub.?bot|orchestrat",                  "Wiki / docs"),
    (r"hybrid.?editor|hybridmarkdown|hybrid.markdown",           "Notes editor"),
    (r"TaskDetailPopup|task.detail|experiment.collab",           "Tasks / experiments"),
    (r"\bwavefunc|showcase|wave\b",                              "Welcome / landing page"),
    (r"demo.data|demo.mode|fixture",                             "Demo / screenshots"),
    (r"\bhmmer\b|\bwasm\b|bioinf",                               "Sequence editor"),
    (r"method.card|kit.card|protocol",                           "Method / kit templates"),
    (r"\bfolder.pick|folder.recov|file.system|folder.gate",      "Folder / file system"),
    (r"\bsearch\b|search.index|search.result",                   "Search"),
    (r"cherry.pick|merge.from|AGENTS\.md",                       "Wiki / docs"),
    (r"r2.storage|r2.bucket|cloudflare.r2",                      "Storage migration (D1/DO)"),
]

# Kilo-era heuristic: commits before the Vercel migration
KILO_CUTOFF = "2026-05-01"

REPO_ROOT = Path(
    subprocess.check_output(["git", "rev-parse", "--show-toplevel"], text=True).strip()
)
MAP_PATH = REPO_ROOT / "scripts/activity-report/commit-map.json"

CONV_RX = re.compile(r"^\w+\(([^)]+)\)\s*:")


def load_map() -> dict:
    if MAP_PATH.exists():
        return json.loads(MAP_PATH.read_text())
    return {}


def save_map(m: dict) -> None:
    MAP_PATH.write_text(json.dumps(m, indent=2) + "\n")


def all_commits() -> list[tuple[str, str, str]]:
    """Return [(sha, date, subject), ...] chronological."""
    raw = subprocess.check_output(
        ["git", "log", "--no-merges", "--format=%H|%as|%s"],
        cwd=REPO_ROOT, text=True, errors="ignore",
    ).strip()
    pairs = []
    for line in raw.splitlines():
        sha, _, rest = line.partition("|")
        day, _, subject = rest.partition("|")
        pairs.append((sha.strip(), day.strip(), subject.strip()))
    pairs.reverse()
    return pairs


def classify(sha: str, day: str, subject: str) -> str:
    # 1. Conventional commit scope
    m = CONV_RX.match(subject)
    if m:
        scope = m.group(1).lower().strip()
        if scope in SCOPE_MAP:
            return SCOPE_MAP[scope]

    # 2. Keyword fallback
    for pat, label in KEYWORD_MAP:
        if re.search(pat, subject, re.I):
            return label

    # 3. Early-era heuristic
    if day < KILO_CUTOFF:
        return "Early desktop app (Kilo era)"

    return "Bug fix / polish"


def main():
    commit_map = load_map()
    commits = all_commits()

    unclassified = [(sha, day, subj) for sha, day, subj in commits if sha not in commit_map]

    if not unclassified:
        print(f"All {len(commits)} commits already classified.")
    else:
        print(f"Classifying {len(unclassified)} commits (scope parsing, no API)...")
        for sha, day, subj in unclassified:
            commit_map[sha] = classify(sha, day, subj)
        save_map(commit_map)
        print(f"Done. Map saved to {MAP_PATH}")

    # Distribution summary
    counts = Counter(commit_map.values())
    total = sum(counts.values())
    print(f"\nFeature distribution ({total} commits):")
    for label, n in counts.most_common():
        bar = "█" * (n * 30 // (counts.most_common(1)[0][1] or 1))
        print(f"  {n:4d}  {bar:<30}  {label}")


if __name__ == "__main__":
    main()
