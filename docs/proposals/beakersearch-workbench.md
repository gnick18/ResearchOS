# BeakerSearch on Workbench (exhaustive interaction spec)

This is the build-ready companion to the Workbench section of
`docs/proposals/beakersearch-website-wide.md`. The master doc holds the
architecture (one global `BeakerSearchProvider`, per-page `useBeakerSearchSource`
contributors, the four context signals, the four item kinds, the global layer).
This doc takes Workbench from concept depth to a full interaction spec grounded
in the real `/workbench` code, so a builder can wire the source without rereading
the page.

Workbench is the hub. It is the most navigation-heavy page in the app (five
tabs over four data domains, no single "open thing"), so its BeakerSearch source
leans hardest on NAVIGATE. "Jump to anything" is the headline power here, and it
must be excellent, including jumping ACROSS tabs (a result on the Notes tab must
be reachable while you stand on the Experiments tab).

Voice in this doc and in every copy string it specifies: no em-dashes, no
en-dashes, no emojis, no mid-sentence colons. Icons are `<Icon>` from the
verified library (the same constraint the Sequences `CommandPalette` already
enforces), never inline SVG inside palette rows.

## 1. The page as BeakerSearch sees it

### 1.1 The five tabs (real state)

`src/app/workbench/page.tsx` holds the whole surface. The active tab is purely
local state:

```ts
type TabType = "projects" | "experiments" | "notes" | "lists" | "oneonone";
const [activeTab, setActiveTab] = useState<TabType>("projects");
```

"projects" is the default landing view (Phase 3a). The five tab buttons each call
`setActiveTab(<tab>)` directly. The 1:1s tab is gated: `shouldShowOneOnOneTab`
(`src/components/workbench/oneOnOneGate.ts`) hides it for a solo user with no lab
head and no 1:1s, and an effect bounces `activeTab` back to "projects" when the
gate goes false while it is open. Its label is role-relative
(`oneOnOneTabLabel("lab_head" | "lab")`), so BeakerSearch must read the same
label, never hardcode "1:1s".

Deep-link params are read ONCE on mount from `window.location.search` (not
`useSearchParams`, to avoid a CSR-bailout Suspense boundary):

- `?tab=projects | experiments | notes | lists | oneonone` selects the tab.
  Unknown / absent leaves the Projects default.
- `?notebook=<id>` is handed to `NotesPanel` as `initialNotebookId` (seeds the
  notebook rail selection). The long-standing case is `?tab=notes&notebook=<id>`,
  emitted by the Shared Notebook home widget.

This is the navigation seam BeakerSearch writes to. A cross-tab NAVIGATE item
either calls `setActiveTab` in-page (preferred, no reload, see 4.4) or pushes
`/workbench?tab=<t>&notebook=<id>` for a cold jump from another route.

### 1.2 The project filter (on-screen scope)

The global project filter lives in the Zustand store
(`src/lib/store.ts`), shared with Gantt and Purchases:

```ts
selectedProjectIds: string[];   // composite "{owner}:{id}" keys, never bare ids
projectFilterMode: "all" | "explicit";
toggleProject(key);             // first toggle from "all" flips to "explicit", scopes to [key]
setSelectedProjects(keys);
setProjectFilterMode("all" | "explicit");  // "all" clears selectedProjectIds to []
```

`WorkbenchProjectFilterPills` renders one pill per project plus a dashed
"Standalone" pill (`STANDALONE_FILTER_KEY = "__standalone__"`, matches orphan
tasks whose `project_id` is null/0). The pills render only on Experiments and
Lists (`activeTab !== "notes" && !== "projects" && !== "oneonone"`). Notes are
project-agnostic in this data model (no `project_id` link), and the Projects tab
IS the project list, so neither shows the filter.

Matching is composite-key OR via `matchesAnyProjectFilter(task, selectedProjectIds)`
from `src/lib/search/filterKey.ts`. `alex:1` and `morgan:1` are different
projects; never collapse to a bare numeric id. BeakerSearch reuses this exact
predicate so its on-screen scope agrees with what the panel renders.

### 1.3 The data layer (sources and query keys)

| Domain | Fetch | Query key | Notes |
| --- | --- | --- | --- |
| Projects | `fetchAllProjectsIncludingShared()` | `["projects", currentUser]` | own + shared-into-me; each has `owner`, `id`, `name`, `color`, `is_shared_with_me` |
| Tasks (all types) | `fetchAllTasksIncludingShared()` | `["tasks", currentUser]` | filtered by `task_type` into experiment / list / purchase; purchases live on `/purchases`, not here |
| Dependencies | `dependenciesApi.list()` | `["dependencies", currentUser]` | drives the "blocked" section in Experiments |
| Methods | `fetchAllMethodsIncludingShared()` | `["methods", currentUser, "with-shared"]` | only for the experiment card method chips |
| Notes | `notesApi.list()` | `["notes"]` | personal-mode list; `notebook_id` optional |
| Notebooks | `labApi.getSharedNotebooks()` | `["shared-notebooks", "mine"]` | `members.length === 1` is personal, `>= 2` is a shared notebook |
| 1:1s | `labApi.getOneOnOnes()` | `["one-on-ones"]` | `{ id, labHead, member, owner, ... }`; the page reads `.length` for the gate + subtitle |

