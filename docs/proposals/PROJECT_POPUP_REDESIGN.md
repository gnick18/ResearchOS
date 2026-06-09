# Project surface redesign: full page → focused popup

Status: design APPROVED by Grant 2026-06-09 (all 8 changes agreed via the
interactive mockup `docs/mockups/project-popup-redesign.html`). Ready to build.

House style for all copy: no em-dashes, no emojis, no mid-sentence colons,
BeakerBot is the only mascot.

## The purpose (the test it must pass)

What can a user do on this surface that they cannot do anywhere else? Today the
surface is a full-page route with six tabs, and Edit / Archive / Delete duplicate
the project card's kebab. The redesigned popup is the project's HOME BASE: it
answers "what is this, how's it going, where do I go next," owns only the
project-level-unique things, and launches into the heavy views rather than
embedding them.

## Approved changes (all AGREE)

1. Make it a popup, not a page. Opens over the Workbench, no navigating away.
2. Fold Edit / Archive / Delete into one kebab (they already exist on the card kebab).
3. Status glance at top: progress bar + experiment/task counts + last active.
4. About overview as the centerpiece, editable inline.
5. Timeline / Results / Methods / Sequences become launch buttons (doorways), not embedded tabs.
6. Group the project-unique actions: Share, Deposit to repo, Version history.
7. Compact recent activity + "see all".
8. Funding shown as an inline chip.

## THE DYNAMIC PRINCIPLE (Grant 2026-06-09, load-bearing)

The popup composes itself from what EXISTS. No permanent "go link X" nags for
absent things. Render a section only when it has content:

- Funding chip: shown only when a grant is linked. No "link funding" prompt when none.
- Tags row: shown only when the project has tags.
- Recent activity: hidden on a brand-new project with no events.
- Doorways (Results / Methods / Sequences): show a doorway only when it has
  content (results images exist / experiments have methods / sequences are linked).
  Timeline always shows (the schedule is always relevant).
- Status glance: adapts. A new project reads "just created, no experiments yet"
  rather than a 0% bar that looks broken.
- The ONE gentle exception: the About overview is the centerpiece, so when empty
  show a SLIM "Add an overview" affordance (not a big empty card, not a nag).

The surface should feel like it grows with the user, not like a checklist of
empty slots.

## Resolved architecture (reuse map)

- **Shell:** `src/components/ui/LivingPopup.tsx`. Use `fillHeight`, `blur`, a
  width around `max-w-lg`/`max-w-xl` (the home base is compact, NOT max-w-4xl like
  TaskDetailPopup, this is a focused popup, not a full mirror of the page).
- **Doorway targets already exist as reusable components** taking a `Project` prop:
  - `src/components/project-surface/ResultsGallery.tsx`
  - `src/components/project-surface/MethodsInventory.tsx`
  - `src/components/project-surface/SequencesInventory.tsx`
  A doorway switches the popup's inner view to that component with a Back arrow
  (lightweight in-popup navigation: Home <-> Results/Methods/Sequences). NO new routes.
- **Timeline doorway** navigates OUT to `/gantt?project=<owner>:<id>` (existing).
- **Overview** is currently inline `OverviewSection` in `ProjectRoute.tsx`
  (~line 1069-1219, prose autosave + version-history). EXTRACT it into a reusable
  `src/components/project-surface/OverviewSection.tsx` and mount it in the popup.
- **Kebab actions** (Edit / Archive / Delete) already exist via `ProjectCardKebab`
  + `EditProjectModal`. Reuse them; do not reimplement the mutations.
- **Project-unique actions** Share (`UnifiedShareDialog`), Deposit
  (`ProjectDepositDialog`), Version history (the existing history sidebar/panel)
  are wired in `ProjectRoute.tsx` today, lift those wirings into the popup.

## Routing (Grant's call: one surface everywhere)

- Card click (WorkbenchProjectsPanel ~line 244, and the Lab Overview cards):
  replace `router.push("/workbench/projects/<id>")` with a state-lift that opens
  `<ProjectDetailPopup project={...} owner={...} />` over the current view. No nav.
- KEEP the `/workbench/projects/[id]` route working for deep links (BeakerSearch
  hrefs, `?openProject=`, shared links, the `?owner=` suffix is critical and must
  be preserved). The route page renders the Workbench projects panel with the
  popup AUTO-OPENED for the id+owner in the URL. So every entry point lands on the
  same popup experience.
- The old full-page `ProjectRoute` layout retires; its sub-components are reused
  by the popup. Do NOT delete the reusable sub-components.

## Scope guards

- Do NOT change any on-disk JSON / data shape. This is pure UI/routing.
- Do NOT break the `?owner=` shared-project routing, BeakerSearch project hrefs,
  or `?openProject=` deep links. Verify each still opens the project.
- Reuse existing mutations (create/edit/archive/delete/share/deposit/history).
- Carve `frontend/src/app/wiki/**` OUT of scope; surface wiki implications in the
  report, do not write wiki pages.

## Verification gate

- `cd frontend && node_modules/.bin/tsc --noEmit` exits 0.
- Run the project-surface + workbench tests that exist; add coverage for the
  dynamic-section logic (a populated project shows funding/tags/activity; an empty
  one hides them) and for the card-click-opens-popup behavior.
- Live check in the app: create a project (no auto-open, already shipped), click a
  card (popup opens, no nav), confirm dynamic sections hide when empty, confirm a
  doorway opens its component and Back returns home, confirm a deep link URL opens
  the popup.
