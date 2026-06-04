# Activity report

A re-runnable snapshot of how ResearchOS was built, mined from two local data
sources, for talks and decks about the project.

```bash
python3 scripts/activity-report/generate.py
open scripts/activity-report/out/index.html
```

No dependencies (stdlib only, no pip, no venv). Charts come out as SVG, which
pastes into PowerPoint, Keynote, and Google Slides as crisp recolorable vectors.

## What it reads

1. **git history** of this repo (commits, lines added/deleted, files touched, phases).
2. **Claude Code transcripts** for this project, at
   `~/.claude/projects/<repo-path-with-slashes-as-dashes>/*.jsonl` (your typed
   prompts and words, AI messages, tokens, tool calls, web searches).

Both are local to your machine, so the report works offline and reflects only
your own activity.

## What it writes (into `out/`, git-ignored)

- `index.html` -- a one-page viewer with summary cards and every chart.
- `summary.json` -- all the totals, machine-readable.
- `timeline.csv` -- one row per calendar day, every metric, for your own charts.
- nine `*.svg` charts: project phases, commits per day, cumulative lines of code,
  words you typed per day, cumulative words, AI output tokens, tokens per day,
  tokens by model tier, most-used tools.

## How the numbers are defined (read before quoting them)

- **Words you typed** counts only prompts a human wrote into chat. It excludes
  tool results, `<task-notification>` and other harness injections, sub-agent
  dispatch prompts that begin "From the orchestrator", and compaction
  continuation summaries. Messages are de-duplicated by uuid so resumed sessions
  do not double count.
- **Lines of code** excludes committed dependencies (`node_modules/`), generated
  installer artifacts, lockfiles, vendored license dumps, and minified bundles,
  so the figure tracks authored source. Commit *count* is never filtered. Edit
  `EXCLUDE_PATH_RX` in `generate.py` to change this.
- **Phases** are detected by matching commit subjects against the patterns in
  `MILESTONES`. Each phase's date is its first matching commit. The bar on the
  roadmap is the number of commits whose subject matches that initiative, so
  parallel initiatives are each credited fairly (they are not carved into
  non-overlapping time windows). A commit can match more than one phase. Edit
  `MILESTONES` to add, rename, or reorder initiatives.
- **Tokens** are summed from each assistant message's usage. Cache reads
  dominate the total, which is expected for long agent sessions.
- **List-price value** is a rough estimate at public list prices (`PRICING` in
  `generate.py`), not what you actually paid on a plan. Treat it as a notional
  "this much model usage at retail" figure.

## Tuning

Everything tweakable lives in the config block at the top of `generate.py`:
`PRICING`, `MILESTONES`, `EXCLUDE_PATH_RX`, and the injected-message prefixes.

Re-run any time. The report regenerates from scratch in a couple of seconds.

-- activity tracker
