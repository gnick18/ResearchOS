# Claude-in-Chrome test prompt: Extract to new sequence

Paste the block below into the Claude-in-Chrome extension. It drives the new
"Extract to new sequence" feature with the mouse against a preloaded folder.

Preconditions (Grant):
- Dev app running at http://localhost:3000 (local main, has the feature).
- Test folder preloaded at ~/Desktop/ResearchOS-Extract-Test (demo lab "alex",
  plasmid pEGFP-N1 + vectors). Rebuild it any time with:
  `rm -rf ~/Desktop/ResearchOS-Extract-Test && cp -R <repo>/frontend/public/demo-data ~/Desktop/ResearchOS-Extract-Test`

---

You are testing a feature in a local web app with the mouse. Work in the active
Chrome tab. Go slowly and report what you see at each step.

GOAL: verify the new "Extract to new sequence" button in the ResearchOS sequence
editor. It takes a selected gene feature (or a base selection) and creates a new
standalone sequence from just that region.

SETUP
1. Open a new tab to http://localhost:3000 and wait for it to finish loading.
2. You will hit a screen to connect a data folder. Click the button labeled
   "Open a folder". A native macOS folder picker will open that you CANNOT
   control. STOP and tell the user: "Please choose the folder
   ~/Desktop/ResearchOS-Extract-Test in the dialog and click Open." Wait until
   the app moves past the picker on its own.
3. If the app shows a list of users or accounts, click "alex" (there is no
   password). If it shows any onboarding or welcome screens, click through them
   to reach the main app. If you get stuck, screenshot it and ask the user.

TEST A: extract a gene feature
4. In the top navigation, click "Sequences".
5. In the sequence list, click "pEGFP-N1 (U55762)". Wait for the circular
   plasmid map to render.
6. Click the "Features" tab (the row of tabs reads Map / Sequence / Features /
   Primers / History). In the features list, click the row for "egfp" (the
   enhanced green fluorescent protein gene, a CDS). It should highlight as
   selected.
7. Find the "Extract" button. It is in the bottom toolbar on the right, next to
   the selection readout (the small text showing length / bp). It has a scissors
   (cut) icon and the word "Extract". Its test id is seq-extract-region-btn.
   NOTE: it is greyed out and disabled until a feature or a base range is
   selected, so confirm it is now ENABLED, then click it.
8. PASS CHECK. Confirm all of these:
   - A new sequence named "egfp (from pEGFP-N1 (U55762))" appears.
   - The editor automatically switches to that new sequence.
   - Its length is about 720 bp (much smaller than the 4,733 bp plasmid).
   - It also shows in the sequence list.
   Take a screenshot of the new sequence open in the editor.

TEST B: extract a base range
9. Open "pEGFP-N1 (U55762)" again from the list. Click the "Sequence" tab to see
   the bases. Click and drag across a stretch of roughly 60 to 100 bases to
   select them (you should see a selection highlight and the readout update).
10. The "Extract" button should enable again. Click it.
11. PASS CHECK: a new sequence named like "pEGFP-N1 (U55762) region <start>..<end>"
    is created and opens. Screenshot it.

TEST C (optional, the cloning showcase)
12. Go back to the sequence list. Open the cloning workspace (look for an
    "Assemble" or "Cloning" action). Choose the Gibson / overlap method. Select
    your extracted egfp fragment as the insert and "pGEX-3X (U13852)" as the
    vector. Review the product, then Save. Confirm a new recombinant sequence
    lands in the library.

REPORT
For each step say whether the mouse interaction worked. Call out specifically:
- Did clicking the "egfp" feature row select it and ENABLE the Extract button?
- Did the new sequence open automatically after clicking Extract?
- Was the extracted length right (about 720 bp for egfp)?
- Did the base-range extract (Test B) work the same way?
Note anything that felt wrong (button not enabling, wrong length, no auto-open,
layout or overlap issues, console errors). Include the screenshots. If a step
blocks you, describe exactly what is on screen so it can be relayed back.
