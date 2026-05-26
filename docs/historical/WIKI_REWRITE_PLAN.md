# Wiki rewrite plan (writer bot, branch claude/naughty-pascal-f22111)

Audit verdicts and screenshot specs for the concept-first rewrite pass.
This file lives at the repo root and will be deleted before merge.

## Shape, restated

Each rewritten page opens with **What is X?** (define the domain object and
its mental model BEFORE any UX details), then **How to do Y?** sections for
each common workflow, each with its own `<Screenshot caption="...">`.

Voice rules: no em dashes, no semicolons except in code, `(e.g., ...)` and
`(i.e., ...)` for asides, contractions throughout, brand names properly
capitalized. No new ALL CAPS anywhere outside the existing Shared Lab
Accounts danger callout.

---

## Per-page verdicts

### `features/gantt/page.tsx` — **full rewrite**

**Diagnosis.** The current page is the textbook anti-pattern: the lede
mentions "every task across every project" but never defines what a task
is in ResearchOS, never explains that the Gantt is a window onto the
shared task store, and never says what "dependency" actually means here.
H2 #1 is "Reschedule a task," which assumes the whole mental model.

**New shape.**
1. Intro: a couple of sentences on what the Gantt does at the lab level.
2. H2 "What you're looking at" — defines task, project bar, dependency arrow, and weekend rules. Anchors the reader before any drag-drop talk.
3. H2 "Add a task" — the two creation paths (+ Task button vs double-click on a day).
4. H2 "Move and resize a task" — drag-the-middle vs drag-the-edge, and how downstream dependencies cascade.
5. H2 "Zoom, filter, and skip weekends" — the controls along the top.
6. H2 "Open a task" — click a bar.
7. Closing callout: shared tasks render here too and respect editor permissions.

**Screenshots:**
- `gantt-overview.png` (existing) — concept-level shot. Caption: "Every active task across every project, color-coded by project."
- `gantt-task-popup.png` (**new**) — task popup opened from clicking a bar. App state: signed in as grant, navigate to /gantt, click task id 2 "Sequence assembled ICS contigs" to open the popup. Highlight: nothing (whole-popup view). Caption: "Clicking a bar opens the full task editor."
- `gantt-zoom-controls.png` (**new**) — top bar of the Gantt highlighted, cropped to the controls. App state: /gantt loaded, zoom selector visible. Highlight: the zoom selector dropdown. Caption: "Switch between 1 week, 1 month, 3 months, and All time."

### `features/home/page.tsx` — **restructure**

**Diagnosis.** Jumps to "Create a project" without ever saying what a
project is for ResearchOS (a color-coded container that organizes tasks
and propagates its color across the Gantt, Lab Mode, and the calendar).

**New shape.**
1. Intro stays.
2. H2 "What a project is" — color-coded container, the unit of organization, where tasks and goals live.
3. H2 "Create a project" — existing steps.
4. H2 "Reorder, archive, edit" — existing.
5. Existing tip callout stays.

**Screenshots:**
- `home-projects.png` (existing) — list of cards. Caption: "The Home page after creating a few projects."
- `home-project-popup.png` (**new**) — the project detail popup open over the cards. App state: /, click the "ICS Genome Mining" card. Highlight: nothing (popup view). Caption: "Click a card to rename, recolor, or archive a project."

### `features/experiments/page.tsx` — **full rewrite**

**Diagnosis.** Opens with "Open an experiment" before defining what an
experiment is in this app (an experiment-type task with notes, attached
methods, an image strip, and a separate Results folder). Lab Notes vs
Methods vs Results live in three different places on disk and the page
never explains why.

**New shape.**
1. Intro stays.
2. H2 "What an experiment is" — an experiment-type task plus its notes folder, image strip, and attached methods. Distinct from Methods (reusable protocols) and Results (final outputs).
3. H2 "Open an experiment" — the steps from the existing page.
4. H2 "Attach methods and PCR protocols" — existing, but with the new lede.
5. H2 "Sub-tasks and deviation log" — existing.
6. H2 "Export to PDF" — existing.
7. Closing callout about Results stays.

**Screenshots:**
- `experiments-list.png` (existing) — list view. Caption: "Every experiment across every project."
- `experiments-editor.png` (**new**) — an experiment editor open showing the markdown notes pane, image strip, and side panel with attached method. App state: /experiments, click task id 1 "Run NEBuilder on PKS and ICS clones". Highlight: nothing (whole editor). Caption: "An open experiment: notes on the left, image strip below, attached method and sub-tasks on the right."

