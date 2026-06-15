# Wiki audit — full sweep (2026-06-15)

Read-only audit of all 91 wiki pages (`frontend/src/app/wiki/**/page.tsx`) against
shipped code, run as 10 parallel agents. Goal: find missing content, stale/removed
content, and screenshots that are no longer needed vs. new ones to capture.

Three pages were rewritten just before this sweep and are excluded (current):
`features/chemistry`, `features/datahub`, `features/sequences`. The `features/phylo`
"Adding data straight from the Data Hub" section is current; the rest of that page is not.

---

## Executive summary

- **Biggest content gap: BeakerBot has no wiki page at all.** `features/ai-helper` covers only the external-AI prompt export. The built-in assistant (CRUD on all objects, @mentions, /slash-commands, macros, voice, PDF reproduce, plan card, summary suite, Smart Data Binding, cloning/NCBI tools) is the largest recent build and is undocumented. Recommend a new `features/beakerbot` page (or major `ai-helper` expansion).
- **~6 pages document REMOVED or NONEXISTENT UI** (highest priority — these actively mislead):
  - `lab-head/edit-session-and-password` — the entire PI password / 5-minute edit-session was removed (2026-06-07); the page documents it end-to-end.
  - `lab-inbox` — describes a "Lab Inbox popup/Tool" that doesn't exist (`/lab-inbox` is a redirect to `/lab-overview`).
  - `lab-head/audit-log` + `lab-head/soft-write-actions` — describe a tabbed "PI Actions popup" that doesn't exist; audit-log documents schema fields (`action`, `target`) not in code.
  - `lab-overview` — describes 3 sections removed in the OV redesign (Today's events, Trainee notes, full announcement stream).
  - `purchases` "PI Experience" — describes a non-existent "LabPurchases Tool" four-tab popup.
  - `getting-started/demo-mode` — documents a "Read the docs" floating pill that doesn't exist in code.
- **Whole-frame stale pages:** `features/settings` (describes the retired single-scroll panel stack, not the SettingsShell rail; ~7 sections missing); `getting-started/connecting-your-folder` (retired "Link a folder / Choose a folder / waving BeakerBot" screen); `getting-started/creating-a-user` ("no central account system / the folder is the lab" — false since cloud accounts shipped); `features/projects` (became a popup; still describes the retired full-route page; "Funding" listed as a tab but isn't); `features/one-on-ones` (tab is always "Check-ins", always shown; 5 sub-tabs undocumented).
- **Security/trust accuracy bugs:** `security` documents retired PBKDF2/`_auth.json` (now Argon2id/`_account.json`), omits `/api/ai/chat` as an outbound route, and its on-disk file layout is missing molecules/inventory/datahub/phylo/figures/_history. `compliance/nih-data-management` wrongly says Results lack version history. `trust/method-validation` hardcodes a "146 matches" count and omits the stats engine validation.
- **Landing/start pages** say "Click Link Folder" (now "Open a folder") and "no account/no sign-up" (Free/Lab tiers shipped + account-first default-on).
- **Screenshots: broadly stale.** Earlier git-date analysis: of 148 wiki screenshots only ~10 are current; ~119 predate the nav-slim (06-12) + wordmark (06-13) chrome changes. This audit additionally identified ~16 orphaned old-UI screenshots to delete and ~30 new screenshots to capture (see Part 3).
- **House style: clean** across all pages (no em-dashes/colons/emojis in rendered prose; a few are inside JSX comments or verbatim UI quotes).

---

## Part 1 — Critical accuracy fixes (documents removed/nonexistent UI)

| Page | Issue | Source of truth |
|---|---|---|
| `lab-head/edit-session-and-password` | Entire page describes the removed PI password + 5-min edit session. Replacement = one-time confirm dialog per record. | `PiEditButton.tsx:16`, `PiEditConfirmDialog.tsx:21`, `pi-actions.ts:74` |
| `lab-inbox` | "Lab Inbox popup/Tool" does not exist; route is a redirect. Comments/announcements live in record popups + `AnnouncementsWidget`. | `app/lab-inbox/page.tsx:14` |
| `lab-head/audit-log` | Tabbed "PI Actions popup" doesn't exist (viewer is `AuditTrailViewer`); `PiAuditEntry` has no `action`/`target` fields (uses `field_path`/`record_type`/`record_id`); lab-root audit file only for announcements. | `pi-audit.ts:67-94`, `AuditTrailViewer.tsx`, `announcements.ts:49` |
| `lab-head/soft-write-actions` | "PI Actions popup → Pending tab" doesn't exist; pending lives at `/approvals`; describes removed edit-session. | `app/approvals/page.tsx`, `OrdersApprovalsLens.tsx:46` |
| `lab-inbox/announcements` | Intro + "Edit-session unlock" section describe the removed password gate; PIs post directly. | `AnnouncementsWidget.tsx:35` |
| `lab-overview` | Describes Today's events, Trainee notes, full announcement stream (all removed); "Needs you" is tiles not a bar; announcements is a composer not a list; nav.ts blurb stale. | `LabOverviewPage.tsx:20-22,389-398` |
| `purchases` (PI Experience) | "LabPurchases Tool" four-tab popup in a "Tools launcher" doesn't exist; PI workflow is `/purchases` + "Pending approval" chip + `PiActionsHeaderButton`. | `LabOverviewPage.tsx:370`, `purchases/page.tsx:155` |
| `pcr` | Claims protocol sharing is "backend-only"; `PcrViewer` has the same Private/Public pill as other methods. | `methods/page.tsx:2780` |
| `projects` | Full-route page retired; now `ProjectDetailPopup`. "Funding" listed as a tab but is always-visible context, not a tab. Top-bar icon actions are now a kebab menu. | `workbench/projects/[id]/page.tsx:8`, `ProjectRoute.tsx:68-74,913` |
| `one-on-ones` | Tab is "Check-ins" for everyone (not role-flipped "Mentoring"); always shown; "Start a check-in" (not "Start a new 1:1"); any account can create. | `label.ts:67`, `oneOnOneGate.ts:22`, `WorkbenchOneOnOnePanel.tsx:147` |
| `getting-started/demo-mode` | "Read the docs" floating pill documented but not in code; Leave-demo pill is muted neutral (not amber); "download as starter folder" link not on connect screen. | `providers.tsx:1242`, `FloatingLeaveDemoButton.tsx:22`, `FolderConnectGate.tsx:18` |
| `getting-started/connecting-your-folder` | "Link a folder" card / "Choose a folder" button / waving BeakerBot / "Explore demo" link — all retired. Now "Connect your folder" + "Drag here"/"Browse for a folder" + idle BeakerBot. | `FolderConnectGate.tsx:284,425,303` |
| `getting-started/creating-a-user` | "No central account system / the folder is the lab" false since cloud accounts (account-first default-on). | `account-first.ts:16`, `AccountHome.tsx` |
| `getting-started/user-archiving` | "Settings → Lab Mode tab" retired (SettingsShell rail). | `settings/page.tsx:188` |
| `getting-started/accounts` | Account-first `/account` home + tier-chooser labels ("Just me, local") undocumented; OAuth-first entry bypasses the 3-path screen described. | `account-first.ts:16`, `AccountTierChooser.tsx:140` |
| `security` | Documents retired PBKDF2/`_auth.json`; now Argon2id/`_account.json`. "data sits in plaintext" caveat stale. | `cleanup-auth-json.ts:2`, `backup.ts:42` |
| `compliance/nih-data-management` | Says Results lack version history; Results DO have it (only library Methods don't). | `version-history/page.tsx:17`, `labarchives-comparison/page.tsx:144` |
| `features` landing + `start-here` | "Click Link Folder" (now "Open a folder"); "no account/no sign-up" (Free/Lab shipped). | `StartScreen.tsx:104` |
| `settings` | Whole frame describes retired single-scroll stack; Tabs list names 9 wrong tabs; Personal/Lab tab strip + Profile pointer card retired. | `SettingsShell.tsx`, `nav.ts:11-35`, `settings/page.tsx:188,1133` |

---

## Part 2 — Content gaps (shipped, undocumented) by page

- **NEW PAGE `features/beakerbot`** (or major `ai-helper` expansion): CRUD on all objects, @mentions, /slash-commands, saved macros, voice input, PDF paper-reproduce, record-set widget, plan card (flag), Smart Data Binding chat door, summary suite, cloning/NCBI tools, Data Hub analysis. Refs: `registry.ts`, `ComposerMentionPicker.tsx`, `beaker-macros-store.ts`, `paper-reproduce-tools.ts`, `BeakerBotPlanCard.tsx`.
- **`phylo`** (rest of page): 5 rail tabs (Shape/Layers/Data/Export/Code), collection rail, 6 layouts (only 2 documented), phylogram/cladogram toggle, branch-color-by-column, MRCA highlights/node pies/clade rotation/brackets, MSA alignment panel, ZoomPanCanvas/minimap. Refs: `PhyloStudio.tsx:1078-1557`.
- **`figures`**: add screenshots (none today); enumerate all 4 panel sources; undo stack; 7 artboard presets; per-panel style inspector; note icon library is flag-gated preview (`ASSET_LIBRARY_ENABLED` default off).
- **`notifications`**: the entire per-category routing matrix (5 categories × 4 channels), quiet hours, solo-user gating, the phone Notifications screen + push token. Refs: `notifications/preferences.ts:17`, `NotificationsSection.tsx`, `mobile/app/notifications.tsx`.
- **`companion` set**: Home hub redesign, Methods library tab (offline + favorites + recs band), Timers/Calc/Wiki tabs, LabAlarm overlay, Quick note, bulk upload, scan-to-reorder, NotebookChooser routing, TodayPanel stat tiles + header button.
- **`settings`**: ~7 missing sections (Companion, Notifications, Usage & billing, Add-a-free-account, Lab group, Tips, Appearance&motion grouping).
- **`purchases`**: document attachment (order/invoice/receipt/quote) + "Send to department" routing. Refs: `PurchaseEditor.tsx:141,241`.
- **`inventory`**: kit/equipment/other categories; companion cross-link; zero screenshots (add list + storage-map shots).
- **`experiments`**: List view is the default (only Board documented); List/Board toggle; method/owner filter chips.
- **`version-history`**: purchases have version history (omitted). Ref: `PurchaseHistoryPopup.tsx`.
- **`trash`**: molecule + storage-location sections missing in BOTH wiki and `SECTION_ORDER` (deleted molecules/storage nodes are invisible on `/trash` — code bug to flag separately). Refs: `trash-types.ts:50-59`, `trash/page.tsx:50`.
- **`sharing-and-permissions`**: `canWrite(record, viewer)` signature (2 args, role-based, no session); `canWriteIgnoringPiRole`, `expandSharedWith`; inventory defaults to whole-lab edit.
- **`markdown-editor`**: object embeds (`ros://` live cards) — phylo page links here for this but it's undocumented.
- **`stats`**: missing nonparametric tests (Kruskal-Wallis, Spearman, Friedman), full post-hoc set (Dunnett/Sidak/Bonferroni/Holm-Sidak), R×C contingency, logistic regression as first-class, power planner + assumption report card, from-summary-stats variants, several reported fields (eta²/partial-eta²/VIF/concordance/Gehan-Breslow-Wilcoxon).
- **`cloud-and-plans`**: BeakerBot AI meter (the second meter) + tier-name structure. Ref: `BILLING_FACTS.md`.
- **`lab-head`**: `/approvals`, `/people`, New Project button, NeedsYou hero, stat strip, people snapshot.
- **`shared-lab-accounts`**: cross-ref the cloud-accounts lab invite/join model.
- **`integrations/labarchives`**: format-step coming-soon note; credential-free-only path.

---

## Part 3 — Screenshots (the capture harness manifest source)

### 3a. DELETE — orphaned old-UI assets (referenced by no page, depict retired UI)
`lab-overview.png`, `lab-overview-canvas.png`, `lab-overview-pi-default.png`,
`lab-overview-sidebar-rail.png`, `lab-overview-tile-vs-popup.png`,
`lab-overview-widget-palette.png`, `pi-actions-audit.png`, `lab-purchases-popup.png`,
`projects-sidebar-nav.png`, `home-widget-canvas.png`, `editor-hybrid-selected.png`,
`onboarding-hybrid-bold.png`, `onboarding-settings-rerun-button.png`,
`onboarding-wizard-step-7-wrapup.png`, `demo-mode-banner.png`.
REVIEW (keep or wire, don't blind-delete): `gantt-zoom-controls.png` (real, wire into Gantt zoom section), `lab-inbox-comments-thread.png` (wire into comments page or delete), `purchases-new-purchase-modal.png`.

### 3b. RECAPTURE — real files depicting pre-redesign UI (content stale, not just chrome)
`settings.png` (→ rail overview), `companion-home.png`, `companion-today.png`,
`companion-inventory.png`, `folder-connect.png`, `workbench-experiments.png`,
`workbench-experiments-sections.png`, `workbench-lists.png`, `methods-library.png`,
`pcr-editor.png`, `pcr-reagent-totals.png`, `purchases-csv-export.png`,
`projects-route-overview.png` (+ the other projects-route-*), `workbench-earlier.png`,
`user-login.png`, `user-archiving-roster.png`, `transparency-method-validation.png`.
Plus all 19 placeholder stubs in `docs/wiki-screenshots-todo.md`.

### 3c. NEW — capture for newly-documented features (filename → what → route/state)
- `settings-rail-overview.png` → SettingsShell left rail + a section pane → `/settings`
- `settings-usage-billing.png` → AI usage/cloud storage section → `/settings?section=ai` (cloud acct)
- `settings-lab-members.png` → Lab Members section → `/settings?section=members` (PI, lab tier)
- `settings-companion-section.png` → Companion toggles → `/settings?section=companion`
- `notifications-routing-matrix.png` → 5×4 channel matrix → `/settings?section=notifications`
- `companion-home-hub.png` → redesigned Home tab → companion, Home
- `companion-notebook-tab.png` → Notebook hero actions → companion, Notebook
- `companion-today-panel.png` → TodayPanel overlay (stat tiles) → companion, Today button
- `companion-inventory-scan-flow.png` → scan reticle + matched item → companion, Inventory→Scan
- `beakerbot-composer.png` → chat with @mention/slash menu → `/datahub` (BeakerBot on)
- `beakerbot-crud-confirm.png` → action approval card → same
- `beakerbot-plan-card.png` → plan card live steps → with `BEAKERBOT_PLAN_STEPS=true`
- `figure-composer-overview.png` / `-inspector.png` / `-artboard.png` → `/figures`
- `phylo-collection-rail.png` / `phylo-studio-tabs.png` / `phylo-studio-branch-color.png` / `phylo-studio-msa.png` → `/phylo`
- `inventory-signal-list.png` / `inventory-storage-map.png` → `/inventory`
- `workbench-experiments-list-view.png` → `/workbench` Experiments (list)
- `methods-type-picker.png` → `/methods` → + New Method
- `projects-popup-home.png` → `/workbench?tab=projects` → click a card
- `check-ins-new-dialog.png` → `/workbench?tab=oneonone` → Start a check-in
- `lab-overview-needs-you-hero.png` / `lab-overview-stat-strip.png` / `lab-overview-announcement-composer.png` → `/lab-overview`
- `lab-head-approvals-page.png` → `/approvals`
- `accounts-tier-chooser.png` / `accounts-start-screen.png` → `/` create-account flow
- `folder-connect-current.png` → `/?connect=1`
- `security-data-inventory-panel.png` / `security-offline-mode-toggle.png` → `/settings`
- `labarchives-import-wizard-format-step.png` / `labarchives-fetch-images-tabs.png` → import wizard
- `editor-embed-card.png` → note with a `ros://` embed
- `transparency-stats-validation.png` → `/transparency` stats section

---

## Part 4 — Structural / nav fixes
- `nav.ts APP_ROUTE_TO_WIKI`: add `/people` and `/lab-inbox` mappings (the in-app `?` button misfires). `/people` has no wiki page at all.
- Hub staleness: `compliance` intro says "two questions" but has 3 child pages; `welcome-wizard` nav blurb says the tour is active but the page says retired; `lab-overview` nav blurb lists removed sections.
- Code bugs surfaced (flag separately, not wiki): `/trash` `SECTION_ORDER` omits `molecule` + `storage_node` so deleted ones are invisible; AccountTierChooser shows "1 GB per member" vs billing code's 5 GB lab pool.