The Workbench page itself already holds the `projects` and `allTasks` queries (it
shares the same query keys the panels use, so the cache is reused). BeakerSearch's
Workbench source reads from the SAME query keys via `useQuery` so it never adds a
fetch, only a reader. Invalidation it must respect: writes go through the panels'
existing mutations and `queryClient.invalidateQueries`/`refetchQueries`, and
BeakerSearch only calls those same handlers (see 7), so the entity lists
re-rank on the next render with no bespoke cache plumbing.

## 2. ENTITY MODEL across the tabs

Five entity families. Each row below is what a NAVIGATE item wraps, the composite
key it carries, and the fuzzy fields (see 4 for the per-entity fuzzy spec).

### 2.1 Project

- Source: `["projects", currentUser]`.
- Key: `projectKey(p) = ` `${p.owner}:${p.id}` (the `projectKey` helper appears
  verbatim in `page.tsx`, `WorkbenchProjectsPanel`, `WorkbenchExperimentsPanel`,
  `WorkbenchListsPanel`).
- Shape used: `name`, `color`, `owner`, `id`, `is_shared_with_me`.
- Derived counts (already computed in `WorkbenchProjectsPanel.countTasksForProject`):
  experiments, experimentsComplete, lists, total, totalComplete. BeakerSearch can
  surface these as the row sub ("8 experiments, 62% complete").
- Open target: `/workbench/projects/${p.id}` plus `?owner=<owner>` when
  `is_shared_with_me && owner !== currentUser` (see `openProject` in the panel and
  `NewProjectButton.handleCreated`, identical rule). The `[id]` route reads
  `searchParams.get("owner")` as `ownerHint`.

### 2.2 Experiment (Task, `task_type === "experiment"`)

- Source: `["tasks", currentUser]`, filtered `t.task_type === "experiment"`.
- Key: `taskKey(t)` from `lib/types.ts` (owner + `is_shared_with_me` namespace),
  used as the React key and the probe-map key throughout the panel.
- Shape used: `name`, `owner`, `project_id`, `is_complete`, `start_date`,
  `end_date`, `duration_days`, `experiment_color`, `method_ids`,
  `is_shared_with_me`, `shared_permission`, `last_edited_by`, `last_edited_at`.
- Section assignment (`assignSection`): ready / blocked / running / awaiting /
  recent / scheduled. BeakerSearch can echo the section as the row sub ("Running,
  day 2 of 5", "Blocked by Miniprep").
- Open target: `setSelectedTask(t)` -> mounts `TaskDetailPopup`. Owned-only lookups
  for chain/blocker click-throughs go through `handleOpenTaskById`. BeakerSearch's
  in-page jump sets the same `selectedTask` state (see 4.2 for the cross-tab case).

### 2.3 List task (Task, `task_type === "list"`)

- Source: `["tasks", currentUser]`, filtered `t.task_type === "list"`.
- Key: `taskKey(t)`.
- Shape used: same Task fields; `sub_tasks` drives the progress dots and the
  forward-cascade complete.
- Bucket (`bucketListTasks`): overdue / doing / upcoming / recentlyDone / earlier.
- Open target: the Lists panel uses an INLINE accordion, not a popup, on card
  click (`expandedTaskKey`); the popup is the "Open full view" escape hatch
  (`onOpenFullView -> setSelectedTask`). BeakerSearch's jump should open the full
  view (`setSelectedTask`) so a cross-tab jump lands somewhere visible without
  depending on accordion scroll position (see 4.2).

### 2.4 Note and Notebook

Two related but distinct entities, both on the Notes tab (`NotesPanel`).

Note:
- Source: `["notes"]` (`notesApi.list()`), personal mode.
- Key: notes use a numeric `id` plus an `owner`/`username`; for BeakerSearch keys
  use `note-${owner ?? currentUser}:${id}` to stay collision-safe across shared
  notes, mirroring the composite-key discipline. (Notes are not in the
  `"{owner}:{id}"` project namespace, so this is a BeakerSearch-local key.)
- Shape used: `title`, `description`, `is_running_log`, `is_shared`, `shared_with`,
  `notebook_id`, `updated_at`, `created_at`.
- Open target: `setSelectedNote(note)` -> `NoteDetailPopup`.

Notebook (`SharedNotebook` from `getSharedNotebooks`):
- Key: notebooks already carry a globally-unique string `id` (UUID). BeakerSearch
  key: `notebook-${id}`.
- Shape used: `id`, name/title, `members[]` (split: `length === 1` personal,
  `>= 2` shared).
- Open target: set the rail selection `{ kind: "notebook", id }` in `NotesPanel`
  (`selection` state, `RailSelection` from `notebooks/NotebookRail.tsx`). A shared
  (2+ member) notebook renders the dedicated `SharedNotebookView`; a personal one
  filters the local grid. Cold jump from another route: push
  `/workbench?tab=notes&notebook=<id>` (the `initialNotebookId` seam).

### 2.5 One-on-one (`OneOnOne`)

- Source: `["one-on-ones"]` (`labApi.getOneOnOnes()`).
- Shape: `{ id (UUID), labHead, member, owner, created_at, shared_with }`.
- Key: `oneonone-${id}`.
- Display name: the "other person" relative to `currentUser`. If
  `currentUser === labHead`, the row names `member`; else it names `labHead`. Use
  `oneOnOneLabel` (the same module the panel and tab label use) for the role word
  ("mentee" / "check-in") so copy stays role-relative.
- Open target: the panel keeps `selectedId` local (`setSelectedId(id)`), defaults
  to the first 1:1, and shows four area sub-tabs (goals / meetings / notes /
  agenda). BeakerSearch jump sets `selectedId` in-page; cold jump pushes
  `/workbench?tab=oneonone` and lets the panel's default-to-first land (there is
  no `?oneonone=` deep-link param today, so add one only if 1:1 deep-linking is in
  scope; see Open Questions).

