# Wiki audit: demo + fixtures + screenshot pipeline

Sub-bot: wiki audit: demo + fixtures + screenshots
Date: 2026-05-26
Anchor: main @ 14ea9892 (Overnight orchestrator handoff doc)

## Scope

Confirm the wiki accurately describes the `/demo` user experience, the fixture
system (`?wikiCapture=1` + `/demo` sticky flag), the screenshot capture pipeline,
and the wiki coverage gate.

App code reviewed:
- `frontend/src/app/demo/[[...slug]]/page.tsx`
- `frontend/src/lib/file-system/wiki-capture-fixture.ts` (217 lines, generated)
- `frontend/src/lib/file-system/wiki-capture-mock.ts` (959 lines)
- `frontend/src/components/FloatingLeaveDemoButton.tsx`
- `frontend/src/components/OpenDocsButton.tsx`
- `frontend/src/components/wiki/TryInDemo.tsx`
- `frontend/src/components/LeaveDemoModal.tsx`
- `frontend/src/components/ResearchFolderSetupNew.tsx` (download link)
- `scripts/generate-demo-data.mjs` (3,566 lines)
- `scripts/capture-wiki-screenshots.mjs` (2,845 lines, ~75 routes)
- `scripts/check-wiki-coverage.mjs`
- `scripts/build-wiki-search-index.mjs`
- `scripts/WIKI_SCREENSHOTS.md`
- `AGENTS.md` section 4 "Wiki + screenshot pipeline"

Wiki pages reviewed:
- `frontend/src/app/wiki/getting-started/demo-mode/page.tsx` (sole user-facing
  page that describes the demo)
- `frontend/src/app/wiki/start-here/page.tsx` (single link to /demo)
- All 5 wiki pages that embed `<TryInDemo>`: page.tsx, features/methods,
  features/experiments, features/markdown-editor, features/gantt

---

## Finding counts

- HIGH severity: 3
- MEDIUM severity: 4
- LOW severity: 3
- Total: 10

---

## HIGH-1: Wiki demo-mode page describes a non-existent "amber Demo Lab banner"

File: `frontend/src/app/wiki/getting-started/demo-mode/page.tsx` lines 50-72,
131-136.

The page states:

> The amber **You're viewing the Demo Lab** banner sits across the top while you
> are on a `/demo` URL. Navigate deeper (Gantt, Methods, Calendar, etc.) and the
> banner steps aside because those routes are outside `/demo*`. The persistent
> affordance across every route is the floating Leave Demo button in the
> bottom-right of the window...

There is also a `<Screenshot src="/wiki/screenshots/demo-mode-banner.png" .../>`
embedded with the caption "The amber demo banner sits across the top while you
are on a /demo URL."

App reality: there is no `<DemoLabBanner>` component anywhere in
`frontend/src/`. Grepping for "viewing the Demo Lab", "DemoLabBanner",
"TopBanner", or any equivalent text returns ONLY the wiki page itself (no app
code matches). `FloatingLeaveDemoButton.tsx` is the only mounted demo
affordance, plus the secondary `OpenDocsButton`. The capture script DOES
capture `demo-mode-banner.png` (line 1658), which means a PNG with that name
will exist but cannot show a banner that the app does not render.

