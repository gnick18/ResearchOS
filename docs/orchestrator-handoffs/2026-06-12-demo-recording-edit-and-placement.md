# Handoff: demo-video recording, editing, and placement (2026-06-12, late)

Continues the demo-recorder lane (`2026-06-12-demo-recorder-and-record-prep-agent.md`).
This session scripted the remaining clips, fixed many record-time issues, helped
Grant record + edit all of them, and reached the placement step. All code is on
LOCAL main (Grant pushes); the edited videos live in `~/Desktop/FinalRecords/`.

## The clip set (all in `frontend/src/lib/demo-video/scripts.ts`)
Seven clips, all RECORDED by Grant and edited:
- `chemistry` (caffeine: import -> properties -> substructure -> **literature explorer**)
- `datahub` (open table -> **guided analysis wizard RUN** -> BeakerBot verdict -> figure tweaks)
- `sequences` (pEGFP-N1: spin map, enzymes, translation, Tm drag, **completes a real Gibson assembly + saves**)
- `purchases` (filter by stage + by category, both now narrow; line items; spending; new purchase)
- `sequencesNcbi` (guided NCBI import wizard, cyp51A walk)
- `chemistryGliotoxin` (gliotoxin: import -> literature explorer + star)
- `checkins` (recorded as Mira via `?demoViewAs=mira`: mentorship tree, IDP, group board, rotation, templates)

Launcher: `localhost:3000/dev/demo-videos` (now renders in ANY browser incl Safari).

## GRANT'S PREFERENCES (locked this session)
- **Chemistry slot = gliotoxin** (`chem2`), NOT caffeine. He likes gliotoxin more.
- **Both sequence clips are keepers** (`seq` = editor/Gibson, `ncbi` = guided import).
  Placement of the 2nd seq clip is the open layout question (two-up sequences
  section vs put one on another surface).

