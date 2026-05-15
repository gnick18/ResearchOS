# /purchases page rework: proposal

> Scope: this proposal is about the **standalone single-user `/purchases`
> page** (`frontend/src/app/purchases/page.tsx`, ~495 LOC). The Lab Mode
> Purchases tab (`frontend/src/components/LabPurchasesPanel.tsx`) is
> treated as comparable prior art and as a disposition question, not as
> a thing to rewrite in this rework.

## TL;DR

1. **Reverse chip-2.** Delete the Active / "Earlier (N)" accordion split
   ([page.tsx:69-82, 303-320](frontend/src/app/purchases/page.tsx#L69)).
   Render one unified scroll, sorted purely by `start_date desc`. Visual
   differentiator for completed orders: keep the green completion dot +
   `· Complete` text softening, drop the `bg-green-50/50` row tint.
2. **Add a spending dashboard** at the bottom. Recommend **Thesis B
   (schema-expanded)**: add `PurchaseItem.vendor` + `PurchaseItem.category`
   (nullable). Skip `Task.completed_at` for v1; `start_date` is the
   pragmatic date axis.
3. **Chart implementation:** hand-rolled CSS bars + inline SVG, matching
   the existing pattern in [LabPurchasesPanel.tsx:228-456](frontend/src/components/LabPurchasesPanel.tsx#L228).
   No chart library, no bundle add.
4. **Latent grandTotal bug** (items on experiment-type tasks): take the
   loose path. Surface "Items on non-purchase tasks ($X)" in the
   dashboard's funding-account breakdown rather than enforce a hard
   schema invariant in v1. Add a soft validation warning in
   `PurchaseEditor`.
5. **LabPurchasesPanel disposition:** extract a shared
   `useSpendingBreakdowns(items)` hook used by BOTH the lab panel and
   the new /purchases dashboard. Keep the lab panel: its job
   (cross-lab CSV export, all-lab spend) is genuinely different from
   /purchases (own + shared-project spend).
6. **Fixture expansion is a prerequisite.** Today's 7-item, 8-day window
   can't populate a 12-month time series. Recommend ~20 items per user,
   ~6 months, mixed funding strings, with seeded vendor + category
   values once Chip A lands.
7. **Chip order:** Schema (Chip A) → fixtures (Chip B) → page rewrite +
   dashboard skeleton (Chip C) → chart implementation (Chip D) → shared
   hook refactor (Chip E) → wiki rewrite (Chip F) → screenshot recapture
   (Chip G). A through E are sequential; F+G follow merge.

---

## 1. Context & problem statement

### What chip-2 shipped, what's been conceded

Chip-2 (commit `46683036`, AGENTS.md §8 entry at `66206833`) split
the /purchases page into two scrolls: **Active** (incomplete purchase
tasks) up top, and a collapsed **Earlier (N)** accordion at the bottom
holding completed purchases. Both lists are sorted `start_date desc`
and share a single `renderPurchaseTaskCard` closure
([page.tsx:154-272](frontend/src/app/purchases/page.tsx#L154)). The
split was intentionally modeled on the same "active pipeline vs
completed history" partition that the Workbench page uses for
experiments. AGENTS.md §8 documents the accordion explicitly as
**temporary**, added to mirror the broader /results-kill arc
(`b5710d5c`) where the cross-cutting Results page was retired and each
feature absorbed its own completion history.

### What's actually wrong with active/earlier for purchases

The split makes sense for experiments because an experiment carries an
in-flight phase: it runs for days, accumulates results, then enters a
"completed but needs writeup" tail (the forcing function Workbench uses
to nag the PI). A purchase has no equivalent in-flight phase. The
lifecycle is:

1. You create the order (the task).
2. You add line items (one writing burst).
3. The order arrives.
4. You toggle `is_complete = true`.

Steps 1-3 collapse to one short authoring session per order, often the
same day. By the time the row gets toggled complete, the user is no
longer planning anything against it; they're looking up history ("did
we already buy that primer?"). The active/earlier partition tries to
hide the answer to that question behind an accordion click. The
chronological scroll is a strictly better surface for the purchase
mental model: most recent first, completion is a state on the row, not
a hidden section.

Concretely, two real moments where the current split hurts:

- **"What did we order last month?"** Today: scroll active list, find
  nothing recent, click Earlier, expand. New: scroll, find it.
- **"How much have we spent across all orders this quarter?"** Today:
  the page header sums `grandTotal` across BOTH lists, but the user
  scanning the page sees only the Active list and can't easily verify
  the number. New: dashboard at the bottom shows monthly bars + the
  unified scroll above lets the user click through any row.

### What the analytics dashboard adds

The page today answers "what have I ordered?" with a row-per-order
list. It does not answer "how much have I spent, where, on what." That
second question is what every reagent-budget review boils down to. The
data is all there
([PurchaseItem](frontend/src/lib/types.ts#L514): `total_price`,
`funding_string`, `task_id`, plus the parent task's `project_id` and
`start_date`) and the LabPurchasesPanel proves the breakdowns are
buildable. They're already shipped on the cross-user side.

### Why this belongs on /purchases vs a separate route

Three reasons:

1. **One stop shop.** Authoring (the list above) and review (the
   dashboard below) live on the same scroll. The dashboard's per-card
   click-through lands inside the unified list above. A separate
   `/spending` route would be a third feature surface to maintain that
   re-renders the same data.
2. **Symmetry with Workbench.** Workbench is "what I'm doing"
   (experiments). /purchases becomes "what I'm spending" (purchases).
   Both are single-user productive views with a forward-looking list
   and backward-looking analytics in one place.
3. **The Lab Mode tab already proves the format.** LabPurchasesPanel's
   funding-account cards + per-month bar list + spend-by-user/project
   rollups are a tight summary view. /purchases users currently have
   to leave the page (or even leave the user) to see anything
   equivalent for their own scope.

---

## 2. Differentiation analysis

### How /purchases differs from neighboring views

| View | Thesis | Data foregrounded |
|---|---|---|
| `/purchases` (this page) | "What have I bought and how am I tracking against funding?" | Per-order list (write), per-grant rollups, time series. Single-user + shared-project scope. |
| `/lab` Purchases sub-tab ([LabPurchasesPanel.tsx](frontend/src/components/LabPurchasesPanel.tsx)) | "How is the whole lab spending against funding?" | Same shape but cross-user; read-only popups; lab-wide CSV export. |
| `/workbench` ([workbench/page.tsx](frontend/src/app/workbench/page.tsx)) | "What experiments am I running?" | Stage sections (Ready / Blocked / Running / Awaiting writeup / Recent results / Earlier). |
| `/` Home ([page.tsx](frontend/src/app/page.tsx)) | "Where do I stand on each project?" | Project cards w/ progress, active/overdue counts, next-up. |
| `/gantt` | "When is everything?" | Time axis; editable. |
| Lab Mode Activity | "What just happened across the lab?" | 30-day rolling; cross-user. |

No `/budgets` route exists today. The dashboard does not duplicate any
existing single-user surface.

### The user question /purchases answers

The audit's framing (*"What have I bought and how am I tracking
against my funding?"*) is right. Refining slightly: this is the page
where the user does **two distinct things in sequence**:

1. **Author a purchase order** (the list + expand-to-edit flow).
2. **Review spend** (the dashboard below).

Authoring is the dominant interaction by frequency (everyone who's
ever bought a reagent does this). Review is the dominant interaction
by importance (grant deadline, end-of-quarter, audit).

### Explicit positioning vs LabPurchasesPanel

| Axis | `/purchases` (this page) | `/lab` Purchases sub-tab |
|---|---|---|
| **User scope** | Own + tasks shared with me + tasks in projects shared with me. (`purchasesApi.listAllIncludingShared`.) | Every user in the lab folder. (`labApi.getAllPurchaseItems`.) |
| **Edit mode** | Writable. `<PurchaseEditor>` inline. | Read-only. Popup opens with `readOnly=true`. |
| **Funding accounts** | Manage (`purchasesApi.createFundingAccount` / `update` / `delete`). | Read-only cards, click-to-filter. |
| **CSV export** | Not today; proposed: yes (own + shared scope). | Yes (lab-wide scope). |
| **Audience** | The researcher placing orders. | The PI / lab manager / auditor. |

Real reasons to keep both: the lab panel is **cross-user roll-up**
(only useful in Lab Mode where the user-filter chip is a first-class
control); the /purchases page is **single-user authoring + own-spend
review**. After the rework they share the breakdown primitives (Chip
E) but render at different scopes.

---

## 3. Unified scroll (the reverse-the-split half)

### The trivially-implementable core

Delete the `activeTasks` / `earlierTasks` split
([page.tsx:69-82](frontend/src/app/purchases/page.tsx#L69)) and the
`showEarlier` accordion
([page.tsx:303-320](frontend/src/app/purchases/page.tsx#L303)). Replace
with a single `useMemo` that sorts all `purchaseTasks` once:

```ts
const sortedTasks = useMemo(
  () => [...purchaseTasks].sort((a, b) => b.start_date.localeCompare(a.start_date)),
  [purchaseTasks]
);
```

…and render them all with the existing `renderPurchaseTaskCard`
closure, unchanged. The closure already styles completed rows
differently (green dot, green text on the task name, `· Complete`
suffix, faint green row tint).

### Visual differentiation options for completed orders

In the unified scroll, completed orders need to read as "done but
recallable": present, but visually quieter than active ones. Four
options:

| Option | What changes |
|---|---|
| **(a)** Keep today's `bg-green-50/50` tint + green dot + `· Complete` text. No time dividers. | Identical to current "earlier" cards. Pros: zero code change. Cons: green tint reads as celebration; an old completed order isn't a celebration. |
| **(b)** Chronological time dividers ("This month" / "Last month" / "Earlier"). No per-state styling. | Pros: implicit recency cue. Cons: purchases don't have weekly cadence (a lab might order monthly or quarterly, so dividers under-fire). |
| **(c)** Softened-text-only for complete (drop the tint). No dividers. | Pros: clean; status reads from the dot + suffix. Cons: less scannable for a long list. |
| **(d)** Hybrid: green dot + `· Complete` suffix kept, drop the row tint, no dividers. | Pros: status cue stays one glance away; quiet enough not to celebrate; chronology alone organizes the list. Cons: very subtle distinction at row level. |

**Recommend (d).** The row tint is the part that overcommits. The dot
+ suffix is enough. Time dividers are a nice-to-have for v2 if
density becomes a problem in real labs with 100+ orders (today's
fixture has 3; nobody hits a usability wall).

### Sort key options

| Option | Behavior | Notes |
|---|---|---|
| **Pure `start_date desc`** | Strict reverse chronology. | Recommend. |
| **`start_date desc` + active-before-complete secondary** | Two active orders on the same day appear before two completed orders on the same day. | This is essentially "the split, softened": quietly resurrects the partition. Reject. |
| **Fiscal-quarter-then-date** | Headers like "Q2 2026" / "Q1 2026". | Over-engineered for a feature most labs don't think in. |

**Recommend pure `start_date desc`.** The simplest sort, matches user
mental model ("most recent first"), and lets visual styling (option d)
do the secondary work. If a labmate wants quarter-aware grouping, they
filter by date range in the dashboard below.

---

## 4. Analytics dashboard (the new-capability half)

The dashboard sits beneath the unified scroll, scrolled-into-view by
default but visually separated by a section heading. It is the second
half of the page: the **review** half.

### Layout

```
┌───────────────────────────────────────────────────────────────────────┐
│  Purchases  ·  12 orders  ·  $4,820.50 total                          │
│  [ Manage Funding Accounts ]                                          │
├───────────────────────────────────────────────────────────────────────┤
│  ┌─ Order 14: April reagents ─────────────────────────  $185.50  ▼ ┐  │
│  │                                                                  │  │
│  │  ● April reagents · Aging study · 2026-04-12 · 3 items           │  │
│  │                                                                  │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌─ Order 13: Primer order #4 ────────────────────────  $52.30   ▼ ┐  │
│  │  ● Primer order #4 · Cardio cells · 2026-04-08 · 4 items         │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│  ┌─ Order 12: Plasmid prep kit ────────────────────────  $312.00  ▼ ┐  │
│  │  ● Plasmid prep kit · Aging study · 2026-04-05 · Complete · 1    │  │
│  └──────────────────────────────────────────────────────────────────┘  │
│                                                                       │
│  ... unified scroll continues, no Earlier accordion ...               │
│                                                                       │
│  ════════════════════════════════════════════════════════════════════ │
│  Spending dashboard                                                   │
│  Time range: [ Last 12 months ▼ ]   Project: [ Active filter ▼ ]      │
│                                                                       │
│  ── FUNDING ACCOUNTS ────────────────────────────                     │
│  ┌─────────────────┐ ┌─────────────────┐ ┌─────────────────┐          │
│  │ NIH-R01-12345   │ │ DOE-EERE        │ │ Internal-Bridge │          │
│  │ $14,250 / $80k  │ │ $5,310 / $25k   │ │ $980 / $5k      │          │
│  │ [▰▰▱▱▱▱▱▱▱▱] 18%│ │ [▰▰▰▰▱▱▱▱▱▱] 21%│ │ [▰▰▱▱▱▱▱▱▱▱] 20%│          │
│  └─────────────────┘ └─────────────────┘ └─────────────────┘          │
│                                                                       │
│  ── SPEND OVER TIME ─────────────────────────  (last 12 months)       │
│  May 25  ▰▰▰▱                       $612.80                          │
│  Jun 25  ▰▰▰▰▰▰▰▱                  $1,240.00                         │
│  Jul 25  ▰▰                          $310.00                          │
│  Aug 25  ▰▰▰▰▰▰                    $980.50                           │
│  ...                                                                  │
│                                                                       │
│  ── BREAKDOWN BY ───  [ Project ▾ ]                                   │
│  ┌──────────────────────────────────────────────────────────────┐    │
│  │ Aging study    ▰▰▰▰▰▰▰▰▰▰▰▰▰▰▰  $2,310                       │    │
│  │ Cardio cells   ▰▰▰▰▰▰▰▰▱      $1,560                         │    │
│  │ Pilot data     ▰▰▰▱           $610                           │    │
│  └──────────────────────────────────────────────────────────────┘    │
│                                                                       │
│  ── BREAKDOWN BY ───  [ Vendor ▾ ]   ── BY CATEGORY ───                │
│  ┌────────────────────────┐  ┌────────────────────────┐               │
│  │ NEB         $1,820     │  │ Reagents      $2,940   │               │
│  │ IDT         $640       │  │ Consumables   $980     │               │
│  │ Sigma       $410       │  │ Plasticware   $260     │               │
│  │ ...                    │  │ ...                    │               │
│  └────────────────────────┘  └────────────────────────┘               │
│                                                                       │
│  Items on non-purchase tasks: 2 items, $148.50 (click to inspect)     │
│  Export CSV                                                           │
└───────────────────────────────────────────────────────────────────────┘
```

### Thesis A: Minimal-schema (only fields available today)

The data the page can reach without schema changes:

- `PurchaseItem`: `total_price`, `quantity`, `funding_string`, `notes`,
  `link`, `cas` ([types.ts:514-526](frontend/src/lib/types.ts#L514)).
- Parent `Task` (via composite-key lookup): `start_date`, `project_id`,
  `name`, `is_complete`.
- Project lookup: `name`, `color`.
- `FundingAccount`: `name`, `total_budget`. (`spent` is stale; recompute.)

**v1 chart inventory (Thesis A):**

1. **Funding-account cards** (per account: spent / budget / remaining /
   `[▰▰▱▱]` progress bar). Mirrors LabPurchasesPanel
   ([LabPurchasesPanel.tsx:283-378](frontend/src/components/LabPurchasesPanel.tsx#L283))
   one-to-one. Click a card → filter the dashboard sections below to
   just that funding string.
2. **Spend over time**: horizontal bar list, one row per month,
   labeled `YYYY-MM`, last 12 months in window. Date axis = parent
   task's `start_date.slice(0, 7)`. Already in LabPurchasesPanel
   ([:441-456](frontend/src/components/LabPurchasesPanel.tsx#L441)).
3. **Spend by project**: bar list, one row per project, sorted desc.
   Project name from joined `Task.project_id` → `Project.name` lookup
   (must compare both `id` AND `owner` per the
   [page.tsx:169-171](frontend/src/app/purchases/page.tsx#L169)
   composite-key convention).
4. **Spend by funding-string**: bar list, sorted desc. Includes an
   "Uncategorized" row for items with `funding_string == null`. The
   funding-account cards above are the same data presented as
   percent-of-budget; this list is the same data presented as raw
   amount and includes the uncategorized tail.
5. **Items on non-purchase tasks**: single line: "2 items, $148.50
   on tasks not typed as 'purchase'." Click to expand and see the
   offending items. Surfaces the latent grandTotal bug (see §5).

**v2 candidates (Thesis A):**

- Day-of-week / day-of-month patterns. Possible but low-value.
- Quantity histograms ("you bought 47 microcentrifuge tubes this
  quarter"). Possible but `item_name` is free-text, so grouping is
  noisy.

### Thesis B: Schema-expanded (recommended)

Add two nullable fields to `PurchaseItem`:

- `vendor: string | null`: free-text or autocompleted from past
  values (the catalogStore already remembers `link` + `price_per_unit`
  per item name; vendor extracts as a sibling concept).
- `category: string | null`: free-text, also autocompleted. Examples:
  Reagents, Consumables, Plasticware, Equipment, Service.

Skip `Task.completed_at`. The page already uses `Task.start_date` as
the date axis everywhere ("Order placed YYYY-MM-DD"). A completion
timestamp would be a nicer "money landed" axis, but: (a) it's a Task
schema change, not a PurchaseItem one (broader blast radius); (b) the
purchase lifecycle is short enough that `start_date` is a good-enough
proxy for "when did this spend happen"; (c) the `is_complete` field
toggles a known timestamp via mtime if a future user really needs it.

**v1 chart inventory (Thesis B) adds:**

6. **Breakdown by vendor**: bar list, sorted desc. Click a vendor →
   filters the dashboard. Depends on `PurchaseItem.vendor`.
7. **Breakdown by category**: bar list, sorted desc. Click a
   category → filters the dashboard. Depends on
   `PurchaseItem.category`.

Both can be rendered alongside the existing Project breakdown as
sibling columns or as a `[ Project | Vendor | Category ]` segmented
control above a single bar-list slot. **Recommend the segmented
control** (one chart, three lenses): less screen real estate, more
focused comparison.

**v2 candidates (Thesis B):**

- Vendor x category cross-tab heatmap. Possible once data exists.
- Anomaly detection ("you spent 3× last month's average on NEB").
  Worth it in a future iteration once a real lab has 1+ years of
  history.

### Decisions for both theses

**Chart library decision.** The existing app has zero chart
dependencies. [package.json](frontend/package.json) shows no
recharts / d3 / chart.js / tremor. LabPurchasesPanel ships its bar
chart as ~10 lines of CSS-bar markup
([:441-456](frontend/src/components/LabPurchasesPanel.tsx#L441)):

```tsx
<div className="flex-1 h-5 bg-gray-100 rounded overflow-hidden">
  <div className="h-full bg-emerald-400 rounded"
       style={{ width: `${(total / maxMonthly) * 100}%` }} />
</div>
```

Trade-offs:

| Approach | Bundle | A11y | Animation | Dev time |
|---|---|---|---|---|
| Hand-rolled CSS bars + inline SVG | 0 KB | Excellent (semantic HTML) | None unless added | 20-30 LOC per chart type |
| recharts (~80 KB gz) | 80 KB | Built-in | Built-in | Component-per-chart, easy |
| Tremor (built on recharts) | ~120 KB | Built-in | Built-in | Higher-level, opinionated styling |
| @nivo (~150 KB tree-shakable) | 50-100 KB | Decent | Built-in | More flexibility, more code |

**Recommend hand-rolled CSS bars + inline SVG.** Matches the existing
shipped pattern. Zero bundle add. Matches Tailwind styling already in
use across the app. The chart types proposed (horizontal bar lists,
progress bars, cards) all fit comfortably in CSS+HTML. If a v2
introduces a real time-series chart that needs zoom/pan/tooltip
interactions, recharts can be added then; the v1 surface won't pay
the bundle tax for animation it doesn't need.

**Time-range scope.** User-configurable dropdown, default **Last 12
months**. Options: Last 30 days / Last 90 days / Last 12 months / All
time / Custom (date picker). Matches LabPurchasesPanel's existing
12-month default
([:163-165](frontend/src/components/LabPurchasesPanel.tsx#L163)).

**Project-filter interaction.** Three behaviors possible:

- (a) Respect the active project filter (matches the rest of the
  single-user app where `selectedProjectIds` from `useAppStore` gates
  what's visible).
- (b) Always show all projects.
- (c) Both, with a toggle.

**Recommend (a) with an in-dashboard "All projects" override toggle.**
The list above the dashboard doesn't respect the project filter today
(/purchases page doesn't read `selectedProjectIds`), so introducing
project-filter awareness needs to happen in the same chip as the
dashboard so the two halves stay coherent. The toggle covers the "I
want to see total spend across everything I own" use case without
needing to navigate-away to clear the global filter.

**Cross-user spending scope.** The current `grandTotal`
([page.tsx:99-102](frontend/src/app/purchases/page.tsx#L99)) sums own +
shared-task + shared-project purchases via
`purchasesApi.listAllIncludingShared`. Three options:

- (a) Include shared-project purchases in dashboards (today's default).
- (b) Exclude.
- (c) Show as a second series ("My spend" / "Spend on projects I'm
  in") with a small toggle.

**Recommend (a): include by default, no toggle.** The reasoning:
the list above the dashboard already shows shared-task purchases (the
merged-view loader pulls them in
[local-api.ts:1259-1343](frontend/src/lib/local-api.ts#L1259)). The
dashboard should be coherent with the list (they're the same scope).
If a user really wants "just me," they filter by project (which
implicitly scopes to their own projects) or by funding string. A
second series is a nice toggle for a v2 but adds visual noise to v1.

**Empty-state behavior.**

- **0 purchases:** keep today's existing empty state
  ([page.tsx:274-283](frontend/src/app/purchases/page.tsx#L274)). The
  dashboard renders with a single placeholder line: "Add your first
  purchase to see spend breakdowns here."
- **1-4 purchases:** dashboard renders with very-low bars; the
  funding-account cards are still meaningful. Add a small "More data
  → more useful breakdowns" hint under the time-series chart.
- **5+ purchases:** dashboard is fully useful.

The current `?wikiCapture=1` fixture (3 purchase tasks, 7 items,
8-day window) would render as the "1-4 purchases" case. **The
fixture needs expansion before the dashboard ships convincingly.**
See §7.

**`FundingAccount.spent` strategy.** **Compute live from items.**
Trust nothing on disk. Mirrors what LabPurchasesPanel already does at
[:101-108](frontend/src/components/LabPurchasesPanel.tsx#L101) and the
inline comment justifies the choice ("FundingAccount.spent on disk is
stale; set to 0 at create time and never recomputed"). The stored
`spent` field becomes effectively a write-only ignored field in v1.
**v2 cleanup candidate (separate chip):** drop the stored field
entirely from the type and the writer, and stop persisting it on
account create/update
([local-api.ts:1402-1421](frontend/src/lib/local-api.ts#L1402)). Out
of scope for this rework.

---

## 5. Latent bug: items on experiment-type tasks

### The case

`grandTotal` ([page.tsx:99-102](frontend/src/app/purchases/page.tsx#L99))
sums **all items in the merged view**, including items whose parent
task has `task_type === "experiment"` (or `"list"`). But
`renderPurchaseTaskCard` is only called for tasks where
`task_type === "purchase"`
([page.tsx:62-65](frontend/src/app/purchases/page.tsx#L62)). The
visual grandTotal in the header is greater than the sum of the cards.
Today's fixture exercises this: morgan's items 1 and 2 are attached
to an experiment-type task and are silent contributors to grandTotal.

### Path 1: Tighten the data model

Enforce `PurchaseItem.task_id → Task.task_type === "purchase"` as an
invariant. Implementation:

- Add validation in `purchasesApi.create`
  ([local-api.ts:1345-1357](frontend/src/lib/local-api.ts#L1345)).
- Add a one-time migration scanner that detects existing offenders
  (`task_type !== "purchase"`) and flags them in a sidecar
  (`_purchase-orphans.json` or similar) for user resolution.
- `PurchaseEditor` either refuses to render against a non-purchase
  task or renders a "this task is not a purchase order, convert?"
  affordance.

Pros: clean invariant, grandTotal stops lying. Cons: migration UX is
work (flag → user clicks → orphans either move to a "fix me" purchase
task or get deleted), and the invariant retroactively breaks anyone
who has a real reason to attach items to a non-purchase task (rare
but plausible: someone tracking reagents for one specific
experiment).

### Path 2: Loose model + surface in dashboard

Don't enforce. Add a dedicated dashboard line ("Items on non-purchase
tasks: 2 items, $148.50") that surfaces the offenders without
breaking the grandTotal contract. Click expands to a small inline
table showing the items + their host task names. The user can then
either:

- Reclassify the host task as a purchase (one toggle in TaskDetailPopup).
- Delete the items.
- Leave them; the dashboard exposes them transparently.

Plus a soft warning in `PurchaseEditor`: if a user opens a purchase
editor on a task whose `task_type !== "purchase"`, render a yellow
inline note ("This task is not typed as a purchase order. Items added
here will appear in the spending dashboard's 'Items on non-purchase
tasks' line."). No hard refusal.

Pros: zero migration overhead, the data stays expressible, the bug
becomes a feature ("unattached spending"). Cons: the surface remains
slightly leaky forever; a user who never opens the dashboard never
sees the cue.

### Recommendation

**Recommend Path 2.** The case the bug captures (items on
experiment-type tasks) is genuinely useful information once surfaced.
"How much did I spend on tagged-to-experiment reagents this quarter"
is a real ask, and the loose model preserves it. Tightening the
invariant is a v2 candidate if it turns out users want a strict
purchase-only view; the dashboard line provides the data needed to
make that call.

---

## 6. LabPurchasesPanel disposition

LabPurchasesPanel ([:1-597](frontend/src/components/LabPurchasesPanel.tsx))
already does most of what the new /purchases dashboard will do:
funding-account cards
([:283-378](frontend/src/components/LabPurchasesPanel.tsx#L283)),
spend-by-month bar list
([:154-165](frontend/src/components/LabPurchasesPanel.tsx#L154)),
spend-by-user
([:127-133](frontend/src/components/LabPurchasesPanel.tsx#L127)),
spend-by-project
([:135-150](frontend/src/components/LabPurchasesPanel.tsx#L135)), and
CSV export
([:172-225](frontend/src/components/LabPurchasesPanel.tsx#L172)). Three
options for resolving the overlap:

### Option 1: Extract shared primitives into a hook

Create `frontend/src/hooks/useSpendingBreakdowns.ts` that takes
`items[]` (decorated with `owner`) and the lookup tables needed
(tasks, projects) and returns `{ spentByMonth, spentByProject,
spentByFundingString, spentByVendor, spentByCategory, totalSpent }`.
The hook is the single source of truth for breakdown math. Both
LabPurchasesPanel and the new /purchases dashboard consume it; each
renders the result at its own scope.

- LabPurchasesPanel scope: `useLabData()` cross-user items (filtered
  by user-chip selection).
- /purchases dashboard scope: `purchasesApi.listAllIncludingShared`
  (own + shared, no Option-C hosted).

Pros: zero duplicated logic, the breakdown math has one home, both
panels evolve coherently. Cons: refactor cost is non-trivial; the
hook needs careful typing because the input shapes differ slightly
(LabPurchasesPanel uses `LabTask` and `username`; /purchases uses
`Task` and `owner`).

### Option 2: Deprecate the lab panel

Redirect lab-mode Purchases tab → /purchases with a "show all-lab
spending" toggle. Single page, two scopes.

Pros: one feature surface. Cons: the lab panel's strengths (user-chip
filtering, lab-wide CSV export) don't map cleanly to a toggle on
/purchases. The audience is different (PI vs researcher), and the
lab panel's read-only model is part of the Lab Mode contract; moving
its content to a writable page would break the wall-mounted-TV use
case.

### Option 3: Coexist with explicit scope boundaries

Leave both panels as-is, document the boundaries: lab panel =
cross-lab + CSV export, /purchases = own + shared-project +
dashboards. Add a small "View in Lab Mode" link from the /purchases
dashboard that deep-links to the lab Purchases tab.

Pros: zero refactor risk. Cons: math diverges over time; bug fixes
land in one panel and not the other (already happened: the
`FundingAccount.spent` stale-field workaround is on the lab side, not
on /purchases).

### Recommendation

**Recommend Option 1 + the deep-link from Option 3.** Extract the
breakdown hook, but keep both panels as separate consumers. The hook
is small (a single useMemo cluster) and the typing pain is real but
manageable: define a `BreakdownInputItem` interface that both
panels' items satisfy, with a `username` / `owner` aliasing helper.
Then add a "View in Lab Mode →" deep-link on the /purchases dashboard
that opens `/lab?tab=purchases` for cross-lab investigation. This
gives /purchases the breakdowns it needs without forking math from
the lab panel, and preserves the lab panel's distinct audience.

---

## 7. Fixture expansion plan

Today's `?wikiCapture=1` fixture has 3 purchase tasks, 7 items, an
8-day date window, and hand-seeded `FundingAccount.spent` values
([wiki-capture-fixture.ts:25-71](frontend/src/lib/file-system/wiki-capture-fixture.ts#L25)).
It cannot populate a 12-month time-series chart or convincing
breakdown bars.

### Target

- **~6 months** date window (start_date spread across Nov 2025 - May
  2026).
- **~20 items per user** (alex + morgan), distributed across
  ~5-6 purchase tasks each.
- **Mixed funding strings**: all 3 existing accounts (DEMO-NIH,
  DEMO-DOE, DEMO-Internal) used at varying ratios; plus 2-3
  uncategorized items per user.
- **Multiple projects** per user: alex has 4 projects today (use 3 of
  them); morgan has 2 (use both).
- **Seeded vendor + category** values (once Chip A lands): ~5
  distinct vendor names (NEB, IDT, Sigma-Aldrich, Thermo, generic
  "internal supply"), ~4 categories (Reagents, Consumables,
  Plasticware, Service).
- **Mix of complete + incomplete tasks**: ~70% complete (so the
  unified scroll exercises the visual distinction), ~30% active.
- **Items on non-purchase tasks**: keep morgan's 2 existing
  experiment-attached items as fixture coverage for the §5 path; add
  1 more to alex.

### Per-file delta (rough)

- `frontend/public/demo-data/users/alex/purchase_items/{1..20}.json`:
  expand from 4 to ~20.
- `frontend/public/demo-data/users/alex/tasks/*.json`: add ~3-4 new
  purchase-type tasks (today: 2).
- `frontend/public/demo-data/users/morgan/purchase_items/{1..20}.json`:
  expand from 3 to ~20.
- `frontend/public/demo-data/users/morgan/tasks/*.json`: add ~3-4
  new purchase-type tasks (today: 1).
- `frontend/public/demo-data/users/{alex,morgan}/_counters.json`:
  bump counters.
- `frontend/public/demo-data/users/lab/funding_accounts/*.json`: no
  changes (accounts stay 3); update stored `spent` values if Path 2
  of §5 keeps the stored field, otherwise leave as-is (we compute
  live).
- `frontend/src/lib/file-system/wiki-capture-fixture.ts`: the inline
  mirror at lines 25-88 must be updated **in lockstep**. AGENTS.md
  chip-3 playbook
  (commit `48a6e456`) is the precedent: every demo-data fixture entry
  must be mirrored in the wiki-capture inline copy, or the
  `?wikiCapture=1` mode silently diverges from the on-disk demo. The
  fixture writer drops `.md` entries but JSON entries must agree
  exactly.

**Prerequisite chip.** Implementation can't ship convincing
screenshots without this. AGENTS.md memory entry on
screenshot-privacy says: real-data folder must NEVER be screenshotted,
only `?wikiCapture=1` fixture mode. So Chip B (fixtures) **must
ship before Chip G (recapture).**

### Privacy hard-rule reminder

The user's real OneDrive folder contains unpublished research data
and **must never be screenshotted**. Every screenshot for the wiki +
demo + docs path must use `?wikiCapture=1` fixture mode. Mirror this
in every chip's bot brief.

---

## 8. Implementation chip breakdown

Proposed chip set for the manager to fire after design-lock.

### Chip A: Schema, add `PurchaseItem.vendor` + `PurchaseItem.category`

- **Files:** `frontend/src/lib/types.ts` (interface + Create + Update
  shapes); `frontend/src/lib/local-api.ts` (`purchasesApi.create` /
  `update` write-paths; existing read paths pass through unchanged
  because the fields are nullable); `frontend/src/components/PurchaseEditor.tsx`
  (two new text inputs in the line-item row, autocomplete from past
  values via existing catalog pattern).
- **LOC delta:** ~80-120 (interface + adapter + editor).
- **Dependencies:** none (first in chain).
- **Merge timing:** **wait for verify.** Backend schema change, even
  if nullable. Per the merge-timing memory: backend/data-shape work
  waits for verification before merge to local main.

### Chip B: Fixtures, expand demo + wiki-capture in lockstep

- **Files:**
  `frontend/public/demo-data/users/{alex,morgan}/tasks/*.json` (new
  tasks); `frontend/public/demo-data/users/{alex,morgan}/purchase_items/*.json`
  (~33 new items total); `_counters.json` for both users;
  `frontend/src/lib/file-system/wiki-capture-fixture.ts` inline
  mirror (every new entry duplicated here).
- **LOC delta:** ~250-400 across many small JSON files. The
  wiki-capture mirror is the bulk.
- **Dependencies:** Chip A (so new items can carry vendor + category).
- **Merge timing:** **wait for verify.** Fixture changes affect
  screenshots and `?wikiCapture=1`; the verification bot should
  confirm the inline mirror matches the on-disk copy and that
  `npm run demo:zip` regenerates cleanly. AGENTS.md
  `27aa8204` playbook for demo regeneration applies.

### Chip C: Page rewrite, unified scroll + dashboard skeleton

- **Files:** `frontend/src/app/purchases/page.tsx` (delete
  active/earlier split + accordion; render single sorted list; add
  `<SpendingDashboard>` component at bottom);
  `frontend/src/components/SpendingDashboard.tsx` (new; ~250-300
  LOC for the dashboard layout + time-range/project-filter controls,
  no real charts yet, just placeholders for §4's six chart slots).
- **LOC delta:** ~250 net (~50 removed from page.tsx,
  ~300 added in new component).
- **Dependencies:** Chip B (so the dashboard isn't empty in screenshots).
- **Merge timing:** **merge on report.** Pure UI change, no schema
  or data-shape changes. Per merge-timing memory: UI-only work merges
  to local main on report.

### Chip D: Chart implementation, full v1 chart set

- **Files:** `frontend/src/components/SpendingDashboard.tsx` (fill in
  the six chart slots from §4); helper files for the bar-list and
  card primitives if they get extracted (`frontend/src/components/charts/SpendBarList.tsx`,
  `frontend/src/components/charts/FundingAccountCard.tsx`).
- **LOC delta:** ~300-400 (six chart components + the segmented
  control + filter wiring + the "Items on non-purchase tasks" panel).
- **Dependencies:** Chip C.
- **Merge timing:** **merge on report.** UI-only.

### Chip E: LabPurchasesPanel disposition, extract shared hook

- **Files:** `frontend/src/hooks/useSpendingBreakdowns.ts` (new;
  ~80-120 LOC); `frontend/src/components/LabPurchasesPanel.tsx`
  (refactor the breakdown useMemo cluster to call the hook;
  ~80 LOC delta);
  `frontend/src/components/SpendingDashboard.tsx` (same refactor).
- **LOC delta:** ~50-100 net (math moves but is shared).
- **Dependencies:** Chips C+D (both consumers must exist before extraction).
- **Merge timing:** **wait for verify.** Touches the cross-user lab
  panel, with risk of subtle math drift between the two scopes. The
  verifier should confirm both panels render identical numbers for
  the same input.

### Chip F: Wiki rewrite

- **Files:** `frontend/src/app/wiki/features/purchases/page.tsx`
  (full rewrite that describes the unified scroll + dashboard, drops
  the Earlier-accordion paragraph, and adds a dashboard walkthrough
  section);
  `frontend/src/app/wiki/features/results/page.tsx` ([:37-45](frontend/src/app/wiki/features/results/page.tsx#L37)
  needs a one-line patch: the "Completed purchases → Purchases
  'Earlier'" section title and prose are now stale).
- **Existing screenshots affected:** `purchases-list.png` (obsolete,
  since list shape changed), `purchases-funding-panel.png` (obsolete,
  but the panel itself didn't change, just the page around it; could
  survive). `purchases-lab-funding-cards.png` and
  `purchases-lab-list.png` survive unless Chip E changes the lab
  panel's visible UI (it shouldn't, refactor is invisible).
- **LOC delta:** ~150-250 (mostly prose).
- **Dependencies:** Chips C+D+E (the wiki describes the shipped UI).
- **Merge timing:** **wiki manager owns**, not master-bot. AGENTS.md
  trap #11 explicitly carves `frontend/src/app/wiki/**` out of the
  master-side bot scope. Master surfaces the wiki implications in
  Chip C+D+E reports; Grant relays to the wiki manager session for
  drafting.

### Chip G: Re-capture screenshots in `?wikiCapture=1` mode

- **Files:** `frontend/public/wiki/screenshots/purchases-list.png`
  (recapture with unified scroll + dashboard visible);
  `purchases-funding-panel.png` (decide: keep or replace given the
  new dashboard takes over). New screenshot for the dashboard
  itself: `purchases-dashboard.png`.
- **Command:** `npm run wiki:screenshots` (per
  [package.json:12](frontend/package.json#L12)).
- **Dependencies:** Chip F (wiki page references the new screenshots).
- **Merge timing:** **merge on report.** Screenshot regeneration is
  deterministic from the fixture (which was verified in Chip B).

---

## 9. Open questions for Grant (clickable-question candidates)

Each formatted as a recommendation-first triplet for the manager to
re-wrap as an AskUserQuestion call.

1. **Visual differentiation for completed orders in the unified scroll.**
   - (a) Keep today's `bg-green-50/50` tint + green dot + `· Complete` text.
   - (b) Drop the bg tint, keep the dot + suffix. **Recommended.**
   - (c) Add time dividers ("This month" / "Last month" / "Earlier") instead.

2. **Chart library.**
   - (a) Hand-rolled CSS bars + inline SVG, matches existing
     LabPurchasesPanel pattern, **0 KB bundle add**. **Recommended.**
   - (b) recharts (~80 KB gz, animated, built-in a11y).
   - (c) Tremor (built on recharts, opinionated component set,
     ~120 KB).

3. **Schema expansion scope.**
   - (a) Add `vendor` + `category` to PurchaseItem.
     **Recommended (Thesis B).**
   - (b) Add `vendor` only; defer `category`.
   - (c) Stay schema-minimal (Thesis A); only funding-account,
     project, and time-axis breakdowns.

4. **Latent grandTotal bug (items on non-purchase tasks).**
   - (a) Loose model + surface in dashboard + soft warning in editor.
     **Recommended.**
   - (b) Tighten the schema invariant (validation + migration scanner +
     editor refuses).
   - (c) Status quo (silent contributors to grandTotal).

5. **LabPurchasesPanel disposition.**
   - (a) Extract shared `useSpendingBreakdowns` hook used by both
     panels; both panels keep their own UI. **Recommended.**
   - (b) Deprecate the lab panel; fold its scope into /purchases with
     a toggle.
   - (c) Coexist with no shared math; just add a deep-link.

6. **Project-filter interaction in the dashboard.**
   - (a) Respect the global `selectedProjectIds` with an "All projects"
     override toggle in the dashboard. **Recommended.**
   - (b) Always show all projects (ignore global filter).
   - (c) Add a third project-picker control inside the dashboard
     scoped just to it.

7. **Cross-user scope in the dashboard.**
   - (a) Include shared-project purchases by default, matching the
     list above. **Recommended.**
   - (b) Exclude (own purchases only).
   - (c) Show as a second series ("My spend" / "Spend on projects I'm
     in") with a toggle.

8. **Time-range default.**
   - (a) Last 12 months (matches LabPurchasesPanel). **Recommended.**
   - (b) Last 90 days.
   - (c) All time.

9. **`Task.completed_at` field, add or skip for v1.**
   - (a) Skip for v1; use `start_date` as the date axis.
     **Recommended.**
   - (b) Add for v1 (broader schema change but cleaner spend-axis).

10. **Funding-account `spent` stored field, when to drop.**
    - (a) Stop reading; recompute live everywhere. Drop the stored
      field in a separate cleanup chip. **Recommended.**
    - (b) Drop the stored field as part of Chip A.
    - (c) Keep it and add a sync-on-item-CRUD recompute.

---

## 10. Out-of-scope / explicitly deferred

What this rework does NOT do (calling out so it doesn't slip into a chip):

- **`catalogStore` changes.** The catalog (used for past-item
  autocomplete) is its own data store. Vendor/category autocomplete
  in Chip A can reuse the existing catalog read path; no schema
  change to `CatalogItem`.
- **OCR / receipt-image import.** "Take a photo of the receipt and
  ResearchOS parses the line items" is a tempting v2 but is a
  separate effort with its own dependency stack.
- **Multi-currency.** All amounts in the dashboard are assumed USD.
  Internationalization is deferred.
- **Recurring / subscription purchases.** A "this is a monthly recurring
  order" concept doesn't exist on `PurchaseItem` today; the dashboard
  doesn't try to introduce it.
- **Per-item dates.** `PurchaseItem` has no `purchased_at` field;
  the date axis is the parent task's `start_date`. A per-item date
  would let "spend over time" land on the actual purchase date
  instead of the order-creation date, but is a meaningful schema
  expansion deferred to v2.
- **Anomaly detection.** "You spent 3× last month's average on NEB"
  is a v2+ once a real lab has 1+ years of data.
- **Budget alerts / notifications.** The funding-account cards show
  amber/red states but don't generate inbox notifications. Could be
  added later via the existing notifications pipeline.
- **`PurchaseEditor` shared-task owner routing.** AGENTS.md §8 entry
  on `4e28dc85` flags that `PurchaseEditor` still calls
  `purchasesApi.listByTask(taskId)` (current-user-scoped) instead of
  threading `task.owner`. That fix is its own chip, orthogonal to
  this rework and should not block.
- **Items on Option-C hosted tasks.** The merged-view loader
  intentionally excludes hosted tasks
  ([local-api.ts:1255-1258](frontend/src/lib/local-api.ts#L1255)).
  No change here.
- **Tightening `PurchaseItem.task_id` to a typed reference.** The
  §5 "loose model" recommendation explicitly defers the hard
  invariant.
- **The funding-account `spent` field cleanup** (see Q10). Separate
  chip if Grant picks option (a) or (b).

---

*Open audit-finding I couldn't fully reconcile and want the manager
to push back on before relaying to Grant:*

The current `grandTotal` lying-by-a-few-dollars (§5) is sub-bug-level
and could be argued either way. The recommended Path 2 (surface in
dashboard) leans on the dashboard existing, but Chip C is the chip
that introduces the dashboard. If Chips A+B+C are not all merged in
sequence, the bug stays unreported. **Suggest:** the manager should
either commit to the full chip chain landing, or carve out a tiny
Chip 0 that just adds the "Items on non-purchase tasks" warning to
the page header today (1-line copy update + an aggregate filter) so
the bug is at least visible to users while the dashboard work is in
flight. I leaned recommend-not-add for Chip 0 (the dashboard land is
the right home for the surface), but worth a Grant gut-check whether
the visibility gap during the rollout matters.
