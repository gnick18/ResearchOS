# Handoff — Icon picker favorites/recents tray + synonym expansion + empty-state

**Date:** 2026-06-15 (Figure Composer lane, smart-search backlog)
**Memory:** `[[project_bioart_icon_library]]`
**Branch:** `figure-icon-favorites` (off `origin/main` @ `af34dc855`, ff-able, **NOT pushed**)
**Commits:** `90233bca0` (favorites/recents + synonyms), `db620a1bb` (empty state)

## What this is

Three smart-search backlog items from the prior handoff
(`2026-06-15-smart-icon-search-and-page-boot-loader.md`, open item #2 + #5), built
on top of the now-live smart-search merge. Keyword + UI layer only — **no vector
or manifest regen, so zero coupling with INJEST.**

## Built

1. **Recent + favorite icon tray.** New pure module
   `frontend/src/lib/figure/asset-recents.ts` — localStorage-backed, fails soft on
   SSR / privacy-mode (never breaks an insert). Pure reducers `pushRecent` (dedup,
   cap 24) + `toggleFavorite` (cap 100) are unit-tested with no DOM. The picker
   (`FigureLeftRail` IconsPanel) now:
   - records every insert (click **and** drag) as recent,
   - shows a compact horizontal **"Recent & favorites"** tray while browsing (no
     query), favorites first then recents, resolved against the live manifest so a
     removed asset just drops out,
   - puts a **star toggle** on each grid tile (always shown once starred, on hover
     otherwise; uses the registry `star` glyph, amber when on — no inline svg).

2. **Expanded synonym map** (`asset-search.ts` `SYNONYM_GROUPS`): ~35 curated
   lab-equipment / technique / cell-biology / anatomy / organism groups
   (centrifuge·rotor, pcr·thermocycler, gel·western blot, crispr·cas9,
   blood·erythrocyte, etc.) for better near-miss keyword recall before the
   semantic layer is invoked.

3. **Actionable empty state.** Zero-result view replaced the dead-end "Nothing
   here" with: clear-category-filter, "Try Smart search" (when the flag is on +
   smart is off), and a "Browse the full library ↗" link. The **AI-generate**
   fallback from the backlog is deliberately deferred — needs a Grant product
   decision on the generate destination.

## Verification done

- `vitest run` on `asset-recents.test.ts` + `asset-search.test.ts`: **23 pass.**
- `tsc --noEmit`: the three touched files (`asset-recents.ts`, `asset-search.ts`,
  `FigureLeftRail.tsx`) are **clean**. (The only tsc error in the worktree is
  `@xenova/transformers` unresolved — an artifact of dep-symlinking the main
  checkout's older `node_modules`; the dep is in `package.json` and resolves on a
  real `pnpm install`.)

## Verify next (live, folder-backed — Chrome, not synthetic preview)

Open `/figures`, Icons panel:
1. Insert a few icons (click + drag) → they appear in the "Recent & favorites"
   tray when the search box is empty; reload → tray persists (localStorage).
2. Hover a grid tile → star appears; click it → tile gets an amber star and the
   icon shows in the tray as a favorite; click again to unstar.
3. Search a gibberish term → empty state offers the full-library link (+ "Search
   all categories" if a category was selected; + "Try Smart search" if the flag
   is on).
4. Spot-check a new synonym, e.g. "centrifuge" or "pcr" finds relevant icons.

## ⚠️ SMART-SEARCH GO-LIVE BLOCKER FOUND (live prod, 2026-06-15)

Drove the in-browser "Smart ranks" check on prod (`research-os.app/demo` → `/figures`,
Chrome MCP). **The keyword (C) layer is LIVE and working** (the Smart toggle renders =
flag is on; "tiny swimming microbe" returned 90/14559 results). **The opt-in semantic
(A) layer is BROKEN on prod** — toggling Smart drops the BeakerBot loader into its error
state ("Something went wrong loading this page", step = "Loading the smart-search model").

Root cause (extracted from the swallowed `BootState.error` via React fiber walk):
```
TypeError: Cannot convert undefined or null to object
    at Object.keys (<anonymous>)
    at module evaluation (…/_next/static/chunks/e542494e8f278029.js)
    at q (…/turbopack-…js)   ← Turbopack module loader
```
`import("@xenova/transformers")` **throws at module-evaluation** under the **Turbopack**
production bundle (an `Object.keys(undefined)` in the library's top-level init). The import
never resolves, so **no model / ort-wasm / embeddings.bin fetch is ever issued** — confirmed
via network + `performance.getEntriesByType('resource')` (only `loro_wasm` loaded; meta.json
200; zero transformers/onnx/wasm). **So this is NOT an R2/CSP/asset problem** — INJEST curled
every sidecar 200 + CORS, and I confirmed meta.json 200 client-side. It's a client bundling bug.

Fails safe: keyword search keeps working, the loader shows a retry, no soft-lock.

**Fix candidates (untried — each needs a full prod build to verify, Turbopack can't symlink deps):**
1. Add `@xenova/transformers` (+ maybe `onnxruntime-web`) to `transpilePackages` in
   `next.config.ts` — there is direct precedent there for Ketcher ("ESM Turbopack fails to
   bundle → RangeError"). Cheapest first try.
2. Migrate to the maintained successor `@huggingface/transformers` (v3) — better ESM/bundler
   compat; `@xenova/transformers@2.17.2` is the deprecated predecessor.
3. Runtime-load transformers from a CDN (avoids Turbopack) — but CSP must allow that origin,
   which the design deliberately avoided. Least preferred.

## To ship

Branch is ff-able onto `origin/main`. Push is Grant's call (new feature, not the
smart-search lane's prior push authorization). `git merge --ff-only
figure-icon-favorites` from origin/main, or fold into the next Figure Composer
push.
