# Chrome-verify — near-miss icon search (Option C baseline)

**Branch:** `figure-semantic-search` (worktree `/Users/gnickles/Desktop/ROS-icon-search`, commit `a993e7d55`)
**Flag:** run with `NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1`.
**What changed:** the icon picker's search box now ranks with a typo + synonym tolerant engine (`asset-search.ts`) instead of plain substring.

## Paste into Claude-in-Chrome

> Open the running dev server, `/demo` then `/figures`, click **Icons** in the left rail. In the search box type each query and screenshot the grid:
> 1. `rodent` → should surface mouse / rat / mammal icons (the word "rodent" is rarely in the title; it resolves via synonyms). PASS if rodent/mouse/rat icons appear in the first row.
> 2. `cell death` → should surface apoptosis icons. PASS if an apoptosis/cell-death icon is in the top results.
> 3. `bacteria` → bacteria/microbe icons fill the grid. PASS.
> 4. `moose` (typo) → mouse should appear in the results (may not be #1; that's the known typo-tolerance limit of the baseline). PASS if a mouse icon is anywhere in the grid.
> 5. `petri dish`, `neuron`, `flask` → each fills with the obvious matches. PASS.
> 6. Clear the box → the grid returns to the selected category / all-icons view. PASS.
> 7. Pick a real icon from a `rodent` result and drag it onto the page → it places (confirms search results are still draggable/placeable).
>
> Report PASS/FAIL per query with a screenshot. Console should have no new errors.

Known baseline limit (by design): pure typos with a near-homophone ("moose" vs "moon") can rank a wrong word above the right one. The planned client-side embedding layer (Option A) fixes the deep-semantic / hard-typo tail. The synonym map is curated in `asset-search.ts` (`SYNONYM_GROUPS`) and easy to extend.