## 3. CONTEXT MODEL (the four signals on Workbench)

The master's four signals map onto Workbench as follows. The context object the
source returns is `{ focused, selected, hovered, onScreen }` plus a render hint
for the context card.

### 3.1 OPEN / FOCUSED -> the active tab (and an open notebook / 1:1)

Workbench has no single "open document"; its identity is the active tab plus any
sub-selection inside that tab. `focused` resolves to:

- The active tab itself (`activeTab`), always present.
- On Notes, the active notebook rail selection (`activeNotebook` / `selection`)
  when one is open. A shared notebook is a strong focus (full `SharedNotebookView`).
- On 1:1s, the selected 1:1 (`selectedId` / `selected`).

This is what prints in the context card's headline (see 3.5).

### 3.2 ON SCREEN -> the active tab + the project filter

The visible frame is `{ activeTab, selectedProjectIds, projectFilterMode }`. This
scopes the empty-query NAVIGATE list (4.x): with the empty query, ENTITIES are
narrowed to what the current tab + filter would render, then widened to all tabs
when the user types (the master's "scoped when empty, widened when typing" rule).

Concretely:
- Experiments tab, filter = `morgan:3` -> empty-query ENTITIES lead with the
  experiments in Mitochondria QC, then offer "jump to any experiment" when typing.
- Notes tab, notebook "Lab meeting" open -> empty-query ENTITIES lead with the
  notes in that notebook.

### 3.3 SELECTED -> a focused card / row / open popup

A real selection on Workbench is a card or row the user explicitly opened or
focused, which maps to:

- Experiments: `selectedTask` (the open `TaskDetailPopup`), OR the keyboard-focused
  board card.
- Lists: `expandedTaskKey` (the inline-expanded card) OR `selectedTask` (full view).
- Notes: `selectedNote` (the open `NoteDetailPopup`).
- 1:1s: `selectedId` (the open 1:1) plus the open `area` sub-tab.

`selected` is the strongest signal and drives the top SUGGESTED actions (3 below
the card). When a popup is open the palette can still open over it (Cmd-K), and
SUGGESTED reads "do this to the open <thing>".

### 3.4 HOVERED -> the card / row under the mouse

Captured app-wide by the provider via `[data-beaker-target]` (master 3). Workbench
opts rows in by tagging:

- Each experiment card wrapper (the `<div key={taskKey(t)}>` in
  `renderCard`) gets `data-beaker-target` carrying its `taskKey`. The wrapper
  already exists and already holds `data-tour-target` / `onContextMenu`, so this is
  one attribute.
- Each list card (`ExpandableListCard` root, or the `renderRow` wrapper) gets one
  carrying its `taskKey`.
- Each project card (the `<button>` in `ProjectCard`) gets one carrying
  `projectKey`.
- Each note card / row (`NoteCard` / `NoteListRow`) gets one carrying the note key.

The provider tracks the LAST hovered target before the palette opened. The source
resolves that key back to the entity (a `Map<key, entity>` it already builds for
rendering) and exposes it as `hovered`. Hover is a softer signal than `selected`:
it pre-biases SUGGESTED ("Open <hovered experiment>", "Mark <hovered list> done")
but a real `selected` outranks it.

This is the page the master flagged for prototyping hover-as-context first
("Workbench rows"). Build hover here, gate it behind the same opt-in, and treat it
as the reference for the other pages.

### 3.5 The context card contents

Empty query, the non-selectable header at the top. Format
`Workbench, <tab>[, <scope>][ + <focus line>]`:

- Projects tab: `Workbench, Projects` with sub `N projects`.
- Experiments tab, no filter: `Workbench, Experiments` sub `M in flight`.
- Experiments tab, filtered to one project: `Workbench, Experiments, filtered to
  Mitochondria QC` (this is the master's named example). For 2+ projects:
  `filtered to 3 projects`. With the Standalone pill: include `+ Standalone`.
- Notes tab, notebook open: `Workbench, Notes, Lab meeting notebook` sub
  `12 notes, shared with 2`.
- 1:1s tab, one selected: `Workbench, 1:1 with Morgan` (role-relative via
  `oneOnOneLabel`) sub `Weekly goals` (the open area).

When a popup/card is `selected`, the card gains a second line naming it ("PCR
optimization, running, day 2 of 5"), mirroring the Sequences context card's
"open sequence + live selection" two-line shape.

## 4. NAVIGATE (the strong suit)

This is the headline. BeakerSearch on Workbench must let you reach any project,
experiment, list, note, notebook, or 1:1 by name from any tab, AND switch tabs
themselves. Two NAVIGATE families: entity jumps (4.1 to 4.3) and tab jumps (4.4).

### 4.1 Per-entity fuzzy fields

| Entity | Primary label | Folded-in fuzzy fields | Row sub (detail) |
| --- | --- | --- | --- |
| Project | `name` | owner (for shared, "shared from morgan") | `8 experiments, 62% complete` |
| Experiment | `name` | project name, owner, method names (from the resolved `method_ids`) | section + freshness ("Running, day 2 of 5") |
| List task | `name` | project name, owner, sub-task titles | bucket + date signal ("Overdue 3d") |
| Note | `title` | `description` excerpt, notebook name | running-log vs single, relative `updated_at`, "shared" |
| Notebook | name | member usernames | `N notes, shared with K` or "personal" |
| 1:1 | the other person's name | the role word, the labHead/member usernames | the area / "weekly goals" |

Folding project name + organism-style fields into the fuzzy match (not just the
bare name) mirrors `SequenceNavItem.organism` in the Sequences contract: typing a
project name surfaces its experiments, typing a method name surfaces the
experiments using it.

### 4.2 Cross-tab entity jump (the key behavior)

A jump must work even when the entity lives on a tab you are NOT standing on. The
rule, in-page (no route reload):

1. If the target tab differs from `activeTab`, call `setActiveTab(targetTab)`
   first.
2. Then perform the tab-local open on the next tick:
   - Experiment -> `setSelectedTask(t)` (the `WorkbenchExperimentsPanel` state).
   - List -> `setSelectedTask(t)` (full view; do NOT depend on the inline
     accordion, which needs the card to be in the visible bucket).
   - Note -> `setSelectedNote(note)`.
   - Notebook -> `setSelection({ kind: "notebook", id })`.
   - 1:1 -> `setSelectedId(id)`.
   - Project -> `router.push(/workbench/projects/<id>[?owner=])` (a real route
     change, not a tab).

The cross-tab open is the spot the page does not wire today (each panel owns its
own `selectedTask` / `selectedNote` / `selection` / `selectedId` state, and the
panels unmount when you switch tabs). The build needs ONE of:

- (Preferred) Lift the "open intent" to the Workbench page as a small
  `pendingOpen` state `{ tab, kind, key }`, set it from BeakerSearch, switch the
  tab, and have each panel read its slice on mount (an `initialSelectedKey` prop,
  exactly like `NotesPanel`'s existing `initialNotebookId`). This reuses the
  proven deep-link-on-mount pattern the Notes tab already ships.
- (Cold fallback) Push `/workbench?tab=<t>&notebook=<id>` for notes/notebooks
  (already supported) and add symmetric `?experiment=<key>` / `?list=<key>` /
  `?oneonone=<id>` params if first-class cross-tab jumps for those are in scope.

Specify the lifted `pendingOpen` approach as the build default; it keeps the jump
instant (no reload) and reuses the `initialNotebookId` seam.

### 4.3 Composite keys preserved

Every entity NAVIGATE item carries its composite key and the jump uses it for the
owner-correct open:

- Project jump: `?owner=<owner>` appended when shared (the `openProject` rule).
- Experiment / List jump: `taskKey(t)` resolves the owner namespace so a shared
  experiment opens in the sharer's namespace, never the viewer's id-colliding own
  task. The `handleOpenTaskById` path is own-namespace only by design; the
  BeakerSearch jump must resolve the full Task object (which it already holds from
  the entity list), not re-look-up by bare id.

### 4.4 Tab jumps (navigate between the tabs themselves)

Five always-available NAVIGATE items (the 1:1 one self-hides when
`!showOneOnOneTab`):

| Item label | Action | Carries |
| --- | --- | --- |
| Go to Projects | `setActiveTab("projects")` | clears no filter |
| Go to Experiments | `setActiveTab("experiments")` | keeps `selectedProjectIds` |
| Go to Notes | `setActiveTab("notes")` | filter hidden on this tab anyway |
| Go to Lists | `setActiveTab("lists")` | keeps `selectedProjectIds` |
| Go to `<1:1 label>` | `setActiveTab("oneonone")` | only when `showOneOnOneTab` |

The 1:1 label MUST come from `oneOnOneTabLabel(isLabHead ? "lab_head" : "lab")`,
not a literal. From a COLD route (palette opened on `/gantt`), the same items push
`/workbench?tab=<t>` so the deep-link effect lands the right tab.

## 5. RESULTS ("recently opened" as the substitute)

Workbench has no saved artifacts the way Sequences has alignments / domain scans.
The master's substitute is "recently opened projects / notes". Build it as a small
client-side MRU:

- Maintain a per-user MRU list (localStorage, keyed by `currentUser`) of the last
  ~8 opened entities across all tabs. Push on every `setSelectedTask` /
  `setSelectedNote` / `openProject` / `setSelection(notebook)` / `setSelectedId`.
- RESULT rows reopen via the same cross-tab jump as 4.2, so "recently opened"
  rows behave identically to a fresh NAVIGATE, just pre-surfaced.
- Empty MRU (new user) hides the RESULTS block entirely.

Row examples: "PCR optimization (experiment, opened 2h ago)", "Lab meeting
notebook (opened yesterday)", "Mitochondria QC (project, opened Mon)".

This is intentionally lighter than a server index; it is the same "recent
reopenable outputs" slot, filled with navigation history because Workbench's
outputs ARE its entities.

## 6. COMMANDS (the long tail, grouped)

Every command points at a REAL existing handler. Grouped by intent. Selection /
filter / hover predicates (the `enabled` and `detail` echoes) follow the Sequences
`EditorCommand` shape (`run`, `enabled`, `detail`, `keywords`).

### 6.1 Create

| Command | Handler | Enabled when | Detail echo |
| --- | --- | --- | --- |
| New project | `NewProjectButton` open flow (`ProjectCreateModal` via `onCreated -> /workbench/projects/<id>`) | always | |
| New experiment | `WorkbenchExperimentsPanel.handleCreateExperiment` (sets `newTaskStartDate(null)`, `restrictedTaskType("experiment")`, `isCreatingTask(true)`; dispatches `tour:workbench-experiment-modal-opened`) | always | "in <filtered project>" when a single project filter is active |
| New list task | `WorkbenchListsPanel.handleCreateListTask` (`restrictedTaskType("list")`, `isCreatingTask(true)`) | always | |
| New note | `NotesPanel.handleCreateNote(false)` (single note) | always | "in <notebook>" when a notebook is active (the create mutation already routes to `notebooksApi.createNote` when `selection.kind === "notebook"`) |
| New running log | `NotesPanel.handleCreateNote(true)` | always | |
| New 1:1 | open `WorkbenchOneOnOnePanel` new-dialog (`setShowNewDialog(true)`) | `isLabHead` only (members cannot create) | |

The create commands route through the shared Zustand task-creation flags
(`isCreatingTask`, `restrictedTaskType`, `newTaskStartDate`), which `TaskModal`
reads. BeakerSearch sets the same flags, so the modal opens pre-scoped to the
right type with no new modal code. The `restrictedTaskType` union is
`"experiment" | "purchase" | "list" | null`; Workbench uses "experiment" and
"list" (purchases live on `/purchases`).

### 6.2 Switch tab

The five tab jumps from 4.4, also exposed as commands (so typing "experiments"
finds both the entities and the "Go to Experiments" command). Handler:
`setActiveTab(<tab>)`.

### 6.3 Filter

| Command | Handler | Notes |
| --- | --- | --- |
| Filter by project `<name>` | `useAppStore.getState().toggleProject(encodeFilterKey(p))` | one per project; the first toggle from "all" mode scopes to just that project |
| Add Standalone to filter | `toggleProject(STANDALONE_FILTER_KEY)` | surfaces orphan tasks |
| Clear project filter | `setProjectFilterMode("all")` (clears `selectedProjectIds` to `[]`) | only `enabled` when a filter is active; greyed otherwise |

Filter commands are `enabled` only on tabs that show the pills (Experiments,
Lists). On Projects / Notes / 1:1s they are hidden (the panel ignores the filter
there).

### 6.4 Open a notebook

| Command | Handler |
| --- | --- |
| Open notebook `<name>` | `NotesPanel.setSelection({ kind: "notebook", id })` (in-page) or push `/workbench?tab=notes&notebook=<id>` (cold) |
| All notes | `setSelection({ kind: "all" })` |
| Unfiled notes | `setSelection({ kind: "unfiled" })` |

### 6.5 Per-entity row actions (selection / hover aware)

These are SUGGESTED-zone commands (section 3 of the master, the page's "right next
move"), bound to the `selected` or `hovered` entity:

- Experiment selected/hovered -> "Open <name>" (`setSelectedTask`), "Add a
  comment" (`openTaskComments` -> popup with comments rail open, the existing
  right-click action). Delete is NOT a Workbench-panel action today (deletion lives
  inside `TaskDetailPopup`), so "Open it" is the jump and the popup owns delete.
- List selected/hovered -> "Open full view" (`setSelectedTask` /
  `onOpenFullView`), "Mark <name> done" (`handleToggleComplete`, which
  forward-cascades sub-tasks), "Expand inline" (`setExpandedTaskKey(tk)`). The
  complete toggle is `enabled` only when `canToggle` (`!is_shared_with_me ||
  shared_permission === "edit"`).
- Note selected/hovered -> "Open <title>" (`setSelectedNote`), "Add a comment"
  (`openNoteComments`), "Move to notebook" (`moveMenu` -> `MoveToNotebookMenu` ->
  `moveNoteMutation`), "Delete" (`handleNoteDelete`, soft-delete + 10s undo toast).
- Project hovered/selected -> "Open <name>" (`openProject`).
- 1:1 selected -> "Open <name>" (`setSelectedId`), and the area sub-tabs as
  jump-to-area commands ("Weekly goals", "Meeting notes", "Notes", "Agenda" via
  `setArea`). "Delete 1:1" only when `isLabHead` (`deleteMutation`).

## 7. `useBeakerSearchSource` implementation sketch for Workbench

One source spanning all five tabs. It reads the same query keys the page already
holds, the same store slices, and binds to the panels' real handlers. Because the
panels own their selection state, the build lifts the cross-tab "open intent" to
the page (the `pendingOpen` seam from 4.2), passed into each panel as an
`initialSelected*` prop modeled on `NotesPanel.initialNotebookId`.

```ts
// In src/app/workbench/page.tsx (or a co-located useWorkbenchBeakerSource hook).
// Reads: the SAME query keys the page/panels already use, so no extra fetch.
function useWorkbenchBeakerSource(args: {
  activeTab: TabType;
  setActiveTab: (t: TabType) => void;
  // lifted open-intent; each panel reads its slice on (re)mount
  requestOpen: (intent:
    | { tab: "experiments"; taskKey: string }
    | { tab: "lists"; taskKey: string }
    | { tab: "notes"; noteKey: string }
    | { tab: "notes"; notebookId: string }
    | { tab: "oneonone"; id: string }
  ) => void;
}) {
  const { currentUser } = useCurrentUser();
  const isLabHead = useAccountType(currentUser) === "lab_head";

  const { data: projects = [] } = useQuery({
    queryKey: ["projects", currentUser],
    queryFn: fetchAllProjectsIncludingShared,
  });
  const { data: allTasks = [] } = useQuery({
    queryKey: ["tasks", currentUser],
    queryFn: fetchAllTasksIncludingShared,
  });
  const { data: notes = [] } = useQuery({ queryKey: ["notes"], queryFn: () => notesApi.list() });
  const { data: notebooks = [] } = useQuery({
    queryKey: ["shared-notebooks", "mine"],
    queryFn: () => labApi.getSharedNotebooks(),
  });
  const { data: oneOnOnes = [] } = useQuery({
    queryKey: ["one-on-ones"],
    queryFn: () => labApi.getOneOnOnes(),
  });

  const selectedProjectIds = useAppStore((s) => s.selectedProjectIds);
  const router = useRouter();

  const experiments = useMemo(
    () => allTasks.filter((t) => t.task_type === "experiment"),
    [allTasks],
  );
  const lists = useMemo(
    () => allTasks.filter((t) => t.task_type === "list"),
    [allTasks],
  );

  const projectNameByKey = useMemo(() => {
    const m: Record<string, string> = {};
    for (const p of projects) m[`${p.owner}:${p.id}`] = p.name;
    return m;
  }, [projects]);

  // --- the four contract pieces -------------------------------------------

  const context = useCallback((): WorkbenchContext => {
    // OPEN/FOCUSED = activeTab (+ open notebook/1:1); ON SCREEN = tab + filter.
    return {
      focused: { tab: args.activeTab },
      onScreen: { tab: args.activeTab, projectFilter: selectedProjectIds },
      // selected/hovered filled by the provider's hover capture + the panels'
      // popup state (lifted alongside requestOpen).
      card: {
        title: contextHeadline(args.activeTab, selectedProjectIds, projectNameByKey),
        sub: contextSub(args.activeTab, { projects, experiments, lists, notes, oneOnOnes }),
      },
    };
  }, [args.activeTab, selectedProjectIds, projectNameByKey, projects, experiments, lists, notes, oneOnOnes]);

  const suggested = useCallback((ctx: WorkbenchContext): BeakerItem[] => {
    const out: BeakerItem[] = [];
    const single = singleProjectFilter(selectedProjectIds); // null unless exactly one real key
    switch (ctx.focused.tab) {
      case "projects":
        out.push(cmd("new-project", "New project", "plus", () => openNewProject(router, currentUser)));
        break;
      case "experiments":
        out.push(cmd("new-exp", "New experiment", "flask",
          handleCreateExperiment, single ? `in ${projectNameByKey[single]}` : undefined));
        if (ctx.hovered?.kind === "experiment")
          out.push(navOpenExperiment(ctx.hovered.task, args));
        out.push(...filterCommands(selectedProjectIds, projects)); // filter by project / clear
        break;
      case "lists":
        out.push(cmd("new-list", "New list task", "list", handleCreateListTask));
        if (ctx.hovered?.kind === "list") {
          out.push(navOpenList(ctx.hovered.task, args));
          const canToggle = !ctx.hovered.task.is_shared_with_me
            || ctx.hovered.task.shared_permission === "edit";
          out.push(cmd("toggle", `Mark ${ctx.hovered.task.name} done`, "check",
            () => handleToggleComplete(ctx.hovered!.task), undefined, canToggle));
        }
        out.push(...filterCommands(selectedProjectIds, projects));
        break;
      case "notes":
        out.push(cmd("new-note", "New note", "note", () => handleCreateNote(false),
          activeNotebookName ? `in ${activeNotebookName}` : undefined));
        out.push(cmd("new-log", "New running log", "log", () => handleCreateNote(true)));
        // "Open <notebook>" suggestions from the notebook list
        for (const nb of notebooks.slice(0, 3))
          out.push(navOpenNotebook(nb, args));
        break;
      case "oneonone":
        if (isLabHead) out.push(cmd("new-oo", "New 1:1", "userPlus", openNewOneOnOne));
        break;
    }
    return out;
  }, [/* deps */]);

  const entities = useCallback((ctx: WorkbenchContext, query: string): BeakerItem[] => {
    // Empty query: scope to the active tab (+ filter). Typed: widen to all tabs.
    const scoped = query.trim() === "";
    const items: BeakerItem[] = [];

    const projectScope = (t: { owner: string; project_id: number | null }) =>
      matchesAnyProjectFilter(t, selectedProjectIds);

    if (!scoped || ctx.focused.tab === "projects")
      for (const p of projects) items.push(navProject(p, router, currentUser));
    if (!scoped || ctx.focused.tab === "experiments")
      for (const t of experiments)
        if (!scoped || t.is_shared_with_me || projectScope(t))
          items.push(navOpenExperiment(t, args, projectNameByKey));
    if (!scoped || ctx.focused.tab === "lists")
      for (const t of lists)
        if (!scoped || projectScope(t)) items.push(navOpenList(t, args, projectNameByKey));
    if (!scoped || ctx.focused.tab === "notes") {
      for (const n of notes) items.push(navOpenNote(n, args));
      for (const nb of notebooks) items.push(navOpenNotebook(nb, args));
    }
    if (!scoped || ctx.focused.tab === "oneonone")
      for (const oo of oneOnOnes) items.push(navOpenOneOnOne(oo, args, currentUser));

    // Always include the five TAB jumps (4.4); the 1:1 one only if shown.
    items.push(...tabJumps(args.setActiveTab, { showOneOnOne: oneOnOnes.length > 0 || isLabHead }));
    return items;
  }, [/* deps */]);

  const results = useCallback((): BeakerItem[] =>
    readWorkbenchMru(currentUser).map((m) => mruToNav(m, args)), [currentUser, args]);

  const commands = useCallback((): BeakerItem[] => [
    ...createCommands(/* ... */),     // 6.1
    ...tabCommands(args.setActiveTab),// 6.2
    ...filterCommands(selectedProjectIds, projects), // 6.3
    ...notebookCommands(notebooks, args),            // 6.4
  ], [/* deps */]);

  return { context, suggested, entities, results, commands };
}
```

Notes on the sketch:

- It is a READER over the page's existing queries; no new fetch, no new
  invalidation. Mutations stay in the panels (create note, toggle complete, move
  note, delete note, delete 1:1, create project/experiment/list), and BeakerSearch
  calls those same handlers, so the existing `invalidateQueries` / `refetchQueries`
  re-rank the entity lists for free.
- The single source spans all five tabs by reading every domain's query at once.
  ENTITIES branch on `ctx.focused.tab` only to SCOPE the empty-query list; a typed
  query ignores the tab and ranks across all five families (the master's
  "collapse to one fuzzy list" rule).
- The cross-tab open (`requestOpen` / `args`) is the one new wiring the page needs.
  Model it on `NotesPanel.initialNotebookId`: a `pendingOpen` state on the page,
  set by the nav helpers, consumed by each panel on (re)mount via an
  `initialSelected*` prop, then cleared.
- `singleProjectFilter` returns the lone real composite key when exactly one
  non-standalone pill is active, used for the "in <project>" create-experiment
  detail echo.

## 8. Keyboard, states, edge cases, permissions, open questions

### 8.1 Keyboard

Inherited from the shared provider (the Sequences `CommandPalette` model): Cmd-K
(and the visible BeakerSearch pill) opens; up/down move the cursor SKIPPING
disabled and non-selectable rows (the context card is never landable); Enter runs
/ navigates / reopens based on `kind`; Escape closes and restores focus to the
opener; combobox/listbox aria. No new keyboard model, Workbench just supplies
items.

### 8.2 Empty vs typed states

- Empty query: Context card -> Suggested (tab + filter + hover aware) ->
  Entities (scoped to the active tab + filter) -> Recently opened (MRU) -> the
  page command groups (Create / Switch tab / Filter / Notebooks) -> a slim Global
  section (cross-page nav + global object search).
- Typed query: the card slims to a one-line header
  (`Workbench, Experiments, filtered to Mitochondria QC` -> one muted line);
  everything below collapses to ONE fuzzy-ranked list across commands + entities
  (all five families, tab scope dropped) + MRU + global, grouped by kind. Enter
  runs the highlighted item.

### 8.3 Edge cases

- 1:1 tab gating: never emit the 1:1 tab jump or 1:1 entities when
  `!showOneOnOneTab`. If the gate flips false while the tab is open the page
  already bounces to Projects; BeakerSearch reads the same gate so its 1:1 items
  vanish in lockstep.
- Standalone tasks: orphan experiments/lists (`project_id` null/0) only render
  when no filter is set OR the Standalone pill is on. The entity scope predicate is
  `matchesAnyProjectFilter`, which already handles the sentinel, so scoped
  empty-query lists agree with the panel.
- Shared experiments bypass the project filter (`is_shared_with_me` short-circuits
  to always-render in the panel). The entity scope mirrors this:
  `t.is_shared_with_me || projectScope(t)`. Never hide a shared card by applying
  the viewer's filter (the v4 §6.16 regression).
- Stale notebook id: a `?notebook=<id>` that no longer resolves falls back to All
  notes (the panel's `activeNotebook` resolves to null). BeakerSearch's notebook
  jump inherits this safely.
- Project id collisions: `alex:1` vs `morgan:1`. Every key is composite; the
  experiment/list jump resolves the full Task (owner-correct), not a bare-id
  lookup. The project jump appends `?owner=` for shared.
- Tab unmount: switching tabs unmounts the previous panel and its selection
  state. The cross-tab jump must therefore set the open intent BEFORE switching the
  tab (the `pendingOpen` seam), or the panel mounts with nothing selected.

### 8.4 Permissions / read-only states

- New 1:1 command: `enabled` only when `isLabHead`. A member sees the 1:1s tab
  (when in >= 1) but no create, no delete.
- List complete toggle: `enabled` only when `canToggle`
  (`!is_shared_with_me || shared_permission === "edit"`). A view-only shared list
  greys the "Mark done" suggestion.
- Note delete / move: available on owned notes; a shared-into-me note with view
  permission greys destructive actions (mirror the panel, which routes deletes
  through `notesApi.delete` against the note owner).
- Shared project sequence counts read 0 (the seam has no cross-owner read yet);
  not a BeakerSearch concern, but the project row sub should not promise a
  sequence count for a shared project.

### 8.5 Workbench-specific open questions

1. Cross-tab open seam: confirm the lifted `pendingOpen` state on the page (the
   `initialSelected*` prop per panel, modeled on `initialNotebookId`) versus adding
   `?experiment=` / `?list=` / `?oneonone=` deep-link params. The in-page seam is
   instant and proposed as the default; the params are only needed if cold deep
   links to a specific experiment/list/1:1 are wanted (they enable shareable URLs).
2. 1:1 deep-link: there is no `?oneonone=<id>` param today (the panel defaults to
   the first 1:1). Add one only if a cold jump to a specific 1:1 is in scope;
   otherwise a cold 1:1 jump lands on the tab and the first 1:1.
3. MRU storage: localStorage per `currentUser` is proposed for "recently opened".
   Confirm that is acceptable (it is client-only, survives reloads, does not touch
   the data folder) versus a heavier on-disk recent-items store.
4. Hover-as-context prototype: the master flags Workbench rows as the place to
   build hover FIRST. Confirm the opt-in `[data-beaker-target]` annotations on the
   four card families (experiment, list, project, note) land in the first
   Workbench source, so this page becomes the hover reference for Gantt / Calendar
   / Purchases.
5. Purchases overlap: purchase Tasks (`task_type === "purchase"`) are fetched into
   `["tasks", currentUser]` but rendered on `/purchases`, not Workbench. BeakerSearch
   on Workbench should NOT list purchases as entities (they have no Workbench tab);
   the global object search + the Purchases source own them. Confirm this boundary.
