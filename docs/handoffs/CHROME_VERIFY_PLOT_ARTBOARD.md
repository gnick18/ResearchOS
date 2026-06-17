# Plot artboard verification (Claude in Chrome)

Verify the new publication page-frame ("artboard") on BOTH figure surfaces on http://localhost:3000. The feature is off by default and behind the existing Data Hub / phylo flags (already set in Grant's .env.local). After each step read the console (read_console_messages) and screenshot. Downloading the test SVGs (Grant's own figures, his machine) is expected here; do not touch sharing or permission settings.

## Part 1 - Data Hub (/datahub)

Setup: open /datahub. Use any demo table with numeric columns (enable demo data if the lane is empty). Make a graph (a Column scatter or Column bar) and open the graph editor (the figure + a right-hand style dock).

1. **Toggle on.** In the right dock find the **Page artboard** section and check it on. EXPECT the figure now sits on a white page sheet over a gray pasteboard, with inch rulers along the top and left edges, and new controls appear (Paper, Orientation, Rulers, Figure width is via the Figure size section, Fit figure to page, a feedback chip, an export readout).
2. **Presets.** Change **Paper** to "Journal single column (3.5 in wide)". EXPECT the page becomes a narrow tall sheet and the figure's size-vs-page changes. Try "A4" and "Slide 16:9" too. The dropdown must list Letter / A4 / Legal / journal single + double / slide 16:9 / square / Custom.
3. **Orientation + rulers.** Flip **Portrait/Landscape** (page rotates). Toggle **Rulers** off/on and switch the unit **in <-> cm** (the tick labels change from inches to centimeters).
4. **Feedback chip.** Make the figure small (Figure size section) then large. EXPECT the chip reads "Lots of room..." when small, "Good fit..." mid-range, and "Overflows the page..." when the figure is bigger than the paper.
5. **Fit to page.** Click **Fit figure to page**. EXPECT the figure resizes to fill the sheet with a small margin and the chip reads good fit.
6. **Export readout.** Confirm the readout shows something like "Exports at 3.5 x 2.6 in at 300 DPI = 1050 x 780 px".
7. **Color edit on the page (Phase 3).** With the artboard ON, double-click or right-click a bar/point in the figure. EXPECT the color popover / menu still opens and recoloring works (color editing was wired into the artboard view).
8. **Export figure vs page.** Click **SVG** (the export row): download it and confirm the file's root `<svg>` carries a physical width like `width="3.5in"`. Then click **Export page (full sheet)**: confirm that file's root `<svg>` is the PAPER size (e.g. `width="8.5in"` for Letter) with the figure nested/centered on a white sheet.
9. **Default-paper memory (Phase 3).** Set Paper to A4, then create a NEW graph and turn its artboard on. EXPECT the new figure starts on A4 (the last-used paper is remembered).

## Part 2 - Tree Studio (/phylo)

Setup: open /phylo. Import or open a tree (paste a small Newick, use a demo tree, or the sample). The tree renders in the canvas with an op rail (Layers / Setup / Export / Code).

1. **Toggle on.** Open the **Export** op. At the bottom is a **Page artboard** group. Check it on. EXPECT the tree now renders on a page sheet with rulers, plus a **Figure width** slider, **Fit figure to page**, a feedback chip, and the export readout.
2. **Resize on the page.** Drag the **Figure width** slider. EXPECT the tree scales on the page. Click **Fit figure to page**.
3. **Presets + orientation + rulers** behave as in Part 1.
4. **True-inch export (the phylo win).** With the artboard ON, click **SVG** in the Export op. EXPECT the downloaded file's root `<svg>` carries a physical inch width (e.g. `width="6in"`). This is Tree Studio's first true-inch export; with the artboard OFF, SVG export is the old 620x460 px box. Then click **Page** for the full sheet.
5. **Persistence.** Save the tree ("Save to my trees"), then reopen it from the rail. EXPECT the artboard comes back on with the same paper + figure width.

## Report
Per part / step: PASS / FAIL, what you saw (quote the export readout text and the exported SVG root width attributes), any console error verbatim, and screenshots of: the Data Hub artboard on a journal-column page, the Tree Studio artboard, and one exported-SVG root tag. Call out specifically: (1) figure-mode SVG carries inches, (2) Export page carries the paper size, (3) color edit works in the Data Hub artboard view, (4) phylo SVG now carries inches with the artboard on, (5) default-paper is remembered for a new figure.
