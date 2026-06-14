# BeakerBot — Summary Robustness + Deterministic Resolvers (session 7, 2026-06-14)

Lane: BeakerAI. All work on local `main`, **NOT pushed** (a push to origin is the
lab-tier launch trigger per `[[project_cloud_accounts_local_data]]`; these are
flag-free AI-tool changes, held with the rest of local `main` until launch).

## Why this happened

Grant asked BeakerBot to "summarize all my experiments over the last month and write
this up as a new note" and it **refused**. Diagnosis: both tools already existed
(`summarize_experiments` + `save_summary_as_note`) — nothing was missing. It refused
because of (a) a two-turn "offer to save" framing and (b) the no-interpretation rule
over-firing. Fixed with prompt changes, then Grant asked how to *prevent BeakerBot
getting stuck on complex filtered summaries* (projects, dates, keywords-in-body), and
selected a four-part safeguard set. He then liked the date-period idea and asked "what
other deterministic resolvers" — floating a grep-not-LLM idea for body text — and
picked all four follow-ups.

## The governing rule (the reusable idea)

**If the model would read N records and reason over them, replace it with a
deterministic function that does the work and hands back only the answer + capped
evidence.** Cheaper (fewer tokens), more reliable (no hallucinated counts/dates),
faster. Every piece below is an instance of this. The browser runtime has **no shell**,
so "grep" means a deterministic JS scan (`indexOf` / `RegExp`), not bash/awk/sed — the
instinct is right, the primitive is JS.

## Part 1 — Summary-robustness safeguards (4)

| Safeguard | Mechanism | Commit |
|---|---|---|
| **A. Never-stall** | `system-prompt.ts` rule: resolve each filter (project by name, member by name, period token, keyword straight through); use the wizard when ambiguous; if exactly one dimension can't be honored, run the closest summary and say what it scoped to — never refuse a doable summary | `24c9a7dfd` |
| **B. Project names in summary tools** | `resolveProjectRefsToIds(refs, projects)` in `artifact-index.ts`; `summarize_experiments` gained a `projects` arg (names OR ids), resolved in-tool | `26f91f12d` |
| **C. Deep note-body search + confirm-first** | `search_note_bodies` (later superseded — see Part 2.3). The safeguard Grant asked for: the model CONFIRMS the exact term/regex via `ask_user` BEFORE scanning (a body scan is broader/slower and the exact string matters) | `d6c515ded` |
| **D. Deterministic period resolver** | `periodToDateRange(period, today)` — `today`/`this_week`/`last_week`/`this_month`/`last_month`/`this_quarter`/`last_quarter`/`this_year`/`last_year`/`all_time` → exact inclusive `{since, until}`, **calendar** semantics (last_month in June = all of May). Wired a `period` param into `summarize_experiments/notes/purchases` (explicit since/until still wins per-bound) | `dd64afda6` |

## Part 2 — Deterministic resolvers, round 2 (4, Grant picked all)

| # | Resolver | Mechanism | Commit |
|---|---|---|---|
| **1** | Fuzzy matcher | `fuzzy-match.ts`: `editDistance` (Damerau-Levenshtein OSA — adjacent transposition = 1 edit) + `fuzzyResolve` (tiered: exact → token/prefix → small-typo within a length-relative budget). Shared layer so "Kritka"→"kritika", "cyp51"→"cyp51A knockout" resolve without the LLM guessing | `46af6a209` |
| **2** | Member-name resolver | `resolveOwnerRefsToUsernames(refs, usernames)` mirrors the project resolver for people. `summarize_experiments/notes/purchases` take `owners` by NAME (resolved in-tool; **keep raw if none resolve, never silently widen to the whole lab**). Also fuzzy-upgraded `resolveProjectRefsToIds` | `46af6a209` |
| **3** | `search_full_text` | The grep idea generalized. New `deep-text.ts` engine (`findFirst` / `countMatches` / `snippetAround` — "grep, do not feed the LLM the corpus"). Scans note bodies (in-memory) AND method protocol bodies (file-backed via `method.source_path`, read on demand = the stream-and-grep path). Returns per-record snippet + per-record `matches` + an accurate `totalMatches` (so "how many notes mention Sigma" is a real integer). `types` param narrows to `["note"]`/`["method"]`. Keeps the confirm-first safeguard. **SUPERSEDES `search_note_bodies`** | `4352cf7ee` |
| **4** | `list_records` | Deterministic top-N. Extracted `buildAllBriefs(deps)` from `searchMyWork` (shared fault-tolerant per-type brief build, zero behavior change) + new `listArtifacts({filter, sortBy, order, limit})` = build → `filterArtifacts` → sort by date/title asc/desc → cap, returning the full pre-cap `total` with the capped `items`. `list_records` tool wraps it with the same NL conveniences (period token, owner names, project names, status, keywords). So "my 5 most recent experiments" / "oldest open tasks" / "notes A-Z" are computed by the tool, never by the model ranking records in its head | `352d0e50b` |

