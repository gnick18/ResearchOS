# Claude-in-Chrome test — Figure Composer styling (Phase 1 + 2)

Paste everything below the line into a fresh Claude-in-Chrome session (Grant's
`:3000`, extension connected). This tests the **in-app figure styling** arc:
per-panel recolor/hide + thickness + ruler/label toggles (Phase 1) and the
**canonical "Save as default"** round-trip (Phase 2).

**Why this one is NOT demo-only:** demo mode ships Data Hub plots but **no
sequences**, and the styling controls key off a sequence's annotated **features**.
So this test needs a real folder with at least one **annotated** sequence (a
plasmid / construct that has features, not a bare base string). Setup options are
in the prompt. Per `feedback_chrome_test_one_folder_demo_parallel`, run this
solo against one scratch folder.

Why Chrome and not Preview/Playwright: the swatches, slider drag, and panel
selection use real pointer events synthetic events miss
(`feedback_mouse_testing_via_chrome_extension`).

---

You are testing a never-browser-verified feature on ResearchOS at
**http://localhost:3000**: **in-app styling for the Universal Figure Composer**
(`/figures`). A user adds a saved **sequence map** as a panel, then recolors /
hides individual features, changes thickness, toggles the ruler and labels, and
finally promotes that look to the sequence's **canonical default** so any future
figure of it starts styled. Drive the browser yourself, report what you find, and
**do not edit any code**.

## Setup — you need ONE annotated sequence

1. Open the app and **connect a research folder** (use a scratch/test folder, or a
   real one you do not mind adding a sequence to). Finish loading into the workbench.
2. Open the **Sequences** surface from the nav. You need a sequence that **has
   features** (colored annotations like a promoter, CDS, ori). 
   - If you already have an annotated plasmid, use it. Skip to The Test.
   - If not, create one from the GenBank sample at the bottom of this prompt:
     use the sequence importer / "New sequence -> paste or upload", paste the
     `LOCUS ...` block (or save it as `pBR-mini.gb` and upload it). Confirm it
     opens in the editor and shows **3 colored features** (P_lac, GFP, AmpR).
3. Note the sequence's name; you will pick it in the composer's add-figure picker.

## The test

Navigate to **http://localhost:3000/figures**. Record PASS/FAIL with what you saw.

1. **Add a Sequence map panel.** New figure -> **Add figure**. In the picker, find
   your annotated sequence (grouped under a sequence/"Sequence map" heading; it
   should show a small circular-plasmid or linear-backbone thumbnail). Select it and
   add it. PASS if it lands on the page as an actual map (ring or backbone with
   feature wedges/arrows), not a blank or "missing" box.

2. **Style section appears on select.** Click the panel to select it. The right-rail
   "Selected panel" card shows, below "Show plot title", a **Style** section with a
   scrollable list of the sequence's **features**, each with a **color swatch** + the
   feature name + an **eye (hide) toggle**. PASS if the features are listed with
   swatches seeded to their current colors.

3. **Recolor a feature (live).** Click a feature's color swatch and pick a clearly
   different color. PASS if the corresponding wedge/arrow on the map **recolors live**
   (no reload).

4. **Hide a feature (live).** Click a feature's **eye** toggle. PASS if that feature
   disappears from the map and its row goes struck-through/faded. Toggle it back on
   and confirm it returns.

5. **Thickness slider.** Drag the **Thickness** slider (range ~0.5 to 2). PASS if the
   feature wedges/arrows get visibly thicker/thinner live as you drag.

6. **Coordinate ruler toggle.** Uncheck **Coordinate ruler**. PASS if the bp
   coordinate ticks/ring disappear; re-check and they return.

7. **Feature labels toggle.** Uncheck **Feature labels**. PASS if the feature text
   labels disappear from the map; re-check and they return.

8. **Save as default (the Phase 2 round-trip).** With your styling applied (a recolor
   + a hidden feature is enough), click **"Save as this sequence's default"**. PASS
   if the button confirms (it switches to "Saved as default" with a check). No console
   error.

9. **Canonical persistence — remove + re-add.** Select the panel and **Remove from
   page**. Then **Add figure** again and re-add the **same** sequence. PASS if the
   newly added panel comes back **already styled** with your saved look (the recolor
   and the hidden feature carry over) — this proves the canonical default persisted on
   the sequence, not just on the old panel.

10. **(Stretch) survives reload.** Reload `/figures/<id>` (or reopen the page). The
    panel should still render with the saved canonical style. PASS/observe.

## Also eyeball (unit-tested, never Grant-verified): chem + non-seq panels

11. If you have a **chemistry structure** or a **Data Hub plot**, add one as a second
    panel and confirm it renders as a real figure. These do NOT have the per-feature
    Style controls yet (that is Phase 3) — just confirm they render cleanly and that
    selecting them does not error or show a broken/empty Style section.

## Throughout

- Keep the **console open**; report ANY red errors / React warnings (especially
  "Maximum update depth", render loops, hydration) and which step triggered them.
- Flag anything visually broken: map not rendering, swatch not recoloring, slider
  doing nothing, labels/ruler not toggling, or the re-added panel coming back
  **unstyled** (that would mean canonical persistence failed — important).

## Report back

A PASS/FAIL table for steps 1-11, the console state (clean or exact errors), and a
1-2 sentence verdict: is sequence-panel styling + Save-as-default usable on `:3000`,
and what (if anything) is broken or rough. List concrete bugs with the step number
and saw-vs-expected.

---

### Fallback annotated sequence (paste/upload if you have none)

Save as `pBR-mini.gb` and upload, or paste into the new-sequence GenBank box:

Each feature uses a distinct `type` (so it gets a distinct default color) plus an
explicit `/ApEinfo_fwdcolor=` qualifier (which the parser promotes into the
feature color):

```
LOCUS       pBR-mini                 60 bp    DNA     circular SYN 14-JUN-2026
DEFINITION  Minimal annotated test construct for figure styling.
FEATURES             Location/Qualifiers
     promoter        1..15
                     /label=P_lac
                     /ApEinfo_fwdcolor=#1e90ff
     CDS             16..39
                     /label=GFP
                     /ApEinfo_fwdcolor=#2ecc71
     rep_origin      40..60
                     /label=AmpR
                     /ApEinfo_fwdcolor=#e67e22
ORIGIN
        1 ttgacaatta atcatcggct cgtataatgt gtggaattgt gagcggataa caatttcaca
//
```
