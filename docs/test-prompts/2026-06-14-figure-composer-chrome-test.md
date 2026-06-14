# Claude-in-Chrome test — Universal Figure Composer Phase 1

Paste everything below the line into a fresh Claude-in-Chrome session (Grant's
`:3000`, the Chrome extension connected). It is fully self-contained: it uses
**demo mode**, which ships 5 Data Hub plots, so no folder or data setup is needed.

Why Chrome and not Preview/Playwright: the composer drags panels with real pointer
events and a move-threshold; synthetic events miss it (see
`feedback_mouse_testing_via_chrome_extension`).

---

You are testing a brand-new, never-browser-verified feature on ResearchOS running at
**http://localhost:3000**: the **Universal Figure Composer** (`/figures`). It lets a
user assemble multiple saved plots onto one publication page, arrange them, label them,
and export the whole page as a single SVG. Phase 1 supports **Data Hub plots only** as
panels. Drive the browser yourself and report what you find. Do not edit any code.

## Setup (zero data needed — use demo mode)

1. Go to **http://localhost:3000/demo**. This unlocks the data-folder gate with a seeded
   multi-user lab. Wait for the app to finish loading into the workbench.
2. The demo lab has saved Data Hub plots already (you do NOT need to create any). If you
   ever want to confirm, open **Data Hub** from the nav and note that several tables have
   graphs — but this is optional; the composer's picker will list them for you.

## The test

Navigate directly to **http://localhost:3000/figures** (it is not in the nav bar yet —
that is expected; reach it by URL).

Run these steps in order. After each, record PASS/FAIL with what you actually saw.

1. **Figures home renders.** The `/figures` page shows a "Figures" heading and a way to
   create a new figure (a "New figure" button). PASS if it renders with no error overlay
   and the console is clean.

2. **Create a page.** Click **New figure**. It should route to `/figures/<some-id>` and
   show the composer: a white page canvas on the left (on a sunken board) with the empty
   hint "Add a figure to start the page," and a right rail with **Add figure**, **Snap to
   grid**, an undo button, a **Page** card (Paper dropdown + Labels ABC/abc/123/None), and
   an **Export** card.

3. **Add-figure GALLERY picker.** Click **Add figure**. A wide "Add figures" modal opens
   with a left sidebar (a **Search figures** box, a funnel + plot-type filter chips
   **All / XY / Bar / Scatter / ...**, and a **Group by: Table / Type / None** segmented
   control defaulting to Table) and a center preview pane. The list shows the demo plots
   as rows with a small **thumbnail** + name, grouped under table headings. PASS if 2-3+
   plots render with thumbnails. (Empty "No saved figures" here = FAIL, report it.) Then:
   - **Click a row** → it renders LARGE in the center preview with a type badge + meta.
   - **Type in Search** (e.g. "growth") → the list narrows; clear it.
   - **Tap a filter chip** (e.g. XY) → only that plot type remains; tap All to reset.
   - **Switch Group by** to Type, then None → the grouping headings change live.
   - **Check 2-3 boxes** (or the center "Select" button) → the footer button updates to
     "Add N figures". Click it → the modal closes and ALL selected plots land on the page
     as panels at once. PASS if multi-select adds them all in one go.

4. **Panels rendered on the page.** The plots you added in step 3 now sit on the white
   page as actual charts (not blank boxes or "missing" placeholders). The Export card's
   footer reflects the count, e.g. "3 panels at <W> x <H> in, one vector SVG."

5. **Get to 3 panels.** If you added fewer than 3 in step 3, click **Add figure** again
   and add more (single or multi-select) until 3 panels are on the page. They may overlap
   at first — that is fine, you will arrange them next.

6. **Drag to arrange (the real-pointer check).** Click and **drag** a panel to a clear
   spot on the page using a real click-drag (press, move, release). It should follow the
   cursor and stay where you drop it. Do this for all 3 so they are visually separated.
   PASS if dragging is smooth and panels land where dropped (this is the move-threshold
   check that synthetic events fail).

7. **Resize a panel.** Click a panel to select it (it gets a colored outline + a small
   square handle at its bottom-right). Drag that handle to resize. The chart should
   re-render larger/smaller to fit. PASS if it resizes and stays a real chart.

8. **Snap to grid + undo.** Click **Snap to grid**. The panels should jump into a clean,
   aligned arrangement. Then click the **undo** button (the arrow); the layout should
   return to the pre-snap positions. PASS if both work.

9. **Panel labels.** In the Page card, the Labels control is a 4-way toggle (ABC / abc /
   123 / None). Click **ABC** — each panel should show a small bold "A", "B", "C" badge in
   reading order (top-left of each panel). Switch to **123** (should become 1/2/3), then
   **None** (badges disappear). PASS if labels update live and follow reading order.

10. **Paper preset.** In the Page card, change the **Paper** dropdown to a different preset
    (e.g. a journal single-column width). The white canvas should change proportions and
    the Export footer's "<W> x <H> in" should update accordingly. PASS if the page reflows.

11. **Remove a panel.** Select one panel, then in the "Selected panel" card click **Remove
    from page**. It disappears and the footer panel count drops by one. PASS.

12. **Export.** Click **Export page SVG** in the Export card. A file download named like
    `<page name>.svg` (or `figure.svg`) should start, with NO console error. PASS if the
    download fires cleanly. (The exact-units SVG math is already covered by 42 unit tests;
    here we only need the export wiring to fire without error.)

## Throughout

- Keep the **browser console open** and report ANY red errors or React warnings (especially
  "Maximum update depth", hydration errors, or render loops) and which step triggered them.
- Note anything that looks visually broken: panels rendering as blank/missing placeholders,
  labels in the wrong order, the page canvas mis-sized, drag jumping or sticking, the picker
  empty, or the inspector not appearing on select.

## Report back

A short PASS/FAIL table for steps 1-12, the console state (clean or the exact errors), and
a 1-2 sentence overall verdict: is the Figure Composer usable end-to-end on `:3000`, and
what (if anything) is broken or rough. List concrete bugs with the step number and what you
saw versus expected.
