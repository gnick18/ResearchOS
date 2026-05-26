# Wiki audit: Home + widget canvas (2026-05-26)

## Summary

Moderate drift. The Home wiki page was partially updated for the customizable widget canvas (§"The customizable widget canvas" section exists and references the 2-default-widget model), but it mis-states the canvas location (claims "at the top of the page" when the HomeCanvas mount is at the BOTTOM of `app/page.tsx`). The bigger concern is the related Lab Overview cluster, which still describes a "gear icon" affordance for edit mode that doesn't exist in the current `SnapshotCanvas` toolbar (it's plain `Edit layout` / `Done` / `Reset` text buttons), claims a tile-resizing feature that no longer exists in the v2 ordered-list shape, lists 12 Tools when the Tool registry now ships 13 (Calendar added 2026-05-24), and never mentions the 5 new tile variants Grant called out (calendar-events-today, comment-mentions, experiments-ready-writeup, lab-activity-by-type, the three lab-purchases variants). No new wiki pages are missing — the existing pages just need their copy refreshed.

## P0 findings (broken / actively misleading)

- **`frontend/src/app/wiki/features/home/page.tsx` line 215-216**: "New accounts start with two default widgets at the top of the page" is WRONG. In `frontend/src/app/page.tsx` line 859 the `<HomeCanvas>` component mounts AFTER the active project grid AND after archived projects AND after the empty state. The widgets render at the BOTTOM of the page, below all project cards. The caption on line 236 ("two default widgets on top and the project grid below") is the inverse of reality. A user reading the wiki and looking for widgets at the top will be confused.

- **`frontend/src/app/wiki/features/lab-overview/snapshot-tiles-and-expanded-views/page.tsx` line 52**: "With edit mode on (gear icon, top-right), tiles sprout drag handles". There is no gear icon. `SnapshotCanvas.tsx` line 327-346 renders a text button labelled "Edit layout" (or "Done" when active) inside the canvas toolbar, alongside "+ Add widget" and "Reset". Same stale "gear" reference on lines 76 ("The gear menu carries a Reset to default action") — Reset is a separate sibling text button, NOT a menu item under any gear.

- **`frontend/src/app/wiki/features/lab-overview/widgets-and-tools/page.tsx` line 143**: "Edit mode (gear icon) reveals a + Add widget action at the bottom of the canvas." Same gear-icon problem. The +Add widget button is in the canvas toolbar at the TOP (right side), not at the bottom. SnapshotCanvas.tsx line 295-318.

