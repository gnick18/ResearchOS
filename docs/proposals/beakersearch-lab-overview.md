# BeakerSearch on Lab Overview (exhaustive interaction spec)

This is the build-ready expansion of the Lab Overview surface for BeakerSearch,
the companion to
[`beakersearch-website-wide.md`](./beakersearch-website-wide.md) and a sibling of
[`beakersearch-purchases.md`](./beakersearch-purchases.md). The master doc fixes
the architecture (one global `BeakerSearchProvider`, per-page
`useBeakerSearchSource` contributors), the four context signals (SELECTED,
HOVERED, ON SCREEN, OPEN / FOCUSED), the item kinds (COMMAND, NAVIGATE, RESULT,
CONTEXT CARD), and the global layer. This doc does NOT restate any of that. It
takes Lab Overview from concept depth to a full interaction spec grounded in the
real `src/app/lab-overview/page.tsx`, `src/components/lab-overview/LabOverviewPage.tsx`,
its child widget bodies, and the `src/lib/lab/` data + action layer, so a builder
can wire the source object without re-reading the page.

Voice rule for this doc and any copy it specifies, no em-dashes, no en-dashes,
no emojis, no mid-sentence colons.

Reference shapes are the ones the Sequences palette already ships
(`components/sequences/editor-commands.ts`), so the Lab Overview source produces
the same `PaletteItem` union the provider already ranks and renders. The relevant
real types are `EditorCommand` (with `id`, `label`, `group`, `iconName`,
optional `shortcut`, `run`, optional `enabled`, optional `detail`, optional
`keywords`), `SequenceNavItem` / `ArtifactNavItem` (the NAVIGATE and RESULT
analogues), and the `PaletteItem` discriminated union over `kind`. Lab Overview
adds no new kind, it only supplies new items.

Lab Overview is the most ACTION-rich and most ROLE-GATED page in the app. Three
things make it different from every other page source:

1. The whole source is LAB-HEAD-ONLY. The route bounces a non-PI to `/`
   (`accountType !== "lab_head"` redirect in `page.tsx`). So the entire Lab
   Overview source is ABSENT for members, never registered, never merged into the
   palette. Section 8 makes this central.
2. Almost every mutating action it can reach is gated by a live PI edit session.
   `assertLiveSession(actor, sessionId)` runs inside `pi-actions.ts` before any
   approve / decline / assign / flag write, throwing `data-write` otherwise. The
   live session is read page-agnostically via `useLiveEditSession()`
   (`src/hooks/useEditSession.ts`) returning `{ isLive, sessionId, username }`.
   Every gated row threads `isLive && username === currentUser` as its `enabled`
   predicate, and the headline Suggested when the session is locked is
   "Unlock edit mode".
3. There is one exception to the gate, the ANNOUNCEMENTS composer. The
   `pi-password` bot (2026-06-02) removed the edit-session gate from posting
   announcements because a signed-in PI is already password-authenticated at
   login. So "Post an announcement" is the one mutating Suggested row that is
   live for a PI WITHOUT an unlock. This asymmetry is called out everywhere it
   matters.

---

## 1. Entity model, data sources, keys

Everything below is read by `LabOverviewPage` and its child widget bodies today
(`ActionBar` via `useActionBarCounts`, `AnnouncementsBody`, `LabActivityBody`,
`CalendarEventsTodayBody`, `MemberWorkloadBody`). BeakerSearch reads the SAME
React Query caches (no new fetches), so it is always in sync with the page and
costs nothing extra.

### 1.1 Entities

| Entity | What it is | Identity in memory |
| --- | --- | --- |
| Lab member | A `LabUser` from `labApi.getUsers()` (via `useLabData`). Carries `username`, `color`, `color_secondary`, `created_at`. Decorated for display by `useLabUserProfileMap()` (`displayName` + `account_type`) and filtered by `useArchivedUsers()`. | `username` (lab-wide, no owner namespacing on the aggregated read). |
| Pending purchase approval | A `PurchaseItem & { username }` from `labApi.getAllPurchaseItems()`, walking every discovered user's `purchase_items/` dir. The `username` field is the item OWNER. "Pending" is `isPurchasePending(item)` => `!approved && !declined_at`. Lab-head only. | `username` (owner) + item `id`. The owner is the `targetOwner` every `pi-action` needs. |
| Assignable task | A `LabTask` from `labApi.getTasks({ exclude_goals: true })` (via `useLabData`). Carries `id`, `name`, `project_id`, `start_date`, `end_date`, `is_complete`, `task_type`, `username` (owner). Goals are excluded upstream. Also carries an optional `flagged` sidecar (widened locally, not on the `LabTask` type). | `username` (owner) + numeric `id`. The owner is the `targetOwner` for `assignTask` / `setFlagForReview`. |
| Announcement | An `AnnouncementEntry` from `listAnnouncements()` (`lib/lab/announcements.ts`), the lab-root `_announcements.json`. Carries `id`, `author`, `text`, `created_at`, `pinned`. The composer is PI-only and (uniquely) NOT edit-session gated. | `id` (UUID-style, lab-wide). |
| Flagged record (by me) | Any task or purchase item whose `flagged.by === currentUser`. The action bar's `flagged` count sums tasks (from `useLabData`) + lab purchase items (from `["lab","purchase-items"]`) where `flagged?.by === currentUser`. | underlying record's owner + id + `record_type`. |
| Inbox feed event | A `FeedItem` built by `LabActivityWidget` from notes (creation + comments), tasks (scheduled), flags, and announcements. Carries `kind`, `username`, `summary`, `timestamp`, `href`, `key`. Read-only, the page's "recent PI actions / lab activity" stream. | `key` (already stable per item). |
| Today's events | Native events from `eventsApi.list()` (`["events"]`) plus pulled external feed events, filtered to today by `coversDate`. Read-only here. | event `id`. |
| Lab inbox counts | `pending` (lab pending approvals), `flagged` (flagged-by-me), `mentions` (@-mentions in shared-note comments). Computed by `useActionBarCounts` over `["lab","purchase-items"]`, `useLabData().tasks`, and `["lab","notes-shared"]`. | derived counts, no key. |

