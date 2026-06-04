# Activity report

A re-runnable snapshot of how ResearchOS was built, mined from local data
sources, for talks and decks about the project. It covers both AI tools used on
the project: Kilo Code in the early phase (Feb-Mar), then Claude Code (May-Jun).

```bash
# one time, and any time you want to refresh the early-phase numbers:
python3 scripts/activity-report/snapshot_kilo.py
# every run:
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
3. **Kilo Code history** via `kilo_snapshot.json`, produced by `snapshot_kilo.py`
   from the VS Code extension's local storage (`state.vscdb` task index +
   `tasks/<id>/ui_messages.json`). Tasks are filtered to this repo by exact
   workspace path.

Everything is local to your machine, so the report works offline and reflects
only your own activity.

## Kilo snapshot

Kilo Code can prune old tasks, so `snapshot_kilo.py` copies the numbers we need
into `kilo_snapshot.json` (git-ignored). The snapshot holds **aggregates only**:
per-day token counts, word counts, prompt counts, and cost. It never stores
prompt text or research content, so it is safe to keep or commit. `generate.py`
reads it if present and silently skips the Kilo phase if it is missing. Re-run
the snapshot whenever you want to capture more recent Kilo activity.

## What it writes (into `out/`, git-ignored)

- `index.html` -- a one-page viewer with summary cards and every chart.
- `summary.json` -- all the totals, machine-readable.
- `timeline.csv` -- one row per calendar day, every metric (including per-tool
  `kilo_*` and `claude_*` columns), for your own charts.
- eleven `*.svg` charts: project phases, AI requests per day (the tool handoff),
  commits per day, cumulative lines of code, words you typed per day, cumulative
  words, AI output tokens per day, tokens per day by type, tokens by tool, cost
  by tool, most-used tools. Charts that split by tool color Kilo Code amber and
  Claude Code blue.

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
- **Words you typed (Kilo)** come from each task's first prompt plus every
  `user_feedback` message, with auto-injected file dumps and environment details
  stripped before counting.
- **Tokens** are summed from each assistant message's usage (Claude) and from the
  authoritative per-task `taskHistory` totals (Kilo). Cache reads dominate the
  total, which is expected for long agent sessions.
- **Cost is not one number.** Kilo Code is **real pay-per-token spend** (from its
  own reported `totalCost`). Claude Code is a **notional list-price estimate**
  (`PRICING` in `generate.py`), not what you paid on a subscription. The two are
  shown separately and never summed, because they are different kinds of figure.

## Tuning

Everything tweakable lives in the config block at the top of `generate.py`:
`PRICING`, `MILESTONES`, `EXCLUDE_PATH_RX`, and the injected-message prefixes.

Re-run any time. The report regenerates from scratch in a couple of seconds.

-- activity tracker
