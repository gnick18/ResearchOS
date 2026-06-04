# Sequence / Plasmid Editor Handoff — 2026-06-04

You are inheriting the **sequence-editor master session**. Grant is moving to a fresh cloud
subscription and handing this chat off to you mid-stream. This doc is your full briefing so you
pick up exactly where the previous session (the "primer redesign master") left off. Read it end to
end before touching anything.

There are three concurrent worker chats being handed off at the same time: this one (the sequence /
plasmid editor), the **sharing worker**, and the **Wiki Update worker**. Each writes its own
inheritor file. Stay in your lane (the SnapGene-style sequence editor) unless Grant redirects you.

---

## 1. Identity + posture

You are Grant Nickles's master orchestrator clone for the ResearchOS sequence editor. The standing
master-bot rules apply (these are non-negotiable and Grant flags violations):

- **Sign messages and commits** with your role (use `sequence editor master` or similar) so the
  audit trail stays traceable across the worker chats.
- **No em-dashes** in anything you write (prose, commits, copy, briefs). Use commas, parens, period
  splits.
- **No mid-sentence colons** to introduce a clause or list (both `One example:` and `everything: x,
  y, z`). Recast with a comma or a period split. Label-terminators at line start (`Goal:`) are fine.
- **No emojis in production UI** ever. Every user-facing icon is a hand-written inline SVG (mirror
  the `StreakBadge` / `AppShell` pattern). The project does not depend on lucide-react.
- **Use the `<Tooltip>` component** (`components/Tooltip.tsx`), never native `title=` (it is
  functionally invisible in this app).
- **Manager-bot autonomy:** spawn well-scoped sub-bots without asking. Only direction / destructive
  / data-shape decisions need Grant's eye.
- **Full AGENTS.md power:** edit + commit + merge AGENTS.md without asking. Add a runbook line when
  you learn something durable.
- **Merge to local main as work progresses.** UI-only work merges on report so Grant can debug the
  UI live. Backend / data-shape / migration work waits for verification first.
- **Do not push to origin.** Grant pushes when he wants. His dev server runs from local `main`.

Read the auto-memory index for the rest of the standing rules:

```
/Users/gnickles/.claude/projects/-Users-gnickles-Desktop-ResearchOS/memory/MEMORY.md
```

And read `AGENTS.md` in full (repo root). Sections 4 (conventions), 6 (traps), 7 (recent work).

---

## 2. What this session has been

A long, screenshot-driven polish of the **SnapGene-style sequence / plasmid editor** (the
`/sequences` route). The viewer is a **vendored fork of SeqViz** living under
`frontend/src/vendor/seqviz/`, driven by `components/sequences/SequenceEditView.tsx`. Pure helpers
(selection math, primer layout, alignment, Tm, GC) live under `lib/sequences/` and `lib/align/` and
are strict-typed + unit-tested with golden values from Biopython.

The session acts as the master orchestrator: it dispatches sub-bots into isolated git worktrees,
cherry-picks their work onto local `main` with `-x`, verifies (`tsc`, vitest), and cleans up. But a
lot of the recent fine-tuning was done directly on `main` because it needed live visual iteration
against Grant's running dev server.

---

## 3. Where things stand RIGHT NOW (the live thread)

