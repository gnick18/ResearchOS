# BeakerSearch on Purchases (exhaustive interaction spec)

This is the build-ready expansion of the Purchases section in
[`beakersearch-website-wide.md`](./beakersearch-website-wide.md). That master
doc fixes the architecture (one global `BeakerSearchProvider`, per-page
`useBeakerSearchSource` contributors), the four context signals (SELECTED,
HOVERED, ON SCREEN, OPEN / FOCUSED), the item kinds (COMMAND, NAVIGATE, RESULT,
CONTEXT CARD), and the global layer. This doc does NOT restate any of that. It
takes the Purchases section from concept depth to a full interaction spec
grounded in the real `src/app/purchases/page.tsx` and its data layer, so a
builder can wire the source object without re-reading the page.

Voice rule for this doc and any copy it specifies, no em-dashes, no en-dashes,
no emojis, no mid-sentence colons.

Reference shapes are the ones the Sequences palette already ships
(`components/sequences/editor-commands.ts`), so the Purchases source produces the
same `PaletteItem` union the provider already ranks and renders. The relevant
real types are `EditorCommand` (with `id`, `label`, `group`, `iconName`,
optional `shortcut`, `run`, optional `enabled`, optional `detail`, optional
`keywords`), `SequenceNavItem` / `ArtifactNavItem` (the NAVIGATE and RESULT
analogues), and the `PaletteItem` discriminated union over `kind`. Purchases
adds no new kind, it only supplies new items.

---

## 1. Entity model, data sources, keys

Everything below is read by `PurchasesPage` today. BeakerSearch reads the SAME
React Query caches (no new fetches), so it is always in sync with the page and
costs nothing extra.

### 1.1 Entities

| Entity | What it is | Identity in memory |
| --- | --- | --- |
| Purchase task | A `Task` with `task_type === "purchase"`. The parent "purchase order" card. Carries `id`, `owner`, `name`, `project_id`, `start_date`, `is_complete`, `is_shared_with_me`. | `taskKey(task)` => `"{self\|owner}:{id}"` (`lib/types.ts`). |
| Purchase item (line item) | A `PurchaseItem` under a task (`task_id` parent ref). Carries `item_name`, `quantity`, `price_per_unit`, `shipping_fees`, `total_price`, `vendor`, `category`, `funding_string`, `assigned_to`, `order_status` (`needs_ordering` \| `ordered` \| `received`), `approved` / `approved_by` / `approved_at`, `declined_at` / `declined_by`, `flagged`. Decorated with `owner` by the merged loader. | composite `` `${owner}:${task_id}` `` groups items to their task (the `purchasesByTask` map). Item id alone is per-owner and collides. |
| Project | A `Project`. The page is the ONLY surface that loads with `{ includeHidden: true }`, so it is the only place the reserved hidden `_misc_purchases` project is visible. `isMiscProject(p)` is `p.is_hidden === true && p.name === "_misc_purchases"`; it renders as `MISC_CATEGORY_LABEL` ("Miscellaneous"). | composite `` `${owner}:${id}` `` (alex's project 1 != morgan's project 1). |
| Funding account | A `FundingAccount` (grant / award). Carries `name` (the label items match on via `funding_string`), `total_budget`, `spent`, `remaining`, and DataCite-shaped grant metadata (`award_number`, `funder_name`, `funder_id`, `funder_id_type`, `award_title`). | `id` (current-user scoped, no owner namespacing on this page). |
| Lab approval queue item | A `PurchaseItem & { username }` from `labApi.getAllPurchaseItems()`, walking every discovered user's `purchase_items/` dir. Lab-head only. Drives the pending-approval count + the lab-head banner. | `username` + item `id`. |

### 1.2 Data sources (exact hooks, already on the page)

