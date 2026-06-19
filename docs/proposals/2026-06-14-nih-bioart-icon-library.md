# Open scientific-asset library → figure / diagram / poster maker
### (NIH BioArt is source #1 of a vetted open-licensed federation)

**Date:** 2026-06-14
**Status:** DESIGN DRAFT — decisions NOT locked. Grant's idea; legal verified from source.
**Builds on:** the Universal Figure Composer + the per-source styling seam
(`docs/handoffs/2026-06-14-figure-composer-styling-handoff.md`, `FigureSource` in
`frontend/src/lib/figure/figure-source.ts`) and the real-units artboard
(`project_plot_artboard`).
**Memory:** `project_bioart_icon_library`, `project_figure_composer_styling`.

> **EXPANDED SCOPE (2026-06-14, Grant):** BioArt is **source #1**, not the whole thing.
> The real target is a **federation of vetted open-licensed scientific-asset sources**
> (icons, illustrations, larger BioRender-style assemblies) unified by ONE invariant:
> **every asset carries its source + license + attribution + URL, captured at ingest,
> so a citation is perfectly linked to each image.** See section 9 for the source matrix
> and the `AssetSource` seam. The guardrail: **curated vetted sources only, never
> indiscriminate scraping** — ingest only where the license is open, per-asset, and
> commercial+derivative-compatible (CC0 / CC-BY / CC-BY-SA / Public Domain).

## 1. The pitch

