# Open scientific-asset corpus — survey findings (2026-06-14)

Phase 0 reconnaissance for the open-asset library (see
`docs/proposals/2026-06-14-nih-bioart-icon-library.md`). Run via
`node scripts/asset-ingest/survey.mjs`. Goal: measure how big the legally-clean
corpus is and validate ingest mechanics, before scoping the UI.

Allowed = CC0 / Public Domain / CC-BY / CC-BY-SA (commercial + derivative OK).
Excluded = any -NC or -ND.

## Headline numbers

| Source | Method | Total | Clean (allowed) | Vector? | Ingest status |
|---|---|---|---|---|---|
| **PhyloPic** | official v2 API | 12,483 | **11,738** | yes, SVG | READY — clean + easy |
| **NIH BioArt** | ID scrape | ~2,000+ | ~all (PD-dominant) | MIXED / unclear | BLOCKED on 2 issues (below) |
| Servier (SMART) | TBD | ~3,000 | ~3,000 (all CC-BY) | yes, SVG | not yet tested — likely best multi-color source |
| BioIcons | TBD | 2,829 | most (per-icon) | yes, SVG | not yet tested |
| SciDraw | TBD | hundreds | most (CC-BY) | yes, SVG | not yet tested |

## PhyloPic — the clean win (source #1)

- **11,738 of 12,483** silhouettes are allowed (only 745 are -NC; PhyloPic carries no
  -ND). Of the clean set, **5,403 are CC-BY/CC-BY-SA** (need attribution) and **6,335
  are CC0 / Public Domain** (no attribution needed).
- Official v2 API with a license filter (`filter_license_nc=false`), per-image
  `attribution`, a direct `vector.svg` URL, contributor + taxon name. Ingest is clean
  and complete via API — no scraping.
- **Caveat for recolor:** silhouettes are **single-fill** (monochrome by nature). The
  per-fill recolor model is moot here; these want **single-tint** recolor. Per-fill
  matters for the multi-color illustration sources (Servier, BioArt vectors).
- Sample SVGs downloaded OK to `out/` (verified real SVG, 2-19 KB each).

## NIH BioArt — two real blockers found

1. **Aggressive rate-limiting.** After ~6-13 rapid requests the server returns HTTP 500
   / a degraded shell, even with retries + 1.5-2.5 s backoff. Ingesting ~2,000 assets
   needs a **slow, polite, retried crawler** (multi-second spacing, long backoff) — a
   patient background job, not a quick scrape. Plan for hours, not minutes.
2. **SVG download path is not in the page data.** The detail page is server-rendered
   with the asset metadata + license (good — license parses, overwhelmingly Public
   Domain) and an embedded file list, BUT that list only contains **PNG previews**
   (multi-color + grayscale raster variants, e.g. `GenericCells0002-blue.png`). Every
   sampled "BioArt 2D" asset (ids 7/40/120/172/250/400/600) was PNG-only in the page
   JSON. The marketing says SVG/AI/EPS are downloadable, so the vector almost certainly
   comes from the **Download action** (a separate request), NOT the embedded preview
   list. **Resolving this needs one devtools capture** of what "Download → SVG" fires.
   - The `/api/bioarts/<id>/files/<fileId>` endpoints serve the **PNG** variants (magic
     bytes confirmed), with embedded tEXt title/description. The SVG endpoint is unknown.

**Net on BioArt:** license is fine (PD-dominant, all clean), but it is the *harder*
source — rate-limited + an unresolved SVG path. It is NOT the quick win PhyloPic is.

## Revised source priority (recommendation)

1. **PhyloPic first** — API, 11.7k clean SVGs, trivial ingest. Validates the
   normalize -> license-filter -> auto-credit pipeline end-to-end with zero scraping.
2. **Servier (SMART) second** — ~3,000 uniformly CC-BY vector medical illustrations;
   the right source to validate **multi-color + per-fill recolor** (PhyloPic can't,
   it's monochrome). Needs its own ingest-mechanics check.
3. **BioArt later** — after one devtools capture of the SVG download request + a polite
   crawler. License-clean but operationally the hardest.

## Corpus scope answer (the question that kicked this off)

Just PhyloPic + Servier + BioIcons gives **~17,500 clean, attributable SVGs** before
BioArt or SciDraw. The federation comfortably clears **~20,000** legally-clean assets.
That is more than enough to scope the figure-page / diagram / poster UX around.

## Open recon (one browser/devtools pass)

- Capture the BioArt "Download -> SVG" network request (the SVG URL pattern).
- Confirm Servier + BioIcons download mechanics (likely direct SVG URLs).
- BioArt exact total + precise license split (falls out of the polite crawl).
