# Wiki audit: cross-cutting + AppShell + wiki infra (2026-05-26)

Auditor: wiki audit: cross-cutting
Anchor: main @ 14ea9892 (Overnight orchestrator handoff doc)

Scope:
- Unified sharing primitive (Lab Mode retirement R1, R1b, R1c, R1d)
- AppShell chrome (top nav, sidebar, lab head login badge, notifications)
- File system context (user-switch React Query invalidation, wikiCapture fixtureUser, setCurrentUser, edit-session reset on user switch)
- Error reporting + Feedback flow (FeedbackButton, FeedbackModal, GitHub issue auto-capture, BugStomp scene)
- Wiki infrastructure (sidebar nav, search, "?" round-trip, WIKI_NAV + APP_ROUTE_TO_WIKI coverage gate)
- AI Helper integration page status
- Form protection (beforeunload guards + draft persistence)

## Findings

Count: 12 findings (3 high, 6 medium, 3 low).

---

### CC-1 [HIGH] Sharing wiki misrepresents the data shape: prose calls it `string[]`, code is `SharedUser[]`

The page at `frontend/src/app/wiki/features/sharing-and-permissions/page.tsx` opens with:

> Every shareable record carries a field:
> `shared_with: string[]   // array of usernames`

But the unified primitive in `frontend/src/lib/sharing/unified.ts` (R1, locked decision 1, 2026-05-23) is:

```
shared_with: { username: string; level: "read" | "edit" }[]
```

A reader inspecting their JSON files (one of the core selling points of the local-first model) will see objects with `level` fields, not bare usernames, and conclude the wiki is wrong (which it is). The whole canRead / canWrite walkthrough downstream also assumes the wrong shape: "appears in shared_with" implies a string-contains check, not an object-lookup. Fix: rewrite the "shared_with array" and the canRead / canWrite sections to describe the `{ username, level }` shape, and explain the read-time normalization path (`normalizeSharedWith` accepts both old `permission: "view" | "edit"` and new `level: "read" | "edit"` shapes).

---

### CC-2 [HIGH] Sharing wiki omits R1b method-auto-grant via task-share

`frontend/src/lib/sharing/unified.ts:266` exports `canReadMethodViaTask`, which grants transient read access on a method when the viewer has a shared task that references it, AND emits a `method-transient-read` audit entry on the method owner's side (R1b, 2026-05-23). This is a non-obvious sharing behavior with a privacy / audit footprint, but no wiki page mentions it. The Methods Library page and the sharing-and-permissions page both should: a user sharing a task does not realize they are also leaking transient read access to the underlying protocol AND that the protocol owner will see an audit row.

---

### CC-3 [HIGH] Lab Mode retirement (R1, R1b, R1c, R1d) is invisible to users

The R1 / R1b / R1c / R1d ship in code with extensive in-code retirement notes (see `lib/sharing/unified.ts:1-14` and `lib/sharing/migrate-unified.ts`). The `is_public` migration is covered by one Callout on `features/sharing-and-permissions/page.tsx:101-112`, but the broader story (there used to be a "Lab Mode" with a special "lab" sentinel user; the migration unified everyone onto per-user accounts + the "*" sentinel; existing records auto-migrate on first read) has no surface anywhere in the wiki. Users with pre-R1 folders need to know: (a) what the data-maintenance repair button actually fixes, (b) whether they should run it, (c) whether anything breaks if they don't. Recommendation: add a "Migrating from Lab Mode" sub-page under sharing-and-permissions, OR a Callout block on Start Here that names the migration and links to it.

---

### CC-4 [MEDIUM] AppShell EditSessionTopNavChip + EditSessionBanner have no wiki anchor

`AppShell.tsx:389` mounts `<EditSessionTopNavChip />` (persistent amber countdown chip when a lab-head session is unlocked) and `:512` mounts `<EditSessionBanner />` (global session-wide banner). Neither chrome element is described on `features/lab-head/edit-session-and-password/page.tsx` (or anywhere else searched). The sub-page focuses on the unlock flow, not on the always-visible session indicators that follow the PI across routes. A reader of the wiki cannot match "the amber chip / banner I see at the top of every page" to its documentation.

---

### CC-5 [MEDIUM] No reverse-coverage gate from `app/wiki/**/page.tsx` to `WIKI_NAV`

`lib/wiki/__tests__/nav.test.ts` covers the forward direction (every `APP_ROUTE_TO_WIKI` value has a page.tsx). The reverse is not enforced: a wiki page can exist on disk and be unreachable through the sidebar (no `WIKI_NAV` entry). Today's WIKI_NAV has good coverage (all 40+ pages under `app/wiki/` enumerated), but the gate would catch a future "I added a page but forgot to wire it into the sidebar" regression. The audit follow-up would be a small test that walks `frontend/src/app/wiki/**/page.tsx` and asserts every href is reachable via `findWikiNode`.

---

### CC-6 [MEDIUM] AI Helper has no dedicated wiki page; deep-link from onboarding step exists

`components/onboarding/v4/step-machine.ts:526` describes the §6.10 AI Helper deep-explain that fires when `picks?.ai_helper` is `full | medium | minimal`. The feature is covered in `features/settings/page.tsx#ai-helper` (one `<h2>` section), but the WIKI_NAV has no top-level entry for it. The integrations index (`/wiki/integrations`) only lists Telegram, Calendar Feeds, LabArchives, NOT AI Helper. Recommendation: either add a standalone `/wiki/integrations/ai-helper` page that points back to the Settings anchor, or add an "AI Helper" cross-link from `/wiki/integrations` so the user expecting to find it under Integrations gets there.

---

