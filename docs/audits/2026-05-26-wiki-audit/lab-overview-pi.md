# Wiki audit: lab overview + PI features

Audit date: 2026-05-26
Auditor: wiki audit: lab overview + PI
Scope: /lab-overview surface, PI customizable left sidebar, Mira PI tooltip badges, per-widget popup-title overrides

App code surveyed:
- `frontend/src/app/lab-overview/page.tsx`
- `frontend/src/components/lab-overview/SnapshotCanvas.tsx`
- `frontend/src/components/lab-overview/SidebarWidgetRail.tsx`
- `frontend/src/components/lab-overview/CustomizableSidebar.tsx`
- `frontend/src/components/lab-overview/ToolsLauncher.tsx`
- `frontend/src/components/lab-overview/widgets/registry.ts`
- `frontend/src/components/lab-overview/widgets/WidgetHelpBadge.tsx`
- `frontend/src/components/lab-overview/widgets/PiActionsWidget.tsx`
- `frontend/src/components/lab-overview/widgets/LabPurchasesWidget.tsx`
- `frontend/src/lib/lab-overview/useFirstPaintHint.ts`
- `frontend/src/lib/lab-overview/tool-registry.tsx`
- `frontend/src/lib/file-system/wiki-capture-mock.ts` (resolveFixtureUser)
- `frontend/src/lib/file-system/file-system-context.tsx` (user-switch React Query invalidation)

Wiki pages compared:
- `frontend/src/app/wiki/features/lab-overview/page.tsx`
- `frontend/src/app/wiki/features/lab-overview/customizable-sidebar/page.tsx`
- `frontend/src/app/wiki/features/lab-overview/widgets-and-tools/page.tsx`
- `frontend/src/app/wiki/features/lab-overview/snapshot-tiles-and-expanded-views/page.tsx`
- `frontend/src/app/wiki/features/lab-head/page.tsx`
- `frontend/src/app/wiki/features/lab-head/soft-write-actions/page.tsx`
- `frontend/src/app/wiki/features/lab-head/audit-log/page.tsx`
- `frontend/src/app/wiki/features/lab-head/edit-session-and-password/page.tsx`
- WIKI_NAV + APP_ROUTE_TO_WIKI: `frontend/src/lib/wiki/nav.ts` (routes /lab-overview correctly to /wiki/features/lab-overview)

---

## Findings

### CRITICAL bugs (wiki contradicts code)

**1. Sidebar rail is on the LEFT, wiki says RIGHT.** Five separate paragraphs across `lab-overview/page.tsx`, `customizable-sidebar/page.tsx`, and `snapshot-tiles-and-expanded-views/page.tsx` describe the customizable sidebar as "runs down the right edge", "right-edge rail", "fixed to the right edge". The actual implementation in `app/lab-overview/page.tsx` line 162 mounts `<SidebarWidgetRail>` BEFORE the canvas in a `flex` row (sidebar | canvas). The new AppShell-level `<CustomizableSidebar>` (`components/lab-overview/CustomizableSidebar.tsx`) replaces the existing left-side `<DailyTasksSidebar>` for lab heads. Net effect: a user following the wiki will look right and find nothing. This is the single highest-impact finding.

**2. Drag-between-canvas-and-sidebar is described as a real flow but does not exist.** `customizable-sidebar/page.tsx` ("drag a tile out of the snapshot canvas and drop it on the sidebar rail. The rail accepts the drop and the tile re-renders in its slim sidebar variant.") and `snapshot-tiles-and-expanded-views/page.tsx` (the closing Callout: "Drag a tile from the canvas onto the right-edge sidebar rail and it re-renders in its slim sidebar variant. Drag it back and it pops back into its canvas variant.") both describe a cross-surface drag that the code does not implement. `SnapshotCanvas`'s `handleDragStart/Drop` operate on the canvas grid only; `SidebarWidgetRail` + `CustomizableSidebar` accept drags only within their own list. Cross-surface pinning happens through the per-surface palette (+ Add widget), not drag. Both passages are fiction.