NIH BioArt (https://bioart.niaid.nih.gov) is a free library of 2,000+ professional
science/medical vector icons. Ingesting the legally-clean subset turns the figure
composer into the start of a **BioRender alternative**: drop publication-quality
icons into figures, then grow into a freeform diagram canvas and conference posters.
We already own the hard parts (exact-SVG compositor, real-units artboard, a picker
with search/filter, a per-element recolor seam), so this is more "assemble what we
have around a new asset type" than "build a graphics editor from scratch."

## 2. Legal policy (the part that decides everything) — PROPOSED LOCK

Verified from the BioArt FAQ + a real icon page. Licenses are assigned **per icon**
(filterable on their discover page), NOT one blanket license:

| License | Commercial use | Edits/derivatives | Attribution | Our call |
|---|---|---|---|---|
| Public Domain | yes | yes | appreciated, not required | INGEST |
| CC-BY | yes | yes | REQUIRED | INGEST + auto-credit |
| CC-BY-SA | yes | yes (share-alike) | REQUIRED | INGEST + auto-credit (+ mark export) |
| CC-BY-NC* | NO | — | — | EXCLUDE (we are a paid product) |
| CC-BY-ND* | — | NO | — | EXCLUDE (we recolor/resize = a derivative) |

**Locked constraints (proposed):**
1. Ingest ONLY **Public Domain + CC-BY + CC-BY-SA**. Hard-exclude every `-NC` and
   `-ND` variant at ingest time. Store the license per icon so the filter is auditable.
2. **Auto-generate credits.** Every icon carries its verbatim citation string +
   creator + collection + source URL + license. A figure/poster that uses CC-BY(-SA)
   icons emits a "Figure credits" block + a copyable citation automatically, so the
   user is compliant by construction. This is a feature, not a tax — a selling point
   vs BioRender.
3. Never imply NIH/NIAID endorsement of ResearchOS (standard gov-work courtesy).
4. CC-BY-SA share-alike: if we ever let users export an edited icon AS an icon
   (vs. baked into a flat figure), mark it CC-BY-SA. In normal figure export the icon
   is composited into the page SVG with the credit block, which satisfies BY/BY-SA.

## 3. What the data looks like (verified)

Per-icon metadata (from BIOART-000172 "Generic Cells", a Public Domain icon):
- Stable id `BIOART-000NNN`, title, creator, collection (NIAID Visual & Medical Arts),
  category, license label, creation/submission/modified dates, description, "Vector".
- A pre-formatted citation string, e.g.
  `NIAID Visual & Medical Arts. (10/7/2024). Generic Cells. NIAID NIH BIOART Source. bioart.niaid.nih.gov/bioart/172`
- Formats offered: **SVG, AI, EPS, PNG**, sometimes multi-color / grayscale variants.
- DOI: present only for some (the FAQ says cite the DOI "should it be available").

**Resolved by recon (2026-06-14):**
- **File download endpoint is real + unauthenticated:** `/api/bioarts/<id>/files/<fileId>`.
  Each icon exposes ~11 files (formats x color/grayscale variants); the detail page
  lists which fileId is the SVG. So we download the SVG directly, no UI selector needed.
- **IDs are sequential numeric** (7, 86, 172, 308, 2182 ... all resolve), and detail
  pages are server-rendered with full metadata. So ingest = **enumerate IDs 1..~2200,
  scrape each detail page for metadata, filter by license, download the SVG file.**
- The public **metadata/list API is NOT at `/api/bioarts` or `/api/bioarts/<id>`** (both
  404); only the `/files/` binary path is public. The discover page's search call is a
  different (likely POST) path. We do NOT need it — ID enumeration covers ingest.

**Still open (one browser/devtools pass):**
- The **per-license counts** (the discover page license facet shows them; read each).
  Expectation from secondary sources: the large majority is Public Domain. (We also get
  the exact split for free as a byproduct of the enumeration ingest.)
- Confirm the detail-page DOM selectors for metadata + which fileId is the SVG (so the
  scraper is robust); capture one real SVG to validate recolor hygiene.

## 4. Ingest pipeline

A one-time (refreshable) build step, NOT a runtime dependency on their site:
1. **Enumerate IDs 1..~2200** (sequential), scrape each detail page for metadata,
   **keep only PD + CC-BY + CC-BY-SA** (drop + log the rest).
2. For each kept icon: download the **SVG** via `/api/bioarts/<id>/files/<svgFileId>`
   (the svgFileId comes from the detail page's file list). SVG = cleanest for recolor.
3. Normalize: store `{ id, title, creator, collection, category, license, citation,
   sourceUrl, doi?, svg, tags }`. Sanitize SVG (strip scripts, normalize fills so
   recolor works). Build a search index (title + category + tags + synonyms).
4. Host our own copies (redistribution of PD + CC-BY(-SA) with attribution is allowed)
   so the library works offline / local-first and does not depend on their uptime.
5. Ship as a versioned asset bundle + manifest; re-run periodically to pick up new
   icons. Log counts dropped by license so the exclusion is transparent.

## 5. Architecture — icon as a new lightweight graphic, on the existing seam

An icon is NOT a data "panel" (a sized box with an A/B/C label). It is a small,
freely-placed, recolorable graphic — closer to an annotation, but sourced from a
searchable library. Proposed: a new **graphics layer** alongside panels + annotations.

- Reuse the **picker** pattern (search / category filter / preview) for the icon
  browser — this is exactly what a 2,000-icon library needs, and we already built it.
- Reuse the **recolor** concept from the styleSchema work (icons expose their fills as
  style targets) so an icon recolors with the same UX as a sequence feature.
- Reuse **annotation placement** (click-to-place, drag-to-move, select, z-order) and
  add transform handles (resize, rotate, flip) — a modest extension of the 3-tool layer.
- Icons composite into the page SVG through the **same `composeFigurePageSvg` /
  `annotationLayerSvg`** path, so on-screen == export and exact-units still holds.
- A new `bioartLibrary` module owns the asset bundle + search; the composer imports it
  the same way it imports sources, keeping `lib/figure` surface-agnostic.

## 6. Phased plan

- **Phase 0 — foundation (no UI):** ingest pipeline + icon-metadata store + license
  filter + the auto-credits model + a search index. The legally-load-bearing phase.
- **Phase 1 — icons IN figures:** an "Icon" tool on the composer's graphics/annotate
  rail → opens the icon library search → place a recolorable, resizable, rotatable
  icon → auto-credits block on export. Ships the core value on the surface we have.
- **Phase 2 — diagram canvas:** a dedicated freeform mode (icons + text + connectors +
  basic shapes + grouping) — the BioRender-parity step. Bigger.
- **Phase 3 — posters:** large paper presets on the artboard (e.g. 36x48"), multi-
  column layout, title/author blocks. Mostly artboard presets + layout, since the
  real-units canvas already supports arbitrary paper.

## 7. Decisions needed before code

1. **First-phase breadth:** icons-in-figures only (Phase 1) vs. commit to the full
   diagram/poster arc up front. (Recommend: Phase 1 first, lowest risk.)
2. **Hosting:** host our own ingested copies (recommended, offline-first) vs. deep-link.
3. **Ingest trigger:** one-time baked bundle vs. periodic refresh job (recommend a
   versioned bundle, refreshed manually for now).
4. **Recolor scope:** single-color recolor vs. per-fill targets for multi-path icons.
5. Confirm the **PD + CC-BY + CC-BY-SA only** policy and the **auto-credits** UX.

## 8. The source federation (the expanded vision)

One `AssetSource` adapter seam (mirroring `FigureSource`): each provider yields a
normalized `Asset { id, source, title, creator, license, attribution, sourceUrl,
doi?, svg, tags, category }`. The library + search + recolor + **auto-credits** engine
are written ONCE against `Asset` and serve every source. Adding a source = writing one
vetted adapter, zero composer change. Per-asset license is a REQUIRED field; ingest
drops anything outside the allowed-license set and logs the drop.

**Vetted sources (license-verified 2026-06-14):**

| Source | License model | Commercial | ~Count | Format | Ingest notes |
|---|---|---|---|---|---|
| NIH BioArt | PD / CC-BY / CC-BY-SA (exclude NC/ND) | yes | 2,000+ | SVG | ID enumeration + scrape (section 4) |
| Servier Medical Art (SMART) | CC-BY 4.0 (uniform) | yes | ~3,000 | SVG | gold-standard medical art; attribute, not for logos |
| BioIcons | per-icon: CC0 / CC-BY / CC-BY-SA / MIT / BSD | yes | 2,829 | SVG | **ADAPTER BUILT** (`ingest-bioicons.mjs`); flat manifest |
| SciDraw | CC-BY default ("unless stated otherwise") | yes | hundreds | SVG | verify the per-drawing exceptions |
| PhyloPic | per-image: CC0 / PD / CC-BY / CC-BY-SA (some NC -> exclude) | yes (filtered) | 12,483 | SVG | **ADAPTER BUILT** (`ingest-phylopic.mjs`); clean v2 API |
| Reactome Icon Library | CC BY 4.0 (uniform) | yes | 2,569 | SVG | **ADAPTER BUILT** (`ingest-reactome.mjs`); molecular/cellular/pathway icons (proteins, receptors, transporters, compounds, cell types/elements, tissues, arrows); SVGs from the official GitHub repo joined to ContentService per-icon designer attribution. 220 EHLD pathway diagrams also available (same repo/license) = the "larger BioRender-style assemblies" |
| Health Icons | MIT (whole repo) | yes | ~1,524 | SVG | **ADAPTER BUILT** (`ingest-healthicons.mjs`); medical / public-health glyphs (body, devices, conditions, specialties, diagnostics, medications, people, symbols) in filled + outline; single GitHub repo, raw SVG; mostly single-fill (single-tint) |

Net of the allowed subset across these: **~20,000+ legally-clean, citation-complete
SVG assets.** All carry creator + license, so the auto-credits engine handles them
uniformly. (And every later source plugs into the SAME library + recolor + credits.)

**Future candidates (need vetting before ingest):** DBCLS / TogoTV (CC-BY biology
illustrations), WikiPathways (CC0 / CC-BY *pathway diagrams* = the "larger
BioRender-style assemblies"; Reactome's pathway-diagram side is already covered by the
built adapter's EHLD set), open-access **CC-BY paper figures** (attribution to the
paper authors; extraction is delicate), Wikimedia Commons biology category (per-file
mixed; harder). **Hard excludes:** BioRender (proprietary), Flaticon / Freepik, The
Noun Project free tier (effectively non-commercial), any NC / ND / "free but no
redistribution" source.

**Per-source vetting checklist (run before any source is added):** (1) is the license
open, commercial-OK, derivative-OK? (2) is it machine-readable PER ASSET (not a
blanket claim that hides exceptions)? (3) does the asset expose creator + a stable URL
for attribution? (4) does the source permit redistribution/hosting? (5) any
trademark/endorsement clause? A source passes only if all five are clean; otherwise it
is per-asset-filtered or excluded.

## 10. Open questions / risks

- Some icons are intricate multi-path illustrations; "recolor" may mean a single tint
  or per-fill targets. Resolve in Phase 1 with real assets.
- SVG hygiene: a few may carry embedded rasters or odd fills; the ingest sanitizer
  handles this, but count + log any that don't round-trip cleanly.
- Search quality across 2,000 icons needs synonyms/categories; the index design in
  Phase 0 matters more than the UI.
