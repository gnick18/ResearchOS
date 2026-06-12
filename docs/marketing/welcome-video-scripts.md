# Welcome page video record scripts

Record scripts for the redesigned welcome / what-we-offer page (`docs/mockups/welcome-redesign-2026-06-11.html`). One short looping clip per feature. Written 2026-06-11.

## How the videos are used (read first)
- They play in `DemoLoop`, a **silent, auto-looping** browser-chrome frame. So **no narration, no audio**, and design each clip to **loop cleanly** (end roughly where it began, no jarring cut).
- Target **10 to 15 seconds** each. Short and punchy beats thorough.
- The page already draws the browser chrome around the video, so **record just the app content** (no real browser frame, no OS chrome, no your-name UI).
- **Privacy, non-negotiable.** Record against **fixture / demo data, never your real research folder.** Use the demo (`research-os.app/demo` or a scratch folder seeded with fake-but-realistic content). The real data folder holds unpublished research and must never appear on screen.
- Capture at a clean resolution (1280x800 or 1440x900), light mode, cursor moving **slowly and deliberately** so a viewer can follow. Pause ~0.5s on the key result before the loop point.
- File naming matches the slots in the mockup. Hand me the files (or the Vercel Blob URLs) and I wire them in.

## Demo-ready check
Record the ones that are built and stable now. For features still being finished, the script is ready when the feature is, just flag it. From the lineup: Chemistry Workbench, Sequence editor, Purchases/Inventory, and the companion photo-capture clip are likely recordable now; **Data Hub** and the **AI assistant (BeakerBot)** record once they are far enough along (the AI is being verified in a separate chat). For the companion spotlight, the **handwriting-to-text** and **barcode inventory** clips depend on those features being built, flag any that are not ready yet and record them when they land.

---

## 1. Chemistry Workbench  ->  `chemistry-workbench.mp4`
**Goal in one line:** draw chemistry and pull a real compound, no ChemDraw license.
**Setup:** an open experiment note, the Chemistry Workbench reachable.
**Steps (~13s):**
1. Open the Chemistry Workbench (0 to 2s).
2. Draw a small, recognizable structure, a benzene ring or a short chain, with a couple of quick bonds (2 to 6s).
3. Use PubChem import, type a familiar name like "caffeine" or "aspirin", pick the result so the real structure appears (6 to 10s).
4. Drop or reference the structure into the experiment note, so it lands in the notebook (10 to 13s).
**Loop tip:** end back on the note with the structure visible, close to the opening frame.

## 2. Data Hub (stats + figures)  ->  `data-hub-stats.mp4`   (record when demo-ready)
**Goal:** run a real stat and make a publication figure, validated, no Prism.
**Setup:** a small fake dataset ready to paste (two groups, ~8 to 10 points each).
**Steps (~14s):**
1. Open Data Hub, paste or load the small dataset (0 to 4s).
2. Run a t-test or a simple comparison, show the result (p-value, means) appear (4 to 9s).
3. Generate a bar or box plot with error bars from the same data (9 to 13s).
4. Optional last beat, a quick glance at the validated-vs-Prism badge or the /transparency link (13 to 14s).
**Loop tip:** rest on the finished plot.

## 3. Sequence editor (cloning)  ->  `sequence-editor.mp4`
**Goal:** plan a cloning and see the map, no SnapGene.
**Setup:** a fake plasmid or two fragments loaded.
**Steps (~13s):**
1. Open the sequence editor on a plasmid, show the annotated circular or linear map (0 to 4s).
2. Set up a Gibson assembly or pick fragments to join (4 to 9s).
3. Show the assembled product / the map updating, or a digest result (9 to 13s).
**Note:** the existing `sequence-editor-a.mp4` can be reused if the UI still matches. Re-record only if it looks dated.

## 4. Purchases + Inventory  ->  `purchases-inventory.mp4`
**Goal:** track an order and inventory, no Quartzy.
**Setup:** the Purchases view with a few fake line items.
**Steps (~13s):**
1. Open Purchases, click New purchase, fill a quick fake item (a reagent, a price) (0 to 5s).
2. Attach a fake order PDF, show it attach (5 to 8s).
3. Show the item appear in inventory, or the PI "send to department" hand-off control (8 to 13s).
**Loop tip:** end on the populated purchases/inventory list.