The active arc just finished is the **primer base-render redesign** (making primers look like
SnapGene's). Grant's last words were **"ya this looks better now"** — so it is APPROVED and landed.
Top of `main` is `b503a7a1`.

What the primer render now does (zoomed in, base-level):

- The **annealing region** is a solid near-black box (`boxFill = #0a0a0a`) with a thick colored
  border (`borderW = 3`) in the primer's own color, the bases inside rendered in bright **yellow**
  (`baseColor = #fde047`) so they pop on the dark fill. Mismatches render red-400.
- The **5' tail** (cloning overhang) is a second box raised one row off the template, abutting the
  annealing box at the 5' corner.
- A **3' arrowhead** with a SnapGene-style "pull back": a swept barb that overhangs BACK over the
  shaft (`barbBack`) then sweeps to the tip (`headLen` reach, `barbRise` height). NOT a plain
  triangle. The body stays a full rectangle so the last base is never clipped.
- The **name label** sits in its own lane, clear above (forward) / below (reverse) the boxes.
- Zoomed OUT it falls back to the original thin bracket + arrow, byte-identical to before.

All the proportion knobs are named constants at the top of the primer element in
`frontend/src/vendor/seqviz/Linear/Primers.tsx` (`baseColor`, `boxFill`, `borderW`, `headLen`,
`barbRise`, `barbBack`). Grant tuned these live, so expect more nudges.

The **circular** map primers are still simple radial markers (no base-level boxes). They DO have the
hover info card now (coords / length / %GC / Tm). Base-level boxes on the ring were not requested.

---

## 4. The primer-render architecture (READ before touching primers)

Four files must stay in sync. Change one without the others and you get clipping or a crash:

1. `lib/sequences/primer-base-layout.ts` — PURE layout math. `layoutPrimerBases(oligo, site)` maps
   an oligo onto forward template columns, returning per-base cells with a `role` (anneal / mismatch
   / tail) and a 0-based forward `column`, plus `tailLength`. Strict + unit-tested.
2. `vendor/seqviz/Linear/Primers.tsx` — the SVG render. Reads `element.baseCells` + `element
   .tailLength`. Builds the boxes / arrowhead / bases / label. Gated on `zoomed && charWidth > 4 &&
   baseCells present`.
3. `vendor/seqviz/Linear/SeqBlock.tsx` — `primerRowHeight(zoomed, hasTail, seqFontSize, charWidth,
   elementHeight)` sizes EACH primer row taller in the base view, with a second box-lane when the
   track has a tailed primer, plus barb headroom. `primerRowsHaveTail()` detects the tail. SeqBlock
   lays out the strands with these heights.
4. `vendor/seqviz/Linear/Linear.tsx` — `blockHeight` must add the SAME `primerRowHeight` per block
   so stacked blocks never clip.

How a primer gets its bases (in `SequenceEditView.tsx`, the `primers` useMemo):

- If the primer_bind feature has a stored oligo note (`/note "primer <SEQ>"`, read by
  `readPrimerSeq`), `derivePrimerSite` searches the template for where it anneals (recovers the 5'
  tail + mismatches) and `layoutPrimerBases` lays it out.
- If NOT (the common case for imported / region-only primers), the code synthesizes the oligo from
  the template over the recorded binding span (reverse-complemented for a reverse primer) and PINS
  the BindingSite directly to `[lo, hi)` (no search, so a short / repeated region can't make the
  bases land on a duplicate elsewhere). Clean full-length annealer, no tail.

Primer color is stored on the primer_bind feature the same way features store color
(`feature.color` -> `ApEinfo_fwdcolor` / `ApEinfo_revcolor` notes). The color picker drives the
border / arrowhead / name; the yellow bases + dark fill are fixed for contrast.

### Current tuned constant values (as of 2026-06-04, Grant-approved)

These are the named constants in `Primers.tsx` (the primer element) and `SeqBlock.tsx`, with their
approved values, so you can reason about or restore them without re-deriving:

- `baseColor = "#fde047"` (yellow-300, the base glyphs on the dark body)
- `mismatchColor = "#f87171"` (red-400, a mismatch base, still readable on dark)
- `boxFill = "#0a0a0a"` (near-black primer body; pure `#000000` if Grant wants it blacker)
- `borderW = 3` (colored outline thickness; NOTE it must not use `style={annotation}`, which would
  force it back to 0.5)
- `boxH = baseFontSize + 6` (one base box height, `baseFontSize = min(seqFontSize, charWidth/0.62)`)
- `strandMargin = 3` (gap between the annealing box and the strand it hugs)
- `headLen = min(charWidth * 1.25, baseFontSize * 1.7)` (3' arrowhead forward reach)
- `barbRise = boxH * 0.85` (how tall the pulled-back barb rises off the body)
- `barbBack = headLen * 0.55` (how far the barb overhangs BACK over the shaft, the "pull back")
- `SeqBlock.primerRowHeight = round(label + barb + box * (hasTail ? 2 : 1) + 5)`, where
  `label = seqFontSize + 4`, `box = baseFontSize + 6`, `barb = round(box * 0.85)`. The `barb` term
  reserves headroom for the arrowhead so it never crowds the name label. If you change `barbRise`
  in `Primers.tsx`, change the `0.85` here to match or the barb will clip / float.

Full layout math (`layoutPrimerBases`) is covered by `primer-base-layout.test.ts` (13 cases,
forward / reverse / tail / mismatch / guards). The whole sequences + align + calculators suite is
1030 tests green as of this handoff.

---

## 5. Traps that already bit this session (do not repeat)

- **`@ts-nocheck` on the vendored seqviz files.** `Primers.tsx`, `SeqBlock.tsx`, `Linear.tsx`,
  `Circular.tsx` all start with `// @ts-nocheck`. **`tsc --noEmit` will NOT catch an undefined
  variable or an out-of-scope reference in these files.** One such slip (`seqFontSize` not in
  `Linear.render`'s destructure) compiled clean and then crashed the ENTIRE SeqViz viewer at runtime
  via its error boundary. After editing a vendored file, grep the render scope for every new
  identifier you reference and confirm it is actually defined / destructured. tsc-clean is NOT a
  real check here.
- **The shared `annotation` style** (`vendor/seqviz/style.ts`) forces `fillOpacity: 0.7` AND
  `strokeWidth: 0.5`. Inline `style=` beats SVG presentation attributes, so applying `style={
  annotation}` silently grays out any fill and overrides any border width. The primer base shapes
  deliberately do NOT use it (solid fill + real border instead).
- **Never start a second `next dev` against the main `frontend/`.** Grant's dev server owns `:3000`
  and the shared `.next` Turbopack cache. A second server corrupts it. Never `rm -rf .next` in the
  live checkout either. (Fix if it does corrupt: `rm -rf frontend/.next` only when Grant's server is
  stopped.)
- **Run vitest / tsc from `frontend/`**, not the repo root (the `@` alias lives in
  `frontend/vitest.config.mts`; running from root makes every test fail to transform).
- **Golden test expected values come from Biopython, never from our own code.** The alignment / HSP
  finder (`lib/align/local-homology.ts`) and Tm helpers have `gen-*-golden.py` generators committed.
- **Worktree separation across the three workers.** `~/Desktop/ResearchOS` = `main` (Grant's dev
  server). The sharing worker uses `~/Desktop/ResearchOS-sharing` and `~/Desktop/ResearchOS-invite`.
  Gate every cherry-pick on `branch == main` before you land it. Other sessions flip main / commit
  to main, so confirm you are on main and only `git add` your own explicit files (never `git add
  -A`, which sweeps another session's working-tree changes into your commit).

---

## 6. Sub-bot orchestration (how this session dispatches work)

- `git worktree add .claude/worktrees/<name> -b claude/<name> main`, then COW-clone node_modules
  into it: `cp -c -R frontend/node_modules <worktree>/frontend/node_modules` (NEVER symlink, it
  breaks Turbopack / next dev). Same for the root node_modules if needed.
- Brief the bot **worktree-first**: it must `git worktree add` + `cd` into the worktree BEFORE
  reading or editing any file. It must NOT read / edit the bare `frontend/...` main checkout.
- Bots COMMIT before reporting. The master integrates via `git cherry-pick -x <sha>` onto `main`,
  verifies (`tsc`, vitest), then removes the worktree + branch.
- Per-bot background watcher pattern: poll `git rev-parse refs/heads/claude/<branch>` vs the base,
  exit on first new commit or a ~30-min timeout. Wait for the branch to EXIST first (`git rev-parse
  --verify --quiet`) before capturing the base hash, or the watcher false-fires.
- Flag data-shape touches (sidecar.ts, new fields, new paths) BEFORE committing, in advance.

---

## 7. Open / possible next threads (nothing committed-to)

- **Primer proportions** may get more live nudges (the named constants in `Primers.tsx`). Grant
  tunes by eye against `:3000`.
- **Circular primer base-level render** — only radial markers + hover card today. Base boxes on the
  ring were never requested; do not build speculatively.
- **Yjs / real-time collaboration** (Grant raised this as a separate initiative, NOT started). His
  framing: `InlineMarkdownEditor.tsx` owns its own undo history and a strict value-in / value-out
  contract; Yjs wants to own the document and its own undo, so they fight. Collab therefore needs a
  distinct "collaborate mode" in the editor where Yjs is the source of truth, not a flag on the
  existing path. That refactor is the main schedule risk. A stale spike lived at `spikes/collab-yjs`
  (deleted on the old `agents-handoff-jun2` branch). If Grant picks this up: design doc FIRST, it is
  a load-bearing editor.
- **Sequence editor backlog** otherwise lives in the proposal docs under `docs/` and AGENTS.md
  section 8.

---

## 8. Verify-before-you-claim (this session's hard lesson)

This session shipped a runtime crash because it trusted a clean `tsc` on a `@ts-nocheck` file, and
shipped two primer iterations Grant called "awful" / "still looks bad." Grant cannot screenshot his
real plasmid for you (it is unpublished research data, privacy rule: fixture mode only, never real
data). So:

- You are largely flying blind on the visual result. Grant is your eyes. Make ONE coherent change,
  state the tunable knobs, and ask him to reload and look. Do not stack three unverified visual
  guesses.
- For vendored-file edits, manually audit variable scope (see trap #1) before saying it is done.
  There is now a render-level guard for this: `vendor/seqviz/Linear/Primers.render.test.tsx` mounts
  the `Linear` viewer with a primer at base zoom, so a render-path crash (the `seqFontSize` class of
  bug) fails the suite even though tsc cannot see it. It was verified to bite by reintroducing the
  original bug. Extend it when you touch the primer render.
- The demo data (`frontend/public/demo-data/`) is task / note JSON, NOT sequence files, so there is
  no easy fixture plasmid with primers to self-screenshot. Plan around that.

---

## 9. Quick start for the inheritor

1. Read this file, `AGENTS.md`, and the memory index.
2. `cd /Users/gnickles/Desktop/ResearchOS && git rev-parse --abbrev-ref HEAD` (should be `main`),
   `git log --oneline -8` to see the latest landed work.
3. Confirm Grant's dev server is up (`curl -s -o /dev/null -w "%{http_code}" http://localhost:3000`).
   If not, Grant starts it; you never start a second one.
4. Ask Grant what he wants next. He drives. Recent cadence is tight, screenshot-led polish of the
   sequence editor.

Top of main at handoff: `b503a7a1` (primer redesign approved).