### CC-7 [MEDIUM] wikiCapture + fixtureUser are documented only as TODO captions, never explained as user-facing affordances

`getting-started/demo-mode/page.tsx` mentions the demo. Multiple wiki pages reference `?wikiCapture=1` in screenshot TODO comments. But the `installWikiCaptureFixture` mechanism, the `?fixtureUser=<name>` override (added 2026-05-25 for the events-widget user-switch fix), and the production hostname gate that hard-blocks the URL flag are entirely invisible to the wiki. Internal-only feature today, but the Start Here page tells users to "use Cmd-F / Ctrl-F" without mentioning the wiki-side capture mode that screenshot work depends on, and verifiers / contributors have no doc to land on. Lower priority — but worth a single contributor-facing page under getting-started or a dedicated `developer/` section.

---

### CC-8 [MEDIUM] Form protection (useUnsavedChangesGuard + useDraftPersistence) has no wiki coverage

`frontend/src/hooks/useUnsavedChangesGuard.ts` + `useDraftPersistence.ts` ship as a paired API with seven+ callsites (NewPurchaseModal, NoteDetailPopup, CommentsThread, TaskModal, HighLevelGoalModal, CreateMethodModal, AnnouncementsWidget, ProjectRoute, links/page.tsx, app/page.tsx). User-facing surface: "Leave site?" prompts on accidental tab close, draft auto-restore after a navigation. Both behaviors are non-obvious to a user (one is browser-native, the other is silent). Wiki pages on Notes, Comments, Announcements, Purchases, Tasks should each have a Callout explaining: "Your unfinished edits are auto-saved to a local draft; if you accidentally close the tab, your text comes back next time you open the same form." Today: zero coverage.

---

### CC-9 [MEDIUM] FeedbackModal "Type" persistence + description-required gate not documented

`features/feedback/page.tsx` accurately describes the three types, the no-auto-submit POST-free model, the BugStomp scene, and the feedback.yml routing. It does NOT mention:
- The `localStorage` "last-used type" memory at `researchos:feedback-type-last` (FeedbackModal.tsx:19), which preselects the user's last choice on next open.
- The mandatory non-empty description gate (FeedbackModal.tsx:95): users wondering why the Submit button is grayed out have no doc to find.
- The "Bug type locks when an error triggered the open" rule (FeedbackModal.tsx:77): if the modal opens via the bug-report flow, the user cannot switch type away from Bug until they close and reopen.

Low impact but each is a real interaction the wiki should call out.

---

### CC-10 [LOW] AppShell late-night coffee easter egg + StreakBadge in header not mentioned anywhere user-facing

`AppShell.tsx:97` mounts `useLateNightCoffeeTrigger` and `:264` mounts `<StreakBadge />`. The StreakBadge is described in `features/settings/page.tsx#streaks` section (visible "below the toggle in the Settings panel") but not as a header-chrome element the user sees every time they look at their app. The Coffee BeakerBot easter egg has no wiki mention at all — fine as an easter egg, but the Settings → Animation toggle that gates it is not labeled as such, so a user who disables animations to silence the late-night scene has no doc to land on.

---

### CC-11 [LOW] React Query user-switch invalidation is correct but the wiki Quick Switch UX hint is missing

`file-system-context.tsx:874-917` correctly performs `appQueryClient.invalidateQueries()` on every real user-change (`isUserChange` gate skips the initial mount). This is a load-bearing fix (events-widget user-switch bug, 2026-05-25). The fix is mentioned nowhere user-facing. A user in a lab folder who switches via the bottom-right user-avatar pill might wonder if a brief loading flash is normal vs broken. The Creating a User wiki page does not describe the in-tab switch flow at all (only the create-user flow). Recommend a one-paragraph "Switching between users" section on `getting-started/creating-a-user/page.tsx` that says: clicking the bottom-right pill switches in-place, all on-screen data refreshes, the active lab-head edit session ends.

---

### CC-12 [LOW] WIKI_NAV "Results (moved)" placeholder vs actual code surface

WIKI_NAV (`nav.ts:292-295`) lists "Results (moved)" pointing to `/wiki/features/results`, which presumably describes where the old standalone Results page's surfaces ended up. Couldn't verify the page itself in this pass (out of scope to read every leaf), but the WIKI_NAV blurb "Where the standalone Results page's surfaces moved to" is fine in the nav, slightly low-effort in the long run. Just flagging that the entry exists as a redirect-explanation page and should be reviewed for whether it's still load-bearing once the standalone Results page has been gone for several months.

---

## What was checked but is clean

- `AppShell.tsx` top-nav gating for the in-product walkthrough (data-tour-nav-disabled): correct + comprehensive.
- `appRouteToWikiRoute` prefix-match logic + `getWikiForRoute` strict-match carve-out: tested + clean.
- `WikiSearch.tsx` lazy index load on first focus + 180ms debounce + a11y combobox roles: solid.
- `WikiSidebar.tsx` mobile toggle + active-descendant nav: clean.
- `useErrorReporting` global Zustand store + auto-error fingerprint dedup + BugStomp cooldown: well-architected.
- `FeedbackModal` reset-on-open guard (errorInfoRef pattern preserving user-typed text): correctly fixed in feedback polish R1.
- The Lab Head implicit view-all + the Phase 5 passcode-gated canWrite logic: documented in unified.ts and correctly described in features/sharing-and-permissions/page.tsx.
- The `restorePreDemoStateOrClear` stale-fixture-handle recovery: correct, mentioned only in code comments which is appropriate.
- The fixture-user real-user guard (`file-system-context.tsx:362-396`) that refuses `?wikiCapture` shadowing a real signed-in user: correct + well-commented.