## 5. Companion app (spotlight, four clips)
The companion app is its own spotlight section, so it gets four short clips, one per capability, plus an optional montage. Record them as a phone screen-capture (and cut to the desktop where the result lands). Each is a small loop on its own. You can also stitch them into one `companion-app.mp4` montage (~25 to 30s) if you prefer a single video in the phone frame.

**Shared setup:** the companion app on a phone, the desktop open to the same fixture experiment, fake-but-realistic content only. A quick cut from phone to desktop sells the "it lands on my computer" beat.

### 5a. Snap a photo into the experiment  ->  `companion-snap.mp4`
**Goal:** a bench photo lands in the right experiment, no cable, no retyping.
**Steps (~11s):**
1. Phone, open the companion app, snap or pick a fake gel/plate photo (0 to 4s).
2. Phone, route it to an experiment (4 to 7s).
3. Cut to the desktop, the photo appears in that experiment (7 to 11s).
**Loop tip:** end on the desktop experiment showing the new photo.

### 5b. Scan handwritten notes to text  ->  `companion-ocr.mp4`   (flag if not demo-ready)
**Goal:** a page of bench scrawl becomes searchable text in the experiment.
**Setup:** a handwritten fake note on paper (a quick protocol tweak, a few measurements).
**Steps (~12s):**
1. Phone, point the camera at the handwritten page in the companion app (0 to 4s).
2. Show the extracted text appear from the image (4 to 8s).
3. Save it as a note, then a quick cut to the desktop where the typed note sits in the experiment (8 to 12s).
**Loop tip:** end on the clean extracted text.

### 5c. Scan a barcode, inventory updates itself  ->  `companion-barcode.mp4`   (flag if not demo-ready)
**Goal:** scanning a reagent barcode auto-deducts inventory, no manual count.
**Setup:** a fake reagent box with a barcode, an inventory item set up for it with a starting count.
**Steps (~12s):**
1. Phone, open the scan view, scan the reagent barcode (0 to 5s).
2. Show the item recognized (5 to 8s).
3. Show the inventory count tick down automatically, on the phone or a cut to the desktop inventory (8 to 12s).
**Loop tip:** rest on the decremented count.

### 5d. Run methods on your phone, add variation notes  ->  `companion-method.mp4`
**Goal:** run a method at the bench in reading mode instead of printing, and log a variation on the go.
**Setup:** a fixture method with a few steps.
**Steps (~14s):**
1. Phone, open a method in reading mode, step through a couple of steps (0 to 6s).
2. Add a variation note from the phone, like "doubled the incubation, 60 min" (6 to 10s).
3. Quick cut to the desktop, the variation note is saved back to that run (10 to 14s).
**Loop tip:** end on the saved variation note.

**Montage option ->  `companion-app.mp4`:** play 5a, 5b, 5c, 5d back to back (~28s) for the single video that sits in the phone frame on the page. Record the four clips first, then I can stitch the montage if you want.

## 6. AI assistant (BeakerBot)  ->  `ai-assistant.mp4`   (record when demo-ready)
**Goal:** ask your own research in plain language, your data, your AI.
**Setup:** fixture data with a few notes/results worth querying.
**Steps (~14s):**
1. Open the search box / BeakerBot front door (0 to 3s).
2. Type a plain-English question over the fixture data, like "show my PCR runs that failed last month" or "summarize this week's experiments" (3 to 7s).
3. Show BeakerBot answer, pulling from the real fixture records, ideally with a small artifact (a summary, a count, a short list) (7 to 14s).
**Privacy note:** double-check the queried data is fixture, not real. **Token cost on screen is fine** (it reinforces the metered model), just make sure no real research is visible.

## 7. NIH + Zenodo  ->  `nih-zenodo.mp4`   (refresh)
**Goal:** grant-ready deposit in one click.
**Setup:** a fixture record ready to deposit.
**Steps (~11s):**
1. From a record, open the Zenodo deposit flow (0 to 4s).
2. Show the ORCID and grant-metadata fields carried in (4 to 8s).
3. Show the one-click deposit action (8 to 11s).
**Note:** the existing `nih-zenodo.mp4` may be reusable if the flow is unchanged.

---

## After recording
- Send me the files or the Vercel Blob URLs (current videos live at `tkqei2x7bdmdvg7v.public.blob.vercel-storage.com`).
- I wire each into its slot when I build the real redesigned `WelcomePage` (after you approve the mockup structure).
- Posters: a `*.poster.jpg` first-frame still per video is nice for fast load, the existing ones follow that pattern. I can grab those from the videos if you prefer.
