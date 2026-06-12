# Claude-in-Chrome test prompt: Guided NCBI import + Literature explorer

Two features to validate with the mouse against a preloaded folder, plus the
size-guard confirm and the literature-explorer entry-point fix.

Preconditions (Grant):
- Dev app running at http://localhost:3000 (local main, has both features).
- A connected data folder (the demo lab "alex" works). The extract test folder
  reused here is fine, it has sequences + chemistry:
  `rm -rf ~/Desktop/ResearchOS-Extract-Test && cp -R <repo>/frontend/public/demo-data ~/Desktop/ResearchOS-Extract-Test`
- Live internet (both features hit NCBI / PubChem / Europe PMC directly).

What we most need confirmed (the unverified bits):
- The guided NCBI wizard runs end to end with the MOUSE (every step is a live
  call, and a couple of clicks target rows that were never exercised live).
- The whole-genome / whole-chromosome SIZE CONFIRM appears and Cancel is a real
  escape (no soft-lock).
- The "View all" Literature explorer button now APPEARS and opens (it shipped
  unreachable before this fix), and starring a paper persists.

---

You are testing features in a local web app with the mouse. Work in the active
Chrome tab. Go slowly and report what you see at each step. These steps make live
calls to NCBI and PubChem, so allow a few seconds for results and say so if a
step is slow rather than assuming it failed.

SETUP
1. Open a new tab to http://localhost:3000 and wait for it to finish loading.
2. If you hit a screen to connect a data folder, click "Open a folder". A native
   macOS picker opens that you CANNOT control. STOP and tell the user: "Please
   choose ~/Desktop/ResearchOS-Extract-Test in the dialog and click Open." Wait
   until the app moves past the picker on its own.
3. If the app shows a list of users, click "alex" (no password). Click through any
   welcome/onboarding screens to reach the main app. If stuck, screenshot and ask.

== FEATURE 1: Guided NCBI genome import (the cyp51A walk) ==

TEST A1: walk the wizard to a windowed gene import
4. In the top navigation, click "Sequences" and wait for the list to load.
5. Near the top-right of the sequences area, click the button "Download from
   NCBI". A dialog titled "Download from NCBI" opens onto step 1 "Which organism?".
6. In the organism input, type: Aspergillus fumigatus
   Wait ~1 to 2 seconds. A list of taxon suggestions should appear below.
7. Click the suggestion whose name is "Aspergillus fumigatus" (it shows a rank
   and a taxid). The wizard advances to step 2 "Genomes for Aspergillus
   fumigatus" and lists assemblies (one should carry a green "Reference" badge).
8. IMPORTANT SELECTOR CHECK. Click the assembly ROW itself (the left part of the
   row with the accession like GCF_000002655.1, NOT the "Whole genome" button on
   the right). It should advance to step 3 "Chromosomes in ...". Report clearly
   whether clicking the row advanced you. If nothing happens, screenshot it.
9. On step 3, click the button "Search a gene instead" (bottom right). The wizard
   advances to step 4 "Search a gene".
10. In the gene input, type: cyp51A   then click "Search".
    Wait a few seconds for hits to return.
11. IMPORTANT PLACEMENT CHECK. Click the FIRST result row. A clickable (enabled)
    row shows a chevron on the right; a row that reads "no placement" is disabled.
    Confirm the first row is enabled and clicking it advances to step 5 "Grab a
    window around cyp51A". If the first row is disabled, say so and click the
    first ENABLED row instead.
12. On step 5, leave the flank at its default (1000). Note the region readout (it
    should reference a chromosome accession like NC_007197.1 and a small size,
    roughly 3 to 4 kb). Click "Import this region".
13. PASS CHECK. After a moment you reach a "Imported into your library" done
    screen. Click "Done". Confirm a new sequence for the cyp51A region appears in
    the list and opens, much smaller than a whole chromosome. Screenshot it.

TEST A2: the size guard on a big download (no soft-lock)
14. Open "Download from NCBI" again. Type Aspergillus fumigatus, pick the species,
    and on the step 2 assemblies list click the "Whole genome" button on the
    reference assembly's row (the right-hand button this time).
15. PASS CHECK. After a brief "Checking the genome size" moment, an amber confirm
    card should appear reading approximately "This download is about 29 Mb ...
    Import it anyway?" with two buttons, "Cancel" and "Download anyway".
16. Click "Cancel". Confirm the card disappears and you are still on the assemblies
    list with nothing downloaded (the escape works, not trapped). Screenshot the
    confirm card before cancelling.
    (Do NOT click "Download anyway" unless you want to wait on a ~29 Mb download.)

== FEATURE 2: Chemistry literature explorer (gliotoxin) ==

TEST B1: import gliotoxin, then open the explorer
17. In the top navigation, click "Chemistry".
18. In the left rail, choose the "Import from PubChem" option. In its search box
    type: gliotoxin   then run the search. Wait for candidate structures.
19. Click the Import button on the top result. Wait for the molecule detail view
    to open (a large structure depiction + properties).
20. Scroll down to the "Papers & patents" area. If it shows a button "Find papers
    and patents for this molecule", click it to expand. Wait a few seconds for the
    live results (a papers/patents count appears).
21. KEY FIX CHECK. Confirm a button labeled "View all" (and/or a link "Open full
    explorer") is now present next to the results. Click it. A large "Literature
    for gliotoxin" explorer dialog should open. Report clearly whether this button
    EXISTED and OPENED, this is the specific thing that was broken before.

TEST B2: filters, year range, and starring
22. In the explorer's left rail, confirm the Type checkboxes (Research / Reviews /
    Patents) each show a count, and a small per-year histogram is drawn.
23. Uncheck "Research", confirm the results list shrinks, then re-check it.
24. In the two year boxes (e.g. showing an older year "to" the current year),
    change the left (from) box to 2015 and press Enter. Confirm the histogram and
    the results list rescale to 2015 onward.
25. Click the star outline on the first paper row. It should turn amber and a brief
    "Saving" indicator may flash. Screenshot the starred row.
26. Close the explorer (press Escape or the X). PASS CHECK: back on the molecule
    detail, a small starred-papers strip should now show the paper you starred
    (proof it persisted to the molecule). Screenshot it.

REPORT
For each step say whether the mouse interaction worked. Call out specifically:
- NCBI wizard: did clicking the assembly ROW (step 8) advance to chromosomes?
- NCBI wizard: was the FIRST cyp51A gene hit (step 11) enabled and clickable?
- NCBI wizard: did the windowed import produce a small annotated sequence?
- Size guard: did the amber "~29 Mb, import anyway?" card appear, and did Cancel
  cleanly back out (step 16)?
- Lit explorer: did the "View all" / "Open full explorer" button appear and open
  the explorer (step 21)?
- Lit explorer: did the year filter rescale results, and did starring persist as a
  strip after closing (steps 24 to 26)?
Note anything that felt wrong (a click that did nothing, a missing button, a wrong
size, a trapped state, layout overlaps, or console errors). Include the
screenshots. If a step blocks you, describe exactly what is on screen so it can be
relayed back.