### MAJOR gaps (whole feature surfaces missing)

**3. PI customizable left sidebar (always-on, app-wide) is undocumented.** `CustomizableSidebar.tsx` replaces the standard `<DailyTasksSidebar>` for every `account_type === "lab_head"` user across every route except `/calendar` and `/lab-overview` (those have their own carve-outs). It reads the same `widgetOrder.sidebar` as the in-page rail, so PI customizations propagate across both surfaces. The wiki's `customizable-sidebar/page.tsx` only covers the in-page lab-overview rail and never mentions the AppShell-level mount or the cross-route persistence. Lab heads using ResearchOS today see a customizable sidebar on /home, /experiments, /search, etc., with zero wiki coverage explaining how it relates to the lab-overview rail.

**4. Mira PI first-paint tooltip badges + auto-open hint are undocumented.** `WidgetHelpBadge.tsx` + `useFirstPaintHint.ts` ship a "?" badge on every sidebar tile with hover + click + once-per-Mira-session auto-open semantics (BeakerBot first-paint variant, single-active-tooltip semantics via module registry, sidecar persistence at `lab_overview_tooltips_seen_at`, deferred-until-wizard-completes via `WIZARD_COMPLETION_BUFFER_MS = 10000`). Every widget definition in the registry now carries a `helpText` field consumed by this badge. The wiki has zero mention of badges, tooltips, the first-paint moment, or the underlying onboarding signal — a freshly-promoted lab head reading the wiki will not be told why a tooltip pops on first paint.

**5. Per-widget popup-title overrides (`popupTitle`) are undocumented.** `tool-registry.tsx` `resolveToolTitle` implements a 3-tier resolution (widget.popupTitle > Tool registry title > widget.title). Used today on `calendar-events-today` ("Today's events"), `sidebar-overdue` ("Overdue tasks"), `sidebar-upcoming` ("Upcoming tasks"), `sidebar-daily-tasks` ("Daily tasks"). The wiki's `widgets-and-tools` page asserts "Click any of them and the same expanded popup opens" without noting the popup title CAN diverge per-variant — directly contradicting what users see when they click Upcoming tasks (popup reads "Upcoming tasks", not the Tool's umbrella "Today's tasks").

**6. PI Actions dashboard (3-tab popup) is described as if it were the old 3-row counter.** `soft-write-actions/page.tsx` describes purchase approval as showing in "the Pending approvals tab of the PI Actions popup" and references the audit log tab, which is accurate at the highest level, but never explains the Flagged-by-you tab, the click-to-source flow for flagged records, the Recently declined collapsible section + Re-approve affordance, the `isPurchasePending` predicate (which makes pending counts exclude declined items), or the Show more / Show all paging on Audit log. The audit-log wiki page covers the audit tab cleanly but PiActions itself never gets a structural walk.

**7. Tools launcher behavior under "no widget pinned" missing.** Wiki says "the Tools launcher in the page header opens the same popups directly, without needing a tile". True but underspecified: `visibleTools(accountType, surface)` filters Tools whose at least one widget variant is eligible for the requested surface AND visible to the account. So a tool with all variants carved out for a surface drops off that surface's launcher. The home launcher behavior and per-surface filtering are real distinctions members and lab heads will encounter and the wiki glosses them.

### MODERATE gaps

**8. Widget catalog count drift.** Wiki `widgets-and-tools/page.tsx` headline says "The 12 Tools" and the bullet list shows 11. The actual `TOOL_REGISTRY` has 14 (announcements, comments, notes, experiments, purchases, metrics, daily-tasks, lab-activity, recent-activity, pi-actions, member-workload, todays-announcements, calendar — and the list omits `calendar` entirely from the bullets). Numbers should either become approximate ("a dozen Tools") or be regenerated from `TOOL_REGISTRY.length`.

