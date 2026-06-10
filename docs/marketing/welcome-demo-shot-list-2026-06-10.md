# Welcome page demo videos, recording shot list

Date 2026-06-10. For the reimagined `/welcome` sell page. You record, I script and wire.

All eight clips are loops that autoplay muted on the page, so each one should
start and end on the same resting frame (no cursor jump at the loop seam) and
run about six to twelve seconds. Record everything in the demo fixture lab, never
a real data folder.

## Where the clips live on the page

`frontend/src/components/welcome/WelcomePage.tsx`. Five already point at real
mp4s, three are still placeholders. The eight output filenames must match the
existing Vercel Blob names so the swap is a clean re-upload:

| # | filename | page slot | status today |
|---|----------|-----------|--------------|
| 1 | `sequence-editor-a.mp4` | flagship hero loop | real mp4, refresh wanted |
| 2 | `replaces-5-tools.mp4` | bento "replaces five tools" | real mp4, refresh wanted |
| 3 | `methods-library.mp4` | bento "91 protocols" | real mp4, refresh wanted |
| 4 | `pi-lab-overview.mp4` | bento "the PI sees the whole lab" | real mp4, refresh wanted |
| 5 | `own-your-data.mp4` | own-your-data trust block | real mp4, refresh wanted |
| 6 | `gibson-cloning.mp4` | bento "Gibson and Golden Gate" | placeholder, needs first capture |
| 7 | `snap-from-bench.mp4` | secondary "from your phone to your inbox" | placeholder, demo already seeded, recordable |
| 8 | `nih-zenodo.mp4` | secondary "grant-ready deposits" | placeholder, needs first capture |

## Recording setup (do this once)

1. Run the app the normal way you already have on `:3000`, or a production build
   if you want the cleanest frame (`cd frontend && npm run build && npm run start`).
   The dev-only chips ("Dev: restart server", "Dev: fresh ephemeral session")
   render in the bottom-left in dev. Either record a production build or keep your
   capture region above and to the right of them so they stay out of frame.
2. Chrome window sized so the app content is roughly 1440 wide. Hide bookmarks bar.
3. Capture with macOS `Cmd-Shift-5`, choose "Record Selected Portion", and draw
   the box tight around the app content (no browser chrome, no dev chips). That
   saves a `.mov`.
4. Convert each `.mov` to a loop-ready mp4 with:
   ```
   ffmpeg -i in.mov -vf "scale=1600:-2,fps=30" -c:v libx264 -pix_fmt yuv420p \
     -crf 23 -an -movflags +faststart out.mp4
   ```
   Name the output exactly as the table above. Drop all the mp4s in one folder and
   tell me the path, I will upload them to the Blob bucket and wire the three
   placeholders over to real `DemoLoop` players.

## Entering the demo lab

Go to `localhost:3000/demo`. It loads the fixture and signs you in as Alex Rivera
(a lab member). Deep links work too, for example `/demo/sequences` lands you
straight on the Sequences tab. The fixture has four people: alex and morgan and
sam (members) and mira (lab head), one synthetic biology lab.

---

## Clip 1, `sequence-editor-a.mp4`

What it sells: the built-in sequence and plasmid editor.

1. Go to `/demo/sequences`.
2. Click the plasmid `pEGFP-N1` in the list (4,733 bp circular).
3. The editor opens. At the bottom strip click the `Map` tab to show the circular
   map.
4. Click the `Restrict. Sites` chip in the toolbar so the restriction sites layer
   draws on the map.
5. Hover or drag-select a stretch of sequence so the floating `start..end, length
   bp, GC%` badge shows, then release.

Resting frame for the loop: the circular map sitting still with the sites layer on.

Surface: `components/sequences/SequenceEditView.tsx`, `SequenceDisplayStrip.tsx`.

## Clip 2, `replaces-5-tools.mp4`

What it sells: one workspace instead of five tools. A quick tab-to-tab montage.

Click across the top nav, pausing about one second on each so the content paints:
1. `/workbench` on the Projects sub-tab (project cards with progress).
2. The `Experiments` sub-tab (task list with image thumbnails).
3. `GANTT` top tab (timeline bars across the team).
4. `Methods` top tab (the protocol card library).
5. `Sequences` top tab (plasmid list).
6. `Purchases` top tab (order table with funding rollup).

Resting frame: end back on Workbench Projects so the loop returns cleanly.

Surface: `components/AppShell.tsx` nav plus each page under `app/`.

## Clip 3, `methods-library.mp4`

What it sells: the 91-protocol starter library.

1. Go to `/demo/methods`.
2. Click `New method` (top right, blue).
3. In the modal click `Browse templates` (the `Templates` segment).
4. Click a category, for example Molecular biology.
5. Click a template card, for example a PCR protocol, so the right panel shows the
   description, ingredients, and steps.

