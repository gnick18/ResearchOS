# Claude-in-Chrome test — icon library in the Figure Composer

Tests the open-asset icon library wired into `/figures`: browse the live CDN
(`assets.research-os.com`), place an icon, drag/resize/tint/rotate it, see
auto-credits, and export. The feature is **flag-gated**, so it must be turned on first.

## Enable the flag (one-time)
In `frontend/.env.local` add:
```
NEXT_PUBLIC_ASSET_LIBRARY_ENABLED=1
```
Then **restart the dev server** (NEXT_PUBLIC_* is inlined at build). Demo mode works
for this (the `/figures` page is reachable in demo), so this is parallel-safe.

---

You are testing a flag-gated feature on ResearchOS at **http://localhost:3000**: an
**open-asset icon library** inside the Figure Composer (`/figures`). Icons come from a
Cloudflare CDN (`assets.research-os.com`, ~300 PhyloPic + BioIcons assets so far) and
are placed as recolorable graphics on the page, with citations auto-generated. Drive
the browser yourself, report PASS/FAIL, and do not edit code. Keep the console open.

## Setup
1. Go to **http://localhost:3000/demo**, wait for the workbench.
2. Go to **http://localhost:3000/figures** → **New figure** → the composer opens.

## The test
1. **Add icon button present.** The right rail shows an **"Add icon"** button next to
   "Add figure". PASS if present. (If absent, the flag is not enabled — fix .env.local
   + restart.)
2. **Picker loads from the CDN.** Click **Add icon**. A modal opens with a search box,
   category chips, and a **grid of icon thumbnails**. PASS if thumbnails load (real
   icons, not broken images). Footer reads "N of M open-licensed assets...". Check the
   console/network: thumbnails load from `assets.research-os.com`.
3. **Search + category.** Type a term (e.g. "cell" or an organism) → grid narrows.
   Click a category chip → grid filters. PASS if both filter live.
4. **Place an icon.** Click a thumbnail. The modal closes and the icon appears on the
   page (centered), selected (outlined). PASS if it renders as a real graphic.
5. **Drag.** Click-drag the icon to a new spot. PASS if it follows the cursor and stays.
6. **Resize.** With it selected, drag the bottom-right square handle. PASS if it scales.
7. **Tint.** In the "Selected icon" card, click a colored tint swatch → the icon
   recolors live. Click the "Original" swatch (the one with the x) → returns to original
   colors. PASS if both work. (Note: PhyloPic silhouettes are single-color so tint
   recolors the whole thing; a BioIcons multi-color icon tints to one color.)
8. **Rotate.** Drag the Rotate slider → the icon rotates live. PASS.
9. **Auto-credits.** If you placed a **CC-BY** icon (many BioIcons + PhyloPic are), the
   Export card shows a **"Figure credits"** block listing its citation, with a "Copy
   credits" button. (CC0 / Public Domain icons add no credit — that is correct.) PASS if
   a CC-BY icon produces a credit line and a CC0 one does not.
10. **Remove.** Click "Remove from page" in the Selected-icon card → the icon disappears.
    PASS.
11. **Export includes the icon.** Place an icon again, then **Export page SVG**. Open the
    downloaded SVG → the icon should be in it. PASS if the export contains the icon.

## Throughout
- Report any red console errors / React warnings (esp. "Maximum update depth", render
  loops, hydration), and any broken thumbnails or CORS errors fetching from the CDN.

## Report back
A PASS/FAIL table for 1-11, the console state, and a 1-2 sentence verdict: does the
icon library work end-to-end in the composer, and what (if anything) is rough.