### `features/methods/page.tsx` — **restructure**

**Diagnosis.** The "Variations on attach" model IS the mental model and
it's buried in H2 #3. The lede mentions "reusable markdown protocols"
but never explains the snapshot-on-attach behavior that makes the
library safe to share.

**New shape.**
1. Intro stays.
2. H2 "What a method is" — a reusable markdown protocol, optionally shared lab-wide, snapshotted into each experiment that attaches it so variations don't dirty the canonical copy.
3. H2 "Create a method" — existing steps.
4. H2 "Folders and sharing" — existing.
5. H2 "Variations live on the experiment" — renamed from "Variations on attach," same content.
6. Existing tip callout stays.

**Screenshots:**
- `methods-library.png` (existing) — folder tree + editor. Caption: "The Methods library, with a folder tree on the left and a markdown editor on the right."

### `features/pcr/page.tsx` — **restructure**

**Diagnosis.** Assumes the reader knows what a "gradient" and a "reagent
table" are in this app's UI. The lede jumps straight to "build PCR
programs with a visual gradient editor." Same variations-on-attach
model as Methods, and the page should call it out the same way.

**New shape.**
1. Intro stays but trims the UI-jargon.
2. H2 "What a PCR protocol is" — a saved program (gradient = the step-by-step temperature/duration list, reagents = the master-mix table) attachable to experiments with per-run overrides.
3. H2 "Build a protocol" — existing.
4. H2 "Sharing" — existing.
5. Closing callout about variations stays.

**Screenshots:**
- `pcr-editor.png` (existing) — full editor. Caption: "Top half is the temperature gradient editor, bottom half is the reagent table."

### `features/purchases/page.tsx` — **restructure**

**Diagnosis.** Adds purchases before explaining the funding-account
concept that organizes the whole tab. Funding accounts are lab-wide,
purchases are per-user, totals roll up.

**New shape.**
1. Intro stays.
2. H2 "How purchases and funding accounts fit together" — funding accounts are shared lab-wide budgets, each purchase debits one account, the page rolls per-account totals.
3. H2 "Add a purchase" — existing.
4. H2 "Manage funding accounts" — promoted from a sub-section to a full H2, with the modal screenshot.
5. Existing tip callout stays.

**Screenshots:**
- `purchases-list.png` (existing) — list with columns. Caption: "Unpurchased on the left, purchased on the right, per-account totals at the top."
- `purchases-funding-modal.png` (**new**) — the Manage Funding Accounts modal open. App state: /purchases, click "Manage Funding Accounts". Highlight: nothing (whole-modal view). Caption: "Manage Funding Accounts is the lab-wide budget settings."

### `features/results/page.tsx` — **restructure**