## THE REMAINING WORK = video placement (NOT started)
The welcome page (`frontend/src/components/welcome/WelcomePage.tsx`) does NOT use
local files. It references videos by **Vercel Blob URL**
(`https://tkqei2x7bdmdvg7v.public.blob.vercel-storage.com/<name>.mp4` + `.poster.jpg`),
e.g. `sequence-editor-a.mp4` at line ~1006, `nih-zenodo.mp4` at ~1295. Source
copies live in `demo-recordings/processed/*.mp4`. So shipping the six edited clips is:
1. **Upload to Vercel Blob** (GRANT'S side: needs the Blob token; `vercel blob` or the dashboard). Each needs an `.mp4` + a `.poster.jpg`.
2. **Wire the welcome page** `<video src>`/`poster` URLs (next session, after upload). Decide the lineup: gliotoxin=chemistry, datahub, purchases, + the two sequence clips (Grant likes both; pick two-up section or relocate one).
3. Consider also surfacing clips on feature pages / the `/ai` page / wiki.

### The edited videos (ready, in `~/Desktop/FinalRecords/`, NOT in the repo)
All Retina 60fps, h264, no audio, trimmed head/tail; chem + gliotoxin also had a
~20s frozen mid-gap cut out (the gap was a slow live Europe-PMC 200-paper fetch).
- `chem-trimmed.mp4` (32.1s) — caffeine
- `chem2_gliotoxin-trimmed.mp4` (26.5s) — **gliotoxin (the chemistry pick)**
- `datahub-trimmed.mp4` (27.2s)
- `ncbi-trimmed.mp4` (34.6s) — guided NCBI import
- `purchase-trimmed.mp4` (17.4s)
- `seq-trimmed.mp4` (46.5s) — editor/Gibson
Originals (`*.mov`) untouched alongside. Editing recipe: `ffmpeg` freezedetect to
find static head/tail + any frozen mid-gap, then trim/concat (frozen segments cut
seamlessly because the frames are identical). Posters not yet generated.

## WELCOME PAGE NOW WIRED (commit b9edcd90e) -> Grant uploads to Blob
The three coming-soon `DemoLoopPlaceholder`s in `WelcomePage.tsx` are now real
`DemoLoop`s pointing at Blob URLs. Upload each trimmed clip + a `.poster.jpg`
(first frame) to the Vercel Blob bucket under EXACTLY these names so the wired
URLs resolve:
- `chem2_gliotoxin-trimmed.mp4` -> **chemistry-gliotoxin.mp4** (+ chemistry-gliotoxin.poster.jpg)
- `datahub-trimmed.mp4` -> **data-hub.mp4** (+ data-hub.poster.jpg)
- `purchase-trimmed.mp4` -> **purchases.mp4** (+ purchases.poster.jpg)
- `seq-trimmed.mp4` -> OVERWRITE the existing **sequence-editor-a.mp4** (+ sequence-editor-a.poster.jpg) — that slot (FeatureRow 5) is unchanged in code, so overwriting the Blob swaps in the new richer-plasmid/Gibson clip.
- `ncbi-trimmed.mp4` -> **sequence-ncbi.mp4** (+ sequence-ncbi.poster.jpg) — NOW WIRED (next session): the sequence FeatureRow 5 visual is a stacked two-up, Gibson/editor clip on top + this guided-NCBI-import clip below, with a 4th bullet ("Pull any published sequence straight from NCBI by gene name"). Upload under this exact name and both sequence clips resolve.
Poster gen (per clip): `ffmpeg -i X-trimmed.mp4 -frames:v 1 -q:v 3 X.poster.jpg`.
STILL NO SLOT (layout follow-up): `chem-trimmed.mp4` (caffeine, deprioritized vs gliotoxin), the `checkins` clip (the check-ins FeatureRow 6.5 uses the div-based `CheckinsVisual`, not a video), and the NL-query placeholder at WelcomePage ~1177 (no clip recorded for it).

## BUILD FIX THAT MUST BE PUSHED
`d071e4fc7` fixes the prod build (it FAILED on commit 79e2aa4): the AI-helper
privacy guard (`scripts/build-ai-helper.mjs` `ALLOWED_FIXTURE_OWNERS`) only allowed
alex/morgan/mira/sam/public/lab, so the seeded `remy` persona broke it. Added
remy/nia/theo/ivy. **Push local main + redeploy** to clear prod. (Verified the
prebuild step locally: build-ai-helper + check-ai-helper pass.)

## Record-time fixes shipped this session (all local main)
- Literature explorer was UNREACHABLE (no mount passed `molecule`); wired it into
  MoleculeDetail, then made it the **default full-page view** (inline, no "View all").
- Substructure clip query was chemically wrong (aromatic purine vs xanthine);
  switched to benzene `c1ccccc1` (matches Resveratrol).
- Nav flattened in record mode (`?record=1`) so module tabs are not hidden in More.
- Routes prefetched during the countdown (warm the page) + literature prewarm bumped
  to 200 papers to match the molecule Papers fetch (killed the ~20s on-camera gap).
- BeakerSearch: new bottom bar SHOWN in record mode, legacy nav pill HIDDEN (both record-gated).
- NCBI over-cap block now hands you the same genome (Datasets web link + pre-filled CLI).
- pEGFP-N1 enriched to 15 features + 3 primers; sequences clip completes a Gibson (fragments 4+5 -> 4733 bp).
- Purchases: stage spread + a Miscellaneous order for alex AND morgan so both filters narrow.
- Companion (mobile): testIDs + 6 Maestro flows + run guide (`mobile/.maestro/`), and
  demo-mode gaps closed (camera bypass, sendTextNote demo success, notebooks fixture).
  Grant runs Maestro on his Android setup; build-then-he-runs.

## STANDING HAZARD: demo-fixture drift (recurring)
The generator (`scripts/generate-demo-data.mjs` `buildEntries`) is OUT OF SYNC with
its two committed outputs (on-disk `frontend/public/demo-data/` + the in-memory
`frontend/src/lib/file-system/wiki-capture-fixture.ts`). Several sessions hand-edit
the outputs (nia/theo/ivy users, phylo trees, my purchase/check-ins seeding) ahead
of the generator. A full `node scripts/generate-demo-data.mjs` WIPES this (drops
nia/theo/ivy + the binary result PNGs the generator can't reproduce) — it caused
3 near-misses this session (each recovered via `git checkout --`). RULE this
session: update all three places (generator literal + both outputs) SURGICALLY by
string edit, NEVER by regen. A proper "regenerate + reconcile from the generator"
pass is still owed (a chip was spawned earlier, now superseded by more drift), AND
keep `build-ai-helper`'s `ALLOWED_FIXTURE_OWNERS` in sync with the demo roster.

## Chrome-test prompts written (for Grant)
- `docs/test-prompts/2026-06-12-ncbi-wizard-and-lit-explorer-chrome-test.md` (incl A3 = the over-cap Datasets escape)
- `docs/test-prompts/2026-06-12-checkins-clip-chrome-test.md`