## New / changed files

- **New:** `frontend/src/lib/ai/fuzzy-match.ts`, `frontend/src/lib/ai/deep-text.ts`,
  `frontend/src/lib/ai/tools/search-full-text.ts`,
  `frontend/src/lib/ai/tools/list-records.ts` (+ a test file each).
- **Changed:** `artifact-index.ts` (`resolveProjectRefsToIds` fuzzy upgrade,
  `resolveOwnerRefsToUsernames`, `periodToDateRange`, `buildAllBriefs` extraction,
  `listArtifacts`), `summarize-experiments.ts` / `summarize-notes.ts` /
  `summarize-purchases.ts` (period + owner-name resolution, `listMemberUsernames`
  dep), `tools/registry.ts`, `system-prompt.ts`.
- **Deleted:** `tools/search-note-bodies.ts` + its test (superseded by
  `search_full_text`; the deletion landed under phylo's commit `23299328b` due to a
  shared-index sweep — verified clean, do not re-commit it).

## Reusable seams the next tools should lean on

`fuzzyResolve` (name → key), `buildAllBriefs` (all-type briefs), the `deep-text`
engine (deterministic body scan), `periodToDateRange` (relative window → dates),
`resolveOwnerRefsToUsernames` / `resolveProjectRefsToIds` (name → username/id).

## State / verification

- ~170 AI-suite tests green (fuzzy 13, deep-text 14, search_full_text 14,
  list_records + listArtifacts 24, period 11, resolver additions ~21, plus the full
  summary suite). `tsc --noEmit` clean for all these files.
- The one standing `tsc` error project-wide is another lane's **uncommitted**
  `phylo/render.ts` (`unitsPerPx possibly null`) — not these files, do not touch.
- Commits: `24c9a7dfd`, `26f91f12d`, `d6c515ded`, `dd64afda6`, `46af6a209`,
  `4352cf7ee`, `352d0e50b`. `d6c515ded` reached origin via another session's `main`
  push; the rest are local-only.

## Not done / candidates

- A *full* NL summary planner was deliberately NOT built (brittle, overlaps the
  wizard + name resolution); the date-period slice is the high-value deterministic
  part of it.
- `list_records` sorts by date/title only; price-based "biggest purchases" still
  lives in the summarize tools' `largestItems` (briefs carry no amount).
- Body-search covers notes + methods; sequences (bases aren't prose) and thin tasks
  were skipped on purpose.
- ~~None of this is browser-verified with a live model yet~~ DONE. Grant ran all 7
  Chrome checks live against the seeded demo lab (2026-06-14):
  `docs/handoffs/CHROME_VERIFY_BEAKERBOT_RESOLVERS.md`. Result: **7/7, every hard
  guardrail intact** (no refusals on doable summaries, tool-owned counts/windows,
  name+fuzzy resolution, never-widen on unknown names, confirm-first body search,
  correct top-N ordering, zero interpretation). Two SOFT deviations, both on the
  graceful-degradation side (not safety):
    - **Check 4 (FIX QUEUED):** an unresolvable owner name ("Zxqv") returns a $0
      summary indistinguishable from a real-but-empty member. Root: when
      `resolveOwnerRefsToUsernames` returns [] the summarize tools fall back to
      filtering by the raw string (`resolvedOwners.length > 0 ? resolvedOwners :
      rawOwners`), which matches nobody. Never-widen held; the gap is signal. FIX
      (deferred, lands AFTER the record-set widget merges since it edits the same
      summarize-tool files): when refs were given but none resolved, return a
      distinct `unresolvedOwners` signal so the model says "no member named X" /
      asks, instead of rendering $0. Touches summarize-experiments/notes/purchases
      + list_records.
    - **Check 7 (FIXED `af5ea3d1c`):** an impossible dimension ("color tag" on
      experiments) was applied as a literal filter -> empty result, instead of
      degrading to the project-only summary. Tool can't know the dimension is
      impossible, so the fix is a system-prompt degrade rule (drop the one
      un-honorable dimension, run the closest doable summary, say what was ignored).
