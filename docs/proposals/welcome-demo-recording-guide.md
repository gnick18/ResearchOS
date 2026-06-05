# Welcome page demo recording guide

Exact recording instructions for every demo loop on the new `/welcome` page.
Companion to `welcome-page-redesign.md`. Click-paths verified against the live
code 2026-06-04, so the button names below are the real ones.

## Before every clip (applies to all)

- FIXTURE MODE ONLY. Append `?wikiCapture=1` to the URL, or use `/demo`. Never
  record your real data folder. Hard rule.
- Drop the raw recording into `demo-recordings/` named after the feature (see
  that folder's README). I do all trimming, cropping, scaling, and encoding.
  You never crop or convert anything.
- Do Not Disturb on. Hide the dock, notifications, personal bookmarks, menubar
  clutter. Bump the browser page zoom so text survives the 720p downscale.
- One action per clip, roughly 6 to 15 seconds. Move the cursor slowly and
  pause on the key moment. Record a couple calm seconds before and after.
- Keep the browser window the same size across every clip so the bento cells
  line up.

---

## HERO 1. Sequence / plasmid editor

Two clips. This is the strongest feature, so it gets the most care.

### Clip A: the plasmid map (file `sequence-editor-a.mov`)
Sells: "it renders a real annotated plasmid like SnapGene."
1. Go to the **Sequences** tab.
2. Click a plasmid in your library to open it. The circular map renders with
   colored feature arcs.
3. Slowly hover one or two features so their annotation labels surface.
4. Optionally nudge the zoom or rotate so the map feels alive.
Loop centers on: the map on screen with a feature label showing.

### Clip B: run a cloning reaction (file `sequence-editor-b.mov`)
Sells: "it designs your cloning and your primers for you." This is the money clip.
1. On the **Sequences** tab, click **Assemble** in the top toolbar (next to New).
2. The "Assemble construct" workspace opens on the **Overlap** tab (Gibson).
3. From the right-hand "Your DNA library," click your **insert** to add it, then
   click your **vector backbone**. They appear numbered 1 and 2 on the left.
4. Leave topology on **Circular (plasmid)** and overlap at the default 20 bp.
5. Click **Review junctions** (bottom right).
6. The review shows the assembled recombinant plasmid, each junction with its
   overlap and Tm, and a full **oligo order list** of primers it designed.
   Pause here, this is the wow frame.
7. Optionally type a construct name and click **Save to library**, which opens
   the new plasmid as a circular map.
Loop centers on: the moment the review screen populates with the product and the
auto-designed primer table.

Prep: you need at least two DNA sequences in your library (an insert and a
backbone). If the demo library is empty, tell me and I will seed a couple of
demo plasmids, or use the **Paste a sequence** button inside the workspace.

---

## HERO 2. You own your data

One clip. File `own-your-data.mov`.
Sells: "your whole notebook is just a plain folder you own."
1. Start on the connect-folder screen (or Settings, the folder picker).
2. Click the choose-folder action and pick a local folder. The app loads it.
3. Now the reveal: switch to a **Finder window** showing that same folder on
   disk, with its plain files visible (notes, images, the project folders).
   Slowly scroll or open a subfolder so it reads as "these are just my files."
Loop centers on: the Finder folder of plain files sitting on the machine, ideally
side by side with the app showing the same content.

Prep: a fixture folder with some content. Have the Finder window open and sized
before you record so the cut is clean.

---

## HERO 3. Replaces 5 tools

One clip, a montage. File `replaces-5-tools.mov`.
Sells: "one workspace instead of five separate tools."
1. Start on **Workbench** with a notebook entry open.
2. Click through the nav deliberately, pausing about 2 seconds on each:
   **GANTT** (the timeline), **Methods** (a protocol open), **Purchases** (the
   spending dashboard), **Calendar** (the month view).
3. One smooth pass, no backtracking.
Loop centers on: the whole sweep. I may speed-ramp the cuts slightly in post so
it lands in one breath.

Prep: fixture data populated on each of the five tabs so none looks empty.

---

## HERO 4. Preloaded biotech methods library

One clip (optionally two). File `methods-library.mov`.
Sells: "real lab protocols ship with it, ready to run."
1. Go to the **Methods** tab.
2. Click **Template library** in the header (the stacked-cards button).
3. Browse the catalog of real protocols (PCR, qPCR, LC-MS kits, cell culture).
   Slowly scroll so the breadth reads.
4. Open one template, then click **Use template**. It creates your own editable
   copy.
5. Open that method to show the structured protocol: the thermal gradient, the
   reaction recipe table, and the bench checklist you tick off as you add each
   reagent.
Loop centers on: the catalog of protocols, then the opened structured recipe.

Optional second beat (file `methods-library-b.mov`) for the "does the math"
angle: open **Calculators** (the calculator button in the app shell) and use
**Molarity** or **Serial dilution**, typing a value and watching it compute.
Note: the math lives in Calculators, the recipe table itself is a structured
protocol plus a bench checklist, not a sample-count auto-scaler.

---

## COMING SOON. Live collaboration

No recording. Not built yet. This slot gets a tasteful "coming soon" mock, two
cursors on one note, badged as on the roadmap. Revisit when the collab MVP ships.

---

## SECONDARY 1. Snap from the bench

Files `snap-from-bench-phone.mov` (phone) and `snap-from-bench-desktop.mov`
(desktop). See the production note in the chat for the phone-vs-camera decision.
Sells: "capture from your phone at the bench, it lands in your notebook."
Flow to capture:
1. PHONE side: in the ResearchOS Telegram chat, attach and send a photo.
2. DESKTOP side: the **Inbox** badge updates. Open the Inbox, the photo is there.
3. Use **Move to active** (or the attach action) to drop the photo onto an open
   note or experiment.
Loop centers on: the photo landing in the inbox and attaching to the experiment.
I composite the phone and desktop clips together (phone in a device frame, then a
cut to the desktop inbox).

Prep: the Telegram bot paired (the pairing modal in Settings), and a phone with
the chat open. Fixture experiment open on the desktop to attach into.

---

## SECONDARY 2. PI Lab Overview

One clip. File `pi-lab-overview.mov`.
Sells: "the PI sees the whole lab at a glance."
1. Signed in as a lab-head (PI) fixture account, go to **Lab Overview**
   (`/lab-overview`).
2. The dashboard shows member tiles, their projects, funding, and progress.
   Slowly scroll the dashboard.
3. Optionally reconfigure or drag a widget so it reads as configurable.
Loop centers on: the populated PI dashboard.

Prep: a PI fixture account with a few members and projects.

---

## SECONDARY 3. NIH compliance + Zenodo

One clip. File `nih-zenodo.mov`.
Sells: "deposit to a public repository with grant metadata, compliance handled."
1. Open a **project**.
2. Click **Deposit to a repository** (the deposit button at the top of the
   project surface).
3. Step 1 **Curation**: pick the files to include in the bundle.
4. Step 2 **Metadata**: the form is prefilled from the project and your ORCID.
   Fill anything missing, especially the license.
5. Step 3 **Handoff**: pick the repository (Zenodo), and it builds the
   repository-ready bundle plus the metadata file.
Loop centers on: the metadata step prefilling, then the repository handoff.

Prep: a fixture project with a few files attached, and an ORCID set in settings.

---

## After you record

Drop the files in `demo-recordings/` and tell me which are in. I will install
ffmpeg (one time), then trim each to a clean seamless loop, crop to the content,
downscale to 720p, strip audio, encode to web MP4 plus WebM, and generate the
poster frame that doubles as the reduced-motion fallback. The encoded loops get
hosted off the repo (Vercel Blob or a CDN), never committed to `frontend/public`.
