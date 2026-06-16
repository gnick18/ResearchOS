# Chrome verify — collision-advisor extensions (4 slices, 2026-06-16)

Hand this to Claude-in-Chrome. It verifies four just-shipped slices of the
collision-aware layout advisor. All run in **demo mode** (no folder writes, parallel-safe).
You need a dev server with phylo + sequences enabled (e.g. the local main dev server;
demo mode bypasses the feature flags). Replace `BASE` with the running origin
(e.g. `http://localhost:3033`).

For each test: do the steps, take a screenshot at the "capture" point, and report
**PASS / FAIL / BLOCKED** with one line of what you saw. If a precondition cannot be
met (e.g. no enzyme-dense sequence in the demo), report **BLOCKED** with why — do
not force it.

---

## Test A — Fan + inward-circular track callouts (the headline)

The rooted circular tree already pulls each metadata ring's name out to the right
gutter with a leader. This slice extends that to the **fan** and **inward-circular**
layouts.

1. Open `BASE/phylo?demo=1`. Wait for the Candida auris demo tree to load (it opens
   **circular**, with metadata rings + the track callouts on the right).
2. In the right panel, open the **Shape** tab, find the **Layout** segmented control,
   click **Fan**.
3. **Capture A1.** Expected: the figure becomes wider than tall; the fan sits on the
   **left**; the track names (CLADE / FCZ / AMB / MCF or similar) are pulled out into
   the **right** margin, each tied to its ring by a thin leader. The legend is further
   right. Nothing clipped off the right edge.
4. Click **Inward circular** in the Layout control.
5. **Capture A2.** Expected: same "circle left, callouts right" treatment — track-name
   callouts with leaders in the right gutter (labels may face inward on the tree
   itself, but the side callouts read normally).
6. Click **Rectangular**. Expected: callouts disappear (rectangular uses per-column
   headers, not side callouts) — confirms the gutter is radial-only.

PASS if Fan and Inward-circular both show the right-gutter callouts with leaders.

---

## Test B — Phylo advisor no longer offers "Tilt the labels"

Tilting a vertical tip-label stack never actually de-collides it (rotating each label
about its own anchor leaves the spacing unchanged). The detector now models this
honestly, so the phylo advisor should offer **Shrink the label font** but NOT **Tilt
the labels**.

1. Open `BASE/phylo?demo=1`. In the **Shape** tab → **Layout**, click **Rectangular**.
2. Turn tip labels ON if they are not already (Layers tab → the tip-labels layer's
   show toggle, or the labels control in Shape). The 300+ tips should crowd vertically.
3. Look for the amber advisor banner over the canvas with an **"Auto-fix layout"**
   button. If it does not appear, shrink the figure / confirm labels are on until the
   labels visibly overlap and it does.
4. Open the advisor's **Review** (the per-fix menu next to Auto-fix).
5. **Capture B1** of the menu. Expected fix list INCLUDES "Shrink the label font"
   (and possibly "Make the figure taller"), and does **NOT** include "Tilt the labels".
6. Click **Auto-fix layout**. Expected: the labels get smaller (font shrink) and the
   banner self-hides or the crowding visibly drops. The button flips to **"Undo
   auto-fix"**; clicking it reverts. (It should NOT tilt the labels to -45°.)

PASS if the menu has no "Tilt the labels" entry and Auto-fix shrinks the font (no tilt).

---

## Test C — Interactive linear map: cut-site / primer crowding chip

In the sequence editor's Map view, a molecule with many restriction sites stacks the
cut-site labels into deep tiers. At ≥5 tiers a dismissible amber chip should appear.

1. Open `BASE/sequences?demo=1`. Open a demo sequence that is a **plasmid / has many
   features** (pick the longest, most-annotated one in the list). If none exist, report
   BLOCKED.
2. Switch to the **Map** view (the Map/Sequence canvas toggle).
3. Turn **cut sites** ON (the rail/menu toggle "Show cut sites on the map"); if needed
   also turn **primers** on. This digests common enzymes → many cut-site labels.
4. **Capture C1.** Expected: when the cut-site/primer labels stack into many tiers
   above the line, an **amber chip** appears (sticky near the top of the map) reading
   roughly *"Cut-site & primer labels are N tiers deep. Hide a layer or zoom in…"*
   with **"Hide cut sites"** / **"Hide primers"** buttons and a dismiss ×.
5. Click **"Hide cut sites"**. Expected: cut sites turn off (rail toggle flips off), the
   stack collapses, the chip disappears. Click the × on a re-shown chip to confirm it
   dismisses.

PASS if the chip appears when the stack is deep and the Hide button turns the layer off.
If the densest demo sequence still does not reach ~5 tiers, report BLOCKED with the
deepest tier count you saw.

---

## Test D — Figure Composer: sequence-map content-overflow (optional / may be gated)

A linear sequence-map panel sized small in the Figure Composer stacks its features
off the top → the composer's per-panel advisor should flag it. This path may be gated
(the composer's add-figure UI is behind a flag in some builds) — if you cannot add a
sequence panel, report BLOCKED and skip.

1. Open the Figure Composer (try `BASE/figures` or the "Compose figure" entry; in demo
   mode if available).
2. Add a **sequence map** panel (a linear, feature-rich sequence).
3. Select the panel and **shrink it small** (short height).
4. **Capture D1.** Expected: the panel's advisor (amber banner in the "Selected panel"
   inspector) fires with a **content-overflow** style message ("…run off the edge of
   the figure") offering a **Shrink to fit** fix; applying it thins the rows.

PASS if the overflow advisory fires on a shrunk sequence panel. BLOCKED is an
acceptable result here.

---

## Report format

```
A (fan/inward callouts): PASS/FAIL — <one line>
B (advisor drops tilt):  PASS/FAIL — <one line>
C (cut-site crowd chip): PASS/FAIL/BLOCKED — <one line>
D (composer overflow):   PASS/FAIL/BLOCKED — <one line>
Console errors seen: <none / list>
```
Attach captures A1, A2, B1, C1, D1.