### 1.2 Data sources (exact hooks, already on the page)

```ts
// Lab core data (users, tasks, projects), shared cache via useLabData.
useQuery({ queryKey: ["lab", "users"],   queryFn: () => labApi.getUsers().then(r => r.users) })
useQuery({ queryKey: ["lab", "tasks"],   queryFn: () => labApi.getTasks({ exclude_goals: true }) })
useQuery({ queryKey: ["lab", "projects"],queryFn: () => labApi.getProjects() })

// Lab-wide purchase items (lab head only). Drives the pending-approval count.
useQuery({ queryKey: ["lab", "purchase-items"],
           queryFn: () => labApi.getAllPurchaseItems(), enabled: isLabHead })

// Shared notes across the lab. Drives @-mention count + the activity feed.
useQuery({ queryKey: ["lab", "notes-shared"],
           queryFn: () => labApi.getNotes({ shared_only: true }) })

// Lab-wide announcements (the composer + the feed both read this key).
useQuery({ queryKey: ["lab-announcements"], queryFn: listAnnouncements })

// Today's calendar events (native + external).
useQuery({ queryKey: ["events"], queryFn: eventsApi.list })

// Per-user display names + account_type (display + role rendering).
useQuery({ queryKey: LAB_USER_PROFILES_QUERY_KEY, queryFn: /* per-user settings */ })

// Archived-member set (filters the assignee picker + the roster).
useQuery({ queryKey: ARCHIVED_USERS_QUERY_KEY, queryFn: /* onboarding sidecars */ })
```

Role comes from `useAccountType(currentUser)` => `isLabHead = accountType === "lab_head"`.
The live session comes from `useLiveEditSession()` =>
`{ isLive, sessionId, username }`.

### 1.3 Composite keys and owner routing (the PI-action contract)

Lab Overview's aggregated reads (`getAllPurchaseItems`, `getTasks`, `getNotes`)
decorate each record with its OWNER `username`. The `pi-actions.ts` writers do
NOT take a composite `"{owner}:{id}"` string. They take the owner + the numeric
id as separate fields:

- `assignTask({ targetOwner, taskId, ... })` where `targetOwner = task.username`.
- `setPurchaseApproval({ targetOwner, purchaseItemId, ... })` where
  `targetOwner = item.username`.
- `declinePurchase({ targetOwner, purchaseItemId, ... })`.
- `setFlagForReview({ targetOwner, recordType, recordId, ... })`.

So a NAVIGATE item or a SUGGESTED command that targets a lab record MUST carry
the record's owner `username` alongside its numeric id, never the bare id, or the
owner-routed write lands in the wrong folder (the same class of bug the composite
key avoids elsewhere). Cross-page NAVIGATE jumps that hand off to Purchases or
the Workbench should still set the destination page's composite `taskKey`-style
deep link (see 4); the in-page PI commands use the owner + numeric id split that
`pi-actions` expects.

Every mutating PI action also carries `actor: currentUser` and
`sessionId: liveSessionId` (from `useLiveEditSession`). `assertLiveSession`
rejects a stale or mismatched id server-side regardless of what the palette
renders.

### 1.4 Query keys for invalidation (what each command must invalidate)

| After | Invalidate |
| --- | --- |
| Approve / decline a purchase (`setPurchaseApproval` / `declinePurchase`) | `["lab", "purchase-items"]`, `["purchases"]`, `["purchases-all"]`. Mirrors `PurchaseApprovalToggle` (which invalidates `["purchases"]` + `["purchases-all"]`); add `["lab","purchase-items"]` so the action-bar pending count drops. |
| Assign a task (`assignTask`) | `["task", taskKey(task)]`, `["lab", "tasks"]`. Mirrors `AssignTaskButton`. |
| Flag / clear a flag (`setFlagForReview`) | task => `["tasks"]`, `["task"]`, `["lab","tasks"]`; note => `["notes"]`, `["lab","notes-shared"]`; purchase_item => `["purchases"]`, `["purchases-all"]`, `["lab","purchase-items"]`. Mirrors `invalidateForRecord` in `FlagForReviewButton` plus the lab keys so the action bar refreshes. |
| Post / edit / delete an announcement | `["lab-announcements"]` (the `LAB_ANNOUNCEMENTS_QUERY_KEY`). Mirrors the composer's `onPosted`. The widget also fans out notifications via `dispatchAnnouncementNotifications` / `purgeAnnouncementNotifications` / `refreshAnnouncementNotifications`. |
| Archive / restore a member (`archiveUser` / `restoreUser`) | `ARCHIVED_USERS_QUERY_KEY`, `LAB_USER_PROFILES_QUERY_KEY`, `["lab","users"]`. Mirrors `LabRoster`. |

The provider does not own these caches. Each Lab Overview COMMAND `run` calls the
same `pi-actions` / `announcements` / `user-archive` handler the page uses and
invalidates the same keys, so the page (and the action-bar counts) re-render
identically whether the action came from a button or BeakerSearch.

---

## 2. Context model (the four signals on Lab Overview)