Resting frame: the template preview panel open and still.

Surface: `components/methods/MethodTemplateLibraryModal.tsx`,
`MethodLibraryDetail.tsx`.

## Clip 4, `pi-lab-overview.mp4`  (needs a demo affordance, flagged below)

What it sells: the lab-head dashboard, every member's projects and funding at a
glance. The fixture signs you in as Alex (a member), and `/lab-overview` is gated
to the lab head, so out of the box you cannot reach this view in demo. See the
"Two flagged clips" section, I can add a small demo-only "View as lab head" toggle
so you can record it.

Once you are viewing as Mira:
1. Go to `/lab-overview`.
2. Let the team projects section paint (project name, owner color chip, task count).
3. Scroll slowly to the funding table (DEMO-NIH-GM999999 and the two others) and
   the team Gantt with one colored bar row per member.

Resting frame: the top of the overview with the team projects grid.

Surface: `app/lab-overview/page.tsx`, `components/lab-overview/LabOverviewPage.tsx`.

## Clip 5, `own-your-data.mp4`

What it sells: the notebook is a plain folder you own, not a cloud silo. This one
reads best as a real folder, not the in-memory demo (the demo has no folder on
disk). Two honest options, your call:
- Option A, record Finder open on a real ResearchOS data folder you already have,
  showing the `users/<name>/` structure with `notes`, `tasks`, `sequences`
  subfolders, then a quick cut to the same content inside the app. Use one of your
  own test folders, not the real research folder (privacy rule).
- Option B, keep it in-app only: `/demo/workbench` on the `Notes` sub-tab, open
  "Lab observations (running log)", and let the framing copy carry the "it is just
  a file on your disk" point without showing Finder.

Resting frame: either Finder still on the folder, or the note open and still.

## Clip 6, `gibson-cloning.mp4`

What it sells: in-silico Gibson and Golden Gate cloning.

1. Go to `/demo/sequences` and open a plasmid.
2. In the operations rail on the right, click `Assemble` (the Cloning panel).
3. In the Cloning Workspace click the `Overlap` method pill (this is Gibson).
4. Click `Add fragment` and pick two sequences from the library.
5. Let the junction primers and product preview render.
6. Optional second beat: click the `Golden Gate` pill and pick an enzyme (BsaI) to
   show the second chemistry.

Resting frame: the assembled product preview card still on screen.

Surface: `components/sequences/CloningWorkspace.tsx`, `CloningProductPreview.tsx`.

## Clip 7, `snap-from-bench.mp4`

What it sells: snap a photo on the bench from your phone and it lands in the app
inbox. The demo is already seeded with four "received from the phone" bench photos
(handwritten bench notes, an agar patch plate, a PCR gel, a microscope field), so
this is recordable today.

1. On any `/demo` page, click the `Inbox` pill in the top header (it shows a `4`
   badge).
2. The Inbox popup opens on the `Photos` tab with the four bench photos, each with
   a caption and a timestamp.
3. Hover a row to show the `Move to active` and `Delete` actions, then click a
   photo thumbnail to open the larger preview.
4. Optional second beat: click `Move to active` on the gel photo to show a snap
   getting filed into the live workspace.

Resting frame: the Inbox popup open on the Photos tab with the four rows still.

Surface: `components/InboxBadge.tsx` (the header pill) opens
`components/InboxPanel.tsx`, Photos segment `components/PhotosInboxTab.tsx`. Seeded
photos live under `public/demo-data/users/alex/inbox/Images/`.

## Clip 8, `nih-zenodo.mp4`

What it sells: grant-ready repository deposits.

1. Go to `/demo/workbench`, click the `Experiments` sub-tab.
2. Open the task "Yeast transformation: pYES-GAL1::flbA".
3. In the task detail click `Deposit to a repository`.
4. Step through the dialog: Curation (the include checkboxes), then `Next` to
   Metadata (the prefilled title, ORCID, grant number form), then `Next` to
   Handoff with `Zenodo` selected in the repository dropdown.

Resting frame: the Handoff step with Zenodo selected and the download button shown.

Surface: `components/DepositDialog.tsx`, `lib/deposit/*`.

---

## One clip needs a demo affordance (now built)

Clip 4 (PI overview) is the only one the demo could not reach out of the box,
because the fixture signs you in as Alex (a member) and `/lab-overview` is gated
to the lab head. Added a demo-only "View as lab head" toggle (renders only in demo
tabs, invisible in real use) so you can flip to Mira and record the dashboard. See
the toggle in the demo, then follow the clip 4 steps above.

Clip 7 turned out to need no new work, the demo was already seeded with four bench
photos in the inbox (Grant had asked whether we still seed it, we do).

Everything (clips 1 through 8) is recordable today with the steps above.