```ts
// Projects WITH the hidden _misc_purchases bucket (only this page passes it).
useQuery({ queryKey: ["projects", currentUser, { includeHidden: true }],
           queryFn: () => fetchAllProjectsIncludingShared({ includeHidden: true }) })

// All tasks, merged own + shared (decorated with is_shared_with_me + owner).
useQuery({ queryKey: ["tasks", currentUser], queryFn: fetchAllTasksIncludingShared })
//   => purchaseTasks = allTasks.filter(t => t.task_type === "purchase")

// All purchase items, merged own + shared, each decorated with `owner`.
useQuery({ queryKey: ["purchases-all", currentUser],
           queryFn: () => purchasesApi.listAllIncludingShared(currentUser) })

// Funding accounts (current user).
useQuery({ queryKey: ["funding-accounts", currentUser],
           queryFn: purchasesApi.listFundingAccounts })

// Lab-wide pending approvals (lab head only, gated by `enabled: isLabHead`).
useQuery({ queryKey: ["lab", "purchase-items"],
           queryFn: () => labApi.getAllPurchaseItems(), enabled: isLabHead })
```

Role comes from `useAccountType(currentUser)` => `isLabHead = accountType === "lab_head"`.

### 1.3 Composite keys (NAVIGATE must preserve these)

- Task: `taskKey(task)` => `"self:{id}"` for own, `"{owner}:{id}"` for shared.
- Item to task: `` `${item.owner}:${item.task_id}` `` (the `purchasesByTask` map key).
- Project: `` `${project.owner}:${project.id}` `` (matched on BOTH `id` and `owner`).

A NAVIGATE item that opens a purchase MUST carry the composite key, never a bare
numeric id, or a shared purchase opens in the wrong owner namespace (the exact
bug the page's loaders were written to avoid). Selecting a purchase in
BeakerSearch sets the page's `selectedTask` to the actual `Task` object, so the
existing `taskKey(selectedTask) === taskKey(task)` open-detection stays correct.

### 1.4 Query keys for invalidation (what each command must invalidate)

| After | Invalidate |
| --- | --- |
| Delete task, toggle complete | `["tasks"]`, `["purchases-all"]` (delete also). Matches `handleDeleteTask` + the complete-toggle. |
| Add / edit / delete line item, set order status, assign | `["purchases-all"]` (and `["tasks"]` is harmless to refresh counts). PurchaseEditor today invalidates after its writes. |
| Approve / decline (lab head) | `["lab", "purchase-items"]` and `["purchases-all"]`. `PurchaseApprovalToggle` already invalidates after `setPurchaseApproval`. |
| Create / edit / delete funding account | `["funding-accounts"]`. Matches `FundingAccountsManager.handleCreate/handleSaveEdit/handleDelete`. |
| New purchase (modal create) | `["tasks"]`, `["purchases-all"]`, `["projects"]` (a new misc purchase can create the hidden project), `["funding-accounts"]` (a typed funding string can create an account). |

The provider does not own these caches. Each Purchases COMMAND `run` calls the
same `purchasesApi` / `tasksApi` / `pi-actions` handler the page uses and
invalidates the same keys, so the page re-renders identically whether the action
came from a button or BeakerSearch.

---

## 2. Context model (the four signals on Purchases)

The source's `context()` returns `{ focused?, selected?, hovered?, onScreen? }`
plus a render hint for the CONTEXT CARD.

### 2.1 OPEN / FOCUSED

There is no single "open document" on Purchases the way Sequences has an open
sequence. The page's identity IS the filtered list plus the spending snapshot.
So FOCUSED maps to the page-level frame, surfaced as the card's first line.

### 2.2 SELECTED

The page's real selection state is `selectedTask: Task | null` (set by clicking a
purchase-order card header, which expands its `PurchaseEditor`). BeakerSearch
SELECTED = that `selectedTask`. When non-null, it is the strongest signal and
drives the top Suggested actions. A selected purchase also exposes its line items
via `purchasesByTask[taskKey-as-owner:id]`, so item-level suggestions
("mark received", "approve") can target the selected order's items.

There is no second-level "selected line item" persisted at the page level today
(line-item edit state lives inside `PurchaseEditor`). BeakerSearch treats the
selected ORDER as the selection unit and offers item-scoped actions as a short
list when the order has few items, falling back to "open it" when it has many
(see 3.2).

### 2.3 HOVERED / UNDER THE MOUSE