**Diagnosis.** Already has the concept-first move ("Why it's separate
from experiment notes") but as H2 #2, not the lede. Promote that block
up.

**New shape.**
1. Intro stays.
2. H2 "What Results is for" — the existing "Why it's separate" content, slightly tightened, made the lede.
3. H2 "Open the Results editor" — promoted from the existing "How to use it" list, converted to Steps.
4. Closing callout about PDF export stays.

**Screenshots:**
- `results-editor.png` (existing) — gallery + editor. Caption: "The Results page is a gallery on the left and a markdown summary on the right."

### `features/lab-mode/page.tsx` — **restructure**

**Diagnosis.** Tabs before explaining that Lab Mode exists because the
folder is shared and multiple users have data inside it. The whole
point of Lab Mode is cross-user aggregation, and the page never says
that explicitly. The "How to get there" H2 is also buried in
implementation details when it should be the second H2 after the
concept.

**New shape.**
1. Intro stays.
2. H2 "What Lab Mode aggregates" — the shared-folder + per-user-namespace + Lab Mode rollup story. Anchors why this view exists at all.
3. H2 "Get to Lab Mode" — the two paths.
4. H2 "The tabs" — existing list, with each tab as its own sub-bullet.
5. H2 "Filter by user" — existing.
6. Existing tip callout stays.

**Screenshots:**
- `lab-mode.png` (existing) — activity feed + Gantt. Caption: "Lab Mode aggregates across every user in the folder."
- `lab-mode-activity.png` (**new**) — the activity feed alone, full-width. App state: /lab, ensure Activity tab is selected. Highlight: nothing. Caption: "The Activity feed lists every change across the lab, with the contributor's name and a timestamp."

### `integrations/telegram/page.tsx` — **restructure**

**Diagnosis.** "Create a bot" comes before the inbox-tray model is
explained. A reader gets six paragraphs in before they understand that
the whole point is "phone photos land in an in-app tray you can drag
into experiments."

**New shape.**
1. Intro stays.
2. H2 "What this gets you" — the inbox-tray model. Photos sent to the bot land in an in-app tray, a toast fires, you drag from the tray into an experiment.
3. H2 "Create a bot" — existing steps.
4. H2 "Pair with ResearchOS" — existing steps.
5. Existing token-privacy danger callout stays.
6. H2 "Disconnecting" — existing.

**Screenshots:**
- `telegram-pairing.png` (existing) — pairing modal. Caption added.
- `telegram-inbox.png` (**deferred**) — the inbox tray is image-backed (`users/{user}/inbox/Images/`), not JSON, so it can't be seeded through the fixture entry format. Page will describe the tray in text and reference the existing pairing screenshot. Capture later once the fixture has a path to inject binary image data, or once a real-but-fake folder of inbox PNGs lands in the public fixtures.

### `features/search/page.tsx` — **light restructure**

**Diagnosis.** Thin but functional. The lede works, but the page never
says what "full-text" means here (i.e., that it indexes everything
on-the-fly across your own data + anything shared with you, no
persistent index). One short concept H2 ahead of the workflow makes the
page feel less like a glossary entry.

**New shape.**
1. Intro stays.
2. H2 "What gets searched" — short paragraph defining the scope.
3. H2 "Search basics" — existing.
4. H2 "Filters" — existing.

**Screenshots:** existing `search-results.png` is fine. Caption added.

### `features/links/page.tsx` — **keep with small tweak**

**Diagnosis.** Already simple and concept-first enough ("a shared
bookmark library for the lab"). Add a brief concept paragraph noting
the lab-wide visibility model, then leave the workflow content
untouched.

**Screenshots:** existing `links.png` is fine. Caption added.

### `features/notifications/page.tsx` — **light restructure**

**Diagnosis.** Borderline. The lede already names the three pieces (the
bell, the inbox tray, event reminders), but it never explains that they
are the same surface for "something happened that you might want to
know about." Add a one-paragraph concept block ahead of "The bell."

**Screenshots:** existing `notifications.png` is fine. Caption added.

---

## Fixture enrichment

Targeted enrichment in `frontend/src/lib/file-system/wiki-capture-fixture.ts`
so the new screenshots tell a coherent research story. All content fully
fictional, but believable.

- **Add a deviation log + sub-tasks to task id 1** ("Run NEBuilder on PKS and ICS clones"). The experiment editor screenshot then has visible structure on the right-side panel.
- **Add a long markdown method body** for method id 2 ("antiSMASH 7 baseline run") so the methods-library editor screenshot has rich content if it lands on that file.
- ~~Add one inbox-style fixture file under `users/grant/inbox/Images/`~~ — dropped. The inbox panel reads binary image blobs from the FSA, not JSON, so the existing fixture format can't seed it. Defer `telegram-inbox.png` for a later pass.
- **Light rename touchups**: keep the existing 4 projects (ICS Genome Mining, Lichen Isocyanide Diversity, Amanita Comparative Genomics, Lab Mentoring) which already feel narrative.

---

## Screenshot bot delegation

All new captures will be delegated to a **single screenshot bot** spawned
at the end of the rewrite pass. The bot's brief will list every new
`{path, file, waitFor, highlight?, action?}` entry plus the
`scripts/WIKI_SCREENSHOTS.md` updates.

New routes the screenshot bot needs to add:

| File | Route | Action |
|---|---|---|
| `gantt-task-popup.png` | `/gantt` | Click the bar for task "Sequence assembled ICS contigs" |
| `gantt-zoom-controls.png` | `/gantt` | Highlight zoom selector, crop to top bar |
| `home-project-popup.png` | `/` | Click the "ICS Genome Mining" project card |
| `experiments-editor.png` | `/experiments` | Click task "Run NEBuilder on PKS and ICS clones" |
| `purchases-funding-modal.png` | `/purchases` | Click "Manage Funding Accounts" |
| `lab-mode-activity.png` | `/lab` | Default tab (Activity) |