- **`frontend/src/app/wiki/features/lab-overview/customizable-sidebar/page.tsx` line 48**: "With edit mode on (gear icon, top-right), drag a tile out of the snapshot canvas and drop it on the sidebar rail." Gear icon does not exist. Also, the customizable PI sidebar uses its own edit affordance (not the canvas's "Edit layout" button) — the two are independent toggles, the wiki copy conflates them.

- **`frontend/src/app/wiki/features/lab-overview/page.tsx` line 46**: "Tiles are draggable when edit mode is on (gear icon, top-right)." Same issue.

- **`frontend/src/app/wiki/features/lab-overview/snapshot-tiles-and-expanded-views/page.tsx` lines 65-72** ("Resizing" section): "Each widget declares which sizes it supports... Drop the size you want from the palette, or swap sizes by removing and re-pinning." This describes a feature that does not exist. The v2 layout shape (`layout-persistence.ts` line 7-17) is an ordered list of widget IDs per surface; there's no per-widget width/height, no size selector in the palette, no resize handle on tiles. SnapshotCanvas renders a fixed `grid grid-cols-1 md:grid-cols-2 gap-3` and the catalog has zero size affordance. Entire "Resizing" section is fictional.

- **`frontend/src/app/wiki/features/lab-overview/widgets-and-tools/page.tsx` line 10 + line 25**: "The Lab Overview ships 12 Tools" / "<h2>The 12 Tools</h2>" — `tool-registry.tsx` ships 13 (added `calendar` tool 2026-05-24, file lines 328-336). The list of bullets that follows enumerates 12 entries; Calendar (the popup behind the `calendar-events-today` tile) is missing entirely.

- **`frontend/src/app/wiki/features/lab-overview/customizable-sidebar/page.tsx` line 102-104**: lists "Lab activity" as a sidebar widget ("The activity feed rendered as one-liners"). But registry.ts line 277-295 shows `lab-activity` has `surfaces: { canvas: true, home: true }` — NOT sidebar. Lab activity is not pinnable to the customizable sidebar today. (The `sidebar-recent-activity` widget is a different, related, sidebar-eligible widget — the wiki probably means that one, but calling it "Lab activity" is wrong on both name and surface.)

## P1 findings (stale but not actively misleading)

- **`frontend/src/app/wiki/features/lab-overview/widgets-and-tools/page.tsx` lines 100-116** (Variants section): only documents the three `LabPurchases` variants. The Tool variants batch (2026-05-24) added five new variants that the wiki doesn't mention at all:
  - `comment-mentions` (Comments tool, @-mentions variant)
  - `experiments-ready-writeup` (Experiments tool, ready-to-write-up variant)
  - `lab-activity-by-type` (Lab Activity tool, by-area variant; today's tasks/notes/purchases columns)
  - `calendar-events-today` (Calendar tool, today variant — the actual today's-events tile that the home wiki line 254 references)
  - Plus three `daily-tasks` variants (`sidebar-overdue` / `sidebar-today` / `sidebar-upcoming`) and the `sidebar-daily-tasks` full-stack variant.
  The "iPhone-widgets model" framing is still accurate; the catalog list is just stale.

- **`frontend/src/app/wiki/features/home/page.tsx` line 220-224**: "The canvas works the same way as the Lab Overview canvas: tiles open into full popups, drag-and-drop reorders them, and edit mode (top-right of the toolbar) reveals the layout controls." The "top-right of the toolbar" wording is misleading — there's no `top-right` per se; the Edit layout / Done / Reset / +Add widget buttons all sit on the right side of the SAME single-row canvas toolbar, which itself sits at the top of the canvas (which is at the bottom of the page). Add a sentence clarifying the location relative to the project grid.

- **`frontend/src/app/wiki/features/home/page.tsx` lines 238-260** (the bulleted list under the widget canvas heading): "Drag tiles to reorder with edit mode on. Tiles snap to the grid and the layout persists in your settings sidecar." OK but the settings field is `_user_settings.json:home_layout` (NOT `lab_overview_layout`), per `layout-persistence.ts` lines 410-417. A separate sentence noting that Home customization is independent of Lab Overview customization would match what the code actually stores. (The lab-overview wiki has the same gap in reverse.)

- **`frontend/src/app/wiki/features/lab-overview/page.tsx` lines 32-35** ("Who this page is for"): "After the Home canvas migration, members land on /home for their own work, while Lab Heads get this dedicated cross-lab surface at /lab-overview." This is accurate. But the sentence could call out that lab heads ALSO get a Home canvas (per `defaultLabHeadHomeLayout` in `layout-persistence.ts` line 470-478) so a PI reading the wiki doesn't think /lab-overview is their only widget surface.

- **`frontend/src/app/wiki/features/lab-overview/customizable-sidebar/page.tsx` lines 39-44** ("Lab Heads only" callout): "The closest analog on the member side is the home canvas at /home, which has its own widget layout but no permanent right-edge rail." Accurate but worth strengthening — Home's customizable rail explicitly does NOT exist (per `layout-persistence.ts` lines 414-417: "The 'sidebar' axis is currently UNUSED on /home — /home keeps its existing AppShell sidebar [DailyTasksSidebar / CustomizableSidebar] untouched.").

- **`frontend/src/lib/wiki/nav.ts` line 223**: "The 12 Tools, widget variants, and the + Add widget palette." Update count to 13 when fixing the widgets-and-tools page.

## P2 findings (polish / nice-to-have)

- **Home wiki has no link to `/wiki/features/lab-overview/widgets-and-tools`**. The §"The customizable widget canvas" section sends users to `/wiki/features/lab-overview` for canvas mechanics, but the deeper widget catalog is one level further. A direct link saves a click.

- **`frontend/src/app/wiki/features/home/page.tsx` line 220-221**: "The canvas works the same way as the Lab Overview canvas." This is mostly true mechanically. Worth a one-line callout that the Home canvas has a softer "append on new catalog entry" contract than Lab Overview — Home does NOT auto-append new home-eligible widgets to a user's saved layout (per `layout-persistence.ts` line 528-538 commentary: "home is user-curated, lab-overview is a dashboard"). Users who wonder why a new widget didn't show up on Home would benefit from this note.

- **No wiki page mentions the §6.2b Home Widgets walkthrough**. The walkthrough teaches 5 sub-steps (canvas intro, tile anatomy, +Add widget, reorder, exit), and is part of the universal Welcome Tour. The welcome-wizard page in `frontend/src/app/wiki/getting-started/welcome-wizard/page.tsx` is the right place for a one-paragraph mention so users know what BeakerBot will do on Home. Not a P1 because the walkthrough does its own teaching in-app; just nice for the wiki to reference it.

- **`scripts/WIKI_SCREENSHOTS.md` row for `home-projects.png`**: this is the original projects-only home capture. Once `home-widget-canvas.png` lands (already wired in `capture-wiki-screenshots-batch-b.mjs` line 299) the OLD `home-projects.png` becomes redundant since the new capture is `fullPage: true` and shows both the project grid and the widget canvas. Worth a note in the screenshot manifest to deprecate `home-projects.png` so we're not regenerating two captures of the same page.

- **`frontend/src/app/wiki/features/lab-overview/snapshot-tiles-and-expanded-views/page.tsx` lines 60-63** ("Edit mode is sticky until you toggle it off"): true but worth noting that the +Add widget button auto-enters edit mode if it's off (SnapshotCanvas.tsx line 299-304, "UI affordance fix break-bot Bug 3"). Users who click +Add expect a palette, not a mode flip.

## Notes

- The "gear icon" mistake repeats in 4 different lab-overview wiki files. A single SR pass replacing "gear icon, top-right" with the actual control names ("Edit layout button in the canvas toolbar") would clean most of the P0s in one commit.

- The widget catalog has 8 sidebar-eligible widgets today (`sidebar-recent-activity`, `sidebar-pi-actions`, `sidebar-member-workload`, `sidebar-todays-announcements`, `sidebar-overdue`, `sidebar-today`, `sidebar-upcoming`, `sidebar-daily-tasks`). The customizable-sidebar wiki only enumerates 5 and one of them is wrong (Lab activity). When rewriting that page, consider whether to enumerate all 8 or just describe the categories — the 5-item list reads as authoritative and isn't.

- The Calendar Tool (added 2026-05-24) shares a popup with the `calendar-events-today` widget variant — clicking the today's-events tile opens `CalendarDayPopupView`. The wiki has no page documenting this Tool. Today's-events is a major default-on-Home widget, so a one-paragraph entry in `widgets-and-tools/page.tsx` plus a mention in `/wiki/features/calendar/page.tsx` would close the loop.

- Recommendation: when refreshing the home page wiki, add a `<Callout>` flagging that Home's canvas sits BELOW the project grid (counter-intuitive given most dashboards put widgets up top), so users reading top-down don't think the widget canvas is missing. This is the single most discoverable improvement.

- No broken intra-wiki links found. All `<Link>` hrefs in the inspected pages resolve to existing wiki pages.

- `APP_ROUTE_TO_WIKI` mapping for `/` → `/wiki/features/home` is correct (`frontend/src/lib/wiki/nav.ts` line 16). No mapping changes needed.