The provider tracks the last hovered `[data-beaker-target]` element app-wide. For
Purchases, tag two row types so hover gives mouse-aware suggestions for free:

- The purchase-order card header (`onClick={() => setSelectedTask(...)}` row).
  Tag it `data-beaker-target` with a payload key `` `purchase:${taskKey(task)}` ``.
- Each line-item row inside `PurchaseEditor` (the editable item rows). Tag with
  `` `purchase-item:${item.owner}:${item.id}` ``.

When the palette opens with no SELECTED but a hovered purchase / item, that
hovered entity is promoted to the same Suggested treatment as a selection, with a
softer card line ("Pointing at 'Pipette tips'"). This is the per-page opt-in the
master doc calls out, and Purchases is a good second prototype after Workbench
because its rows are already discrete cards.

### 2.4 ON SCREEN

ON SCREEN = the two active filters plus the live spending snapshot:

- `categoryFilter`, one of `all` \| `project` \| `misc` \| `awaiting_approval`.
- `orderStatusFilter`, one of `any` \| `needs_ordering` \| `ordered` \| `received`.
- The visible task count after both filters (`sortedTasks.length`) and the dollar
  total of the items in those visible tasks.

ON SCREEN scopes ENTITIES (empty-query jump list is the currently visible orders
first) and biases Suggested (e.g. the awaiting-approval filter unlocks
"Approve all pending").

### 2.5 The CONTEXT CARD contents

The card is non-selectable. Its lines, computed from the signals above:

- Line 1 (FOCUSED + ON SCREEN), the scope and the snapshot:
  `Purchases, needs ordering, 12 items, $3,420`.
  Built from `orderStatusFilter` label (`PURCHASE_ORDER_STATUS_LABEL`) when not
  `any`, else the `categoryFilter` label, then the visible-item count and the
  summed `total_price` of items in `sortedTasks` (use the page's `grandTotal` for
  the unfiltered "All / Any stage" case). A purely-unfiltered card reads
  `Purchases, 18 orders, $9,140 total` (mirrors the page subhead).
- Line 2 (SELECTED), when a purchase is open:
  `Selected, "qPCR reagents" - Project Alpha - 4 items - $612.40`.
  Project name uses the misc override (`isMiscProject` => "Miscellaneous").
- Line 2 alt (HOVERED, no selection): `Pointing at "Pipette tips x10"`.
- Line 3 (role, lab head only, when the lab queue is non-empty):
  `8 items across the lab await your approval` (mirrors the page banner copy,
  count from `labPendingApprovalCount`). This is the only role-specific card
  line; members never see it.

While the query is typed, the card collapses to its one-line header
(`Purchases, needs ordering`) exactly like the Sequences card slims.

---

## 3. SUGGESTED (contextual + role-aware)

Suggested items are COMMANDs (kind `"command"`) with the selection echoed in the
row's `detail`, identical to how Sequences echoes "from 612..632". Each lists its
exact real handler, its `enabled` predicate, and the row echo. Ranking follows
the master priority, SELECTED > HOVERED > ON SCREEN > FOCUSED.

### 3.1 The permission split (applies to every selection / item command)

Write and destructive actions are gated the way the page gates them:

- `task.is_shared_with_me === true` disables complete-toggle, delete, and all
  line-item writes (the page's `completeLabel` / `deleteLabel` carry the reason,
  and `PurchaseEditor` is passed `isSharedWithMe`). BeakerSearch sets
  `enabled: !task.is_shared_with_me` and puts the same reason in `detail`
  ("Only the owner (alex) can change this").
- Approve / decline is lab-head only AND requires a live PI edit-mode session.
  `setPurchaseApproval` / `declinePurchase` both call
  `assertLiveSession(actor, sessionId)` and fail with `data-write` otherwise. So
  the Approve command is `enabled` only when `isLabHead && hasLiveSession`; with
  no live session the row is shown but greyed with detail "Start an edit session
  on Lab Overview to approve".
- Shared-purchase dedup, the merged loaders already dedup own vs shared by the
  composite key. BeakerSearch must build its item list from `purchasesByTask`
  (already deduped) and never from a second raw read, so a shared order never
  shows twice.

