# BeakerSearch permanent home: the bottom-center ask bar (Option A)

Status: APPROVED by Grant 2026-06-12 (picked Option A in `docs/mockups/beakersearch-home-comparison.html`). NOT built. Owner: BeakerAI. Coordinates with the global-nav-slimming arc (shared `AppShell` top bar).

## Decision

BeakerSearch leaves the crowded top nav and gets a permanent home as a slim, always-present ask bar docked bottom-center on every app page. It reads "Ask or search your work..." with a Cmd K hint, and on open it expands in place into the existing centered BeakerSearch surface (the search-morphs-into-chat surface we already ship). The top-nav `BeakerSearchPill` is removed. The bottom-right utility cluster (Calculators, Report-bug) is unchanged and must not collide with the centered bar.

## Why

The top bar already carries the logo, streak, drag-customizable tabs + the hidden-tabs dropdown, Reset, Done, the BeakerSearch pill, bell, Inbox, timer, phone, help, trash, and the avatar. The app's primary front door competes with a dozen page-level controls. A persistent bottom-center bar makes the front door the most consistent, most reachable thing on every page (thumb-reachable, identical on every route so muscle memory forms), reads as the AI-forward way to drive the app, and declutters the top bar (which also helps the nav-slimming arc).

## What changes

1. **New component, the persistent ask bar.** A fixed bottom-center pill, present on every app route, that opens the existing BeakerSearch centered surface (reuse the current open path, do not fork the surface). Slim, calm at rest, brand-clean. It is NOT a second surface, only a new resting affordance / trigger for the one we have.
2. **Remove `BeakerSearchPill` from the top bar** in `AppShell`. This is the line that touches the contended top-nav surface, so it is done in coordination with the global-nav-slimming session (one of us makes the edit, the other rebases) rather than both editing `AppShell` head-on.
3. **Cmd K unchanged.** The keyboard path already opens the surface; the new bar is the visible affordance for it and shows the Cmd K hint.
4. **No collision with the bottom-right FABs.** The ask bar is centered; the Calculators / Report-bug cluster stays bottom-right. On the dense `/sequences` editor (which already relocates its FABs), confirm the centered bar clears the inspector rail; if it crowds, the bar can sit slightly higher or the editor can opt to the compact trigger.
5. **Record mode + capture.** The bar must hide under `?record=1` and `?wikiCapture=1` (it is app chrome, like the dock and flask already are), so demo clips and wiki screenshots are clean.

## Open / to confirm during build

- Exact resting width and whether the bar shows recent / suggested actions at rest or only the placeholder (mockup shows placeholder only; keep minimal first).
- Mobile / narrow behavior (the companion app and narrow viewports): does the bar stay full-width-bottom or collapse to a single round trigger.

## Verification

The new component renders in the browser, so it is mockup-approved (done) then verified on Grant's running :3000 (hot reload), not headless. The pill-removal coordination is the only shared-tree risk; sequence it with the nav-slimming session.
