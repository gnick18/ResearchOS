# Chrome-verify — new icon sources live (Reactome Icon Library + Health Icons)

**What changed:** the open-asset library grew from **14,559 → 18,610** SVGs by adding two new vetted sources, now LIVE on `assets.research-os.com`:
- **Reactome Icon Library** — 2,569 molecular / cellular / pathway icons (CC BY 4.0, per-icon designer credit). Mostly **multi-fill** (per-fill recolor).
- **Health Icons** — 1,482 medical / public-health glyphs in filled + outline (MIT). **Single-fill** (single-tint).

Both are searchable by **keyword** (immediately) and **semantic smart search** (regenerated full-corpus MiniLM vectors, also live). Their categories were mapped onto the existing locked taxonomy leaves, so they appear inside the current sidebar sections (no new sections).

**Local commits (unpushed):** `b2b388d27`, `2589be66a`, `b439f69d3` (ingest/mappers/embed). No app-code change was needed — the figure tool reads the live CDN manifest.

## Setup
Run a dev server with the library flag on (it reads the live CDN, so no local ingest needed):
```
NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1 pnpm dev   # from frontend/, real node_modules (not symlinked)
```
Then `/demo` → `/figures`. (Or test prod `/demo → /figures` directly **if** `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1` is deployed in Vercel.)

## Paste into Claude-in-Chrome

> Go to the running dev server. Open `/demo`, then `/figures` (recreate the demo if it says "not found" — demo is flaky on reload). In the composer, click the **Icons** entry in the left insert rail. Note the window size so I can map coordinates. Screenshot each step and report PASS/FAIL.
>
> **A. New sources are present (keyword search)**
> 1. Search **"protein"** → expect many results; several should be Reactome molecular icons (clean line-art proteins/receptors), not just PhyloPic silhouettes.
> 2. Search **"syringe"**, then **"microscope"**, then **"wheelchair"** → expect Health Icons glyphs (simple medical line/filled icons).
> 3. Search **"receptor"** and **"transporter"** → expect Reactome membrane icons.
>
> **B. Categories populated (grouped sidebar)**
> 4. In the category tree, expand **Molecular** → the **"Molecular biology"** leaf should now hold a large count (Reactome proteins, ~1,400). Click it → grid fills with Reactome-style icons.
> 5. Expand **Lab & methods** → **"Safety symbols"** should be sizable (Health Icons symbols/ppe). Expand **Anatomy & physiology** → **"Human physiology"** populated (Health Icons body/conditions).
> 6. Confirm there is **no flood of junk** in an **"Other"** section from these sources (the mapping should have placed them all in real leaves).
>
> **C. Semantic smart search (the long tail)**
> 7. Toggle **Smart** search ON (the BeakerBot loader runs once: model → vectors → ready, no error). Then search **"programmed cell death"** → expect apoptosis / cell-death icons near the top. Search **"mitochondria"** and **"vaccine"** → expect on-meaning hits even without the literal word in the title.
>
> **D. Place + recolor + credits**
> 8. **Drag a Reactome icon** onto the page → it places. Open its recolor inspector → because Reactome icons are **multi-fill**, you should see **multiple fill swatches** (per-fill recolor), not a single tint. Change one fill → only that part recolors.
> 9. **Place a Health Icon** → single-fill, so a **single tint** control. Tint it → whole glyph recolors.
> 10. Open the **Export / Figure credits** block → confirm a **Reactome credit** line appears for the placed Reactome icon (format: `"<name> by <designer>. Reactome Icon Library. … (CC-BY)"`) and a **Health Icons** line for the health glyph. Click **Copy credits** → it copies.
>
> **E. Health**
> 11. Open the console → **no errors**, especially no failed `assets.research-os.com` fetches or CORS errors; every grid thumbnail renders (no broken-image boxes).
>
> Report PASS/FAIL per step with screenshots.

## Expected gotchas / notes
- **Right after the sync**, one Cloudflare edge briefly served a stale embeddings file; it self-resolved (the bin is `cf-cache-status: DYNAMIC`, uncached). If Smart search ever throws "embeddings too short," hard-reload once.
- Health Icons titles are filename-derived ("blood a n") so a few read tersely — category + the source folder are kept as search tags, so keyword search still finds them.
- Reactome includes a handful of generic **arrows / backgrounds** (mapped to **General**) — diagram primitives, expected.
- This is verifying LIVE CDN data; nothing here depends on the local `out/bundle/`.