### 3.2 A purchase SELECTED or HOVERED

Let `task` be the selected (or hovered) order, `items = purchasesByTask[`${task.owner}:${task.id}`]`.

| Suggested label | When shown | Handler | `enabled` | Row echo (`detail`) |
| --- | --- | --- | --- | --- |
| `Mark "{first needs-ordering item}" ordered` | items has a `needs_ordering` item | `purchasesApi.setOrderStatus(itemId, "ordered", { owner: task.is_shared_with_me ? task.owner : undefined, actor: currentUser })`, then invalidate `["purchases-all"]` | `!task.is_shared_with_me` | the item name + "needs ordering -> ordered" |
| `Mark "{first ordered item}" received` | items has an `ordered` item | `setOrderStatus(itemId, "received", ...)` | `!task.is_shared_with_me` | "ordered -> received" |
| `Mark whole order received` | every item is `ordered` or `received` | loop `setOrderStatus(_, "received")` over non-received items | `!task.is_shared_with_me` | "{n} items" |
| `Approve "{first pending item}"` | `isLabHead` and items has a pending item (`isPurchasePending`) | `setPurchaseApproval({ actor: currentUser, sessionId, targetOwner: task.owner, purchaseItemId, approved: true, itemName })`, invalidate `["lab","purchase-items"]` + `["purchases-all"]` | `isLabHead && hasLiveSession` | "pending -> approved" |
| `Approve all pending in this order` | `isLabHead` and >1 pending item | loop `setPurchaseApproval` over pending items | `isLabHead && hasLiveSession` | "{k} pending" |
| `Decline "{first pending item}"` | `isLabHead` and items has a pending item | `declinePurchase({ actor, sessionId, targetOwner: task.owner, purchaseItemId, itemName })` | `isLabHead && hasLiveSession` | "marks declined" |
| `Add a line item to "{task.name}"` | always (own orders) | open the order (set `selectedTask`) and focus `PurchaseEditor`'s new-row input, OR call the editor's add-row path (`purchasesApi.create({ task_id, ... })`) | `!task.is_shared_with_me` | "opens the editor row" |
| `Open "{task.name}"` | always | `setSelectedTask(task)` (NAVIGATE-like, but kept in Suggested as the obvious move) | always (read is allowed for shared) | project + total |
| `Mark order {complete/incomplete}` | always (own orders) | `tasksApi.update(task.id, { is_complete })`, invalidate `["tasks"]` | `!task.is_shared_with_me` | current state |
| `Change project of "{task.name}"` | own orders | `tasksApi.update(task.id, { project_id })` via a follow-on project picker (NAVIGATE sub-list of projects incl. Miscellaneous) | `!task.is_shared_with_me` | current project |
| `Set funding account for items` | own orders, order has uncategorized items | per-item `purchasesApi.update(itemId, { funding_string })` via a funding-account picker | `!task.is_shared_with_me` | "{m} items unfunded" |
| `Delete "{task.name}"` | own orders | `handleDeleteTask(task.id)` (keeps the page's `confirm()` + invalidations) | `!task.is_shared_with_me` | "removes the order and items" |

When the selected order has more than a small number of items (say > 4), collapse
the per-item "mark / approve" rows into "Open it" plus the bulk variants, so
Suggested never balloons. The first-item targeting uses the item's display order
(the editor's row order), so "the first needs-ordering item" is the topmost one.

### 3.3 The awaiting-approval filter active, lab head

When `categoryFilter === "awaiting_approval"` and `isLabHead`:

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Approve all pending (this page)` | loop `setPurchaseApproval(approved: true)` over every pending item in `sortedTasks` | `isLabHead && hasLiveSession` |
| `Open the lab-wide approval queue` | `router.push("/lab-overview")` (matches the banner CTA; honest label, the queue tile lives there) | `isLabHead` |
| `Review pending one at a time` | sets selection to the first pending order, biasing 3.2 | `isLabHead` |

For a MEMBER on this same filter (their label reads "Awaiting approval"), there
is nothing to approve, so Suggested instead offers `Nudge the lab head` is OUT OF
SCOPE (no such handler exists), and we fall back to "Open it" on the first
awaiting order plus the nothing-selected set below. Members never see an Approve
row, anywhere.

### 3.4 Nothing selected, no hover

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `New purchase` | `setShowNewPurchase(true)` (opens `NewPurchaseModal`) | always |
| `Manage funding accounts` | `setShowFundingManager(true)` (opens the `FundingAccountsManager` LivingPopup) | always |
| `Export current spending (CSV)` | trigger `SpendingDashboard.handleExportCsv` over the in-window items (see 5) | `filteredItems.length > 0` |
| `Open the spending dashboard` | scroll to / focus the `SpendingDashboard` section | always |
| `Open the lab approval queue` | `router.push("/lab-overview")` | `isLabHead` only |

"Export selected" in the master doc resolves to "Export current spending" here,
because the real export operates on the dashboard's in-window filtered items, not
on a single selected order (there is no per-order CSV today, see open questions).

---

## 4. NAVIGATE (entities to jump to)

NAVIGATE items are the `"sequence"`-kind analogue (a purchases-specific nav item
reusing `SequenceNavItem`'s `{ id, label, detail, iconName }` shape, or a small
`PurchaseNavItem` variant if the builder prefers an explicit type). Selecting one
changes context without leaving the page (except the cross-page route jumps).

Empty query, the list is the on-screen orders first (the visible `sortedTasks`),
then widens to all purchase orders as the user types.

| NAVIGATE target | Effect | Carries |
| --- | --- | --- |
| A purchase by title | `setSelectedTask(task)` (expands its card + editor) | `taskKey(task)`, so a shared order opens in the owner namespace |
| A line item by name | select its parent order, then scroll the editor to the item | `` `${item.owner}:${item.task_id}` `` + item id |
| A funding account by name | open the funding manager focused on that account (or filter the dashboard's funding breakdown to it) | account `id` |
| A project's purchases | set `categoryFilter` to the project's bucket (real project => `project`, misc => `misc`) and select the project's first order; full per-project scoping rides the global project filter (`selectedProjectIds`) that the dashboard already respects | `` `${project.owner}:${project.id}` `` |
| A category filter | `setCategoryFilter(key)` for `all` / `project` / `misc` / `awaiting_approval` | filter key |
| An ordering-status filter | `setOrderStatusFilter(key)` for `any` / `needs_ordering` / `ordered` / `received` | filter key |
| The spending dashboard | focus the dashboard section | none |
| Lab Overview (lab head) | `router.push("/lab-overview")` | none |

Detail (sub) lines, a purchase nav row reads
`Project Alpha - 4 items - $612.40 - 2 need ordering`; a funding row reads
`NIH R01 - $4,120 of $20,000 spent`; a filter row reads `Filter, 12 orders`.
Fuzzy match runs over label + detail just like `scoreSequenceNav`, so typing a
vendor or project name surfaces the matching orders.

---

## 5. RESULTS (reopenable spending export)

The master doc generalizes the Phase 5 sequence artifact idea to a reopenable
spending export. The real export today is `SpendingDashboard.handleExportCsv`,
which builds a CSV in the browser and triggers a download. It captures, per item
in the current window:

```
item_id, item_name, vendor, category, funding_string,
project_name (misc shown as "Miscellaneous"), task_name,
start_date, total_price, owner
```

scoped by the dashboard's `timeRangeOption` (`30d` / `90d` / `12mo` / `all` /
`custom` with `customFrom` / `customTo`) and the global project filter when
`respectGlobalProjectFilter` is on. Filename `purchases-export-{YYYY-MM-DD}.csv`.

BeakerSearch turns this into a RESULT (kind `"artifact"`-shaped):

- When the user runs `Export current spending` from BeakerSearch, capture a small
  descriptor of the export, the active time range, the project-filter state, the
  item count, the dollar total, and the generated filename / blob handle.
- Surface it under "Recent results" as
  `Spending export, last 12 months, 142 items, $9,140` with an "Open" hint.
- Reopening re-runs `handleExportCsv` with the captured scope (the CSV is cheap
  to regenerate; we do not need to persist the blob, only the scope), so the
  result is a reproducible report rather than a stored file. This matches the
  Sequences pattern where a result reopens its computed view.

What it captures is exactly the CSV scope above (time range + project filter +
the resulting item set + total), nothing user-private beyond what the CSV already
exports. No lab-wide data leaks, the export is over `filteredItems`, which is the
current viewer's merged own + shared purchase items only.

---

## 6. COMMANDS (the full long tail, grouped)

These are the page's complete command set, the `commands()` half of the contract.
Groups print in a fixed order (mirroring `CommandGroup` on Sequences). Every row
lists its real handler and permission gate.

### Create
- `New purchase` -> `setShowNewPurchase(true)` (`NewPurchaseModal`). Always.
- `Add a line item to the open order` -> editor add-row / `purchasesApi.create({ task_id, item_name, quantity, ... })`. `enabled` when an own order is selected.

### Order status
- `Mark item needs ordering / ordered / received` -> `purchasesApi.setOrderStatus(itemId, status, { owner?, actor })`. Own (or shared with owner-routing) orders. The `needs_ordering -> ordered` transition fires the `purchase_ordered` bell to the requester when the item was assigned to someone else.
- `Assign item to a lab member` -> `purchasesApi.assign(itemId, assignee, { owner?, actor })`, fires the `purchase_assignment` bell. Own / lab-mode orders.

### Approval (lab head only, live session required)
- `Approve item` -> `setPurchaseApproval({ actor, sessionId, targetOwner, purchaseItemId, approved: true, itemName })`.
- `Decline item` -> `declinePurchase({ actor, sessionId, targetOwner, purchaseItemId, itemName })`.
- `Approve all pending on this page` -> loop over `sortedTasks` pending items.
- All gated `isLabHead && hasLiveSession`; greyed with the "start an edit session" reason otherwise.

### Filters
- `Filter, All / Project purchases / Miscellaneous / {Awaiting,Pending} approval` -> `setCategoryFilter(key)`. The awaiting-approval label is role-derived (`awaitingApprovalLabel`).
- `Ordering, Any stage / Needs ordering / Ordered / Received` -> `setOrderStatusFilter(key)`.

### Funding
- `Manage funding accounts` -> `setShowFundingManager(true)`.
- `New funding account` -> open the manager focused on its create form (`FundingAccountsManager.handleCreate` => `purchasesApi.createFundingAccount`).
- `Edit / delete a funding account` -> manager edit / delete (`updateFundingAccount` / `deleteFundingAccount`).

### Spending
- `Open the spending dashboard` -> focus the dashboard section.
- `Export current spending (CSV)` -> `handleExportCsv` (disabled when `filteredItems.length === 0`).
- `Set the dashboard time range` -> `setTimeRangeOption(30d|90d|12mo|all|custom)`.
- `Set the breakdown lens` -> `setBreakdownLens(project|vendor|category)`.

### Order management
- `Open order`, `Mark order complete / incomplete` -> `tasksApi.update(id, { is_complete })`. Own orders.
- `Change order project` -> `tasksApi.update(id, { project_id })`. Own orders.
- `Delete order` -> `handleDeleteTask(id)` (keeps the `confirm()` prompt). Own orders.

### Navigate out
- `Open Lab Overview` -> `router.push("/lab-overview")`. Lab head.

---

## 7. `useBeakerSearchSource` implementation sketch

The page calls one hook. It reads the same caches the page already holds (so this
hook lives inside `PurchasesPage` or a colocated `usePurchasesBeakerSource()`
that takes the page's already-fetched data + setters as input, to avoid a second
fetch). Types are illustrative; `PaletteCommand` here is the page's local alias
for the provider's `EditorCommand`-shaped command, and `PurchaseNavItem` reuses
`SequenceNavItem`'s field shape.

```ts
function usePurchasesBeakerSource(args: {
  // already-fetched page state + setters
  purchaseTasks: Task[];
  purchasesByTask: Record<string, PurchaseItem[]>;
  projects: Project[];
  fundingAccounts: FundingAccount[];
  sortedTasks: Task[];            // the on-screen list
  grandTotal: number;
  categoryFilter: PurchaseCategoryFilter;
  orderStatusFilter: PurchaseOrderStatusFilter;
  selectedTask: Task | null;
  setSelectedTask: (t: Task | null) => void;
  setCategoryFilter: (k: PurchaseCategoryFilter) => void;
  setOrderStatusFilter: (k: PurchaseOrderStatusFilter) => void;
  setShowNewPurchase: (b: boolean) => void;
  setShowFundingManager: (b: boolean) => void;
  exportSpendingCsv: () => void;  // lifted from SpendingDashboard
  handleDeleteTask: (id: number) => void;
  currentUser: string;
  isLabHead: boolean;
  hasLiveSession: boolean;        // from the PI edit-mode session store
  liveSessionId: string | null;
  labPendingApprovalCount: number;
  hoveredKey: string | null;      // from the provider's [data-beaker-target]
}): BeakerSearchSource {
  const queryClient = useQueryClient();

  const itemsFor = (t: Task) =>
    args.purchasesByTask[`${t.owner}:${t.id}`] ?? [];

  // helpers that wrap the real handlers + invalidations
  const setStatus = (it: PurchaseItem, owner: Task, status: PurchaseOrderStatus) =>
    purchasesApi
      .setOrderStatus(it.id, status, {
        owner: owner.is_shared_with_me ? owner.owner : undefined,
        actor: args.currentUser,
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["purchases-all"] }));

  const approve = (it: PurchaseItem, owner: Task) =>
    setPurchaseApproval({
      actor: args.currentUser,
      sessionId: args.liveSessionId ?? "",
      targetOwner: owner.owner,
      purchaseItemId: it.id,
      approved: true,
      itemName: it.item_name,
    }).then(() => {
      queryClient.invalidateQueries({ queryKey: ["lab", "purchase-items"] });
      queryClient.invalidateQueries({ queryKey: ["purchases-all"] });
    });

  return {
    id: "purchases",

    context() {
      const sel = args.selectedTask;
      const hovered = !sel && args.hoveredKey?.startsWith("purchase:")
        ? args.purchaseTasks.find(t => `purchase:${taskKey(t)}` === args.hoveredKey)
        : undefined;
      return {
        focused: { kind: "page", label: "Purchases" },
        selected: sel ? { kind: "purchase", task: sel, items: itemsFor(sel) } : undefined,
        hovered: hovered ? { kind: "purchase", task: hovered, items: itemsFor(hovered) } : undefined,
        onScreen: {
          categoryFilter: args.categoryFilter,
          orderStatusFilter: args.orderStatusFilter,
          visibleCount: args.sortedTasks.length,
          grandTotal: args.grandTotal,
          labPendingApprovalCount: args.isLabHead ? args.labPendingApprovalCount : 0,
        },
        cardHint: buildPurchasesCardLines(/* signals above */),
      };
    },

    suggested(ctx) {
      const focus = ctx.selected ?? ctx.hovered;          // SELECTED beats HOVERED
      if (focus) return suggestForOrder(focus.task, focus.items); // section 3.2
      if (args.categoryFilter === "awaiting_approval" && args.isLabHead)
        return suggestApprovalQueue();                    // section 3.3
      return suggestNothingSelected();                    // section 3.4
    },

    entities(ctx, query) {
      const base = query ? args.purchaseTasks : args.sortedTasks; // on-screen first
      return [
        ...base.map(toPurchaseNavItem),                   // jump to order (carries taskKey)
        ...args.fundingAccounts.map(toFundingNavItem),    // jump to account
        ...categoryFilterNavItems(args.setCategoryFilter),
        ...orderStatusFilterNavItems(args.setOrderStatusFilter),
      ];
    },

    results() {
      return recentSpendingExports.map(toExportResultItem); // section 5
    },

    commands() {
      return purchasesCommandSet(args);                   // section 6, full long tail
    },
  };
}
```

Role gating is centralized, `suggestForOrder` sets `enabled: !task.is_shared_with_me`
on writes and `enabled: args.isLabHead && args.hasLiveSession` on approve / decline,
and the whole approval block is omitted from `commands()` for members so it never
appears in the typed long-tail search either. Every `run` invalidates the exact
query keys from section 1.4. The provider handles ranking, rendering, keyboard,
and merging with the global layer.

---

## 8. Keyboard, states, edge cases, open questions

### Keyboard
Inherits the shared model, up / down skipping disabled (greyed shared-write and
no-live-session approve rows) and non-selectable (the context card), Enter runs /
navigates / reopens the highlighted item, Escape closes, focus trap + restore,
combobox / listbox aria. No Purchases-specific shortcuts beyond what the rows
carry in `shortcut`.

### Empty vs typed
- Empty query, CONTEXT CARD (section 2.5), then SUGGESTED (3), then on-screen
  orders as ENTITIES (4), then Recent spending exports (5), then the grouped
  COMMANDS (6), then the slim global section.
- Typed query, card slims to one line, everything collapses into one fuzzy list
  over commands + purchase / funding / filter entities + export results + global,
  grouped by kind. Typing a vendor, project, or grant name surfaces matching
  orders via the label + detail fuzzy match.

### Empty states
- No purchases at all (`purchaseTasks.length === 0`), Suggested shows only
  `New purchase` + `Manage funding accounts`, ENTITIES is empty, the card reads
  `Purchases, no orders yet`. Mirrors the page's "No purchases yet" empty block.
- Filter bucket empty (`sortedTasks.length === 0` but purchases exist), the card
  still shows the global snapshot, ENTITIES widens to ALL orders (ignoring the
  empty filter) so the user can still jump, and Suggested offers
  `Clear the {category} filter` / `Show any stage`.

### Edge cases
- Shared purchase orders, read is allowed (Open, jump), every write is greyed with
  the owner reason. Built from `purchasesByTask` so a shared order never
  double-lists (dedup is already done by the merged loaders).
- Misc orders, the project name is always the "Miscellaneous" override, never the
  raw `_misc_purchases`, in the card, nav detail, and any echo. The
  `Filter to Miscellaneous` command targets `categoryFilter = "misc"`.
- Orphaned project (`project_id` resolves to nothing), treat as non-misc (matches
  the page), nav detail omits the project segment.
- Lab head with zero personal purchases but a non-empty lab queue, the card's
  role line + the `Open the lab approval queue` command still surface, so the
  same gap the page banner closes is closed in BeakerSearch.
- Approve without a live session, the row is visible but greyed (`enabled: false`)
  with detail "Start an edit session on Lab Overview to approve", never silently
  failing the `assertLiveSession` write.

### Permissions summary
- Member, no Approve / Decline anywhere; sees own + shared-with-them orders;
  writes only on own orders.
- Lab head, Approve / Decline on others' items WHEN a live PI session is active;
  the lab-queue role line + queue-jump command; the awaiting-approval bulk
  approve. Approval writes route to the target owner's folder
  (`targetOwner: task.owner`) and post the `lab_purchase_approval` bell.

### Purchases-specific open questions
1. No per-order CSV exists today (only the dashboard's in-window export). Do we
   add a "Export THIS order" path, or keep RESULT scoped to the dashboard window?
   The spec above keeps it to the dashboard export to avoid new export code.
2. The PI live-session id is owned by the Lab Overview edit-mode store, not the
   Purchases page. Wiring Approve into BeakerSearch needs that session id surfaced
   to the page (a small selector). Until then, Approve can route the user to Lab
   Overview instead of approving inline.
3. HOVERED-as-context here depends on tagging the order cards and the editor item
   rows with `[data-beaker-target]`. Worth prototyping on the order cards first
   (discrete, already clickable) before the denser editor rows, matching the
   master doc's "prototype hover on one surface first" caution.
4. "Change order project" and "Set funding account for items" need a follow-on
   picker step inside the palette (a sub-list NAVIGATE). The provider does not yet
   have a two-step command model; either add one or have these commands open the
   existing modals positioned on the right field.