The source's `context()` returns `{ focused?, selected?, hovered?, onScreen? }`
plus a render hint for the CONTEXT CARD. The defining detail on this page is that
the card MUST surface the live-session state (locked vs unlocked for
`currentUser`), because every gated command reads off it.

### 2.1 OPEN / FOCUSED

There is no single "open document" on Lab Overview. The page's identity IS the
lab-head dashboard frame, "everything that needs you plus what your lab has been
up to". So FOCUSED maps to the page-level frame, surfaced as the card's first
line, and ON SCREEN (the active section + the inbox counts + the session state)
does the heavy lifting.

### 2.2 SELECTED

Lab Overview has no persisted single-selection like Sequences' open sequence or
Purchases' `selectedTask`. The page is a feed-and-sections dashboard, not a
record editor. BeakerSearch SELECTED on this page therefore maps to a FOCUSED
entity the user explicitly picks INSIDE the palette via a NAVIGATE drill (a
member, a pending approval, a flagged record). When the user navigates to "the
member alex" or "the pending item Pipette tips" inside BeakerSearch, that entity
becomes SELECTED for the duration of the palette session and re-drives Suggested
(see 3.2 / 3.3). This is the "select an entity in the palette, then act on it"
pattern, the only sane SELECTED model for a page with no inline record selection.

### 2.3 HOVERED / UNDER THE MOUSE

The provider tracks the last hovered `[data-beaker-target]` element app-wide. For
Lab Overview, tag the two row types that are already discrete and clickable so
hover gives mouse-aware suggestions for free:

- Each Member-workload row in `MemberWorkloadBody` (avatar + name + open / overdue
  counts). Tag with `data-beaker-target` payload key `` `lab-member:${username}` ``.
- Each pending-approval row, once a pending-approvals tile is surfaced (today the
  count routes to `/purchases`; a hoverable per-item list is a small addition).
  Tag with `` `lab-approval:${item.username}:${item.id}` ``.
- Each announcement card in `AnnouncementsBody`. Tag with
  `` `lab-announcement:${entry.id}` `` so "Edit" / "Pin" / "Delete" can be the
  hover-promoted Suggested for the PI's own announcements.

When the palette opens with no SELECTED but a hovered member / approval /
announcement, that hovered entity is promoted to the same Suggested treatment as
a selection, with a softer card line ("Pointing at member alex"). This is the
per-page opt-in the master doc calls out. The member-workload rows are the best
first prototype here (discrete, already carrying open / overdue detail).

### 2.4 ON SCREEN

ON SCREEN is richer here than on any other page because it must carry the
session state:

- `activeSection`, which section is in view / nearest the scroll (Action bar,
  Announcements, Lab activity, Today's events, Member workload). The page is a
  fixed vertical stack, so this is a scroll-position derivation, not store state.
- `editSession`, the live-session liveness from `useLiveEditSession()`,
  `{ isLive, sessionId, username }`. The single most important ON SCREEN fact on
  this page, because it flips the headline Suggested between "Unlock edit mode"
  and the real PI actions.
- The inbox counts, `pending` (lab pending approvals), `flagged` (flagged-by-me),
  `mentions` (@-mentions), from `useActionBarCounts`. These scope the headline
  Suggested ("3 approvals waiting") and seed the empty-query Suggested even with
  no hover.
- Lab size, `users.length` from `useLabData` (for the card's "8 members" line and
  the announce / member commands).

ON SCREEN scopes ENTITIES (the empty-query jump list leads with the inbox
attention items, then members) and biases Suggested (the pending count unlocks
"Review pending approvals"; the locked session unlocks "Unlock edit mode").

### 2.5 The CONTEXT CARD contents

The card is non-selectable. Its lines, computed from the signals above:

- Line 1 (FOCUSED + ON SCREEN), the dashboard scope and the lab size:
  `Lab Overview, 8 members`. From `users.length`. When the active section is
  meaningful, append it, `Lab Overview, 8 members, Lab activity`.
- Line 2 (the SESSION state, ALWAYS present, the page-defining line):
  - Unlocked for the current user, `Edit mode unlocked, 4:12 left` (the
    `formatRemaining(remainingMs)` value, mirroring the top-nav chip). Green /
    amber unlocked-padlock affordance.
  - Locked / idle, `Edit mode locked, approvals and edits need an unlock`.
    Closed-padlock affordance. This line is the cue for the "Unlock edit mode"
    headline Suggested.
  - Unlocked for a DIFFERENT lab head (multi-PI lab),
    `Edit mode held by @other-pi`, and the current user's gated commands stay
    disabled (the gate is `username === currentUser`, see 3).
- Line 3 (the inbox snapshot, when anything is pending):
  `3 approvals, 2 flagged by you, 1 mention await you`. Built from
  `useActionBarCounts`; the segments mirror the action bar's "What needs you"
  copy. When all three are zero, this line reads `You're all caught up` (mirrors
  the page's all-clear state).
- Line 4 alt (HOVERED, no selection): `Pointing at member alex, 6 open, 2 overdue`
  (from the member-workload row detail), or `Pointing at "Pipette tips x10"` for
  a hovered approval.

While the query is typed, the card collapses to a one-line header that KEEPS the
session badge, `Lab Overview, edit mode locked`, because the lock state stays
relevant to every command the user might filter to.

---

## 3. SUGGESTED (contextual + session-aware + role-aware)

Suggested items are COMMANDs (kind `"command"`) with the target echoed in the
row's `detail`, identical to how Sequences echoes "from 612..632". Each lists its
exact real handler, its `enabled` predicate, and the row echo. Ranking follows
the master priority, SELECTED > HOVERED > ON SCREEN > FOCUSED.

The whole source only exists for `isLabHead === true` (section 8), so there is no
"member view" of Suggested. The branch that matters here is LIVE SESSION vs
LOCKED SESSION.

### 3.1 The session gate (applies to every mutating row except announcements)

Let `live = useLiveEditSession()` => `{ isLive, sessionId, username }`. Define the
canonical gate once:

```ts
const canWrite = live.isLive && live.username === currentUser;
```

- Every approve / decline / assign / flag Suggested row sets `enabled: canWrite`.
- When `canWrite` is false, the row is SHOWN but greyed, with `detail`
  "Unlock edit mode to do this" and an alternate `run` that opens the unlock
  (routes to the "Unlock edit mode" headline command, section 3.2 / 6). The row
  never silently fails the `assertLiveSession` write.
- The ANNOUNCEMENTS composer rows are the exception. "Post an announcement" /
  "Edit announcement" / "Delete announcement" set `enabled: true` for a PI
  regardless of `canWrite`, because the composer is not edit-session gated
  (pi-password bot, 2026-06-02). The audit row is skipped when no session is
  live; attribution stays on `entry.author`.
- Archive / restore a member is a special case, the underlying
  `archiveUser` / `restoreUser` do NOT call `assertLiveSession` (they read the
  session only to stamp the audit `session_id`, falling back to a
  `no-session-...` id). The REAL gate is UI-side, `LabRoster` requires
  `session.state === "unlocked" && session.active?.username === currentUser`. So
  BeakerSearch mirrors that, `enabled: canWrite` on archive / restore, matching
  the roster's `sessionUnlocked` rule.

### 3.2 Session LOCKED, nothing selected (the headline state)

This is the most common entry. The session is idle / locked, so the mutating
commands are greyed and the headline Suggested is the unlock:

| Suggested label | When shown | Handler | `enabled` | Row echo (`detail`) |
| --- | --- | --- | --- | --- |
| `Unlock edit mode` | `!canWrite` (idle or locked) | open `LabHeadPasswordModal` for `currentUser` (the same flow `RequestEditButton` drives, which on success calls `startEditSession(currentUser)`). The palette never auto-unlocks, it surfaces the password step. | always (for a PI) | "Approvals, assignments, and flags need this" |
| `Review pending approvals (N)` | `pending > 0` | `router.push("/purchases")` with the awaiting-approval filter, OR (preferred) set the palette SELECTED to the first pending item and re-drive 3.3 inside the palette | `pending > 0` | "{N} items across the lab" |
| `Post an announcement` | always | open the Announcements composer focused (set caret in `AnnouncementsBody`'s textarea) OR run the post path directly | always (NOT gated) | "everyone in the lab sees it" |
| `See what flagged records need follow-up (M)` | `flagged > 0` | `router.push("/lab-inbox")` (mirrors the action bar's flag segment) | `flagged > 0` | "{M} flagged by you" |
| `Open your @-mentions (K)` | `mentions > 0` | `router.push("/lab-inbox")` (mirrors the mention segment) | `mentions > 0` | "{K} unread mentions" |
| `Browse lab experiments` | always | `router.push("/workbench")` (the LinkOut) | always | "the lab-wide experiments view" |
| `Browse lab notes` | always | `router.push("/workbench?tab=notes")` (the LinkOut) | always | "shared notes across the lab" |
| `New project` | always | open `ProjectCreateModal` (the `NewProjectButton` flow) | always | "owned by you" |

The greyed mutating rows below (approve / assign / flag) still appear so the PI
SEES their powers, each with `enabled: false` + "Unlock edit mode to do this" and
an unlock `run`. This is the "teach the page's powers" behavior the master doc
asks for, made honest by the lock affordance.

### 3.3 Session LIVE (unlocked for the current user)

When `canWrite === true`, the headline flips from "Unlock edit mode" to the live
actions, and a "Lock now / Extend 5 min" affordance appears (mirroring
`EditSessionTopNavChip`):

| Suggested label | When shown | Handler | `enabled` | Row echo (`detail`) |
| --- | --- | --- | --- | --- |
| `Approve "{first pending item}"` | `pending > 0` | `setPurchaseApproval({ actor: currentUser, sessionId: live.sessionId, targetOwner: item.username, purchaseItemId: item.id, approved: true, itemName: item.item_name })`, then invalidate `["lab","purchase-items"]` + `["purchases-all"]` | `canWrite` | "{owner} - pending -> approved" |
| `Approve all pending (N)` | `pending > 1` | loop `setPurchaseApproval(approved: true)` over every `isPurchasePending` item in `["lab","purchase-items"]`, owner-routed per item | `canWrite` | "{N} items across the lab" |
| `Decline "{first pending item}"` | `pending > 0` | `declinePurchase({ actor, sessionId, targetOwner: item.username, purchaseItemId: item.id, itemName })` | `canWrite` | "marks declined" |
| `Assign a task to a lab member` | `users.length > 1` | open the assignee picker (the `AssignTaskButton` flow) for a task chosen via a follow-on NAVIGATE sub-list of tasks, then `assignTask({ actor, sessionId, targetOwner: task.username, taskId: task.id, assignee, taskName: task.name })` | `canWrite` | "owner-routed, notifies the assignee" |
| `Flag a record for review` | always | open the flag composer (the `FlagForReviewButton` flow) for a record chosen via NAVIGATE, then `setFlagForReview({ actor, sessionId, targetOwner, recordType, recordId, flag, recordName })` | `canWrite` | "sends the owner a bell" |
| `Post an announcement` | always | the composer post path | always (NOT gated) | "everyone in the lab sees it" |
| `Extend edit mode 5 min` | `canWrite` | `extendEditSession()` (no re-auth) | `canWrite` | "resets the countdown to 5:00" |
| `Lock edit mode now` | `canWrite` | `endEditSession()` | `canWrite` | "ends the session immediately" |

The first-pending-item targeting uses the `getAllPurchaseItems` order filtered by
`isPurchasePending`, so "the first pending item" is the topmost pending one. When
`pending > 4`, collapse the per-item approve / decline rows into "Approve all
pending (N)" plus "Review pending approvals" so Suggested never balloons.

### 3.4 An entity SELECTED or HOVERED in the palette

When the user has drilled to a SELECTED entity (2.2) or is HOVERING a tagged row
(2.3), that entity drives the top Suggested:

A MEMBER selected / hovered (`lab-member:{username}`):

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Open {member}'s workload` | `router.push("/workbench")` (FOLLOW-UP, a `/workbench?user=` view does not exist yet, see open questions) | always |
| `Assign a task to {member}` | pre-fill the assignee picker with `member`, then `assignTask({ ..., assignee: member.username })` | `canWrite` |
| `Archive {member}` | `archiveUser(member.username, currentUser)`, invalidate `ARCHIVED_USERS_QUERY_KEY` + `LAB_USER_PROFILES_QUERY_KEY` + `["lab","users"]` | `canWrite && member.username !== currentUser && !archived` |
| `Restore {member}` | `restoreUser(member.username, currentUser)`, same invalidations | `canWrite && archived` |

A PENDING APPROVAL selected / hovered (`lab-approval:{owner}:{id}`):

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Approve "{item.item_name}"` | `setPurchaseApproval({ targetOwner: item.username, purchaseItemId: item.id, approved: true, ... })` | `canWrite` |
| `Decline "{item.item_name}"` | `declinePurchase({ targetOwner: item.username, purchaseItemId: item.id, ... })` | `canWrite` |
| `Flag "{item.item_name}" for review` | `setFlagForReview({ recordType: "purchase_item", recordId: item.id, targetOwner: item.username, flag, ... })` | `canWrite` |
| `Open it on Purchases` | `router.push("/purchases")` carrying the owner namespace | always |

An ANNOUNCEMENT selected / hovered (`lab-announcement:{id}`, the PI's OWN entry):

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Edit this announcement` | open the card's inline editor (`updateAnnouncement`) | `entry.author === currentUser` (NOT session-gated) |
| `{Pin / Unpin} this announcement` | `updateAnnouncement({ pinned: !entry.pinned })` | `entry.author === currentUser` |
| `Delete this announcement` | `deleteAnnouncement` + `purgeAnnouncementNotifications` (keeps the `confirm()`) | `entry.author === currentUser` |

Members' announcements (not the current PI's) get only a read echo, no edit rows,
matching `canEdit = isLabHead && currentUser === entry.author`.

---

## 4. NAVIGATE (entities to jump to)

NAVIGATE items are the `"sequence"`-kind analogue (a lab-overview-specific nav
item reusing `SequenceNavItem`'s `{ id, label, detail, iconName }` shape, or a
small `LabNavItem` variant). Selecting one either drills WITHIN the palette
(sets the SELECTED entity, re-driving Suggested) or jumps to another page
(carrying the owner / deep-link).

Empty query, the list leads with the inbox attention items (pending approvals,
then flagged-by-me), then members, then sections, widening to all members /
records as the user types.

| NAVIGATE target | Effect | Carries |
| --- | --- | --- |
| A lab member by name | set palette SELECTED to the member (drives 3.4); detail shows open / overdue counts | `username` |
| A pending approval by item name | set palette SELECTED to the item (drives 3.4); detail shows owner + price | `item.username` (owner) + item `id` |
| A flagged record by name | set SELECTED to the record (offers clear-flag via 3.4); routes to its home surface on open | owner + `recordType` + `recordId` |
| An announcement by text | set SELECTED to the announcement (offers edit / pin / delete for own) | `id` |
| A page section | scroll to / focus the section (Action bar, Announcements, Lab activity, Today's events, Member workload) | section key |
| Today's events | scroll to the Today's events section, or `router.push("/calendar")` to open the day | none / `?date=today` |
| The lab inbox | `router.push("/lab-inbox")` | none |
| Purchases (approval queue) | `router.push("/purchases")` with the awaiting-approval filter | filter key |
| Workbench (experiments / notes) | `router.push("/workbench")` / `router.push("/workbench?tab=notes")` | `?tab=` |

Detail (sub) lines, a member nav row reads
`alex - 6 open, 2 overdue`; a pending-approval row reads
`Pipette tips x10 - owned by mira - $48.00`; a flagged row reads
`PCR optimization - flagged by you 2d ago`; a section row reads
`Section, jump here`. Fuzzy match runs over label + detail just like
`scoreSequenceNav`, so typing a member name, a vendor, or an item surfaces the
matching rows.

---

## 5. RESULTS (the lab inbox / recent PI actions)

Lab Overview has no generated artifact like the Sequences alignment or the
Purchases spending export. Its reopenable / recent substitute is the LAB INBOX
FEED, the `LabActivityWidget` stream, which is already a time-sorted record of
everything happening in the lab including the PI's own recent actions (flags,
announcements, task changes).

BeakerSearch surfaces this as RESULT-kind rows under "Recent in the lab":

- Take the `buildFeedItems({ tasks, notes, announcements })` output (the same
  builder the widget uses), newest-first, top 5 to 8.
- Render each as a RESULT row, `mira flagged purchase: Antibody kit - 2h ago`,
  `you posted an announcement - 1d ago`, `alex created note "Prep" - 3d ago`.
- "Open" routes to the item's `href` (today every feed item routes to
  `/lab-overview`; where a deeper target exists, e.g. a flagged purchase, route
  to `/lab-inbox` or `/purchases` so the row is actionable rather than circular).
- Optionally filter the RESULT rows to "your recent actions" (flags +
  announcements where the actor is `currentUser`) as a "Recent PI actions"
  sub-group, since that is the most reopen-worthy slice for a PI.

This matches the Sequences pattern where a RESULT reopens its computed view, and
the master doc's framing of the lab inbox as the reopenable / recent substitute
for this page. Nothing lab-private leaks beyond what the page already shows, the
feed is built from `getNotes({ shared_only: true })` + lab tasks + lab-wide
announcements, exactly the page's existing reads.

---

## 6. COMMANDS (the full long tail, grouped)

These are the page's complete command set, the `commands()` half of the contract.
Groups print in a fixed order (mirroring `CommandGroup` on Sequences). Every row
lists its real handler, its session gate, and (where relevant) its invalidation.
The whole command set is omitted for non-lab-heads (the source never registers,
section 8).

### Edit session
- `Unlock edit mode` -> open `LabHeadPasswordModal` for `currentUser` (the
  `RequestEditButton` flow, `verifyLabHeadPassword` then `startEditSession`).
  `enabled` when `!canWrite`. Never auto-unlocks.
- `Extend edit mode 5 min` -> `extendEditSession()`. `enabled: canWrite`.
- `Lock edit mode now` -> `endEditSession()`. `enabled: canWrite`.

### Approvals (lab head, live session required)
- `Approve a pending purchase` -> `setPurchaseApproval({ actor, sessionId, targetOwner, purchaseItemId, approved: true, itemName })` over a NAVIGATE-picked pending item. `enabled: canWrite`.
- `Decline a pending purchase` -> `declinePurchase({ actor, sessionId, targetOwner, purchaseItemId, itemName })`. `enabled: canWrite`.
- `Approve all pending` -> loop `setPurchaseApproval` over `isPurchasePending` items in `["lab","purchase-items"]`. `enabled: canWrite`.
- All invalidate `["lab","purchase-items"]` + `["purchases"]` + `["purchases-all"]`. Greyed with "Unlock edit mode to do this" when `!canWrite`.

### Task assignment (lab head, live session required)
- `Assign a task to a lab member` -> `assignTask({ actor, sessionId, targetOwner: task.username, taskId: task.id, assignee, note, taskName })` over a NAVIGATE-picked task + assignee. Fires the `lab_task_assignment` bell, skips archived assignees. `enabled: canWrite`. Invalidate `["task", taskKey(task)]` + `["lab","tasks"]`.

### Flag for review (lab head, live session required)
- `Flag a record for review` -> `setFlagForReview({ actor, sessionId, targetOwner, recordType, recordId, flag, recordName })`. Works on task / note / purchase_item. Fires the `lab_flag_for_review` bell. `enabled: canWrite`.
- `Clear a flag` -> `setFlagForReview({ ..., flag: null })` (PI clear; the owner-side clear is `clearFlagAsOwner`, not reachable from the PI source). `enabled: canWrite`. Invalidate per `invalidateForRecord` + the matching `["lab",...]` key.

### Announcements (lab head, NOT session gated)
- `Post an announcement` -> `postAnnouncement({ author: currentUser, text, pinned })` + `dispatchAnnouncementNotifications`. `enabled: true`.
- `Edit an announcement` -> `updateAnnouncement` + `refreshAnnouncementNotifications` (own only). `enabled: entry.author === currentUser`.
- `Pin / unpin an announcement` -> `updateAnnouncement({ pinned })`. `enabled: entry.author === currentUser`.
- `Delete an announcement` -> `deleteAnnouncement` + `purgeAnnouncementNotifications` (keeps the `confirm()`). `enabled: entry.author === currentUser`.
- All invalidate `["lab-announcements"]`.

### Members (lab head, live session required by UI parity)
- `Archive a member` -> `archiveUser(username, currentUser)`. `enabled: canWrite && username !== currentUser && !archived`. Invalidate `ARCHIVED_USERS_QUERY_KEY` + `LAB_USER_PROFILES_QUERY_KEY` + `["lab","users"]`.
- `Restore a member` -> `restoreUser(username, currentUser)`. `enabled: canWrite && archived`. Same invalidations.
- `Manage members` -> `router.push("/settings")` (the `LabRoster` lives in Settings, not on this page). `enabled` always (read).

### Create / navigate
- `New project` -> open `ProjectCreateModal` (the `NewProjectButton` flow). Always.
- `Browse lab experiments` -> `router.push("/workbench")`. Always.
- `Browse lab notes` -> `router.push("/workbench?tab=notes")`. Always.
- `Open the lab inbox` -> `router.push("/lab-inbox")`. Always.
- `Open the purchases approval queue` -> `router.push("/purchases")` (awaiting-approval filter). Always.
- `Jump to a section` -> scroll to Action bar / Announcements / Lab activity / Today's events / Member workload. Always.

---

## 7. `useBeakerSearchSource` implementation sketch

The page calls one hook. It reads the same caches the page already holds (so this
hook lives inside `LabOverviewPage` or a colocated `useLabOverviewBeakerSource()`
that takes the already-fetched data + the live session + setters as input, to
avoid a second fetch). Types are illustrative; `PaletteCommand` is the page's
local alias for the provider's `EditorCommand`-shaped command, and `LabNavItem`
reuses `SequenceNavItem`'s field shape. The whole hook returns `null` for a
non-lab-head so the provider never merges a Lab Overview source for members.

```ts
function useLabOverviewBeakerSource(args: {
  // already-fetched page state
  users: LabUser[];
  tasks: LabTask[];
  pendingItems: Array<PurchaseItem & { username: string }>; // isPurchasePending only
  announcements: AnnouncementEntry[];
  feedItems: FeedItem[];                 // buildFeedItems output, newest-first
  profileMap: LabUserProfileMap;
  archivedSet: Set<string>;
  counts: { pending: number; flagged: number; mentions: number };
  // session (page-agnostic reader)
  live: { isLive: boolean; sessionId: string | null; username: string | null };
  // actions / navigation
  router: AppRouterInstance;
  openUnlockModal: () => void;           // LabHeadPasswordModal for currentUser
  openAnnouncementComposer: () => void;
  openProjectCreate: () => void;
  scrollToSection: (s: SectionKey) => void;
  currentUser: string;
  isLabHead: boolean;
  hoveredKey: string | null;             // from the provider's [data-beaker-target]
}): BeakerSearchSource | null {
  const queryClient = useQueryClient();

  // The lab-head-only gate. No source for members.
  if (!args.isLabHead) return null;

  const canWrite = args.live.isLive && args.live.username === args.currentUser;
  const sessionId = args.live.sessionId ?? "";

  // helpers that wrap the real handlers + invalidations + session gate
  const approve = (it: PurchaseItem & { username: string }) =>
    setPurchaseApproval({
      actor: args.currentUser,
      sessionId,
      targetOwner: it.username,
      purchaseItemId: it.id,
      approved: true,
      itemName: it.item_name,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
      queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
    });

  const assign = (t: LabTask, assignee: string) =>
    assignTask({
      actor: args.currentUser,
      sessionId,
      targetOwner: t.username,
      taskId: t.id,
      assignee,
      taskName: t.name,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["lab", "tasks"] });
    });

  const flag = (
    rec: { owner: string; type: "task" | "note" | "purchase_item"; id: number; name: string },
    f: PiFlag | null,
  ) =>
    setFlagForReview({
      actor: args.currentUser,
      sessionId,
      targetOwner: rec.owner,
      recordType: rec.type,
      recordId: rec.id,
      flag: f,
      recordName: rec.name,
    }).then(() => invalidateFlag(queryClient, rec.type));

  return {
    id: "lab-overview",

    context() {
      const hovered = resolveHovered(args.hoveredKey, args); // member | approval | announcement
      return {
        focused: { kind: "page", label: "Lab Overview" },
        // SELECTED is set by an in-palette drill; provider carries it.
        hovered,
        onScreen: {
          memberCount: args.users.length,
          editSession: args.live,             // the page-defining signal
          counts: args.counts,
        },
        cardHint: buildLabOverviewCardLines({   // section 2.5
          users: args.users,
          live: args.live,
          counts: args.counts,
          hovered,
          currentUser: args.currentUser,
        }),
      };
    },

    suggested(ctx) {
      const focus = ctx.selected ?? ctx.hovered;        // SELECTED beats HOVERED
      if (focus) return suggestForEntity(focus, { canWrite, ...args }); // 3.4
      if (!canWrite) return suggestLocked({ canWrite, ...args });        // 3.2
      return suggestLive({ canWrite, sessionId, approve, ...args });     // 3.3
    },

    entities(ctx, query) {
      return [
        ...args.pendingItems.map(toApprovalNavItem),     // attention first
        ...flaggedByMe(args).map(toFlaggedNavItem),
        ...args.users
          .filter((u) => !args.archivedSet.has(u.username))
          .map((u) => toMemberNavItem(u, args.profileMap, args.tasks)),
        ...sectionNavItems(args.scrollToSection),
        ...args.announcements.map(toAnnouncementNavItem),
      ];
    },

    results() {
      return args.feedItems.slice(0, 8).map(toFeedResultItem); // section 5
    },

    commands() {
      return labOverviewCommandSet({ canWrite, sessionId, approve, assign, flag, ...args });
    },
  };
}
```

Session gating is centralized, `suggestLive` / `labOverviewCommandSet` set
`enabled: canWrite` on every approve / decline / assign / flag / archive / restore
row, and `enabled: true` on the announcement + unlock + navigate rows. The unlock
command opens the password modal (never auto-unlocks). Every gated `run` carries
`sessionId: args.live.sessionId ?? ""`, which `assertLiveSession` re-validates
server-side. Every `run` invalidates the exact query keys from section 1.4. The
provider handles ranking, rendering, keyboard, and merging with the global layer.

---

## 8. Keyboard, states, edge cases, open questions

### Lab-head-only visibility (the central rule)

The Lab Overview source is registered ONLY when `accountType === "lab_head"`.
`useLabOverviewBeakerSource` returns `null` for a member, so the provider never
merges it, and the route itself bounces a non-PI to `/` before the page mounts.
The GLOBAL layer still gives a member Cmd-K reach (cross-page navigation, global
object search), but none of the Lab Overview context / suggested / approval /
assign / flag / announce / member commands exist for them. A member can never
see an Approve, Assign, Flag, Archive, or announcement-compose row anywhere,
because the source that produces them is absent.

### The locked-session UX

When `!canWrite`, the palette is honest, not broken:
- The CONTEXT CARD's session line reads `Edit mode locked` with a closed padlock.
- The headline Suggested is `Unlock edit mode` (opens the password modal).
- The mutating rows still RENDER (so the PI learns their powers) but are greyed
  with `enabled: false` and detail "Unlock edit mode to do this", and their `run`
  falls back to opening the unlock rather than attempting a write that
  `assertLiveSession` would reject.
- The announcement + navigate rows stay live throughout, because they are not
  session-gated.
- A session held by a DIFFERENT lab head (`live.isLive` but
  `live.username !== currentUser`) keeps the current PI's commands gated; the
  card reads `Edit mode held by @other-pi`.

### Keyboard

Inherits the shared model, up / down skipping disabled (greyed locked-session
rows) and non-selectable (the context card), Enter runs / navigates / reopens the
highlighted item, Escape closes, focus trap + restore, combobox / listbox aria.
No Lab-Overview-specific shortcuts beyond what the rows carry in `shortcut`. The
unlock, extend, and lock commands deliberately have no default shortcut so a
stray keypress can never change the session state.

### Empty vs typed

- Empty query, CONTEXT CARD (2.5, keeping the session badge), then SUGGESTED (3,
  locked or live), then the attention-first ENTITIES (4, pending approvals then
  flagged then members then sections), then Recent-in-the-lab RESULTS (5), then
  the grouped COMMANDS (6), then the slim global section.
- Typed query, the card slims to one line that KEEPS the session badge
  (`Lab Overview, edit mode locked`), and everything collapses into one fuzzy
  list over commands + member / approval / flagged / announcement / section
  entities + feed results + global, grouped by kind. Typing a member name, a
  vendor, or an announcement phrase surfaces the matching rows via the label +
  detail fuzzy match.

### Empty states

- No lab members yet (`users.length <= 1`, only the PI), Suggested shows
  `Unlock edit mode` (if locked) + `Post an announcement` + `New project`;
  ENTITIES omit the member list; the card reads `Lab Overview, just you so far`.
  Mirrors `MemberWorkloadWidget`'s "No lab members yet".
- Nothing pending, no flags, no mentions (`counts` all zero), the card's line 3
  reads `You're all caught up` (mirrors the action bar), and the attention
  ENTITIES collapse so the empty-query list leads with members + sections.
- No announcements, the announcement nav group is empty; `Post an announcement`
  is still the obvious move (mirrors the composer's "Start the conversation"
  empty state).

### Edge cases

- Multi-PI lab, the gate is `live.username === currentUser`, so a session another
  PI holds never enables THIS PI's writes. The card surfaces who holds it.
- Archived member, filtered out of the member ENTITIES + the assignee picker
  (matching `useArchivedUsers` + `AssignTaskButton`'s filter). A `Restore` row is
  the only member action offered for an archived row (and only when `canWrite`).
- Self-archive guard, `Archive {member}` is disabled when
  `member.username === currentUser` (mirrors `LabRoster`'s "NOT self" rule).
- Approve / decline without a live session, the row is greyed with
  "Unlock edit mode to do this", never silently failing `assertLiveSession`.
- Announcement edit / delete on someone else's announcement, never offered
  (`entry.author === currentUser` gate), matching `canEdit` on the card.
- Stale session id, the palette captures `live.sessionId` at `run` time (not at
  mount), and `assertLiveSession` re-checks it; if the session expired between
  open and Enter, the write returns `data-write` and the row surfaces the same
  "relock and retry" message the popups show.

### Permissions summary

- Member, the Lab Overview source does not exist. No Approve / Decline / Assign /
  Flag / Archive / announcement-compose anywhere from this page. Global Cmd-K
  reach only.
- Lab head, locked session, sees every power (greyed) plus the live unlock,
  announcements (un-gated), and navigation. Live session, every approve / decline
  / assign / flag / archive / restore is enabled and owner-routed, plus
  extend / lock. Announcements are always live for a PI regardless of the
  session.

### Lab-Overview-specific open questions

1. There is no `/workbench?user={username}` view today (the workbench scopes to
   the current user, not a query param, per `MemberWorkloadWidget`'s FOLLOW-UP).
   So `Open {member}'s workload` routes to `/workbench` generically until that
   per-member view lands. Do we build the param, or keep the generic jump?
2. A hoverable pending-approval list does not live ON the Lab Overview page today
   (the action bar shows a COUNT that routes to `/purchases`). Surfacing per-item
   approve from BeakerSearch needs either a small in-page pending list to tag
   with `[data-beaker-target]`, or the palette can pull the items straight from
   `["lab","purchase-items"]` and act without a visible row. The spec assumes the
   latter (act from the cache) so no new page chrome is required.
3. The assign / flag commands need a two-step picker inside the palette (pick the
   task / record, then the assignee / reason). The provider does not yet have a
   two-step command model. Either add one (a sub-list NAVIGATE that feeds the
   second step), or have these commands open the existing `AssignTaskButton` /
   `FlagForReviewButton` modals positioned on the right record, matching the
   Purchases doc's identical open question.
4. `archiveUser` / `restoreUser` are NOT hard-gated by `assertLiveSession` (only
   the UI gates them via `LabRoster`'s `sessionUnlocked`). BeakerSearch mirrors
   the UI gate (`enabled: canWrite`), but a future hardening could push the gate
   into `user-archive.ts` so the rule is enforced in one place rather than
   re-implemented per surface. Worth a deliberate pass before more surfaces gain
   archive controls.
5. The "Unlock edit mode" command opens `LabHeadPasswordModal`, which is a
   deliberate, password-gated step. The palette MUST NOT offer a one-click unlock
   that skips the password (the `useLiveEditSession` security note is explicit,
   surfaces never auto-unlock from a command). Confirm the modal flow is the only
   path the palette wires.