**9. Three purchases variants section is accurate but does not explain Phase C model.** The widget-variants section mentions LabPurchases has 3 variants but does not generalize: today the registry has variants on Comments (mentions), Experiments (ready-writeup), Lab Activity (by-type), Calendar (today), Daily Tasks (overdue / today / upcoming / full-stack). The "iPhone widgets" framing is present, the catalog enumeration is not.

**10. Member visibility / Home migration not consistent.** `customizable-sidebar/page.tsx` correctly says members do not see /lab-overview. But `lab-overview/page.tsx` (the wiki page) says the rail is "always visible" — implying always-on on /lab-overview, fine — but the AppShell-level customizable sidebar IS always-on app-wide for PIs (Finding 3) which the wiki never reconciles. Net: a member reading the wiki cannot tell that the customizable rail concept extends beyond /lab-overview for their lab head.

**11. `wikiCapture` fixture override (`?fixtureUser=`) + user-switch React Query invalidation are undocumented.** Both ship as developer-facing surfaces with no wiki coverage. The audit's scope mentions both; since these are infra plumbing (not user-facing UX), a missing wiki page is defensible IF the call is that they should not be on the wiki. Flagging for confirmation. The `?fixtureUser=` flag does have meaningful impact on screenshot capture workflows; the user-switch invalidation is internal.

### MINOR gaps / polish

**12. Lab Inbox → Lab Overview rename is incomplete in wiki cross-links.** `lab-overview/widgets-and-tools/page.tsx` links to `/wiki/features/lab-inbox/announcements` and `/wiki/features/lab-inbox/comments` (Lab Inbox is the old name; the WIKI_NAV still keeps `/wiki/features/lab-inbox` alive as a separate node). Code routing in `lib/wiki/nav.ts` line 24 maps `/lab-overview` → `/wiki/features/lab-overview` correctly, but lines 238-248 keep a parallel `/wiki/features/lab-inbox` tree. The two wiki nodes are not reconciled — readers will see both as distinct sections even though the route consolidated. Either re-home announcements/comments under `/lab-overview/widgets/*` or document why the dual tree is intentional.

**13. PurchaseDeclinedBadge documented only on `/wiki/features/lab-head/soft-write-actions`.** Mentioned in passing on the soft-write page and the purchases wiki page (line 410). No screenshot, no explanation of when the badge appears (everywhere a declined purchase renders — `PurchaseEditor`, `LabPurchasesWidget`, member purchase popups). Once tested, document the visual on the lab-head page so PIs know what to look for.

**14. `helpText` exit-edit-mode hide.** `SidebarWidgetRail` line 380 hides the WidgetHelpBadge in edit mode so it does not fight with the remove ×. Not user-facing critical but the wiki's "edit mode" section should note that hover affordances disappear while editing.

**15. Default lab-head layout copy mismatch.** `customizable-sidebar/page.tsx` lists defaults as "DailyTasksWidget, PiActions, TodaysAnnouncements". Code defaults from `EMPTY_SIDEBAR_FALLBACK` + `defaultLabHeadLayout` are `sidebar-recent-activity`, `sidebar-pi-actions`, `sidebar-member-workload` (3 widgets in `EMPTY_SIDEBAR_FALLBACK`; the actual fresh-user default in `layout-persistence.ts` seeds four — wiki should reflect whichever the persistence layer actually writes).

---

## Counts

- Critical bugs (wiki contradicts code): 2
- Major gaps (whole features undocumented): 5
- Moderate gaps: 4
- Minor / polish: 4
- Total findings: 15

## Recommended chip priority

Highest impact: Findings 1 + 2 (sidebar position + drag-between mechanic). Both are factually wrong, both can be fixed inline in `customizable-sidebar/page.tsx` and `snapshot-tiles-and-expanded-views/page.tsx`. Next: Findings 3 + 4 (whole-surface gaps) need new wiki sections. Finding 5 (popupTitle) is a 2-paragraph addition to `widgets-and-tools/page.tsx`.
