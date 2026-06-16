# Chrome-verify — Figure Composer grouped category sidebar

**Branch:** `figure-grouped-sidebar` (worktree `/Users/gnickles/Desktop/ROS-fig-sidebar`, commit `69f5c2e49`)
**Flag:** run the dev server with `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1` (the left rail + icon library are gated). Optionally `NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED=1` to see the verification badges + "Help review" entry (otherwise inert).
**What changed:** the icon picker's flat 10-chip category row → a BioRender-style collapsible grouped tree (9 locked sections + Other), built on the Icon Library lane's `listCategoryGroups`.

## Paste into Claude-in-Chrome

> Go to the running dev server (`:3012` if I started the worktree server, else the lane's port). Open `/demo`, then `/figures` (recreate the demo if it says "not found" — demo is flaky on reload). In the composer, click the **Icons** entry in the left insert rail.
>
> Verify, screenshotting each step:
> 1. The category area is now a **bounded scrollable tree**, NOT a flat chip row. Top row is **"All icons"** (selected by default). Below it are collapsible **section headers** (Organisms, Microbes & pathogens, Cells & tissues, Molecular, Anatomy & physiology, Lab & methods, Chemistry, Data & informatics, People & general, and possibly Other) each with a right-aligned count and a chevron.
> 2. **Click a section header** (e.g. Organisms) → it expands with a left rule showing leaf categories (Mammals, Birds, Fishes, …). Chevron flips down. Click again → collapses.
> 3. **Click a leaf** (e.g. Mammals) → it highlights (brand-action), the icon grid below filters to that category, and the section stays open.
> 4. **Type in the search box** (e.g. "mouse") → grid filters; clear it → returns.
> 5. **Drag an icon** from the grid onto the page → it places (this is the drag-feel check synthetic events can't do). Click another icon → also places. Confirm the auto-credit footer still reads "N of M. Credits auto-added."
> 6. Open the browser console → **no errors** (especially no failed asset/CORS fetches; icons should render in the grid).
>
> Report PASS/FAIL per step with screenshots. Note the window size so I can map coordinates.

## If `NEXT_PUBLIC_ASSET_CONTRIBUTE_ENABLED=1`
- Community/unverified assets show a small **amber dot** top-right of the thumbnail; curated assets show none.
- A **"Help review (N)"** link appears bottom-right of the footer, pointing to `/library/review`.