`LeaveDemoModal.tsx` line 16 comment ("Modal shown when the visitor clicks
'Leave Demo' in `<DemoLabBanner>` or...") is also stale.

Action: either restore a banner component (Grant decision), or rewrite the
demo-mode wiki page to drop the banner narrative and describe only the
`<FloatingLeaveDemoButton>` + `<OpenDocsButton>` affordances that actually
render today. Likely the rewrite is correct given the floating-button-only
pattern landed deliberately. The stale capture-script entry for
`demo-mode-banner.png` should also be removed (capture currently silently
records whatever is in the bottom-right viewport with that filename).

## HIGH-2: Wiki describes emoji prefixes ("Read the docs", "Try this") that do not appear in the rendered components

File: `frontend/src/app/wiki/getting-started/demo-mode/page.tsx` lines 93,
103.

Wiki copy:

> a darker **Read the docs ↗** button shows up...
> feature pages that have a demo-able view show an amber inline call-out
> (**Try this in the demo →**)

(Per AGENTS.md the wiki style is no-emoji; the actual wiki source shows
literal book and test-tube emoji at the start of those bold strings.)

App reality:
- `OpenDocsButton.tsx` line 52 renders `<span>Read the docs</span>` with an
  arrow span. No book emoji.
- `TryInDemo.tsx` line 25 renders children verbatim plus a `→` span. The
  string "Try this in the demo" is never injected; each wiki call-site
  controls the text (e.g. `Try the Gantt view`, `Try methods in the demo`,
  `Try the Workbench`, `Open the demo and try Lab Notes`).

Two issues:
1. The emoji prefixes are wrong (and the page itself violates the
   no-emojis-in-prose convention if those are real glyphs in the source).
2. The "Try this in the demo" canonical text doesn't match any of the 5
   actual `TryInDemo` call-sites.

Action: edit `demo-mode/page.tsx` to drop the emoji prefixes and either (a)
quote the actual variable labels with a note that each page sets its own, or
(b) describe the affordance generically ("an amber call-out that drops you
into the live view").

## HIGH-3: WIKI_SCREENSHOTS.md table is ~48 entries stale vs the capture script

File: `scripts/WIKI_SCREENSHOTS.md` lines 72-101.

The "What gets captured" table lists 27 PNG entries. The current
`scripts/capture-wiki-screenshots.mjs` defines ~75 capture entries (grep
`file:` shows 75 matches including the new project-route, workbench-section,
purchases-dashboard-breakdown, onboarding-w*, onboarding-l4, onboarding-phase4,
onboarding-resume, demo-mode-banner, demo-mode-leave, experiments-export,
notifications-shift-alert, search-export-selected, telegram-inbox-multiselect,
import-eln-format-pick, feedback-modal, lab-mode-gantt, lab-mode-purchases,
lab-mode-cross-user-lists, lab-mode-user-filter, purchases-lab-funding-cards,
purchases-lab-list, workbench-experiments, workbench-experiments-sections,
workbench-notes, workbench-lists, projects-slim-popup, projects-route-overview,
projects-route-results, projects-route-methods, projects-route-activity,
projects-sidebar-nav, pcr-step-edit, pcr-reagent-totals,
purchases-unified-scroll, purchases-expanded-order,
purchases-non-purchase-warning, purchases-non-purchase-panel-expanded,
purchases-csv-export captures, etc.).

The doc also still lists "Lab Notes (Hybrid)" against `editor-hybrid-selected`
but the workflow now flows through `workbench-*` views. New screenshots from
the post-Lab-Mode-retirement work, lab-head expansions, projects-route family,
and v4 onboarding cluster are not documented.

Action: regenerate the table from the script (could be auto-derived; the
script entries already carry `file`, `path`, action descriptions). Suggest a
sub-bot follow-up to either auto-generate this section at build time, or do a
one-shot rewrite to match the current script state.

## MEDIUM-1: Demo-mode wiki page describes only "alex + morgan", misses mira (PI lab_head) and sam (archived)

File: `frontend/src/app/wiki/getting-started/demo-mode/page.tsx` lines 28-36.

> The Home page opens with four projects, all prefixed DEMO:... A second
> researcher named morgan shares one project with alex, so shared records are
> visible across both users for you to click through.

Fixture reality (`wiki-capture-fixture.ts` lines 20, 191-198):

- `alex` (member, default fixture sign-in)
- `morgan` (member, shares with alex)
- `mira` (lab_head with full `_lab_head_auth.json` PBKDF2 record, displayName
  "Dr. Mira Castellanos", #f97316 orange) — visible on the user-picker, drives
  the announcements + PI audit log + LabComment threads + flag-for-review
  notifications
- `sam` (archived member, displayName "Dr. Sam Whitley", `archived_at`
  2026-03-15, slate gray)

Mira's presence is the load-bearing demo asset for the lab_head feature
documentation (`/wiki/features/lab-head`, `/wiki/features/lab-inbox/*`,
`/wiki/features/lab-overview/*`). Sam exists specifically to demo the
user-archiving feature (`/wiki/getting-started/user-archiving`). Neither is
mentioned on the demo-mode page, so a reader following the demo to try the
lab-head walkthrough has no guidance on which fixture user to pick from the
user-picker or what archived-state to look for.

Action: add a "Who's in the demo lab" section listing the four seeded users
with their roles, plus a note that `?fixtureUser=mira` (or `?wikiCapture=…&
fixtureUser=mira`) drives the fixture as a different seeded user (the
`resolveFixtureUser()` helper in `wiki-capture-mock.ts` lines 157-177 is
already wired but undocumented).

## MEDIUM-2: `?fixtureUser=` and `?wikiCapture=picker` query params are undocumented in the wiki

File: `frontend/src/lib/file-system/wiki-capture-mock.ts` lines 144-177,
136-149.

The fixture supports:
- `?wikiCapture=1` (signed-in as alex, default)
- `?wikiCapture=picker` (installs fixture without signing in, lands on the
  user-picker)
- `?fixtureUser=morgan|mira|sam` (switches the seeded current user)
- `?forceControls=1` (makes hover-only controls visible for screenshots, lines
  408-431)
- `?unlockSession=1` (synthesizes a lab-head unlocked edit session for
  capture, lines 440-463)

None of these are mentioned on the demo-mode wiki page. They're documented
inside `WIKI_SCREENSHOTS.md` for the picker variant only. Other knobs are
purely internal.

Action: this is dev/verifier-facing not user-facing — likely belongs in
`WIKI_SCREENSHOTS.md` rather than the user wiki. Add a "Fixture mode URL
flags" section to `WIKI_SCREENSHOTS.md` listing all four flags + their
hostname guards. Likely no action needed in user wiki.

## MEDIUM-3: Wiki demo-mode page mentions `/demo` deep-link redirect behavior but never lists deep-linkable routes

File: `frontend/src/app/wiki/getting-started/demo-mode/page.tsx` lines 38-48.

> Deep links like `/demo/methods` also work: the app installs the fixture
> first, then redirects to `/methods` so the shareable link lands the visitor
> on the right view.

The /demo route is an optional-catch-all (page.tsx confirms — any slug after
/demo redirects to the equivalent app route once the fixture installs).
However, only 5 wiki pages currently embed a `<TryInDemo>` call-out:
`/wiki/features/methods`, `/experiments`, `/markdown-editor`, `/gantt`, and
the wiki landing page. Most feature pages have no demo deep-link, even though
the demo can render their data (Calendar, Purchases, Lab Mode, Search, Lab
Inbox, Lab Overview, Lab Head, Settings, etc. all have rich seeded fixtures).

This isn't strictly wrong but it's a wiki-coverage hole worth flagging: any
feature with seeded fixture data should optimally have a `<TryInDemo>`
call-out. Tracking against the 49 wiki pages discovered under
`frontend/src/app/wiki/`, 5/49 (10%) have demo deep-links, even though
~30+ feature pages have rich fixture coverage.

Action: queue a follow-up chip to audit which feature wiki pages have
fixture-backed views and add `<TryInDemo>` call-outs to each. Out-of-scope for
this audit chip but worth surfacing to master.

## MEDIUM-4: `scripts/build-wiki-search-index.mjs` is undocumented in the wiki and in `WIKI_SCREENSHOTS.md`

File: `scripts/build-wiki-search-index.mjs` (just shipped per brief).

The script:
- Walks `frontend/src/app/wiki/**/page.tsx`
- Extracts titles, breadcrumbs, headings, paragraphs, callouts, screenshot
  captions
- Writes `frontend/public/wiki-search-index.json`
- Runs as part of `prebuild` (line 7 in `frontend/package.json`)

It's the runtime fuel for the wiki's search input. AGENTS.md section 4 covers
`check-wiki-coverage.mjs` (the coverage gate) and `capture-wiki-screenshots.mjs`
in detail but never mentions `build-wiki-search-index.mjs`. Future
wiki-overhaul sub-bots editing the WikiPage / Callout primitives could break
the search index without realizing the build pipeline depends on the JSX house
style holding.

Action: add a short bullet to AGENTS.md section 4 under "Wiki + screenshot
pipeline" describing the search-index builder, its prebuild wiring, and the
"if you change wiki primitives, re-run `npm run wiki:search-index` to verify
extraction still works" note. Also worth a 1-paragraph mention in
`WIKI_SCREENSHOTS.md` ("This doc covers screenshots; for the search index see
`scripts/build-wiki-search-index.mjs`.").

## LOW-1: Lab-head wiki TODO screenshot comments still reference outdated lab_head fixture state

File: `frontend/src/app/wiki/features/lab-head/page.tsx` lines 14-16, and
similar TODO blocks in `lab-overview/`, `purchases/`, `lab-head/audit-log/`,
README.md lines 11, 36, 53, 78, 90, 102, 192, 305.

The README's TODO blocks consistently call out "lab_head fixture" or
"lab fixture with X". These were drafted before mira (the actual lab_head
fixture user) shipped. The TODOs are correct — mira IS now a lab_head — but
the README would benefit from a one-line note pointing screenshot agents at
`?fixtureUser=mira` as the canonical way to capture lab_head screenshots.

Action: small README edit. Low priority; the TODOs are still actionable as-is.

## LOW-2: `lab-mode-*` capture entries point at retired `/lab` route

File: `scripts/capture-wiki-screenshots.mjs` lines 1368-1408,
`scripts/WIKI_SCREENSHOTS.md` lines 91-92.

Per AGENTS.md recent landed work, Lab Mode retirement is in flight (R1
landed, R2 landed, R3 in flight, R4-R6 queued). The `lab-mode-*.png`
captures still target `/lab` even though that route is destined for deletion
as part of R5. Acceptable for now (R5 hasn't landed), but the WIKI_SCREENSHOTS.md
documentation should call out that those entries will need a sweep when
R5 lands.

Action: add a "Pending retirement" note to the screenshot doc for the
`lab-mode-*` family. Or wait for R5 to remove them — depends on Grant's
preference. Lower priority.

## LOW-3: Hardcoded fixture demo lab name "Demo Synthetic Biology Lab" vs wiki copy "fake yeast lab"

File: `wiki-capture-fixture.ts` line 18 (`_demo_marker.json`):

> "lab_title": "Demo Synthetic Biology Lab"

Wiki copy and README repeatedly call it "fake yeast lab" / "seeded yeast
lab" / "fictional synthetic biology yeast lab". Minor inconsistency. Either
is fine; flagging for awareness.

Action: optional; could rename `_demo_marker.lab_title` to "Demo Yeast Lab"
(or similar) so the in-app label and the documentation voice match. Pure
polish.

---

## Out-of-scope / not findings

- Real-data screenshots: per `feedback_screenshot_privacy` memory, forbidden.
  No violations found; all PNG paths in capture script target fixture mode.
- Onboarding tour content: Stream A's wiki chip covers v4 walkthrough wiki
  coverage. The fixture's `wizardSeedStep=` flag wiring (wiki-capture-mock.ts
  lines 842-925) was outside the scope of this chip; flagged for the
  onboarding-focused sibling sub-bot.
- The `LabComment` thread + announcements + PI audit fixtures are well-formed
  and load-bearing for the lab_head + lab_inbox + lab_overview wiki families;
  those wiki pages already document the surface. Out of scope here.

---

## Summary

| Sev | Finding | File |
|-----|---------|------|
| HIGH-1 | Wiki describes non-existent DemoLabBanner | wiki/getting-started/demo-mode/page.tsx |
| HIGH-2 | Wiki cites wrong emoji prefixes + wrong TryInDemo label | wiki/getting-started/demo-mode/page.tsx |
| HIGH-3 | WIKI_SCREENSHOTS.md table 48 entries stale vs script | scripts/WIKI_SCREENSHOTS.md |
| MED-1 | Demo wiki doesn't mention mira (PI) or sam (archived) fixture users | wiki/getting-started/demo-mode/page.tsx |
| MED-2 | fixtureUser / wikiCapture=picker / forceControls / unlockSession undocumented | WIKI_SCREENSHOTS.md |
| MED-3 | Only 5/49 wiki pages have TryInDemo despite rich fixture coverage | wiki/features/* (many) |
| MED-4 | build-wiki-search-index.mjs absent from AGENTS.md + screenshots doc | AGENTS.md, WIKI_SCREENSHOTS.md |
| LOW-1 | README TODOs should point screenshot agents at ?fixtureUser=mira | README.md |
| LOW-2 | lab-mode-* captures will need sweep at Lab Mode R5 | scripts/capture-wiki-screenshots.mjs |
| LOW-3 | _demo_marker.lab_title vs wiki "yeast lab" copy mismatch | wiki-capture-fixture.ts:18 |
