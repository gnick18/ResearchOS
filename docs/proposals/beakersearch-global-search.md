# BeakerSearch global object search (defines "core")

This is the build-ready companion to the GLOBAL LAYER of
[`beakersearch-website-wide.md`](./beakersearch-website-wide.md). The master doc
fixes the architecture (one app-shell `BeakerSearchProvider`, per-page
`useBeakerSearchSource` contributors, the four context signals, the item kinds
COMMAND / NAVIGATE / RESULT / CONTEXT CARD), and it names "global object search"
as one of three always-present global sources. It does not say WHAT that source
indexes. This doc settles that.

Grant approved the approach "Core, reuse the `/search` loaders" and then asked the
one question this doc exists to answer, "what is defined as core? this needs an
entire follow-up plan just on this point." So section 1 below DEFINES core
precisely (which entity types ship in the v1 index, which are deliberately
deferred to v2, and the decision criteria that draw the line), and the rest of the
doc specifies the indexing, ranking, palette wiring, and `/search` relationship
around that boundary so a builder can wire the source without re-deriving any of
it.

This is a planning doc. It adds NO app code.

Voice in this doc and in every copy string it specifies, no em-dashes, no
en-dashes, no emojis, no mid-sentence colons. Icons are `<Icon>` names from the
verified registry (`src/components/icons/registry.tsx`), never inline SVG inside a
palette row. Reference shapes are the ones the Sequences palette already ships
(`src/components/sequences/editor-commands.ts`), so the global source produces the
same item union the provider already ranks and renders.

---

## 1. The definition of "core" (the heart of this doc)

### 1.1 What "core" means

CORE is the set of entity types whose records the global object search INDEXES and
can JUMP TO by name in v1. An entity type is core only if it clears every one of
four gates. The gates are not aesthetic; each one removes a specific class of build
risk, and together they scope the v1 build chunk to something a single source can
ship without touching page internals or inventing new data plumbing.

The four gates (an entity type is core only if ALL are true):

1. CANONICAL MERGED LOADER. A single `fetchAll<Type>IncludingShared` function
   already exists in `src/lib/local-api.ts` that returns own + shared-with-me
   records in one decorated, deduped array, with a dev-mode duplicate-key
   guardrail. This is the gate that matters most. It means the index reads ONE
   function, gets the shared overlay (`is_shared_with_me`, `owner`,
   `shared_permission`) for free, and never has to fan out per-owner reads or
   reconcile own-vs-shared by hand (the exact bug class `caa22513` and the
   `/search` comment at `local-api.ts:94` warn about).
2. HIGH TRAFFIC. The type is something a researcher reaches for by name many times
   a day, so "find it and jump" earns its slot in the always-present global layer.
3. CLEAN DEEP-LINK TARGET. There is an unambiguous route + param that OPENS the
   record on its home page (`?openTask=`, `?openMethod=`, `?seq=`,
   `/workbench/projects/<id>[?owner=]`), so a jump from any page lands on the
   record, not a bare route.
4. COMPOSITE-KEY IDENTITY. The record carries a stable `"{owner}:{id}"` identity
   (or a page-scoped id for the ownerless sequence case) so the jump opens in the
   right owner namespace and the index dedups own vs shared correctly.

### 1.2 The v1 core set (recommended)

Four entity types clear all four gates. They are exactly the set the canonical
`fetchAll*IncludingShared` loaders cover AND the set `/search` already indexes
today, which is why they are also the lowest-wiring-risk choice.

| Core type | Loader (gate 1) | High traffic (gate 2) | Deep-link (gate 3) | Composite key (gate 4) |
| --- | --- | --- | --- | --- |
| Task (experiment / list / purchase) | `fetchAllTasksIncludingShared` | yes, the most-opened record in the app | `?openTask=<key>` -> `TaskDetailPopup` | `taskKey(t)` (`self:<id>` or `<owner>:<id>`) |
| Project | `fetchAllProjectsIncludingShared` | yes, the top-level container | `/workbench/projects/<id>[?owner=]` | `${owner}:${id}` |
| Method | `fetchAllMethodsIncludingShared` | yes, reused across experiments | `?openMethod=<id>` (owner-resolved) | `${owner}:${id}` (`public:<id>` for lab-wide) |
| Sequence | `sequencesApi.list()` (see note) | yes, the editor's own jump target | `/sequences?seq=<id>` | page-scoped numeric `id`, no owner |

Note on the sequence loader gate. Sequences do NOT have a
`fetchAllSequencesIncludingShared` because sequences are PAGE-SCOPED and ownerless
(they are not in the `"{owner}:{id}"` namespace, the master doc and `types.ts`
both call this out). `sequencesApi.list()` is the canonical single read that
returns the full local set, so the spirit of gate 1 (one canonical loader, no
per-owner fan-out, no shared-overlay reconciliation) is satisfied, just with no
shared dimension to merge. Sequences are admitted to core on that basis. They are
the one core type that needs no owner in its jump key.

Task carries a sub-classification (`task_type` of `experiment` / `list` /
`purchase`). All three subtypes ride in on the single Task loader and the single
`?openTask=` deep-link, so they are ONE core type at the index level even though
they render on different pages. The result row labels the subtype (see 2.3).

### 1.3 What is DEFERRED to v2, and why

Everything below is intentionally OUT of the v1 index. Each is deferred because it
fails at least one gate, and the failing gate is named so the boundary is
unambiguous and the v2 follow-up is pre-scoped.

| Deferred type | Fails gate | Why it waits |
| --- | --- | --- |
| Note | gate 1 (no merged loader) | `notesApi.list()` returns the personal-mode list only; shared notes come through a separate notebook path. There is no `fetchAllNotesIncludingShared`. The note key is a BeakerSearch-local `note-<owner>:<id>` (the Workbench spec invents it), not a first-class composite key, so gate 4 is also soft. Notes also have NO `?openNote=` deep-link today (the Workbench source opens them via in-page `setSelectedNote`), so gate 3 fails for a cross-page jump. |
| Notebook | gates 1, 3 | `labApi.getSharedNotebooks()` is a separate read, not a merged loader; the only deep-link is `?tab=notes&notebook=<id>` which lands the rail selection, not an opened document. High value, but three gate failures. |
| Purchase item (line item) | gate 1 (partial), gate 3 | The parent purchase TASK is already core (it rides the Task loader). The individual line item has its own loader (`purchasesApi.listAllIncludingShared` does exist) but no per-item deep-link, only the parent task's `?openTask=`. So a line item is reachable today by jumping to its purchase task; a standalone "find this line item by vendor" index is v2. |
| Calendar event | gates 1, 3 | `eventsApi.list()` (`["events"]`) is a plain read, no merged-shared loader. Events deep-link by DATE (`?date=&view=`), not by an event id, so "open THIS event" has no route param. Task-linked events (`task_id`, added 2026-06-07) can be reached via the linked task, which is already core. |
| Lab link | gate 2 (marginal), gate 3 | `labLinksApi.list()` (`["lab-links"]`) is a plain read. Links open EXTERNALLY (`window.open(url)`), they have no in-app home page to land on, so gate 3 ("open it on its home page") does not really apply. A link is a bookmark, not a research record; lower traffic. |
| Lab member / researcher | gates 1, 3 | People are not in the `fetchAll*` family and have no record home page (the `/researchers` hub is a search surface, not a per-person route). Cross-boundary identity is also gated behind `SHARING_ENABLED`, dark in prod. |
| Artifact (alignment / domain scan / export) | gates 1, 2, 4 | These are per-sequence RESULT items the Sequences source already surfaces locally; there is no global artifact loader, no global id, and they are reopened in-context, not jumped to from another page. |
| One-on-one | gates 1, 3 | `labApi.getOneOnOnes()` is a plain read; no deep-link param (`?oneonone=` does not exist), the panel defaults to the first 1:1. Reachable via the Workbench source only. |

The principle that draws the line, v1 core is "the records that already have a
canonical merged loader AND a clean deep-link," because that is exactly the set the
global source can index and open with zero new page wiring. Everything deferred
needs at least a new loader, a new deep-link param, or both, which is a deliberate
v2 follow-up, not a v1 omission.

### 1.4 The boundary stated as a build rule

The v1 global-search chunk indexes Tasks, Projects, Methods, Sequences. It reads
four loaders, builds one flat index, ranks across the four, and opens each by its
existing deep-link. It adds NO new loader, NO new deep-link param, and touches NO
page component. The moment a candidate would require any of those three, it is v2.

---

## 2. The cross-app entity catalog

One row per core entity. This is the table the index builder works from. `currentUser`
is the active username from `useCurrentUser`. The composite key column is the
in-memory identity used for dedup and for carrying the owner into the jump.

### 2.1 Task (experiment / list / purchase)

| Field | Value |
| --- | --- |
| Loader | `fetchAllTasksIncludingShared()` |
| Query key | `["tasks", currentUser]` (the key `/`, `/gantt`, `/search`, `/workbench` already use) |
| Composite key | `taskKey(t)` from `lib/types.ts` -> `self:<id>` (own) or `<owner>:<id>` (shared) |
| Display name | `t.name` |
| Meta subline | `<task_type> in <project name> + <freshness>`, e.g. "Experiment in Mitochondria QC, edited 2d ago". Project name resolved from the Projects index by `${t.owner}:${t.project_id}`; orphan (null/0 project) reads "Standalone". |
| Fuzzy fields | `t.name` (primary) + project name + `t.tags.join(" ")` + owner label (for shared) |
| Destination route | `/workbench?tab=experiments&openTask=<taskKey>` for experiments/lists; `/purchases?openTask=<taskKey>` for purchases. The subtype picks the home page. |
| Deep-link params carried | `openTask=<taskKey>` (the FULL composite key, so a shared task resolves to the sharer's namespace, never the viewer's id-colliding own task) |
| Icon | `list` (experiment/list), `download` is wrong here; use `file` for a generic task; `features` for experiments if a richer glyph is wanted. Recommend `list`. |

The page-local jump (palette already on `/workbench`) prefers the in-page open
(set the panel's `selectedTask`) over a route reload, exactly as the Workbench
spec's `pendingOpen` seam describes. The route form is the COLD jump from another
page. Both carry `taskKey`.

### 2.2 Project

| Field | Value |
| --- | --- |
| Loader | `fetchAllProjectsIncludingShared()` |
| Query key | `["projects", currentUser]` |
| Composite key | `${p.owner}:${p.id}` (via `encodeFilterKey(p)` / the page's `projectKey`) |
| Display name | `p.name` |
| Meta subline | `<N experiments, K% complete>` when counts are cheap (the Workbench panel already derives them), else "Project" + "shared from <owner>" when `is_shared_with_me` |
| Fuzzy fields | `p.name` + owner label (for shared) |
| Destination route | `/workbench/projects/<p.id>` plus `?owner=<p.owner>` when `is_shared_with_me && p.owner !== currentUser` (the `openProject` rule, identical in `NewProjectButton.handleCreated`) |
| Deep-link params carried | `owner=<p.owner>` for shared; the `[id]` route reads `searchParams.get("owner")` as `ownerHint` |
| Icon | `folder` |

### 2.3 Method

| Field | Value |
| --- | --- |
| Loader | `fetchAllMethodsIncludingShared()` |
| Query key | `["methods", currentUser]` (the `/search` key; the Methods page uses bare `["methods"]`, see 3.4) |
| Composite key | `${m.owner}:${m.id}` (`public:<id>` for lab-wide / `is_public`) |
| Display name | `m.name` |
| Meta subline | `<type label> + <folder or "Uncategorized">`, e.g. "PCR, Molecular Biology". Type label from `getMethodTypeMeta(m.method_type).label`. Shared reads "shared by <owner>, read-only"; public reads "lab-wide". |
| Fuzzy fields | `m.name` + `method_type` + `m.tags.join(" ")` + `folder_path` (mirrors the page's `matchesMethodSearch`) |
| Destination route | `/methods?openMethod=<m.id>` (the existing param; resolves own-first, then `owner === "public"`, then any) |
| Deep-link params carried | `openMethod=<m.id>`. The `?openMethod` resolver is id-based and owner-priority, so it lands the right record even for a public/shared method. The page-local jump sets `viewingMethod` to the actual object (no id round-trip). |
| Icon | the method-type glyph via `getMethodTypeMeta`; fall back to `body` (markdown) or `book`. Recommend the type meta icon. |

### 2.4 Sequence

| Field | Value |
| --- | --- |
| Loader | `sequencesApi.list()` (returns `SequenceRecord[]`) |
| Query key | `["sequences"]` (the `/sequences` page key, no user suffix, sequences are local-only and ownerless) |
| Composite key | the bare numeric `id` (page-scoped, NO owner; the documented exception) |
| Display name | `s.display_name` |
| Meta subline | `<seq_type>, <length> bp[, <organism>]`, e.g. "DNA, 4,733 bp, E. coli". Topology (circular/linear) can prefix when known. |
| Fuzzy fields | `s.display_name` (primary) + `s.organism` (folded in like `SequenceNavItem.organism`, so typing a species finds the sequence) + `s.seq_type` |
| Destination route | `/sequences?seq=<s.id>` (the existing `?seq=<id>` deep-link the page's resolver reads) |
| Deep-link params carried | `seq=<s.id>` |
| Icon | `moleculeCircular` when circular, else `moleculeLinear`; generic `sequence` otherwise |

Cross-collection note. The Sequences page jump (palette already on `/sequences`)
prefers the in-page `setSelectedId(s.id)` over a route reload, matching the built
Sequences source's "Jump to a sequence" behavior. The `?seq=` route is the cold
jump from another page.

---

## 3. Indexing strategy

### 3.1 The recommendation, lazy-from-React-Query with a one-time prefetch on shell mount

The index is NOT a new store and NOT a server-side search service. It is a thin
reader over the four canonical React Query caches the app already populates. A
small global hook, `useGlobalObjectIndex()`, mounted ONCE alongside the
`BeakerSearchProvider` at the app shell, subscribes to the four canonical queries
and assembles a flat in-memory index.

```ts
// Illustrative. Lives next to BeakerSearchProvider, mounted once at the shell.
function useGlobalObjectIndex(): GlobalIndexEntry[] {
  const { currentUser } = useCurrentUser();
  const { data: tasks = [] }    = useQuery({ queryKey: ["tasks", currentUser],    queryFn: fetchAllTasksIncludingShared });
  const { data: projects = [] } = useQuery({ queryKey: ["projects", currentUser], queryFn: fetchAllProjectsIncludingShared });
  const { data: methods = [] }  = useQuery({ queryKey: ["methods", currentUser],  queryFn: fetchAllMethodsIncludingShared });
  const { data: sequences = [] }= useQuery({ queryKey: ["sequences"],             queryFn: () => sequencesApi.list() });
  return useMemo(() => buildGlobalIndex({ tasks, projects, methods, sequences, currentUser }), [...]);
}
```

The four queries reuse the SAME query keys the home/gantt/search/workbench/methods/
sequences pages already register, so on any page the user has visited, the cache is
already warm and the index is free. To make search work BEFORE the user has
visited each page, the hook prefetches the four loaders once on shell mount
(`queryClient.prefetchQuery` for each, fire-and-forget) so Cmd-K on a cold
`/calendar` still finds a task by name. The prefetch is the only proactive cost; it
is bounded and runs once per session.

This is the right call because the app is LOCAL-FIRST. Every record is a local file
read, there is no network round-trip, and the four loaders are already optimized
(the merged loaders dedup and decorate in one pass). Eager prefetch of four local
reads on shell mount is cheap, and it buys instant cross-page search.

### 3.2 The index entry shape

`buildGlobalIndex` maps each core record to a uniform entry so ranking and
rendering do not branch per type beyond the icon and the open handler.

```ts
interface GlobalIndexEntry {
  type: "task" | "project" | "method" | "sequence";
  key: string;          // composite key (taskKey / `${owner}:${id}` / sequence id as string)
  label: string;        // display name
  meta: string;         // the subline (section 2)
  haystack: string;     // label + folded fuzzy fields, precomputed lowercased
  recencyAt: number;    // last_edited_at / updated_at epoch, 0 when absent
  iconName: IconName;
  open: () => void;     // page-local in-page open OR router.push with the deep-link
  enabled: boolean;     // false => greyed (a record the user cannot open, section 7)
}
```

`haystack` is precomputed once per build so the per-keystroke fuzzy pass is a
single `fuzzyScore(query, entry.haystack)` and not a re-concatenation. The index
rebuilds only when one of the four query results changes identity (the `useMemo`
deps), which happens on the same `invalidateQueries` the pages already fire after a
write, so the index stays fresh with no bespoke invalidation. There is no separate
cache to keep in sync; the React Query cache IS the source of truth.

### 3.3 Cost

Local labs are small. Order-of-magnitude per user, tens to low-hundreds of tasks, a
handful of projects, tens of methods, tens of sequences. The flat index is a few
hundred `GlobalIndexEntry` objects, each a few precomputed strings, well under a
megabyte. The build is an O(n) map over four arrays, the per-keystroke scan is O(n)
with an early-null cutoff in `fuzzyScore`. No virtualization, no worker, no
trie needed at this scale. If a lab ever grew an order of magnitude, the first lever
is the per-type cap (4.3), not a re-architecture.

### 3.4 Staleness, invalidation, and the methods query-key seam

The index inherits the pages' freshness. Each page mutates through its existing
handlers and `invalidateQueries`/`refetchQueries` on the canonical key, which
re-runs the loader, which re-fires the index `useMemo`. No write path is added
here; the global source is read-only over the caches.

One concrete seam the builder must handle, the Methods page registers its query as
bare `["methods"]` while `/search` (and this index, following `/search`) uses
`["methods", currentUser]`. These are DIFFERENT cache entries. To avoid a
double-fetch and a stale-after-edit split, the index should read the SAME key the
Methods page writes to. Recommendation, standardize the global index on
`["methods", currentUser]` (matching `/search`, the relationship anchor) and, as a
tiny v1 follow-up, align the Methods page read to the same key OR add a thin
`invalidateQueries(["methods"])`-to-`["methods", currentUser]` bridge. Flag this in
open questions; do not silently fork the cache.

### 3.5 Shared-record dedup

The merged loaders already dedup own vs shared by composite key and carry a
dev-mode duplicate-key guardrail (`fetchAllTasksIncludingShared` logs a duplicate
composite key in dev). The index therefore trusts the loader output and keys every
entry by its composite key, so a record shared into me and also owned by me (the
`alex:1` vs `morgan:1` and the `self:2` vs `alex:2` collision classes) never
double-lists. Sequences have no shared dimension, so their numeric id is already
unique within the local set.

---

## 4. Ranking across heterogeneous types

### 4.1 Reuse `fuzzyScore`, do not invent a second scorer

The global source scores every index entry with the SAME `fuzzyScore(query,
haystack)` the Sequences palette ships, so the in-the-nose match floats up
identically whether the user is matching a command, a sequence sibling, or a
cross-app task. A task's `haystack` is its name plus project plus tags plus owner;
a method's is name plus type plus tags plus folder; a sequence's is name plus
organism plus type; a project's is name plus owner. The base relevance is the raw
fuzzy score over that haystack.

### 4.2 Type weighting and recency boost

Three adjustments on top of the raw fuzzy score, applied as small additive
nudges so a strong name match always beats a weak one regardless of type (the
fuzzy score dominates; the nudges only break near-ties).

- TYPE WEIGHT, a small per-type constant added to the score so that, for an
  otherwise equal name match, the more-opened type wins. Recommended order, Task
  (+3) > Project (+2) > Sequence (+1) > Method (+0). Rationale, a user typing a
  bare word most often wants the experiment by that name; methods are most often
  reached from within an experiment. These are tunable constants in one place.
- RECENCY BOOST, `+min(4, weeksFreshness)` derived from `recencyAt`
  (`last_edited_at` / `updated_at`), capped so a freshly-touched record edges out a
  stale same-name one without letting recency override relevance. Sequences and
  some projects have no edit stamp; they get +0.
- EXACT / PREFIX, already handled inside `fuzzyScore` (prefix +8, word-boundary
  +4). No additional exact-match rule is needed; the existing bonuses carry it.

Final score `= fuzzyScore(q, haystack) + typeWeight(type) + recencyBoost(entry)`,
entries with a null fuzzy score are dropped. Sort descending. This keeps the
ordering consistent with the existing palette scorer (same fuzzy core, same
additive-nudge philosophy as the command keyword penalty of `-2`).

### 4.3 Caps and debounce

- PER-TYPE CAP, at most 5 results per type in the merged list, so one prolific type
  cannot crowd out the others. Mirrors the spirit of `RECENT_RESULTS_CAP = 5`.
- OVERALL CAP, at most 12 global-object results shown at once (the long tail is the
  "Search everything for <query>" handoff to `/search`, section 6).
- DEBOUNCE, 120 ms on the input before re-ranking, matching a calm typing feel; the
  scan is cheap enough that this is a UX choice, not a performance need.

### 4.4 Grouping in the rendered list

In the EMPTY-query view the global source contributes nothing but a slim header
(see 5.2). In the TYPED view, global object results are grouped UNDER ONE heading
per type ("Tasks", "Projects", "Methods", "Sequences"), each capped at 5, ordered
by the per-type best score, and the group holding the single best hit leads
(reusing the existing "lead with the top hit's group" rule from
`buildPaletteResultsForQuery`). This composes cleanly with the page source's own
groups (5.4).

---

## 5. The palette wiring

### 5.1 A new global source, not a new item KIND

The global object search is a new SOURCE that contributes NAVIGATE items, it does
NOT add a new `PaletteItem` kind. Each result is a NAVIGATE item (the master's
"jump to an entity" kind), carrying the entry's `open` handler and composite key.
This is the same union the provider already renders; the global source just feeds
more NAVIGATE items into it. Concretely, the provider gains a third always-present
contributor alongside the active page source and the global nav/app-commands
source, fed by `useGlobalObjectIndex()`.

A `GlobalNavItem` shape mirrors `SequenceNavItem` (`{ id, label, detail, iconName,
onRun }`) so no renderer change is needed; `onRun` is the entry's `open`. The
`detail` is the meta subline.

### 5.2 Empty-query behavior, do NOT dump the index

On an empty query the global source shows NOTHING from the index by default.
Dumping hundreds of records into the empty palette would bury the page's Context
card and Suggested actions, which are the orienting glue. Instead the empty view
shows, in order, the page Context card, the page Suggested, the page Entities, the
page Recent results, the page command groups, then a slim Global section that
offers cross-page NAVIGATE (go to Gantt / Calendar / ...) and app commands only.

Optionally the empty global section may show a short "Recent records" list (the
last ~5 globally opened core records, a per-user MRU in `localStorage` keyed by
`currentUser`, pushed whenever a global jump fires), which is genuinely useful and
small. This is the same MRU substitute the Workbench and Methods specs adopt for
their RESULTS slot. Recommend shipping it; it makes the empty palette feel alive
without dumping the index.

### 5.3 Typed behavior, instant cross-type matches

The moment the user types, the global source ranks the whole index (4) and
contributes its capped, grouped NAVIGATE results into the single fuzzy-ranked list
the typed palette already builds. A user on `/calendar` typing "pcr opt" sees the
"PCR optimization" experiment and "qPCR master mix" method without leaving the
page, and Enter jumps to whichever is highlighted.

### 5.4 Composition with the other sources, ordering and group headings

Three contributors merge in the typed view, in this precedence so the page's own
context always leads and the global reach lives below:

1. ACTIVE PAGE SOURCE, the page's own commands + entities + recent results (its
   `useBeakerSearchSource`). Its groups print first (its on-page entities are the
   user's most likely target). For example on `/methods`, the page's own method
   entities lead; the global "Methods" group is suppressed as redundant on that
   page (see 5.5).
2. GLOBAL OBJECT SEARCH, the cross-app NAVIGATE results, grouped per type
   ("Tasks" / "Projects" / "Methods" / "Sequences"), capped per 4.3.
3. GLOBAL NAV + APP COMMANDS, "Go to <page>", "New project", "Toggle dark mode",
   etc.

Then the "Search everything for <query>" handoff row (6) sits at the very bottom of
the global section as the escape hatch to the deep faceted page.

The provider's existing "lead with the top hit's group" rule still applies WITHIN
the merged list, so the single best match across all three contributors is the
default highlight under the input regardless of which contributor produced it.

### 5.5 On-page de-duplication

When the active page is the home page of a core type, the global group for that
type is REDUNDANT with the page source's own entities. Suppress the global group
for the active page's own type to avoid showing the same method twice. Rule, the
global source receives the active page's `id` and drops the global group whose type
matches that page's primary entity (`/methods` -> drop global "Methods"; `/sequences`
-> drop global "Sequences"; `/workbench`, `/gantt`, `/purchases` all host tasks, so
drop global "Tasks" there; `/search` is never an active palette page in this sense).
The page source still surfaces those records with its richer, action-bearing rows.

### 5.6 The "Search everything for <query>" handoff row

A single always-present row at the bottom of the typed global section, label
`Search everything for "<query>"`, icon `search`, that does
`router.push(/search?keywords=<query>)` (pre-filling the `/search` keyword box; see
6 for the param contract). It is the bridge from instant find-and-jump to the deep
faceted query + bulk export. It is shown whenever the query is non-empty, even when
the inline results are empty (so "no quick match, search the deep page" is always
offered).

---

## 6. The `/search` relationship

BeakerSearch global object search and `/search` are complementary, not redundant.
The split is crisp.

BeakerSearch global object search OWNS:
- INSTANT inline find-and-jump from any page, keyboard-first, zero navigation.
- CROSS-TYPE in one ranked list (a task, a method, a sequence, a project together).
- OPEN the record on its home page via its deep-link.
- It is a verb, "take me to this thing right now."

`/search` OWNS:
- The DEEP FACETED query, the full filter set (`taskType`, `dateFrom`/`dateTo`,
  `projectKey`, `methodKey`, `methodFolder`, `completionStatus`) that the inline
  palette deliberately does not reproduce.
- BULK SELECTION + EXPORT (the select-mode multi-export to zip / combined PDF /
  save-to-disk that `/search` already ships).
- It is a workbench, "let me filter, compare, and export a SET."

THE HANDOFF, in both directions:
- BeakerSearch -> `/search`, the "Search everything for <query>" row pushes
  `/search?keywords=<query>`. The `/search` page reads `keywords` into its filter
  form on mount and runs the search, so the user lands in the deep view pre-seeded
  with what they typed. (This needs a tiny `/search` enhancement to read a
  `keywords` query param on mount; flag as a v1 wiring item, it is the only `/search`
  touch this feature requires.)
- `/search` is reached normally for the faceted/export workflow; BeakerSearch does
  not replace its entry point (the nav link and the page stay).

The two share their data SOURCE (the same four `fetchAll*` loaders and query keys),
which is why "reuse the `/search` loaders" is exactly the right framing. They
differ only in the surface, instant-jump vs faceted-export.

---

## 7. Permissions

### 7.1 Shared and read-only records

The index includes shared-with-me records (the merged loaders return them decorated
with `is_shared_with_me`, `owner`, `shared_permission`). A shared record is fully
JUMPABLE, the global source only navigates, it never mutates, so view-only access
is sufficient to open and read. The destination page (TaskDetailPopup, the method
viewer) owns the per-record write gating; BeakerSearch does not duplicate it.

### 7.2 Owner-correct opening

Every NAVIGATE item carries the composite key and uses it for the owner-correct
open, a shared task opens via `openTask=<owner>:<id>` so it resolves to the
sharer's namespace, a shared project appends `?owner=`, a public/shared method
rides the owner-priority `?openMethod=` resolver. Never open by a bare numeric id
(the `alex:1` vs `morgan:1` collision the whole composite-key discipline exists to
prevent).

### 7.3 Records the user cannot open

If a record is in the index but cannot be opened (a shared record whose owner has
since revoked, a tombstoned host), the entry's `enabled` is false, the row greys
and the keyboard cursor skips it (the provider already skips disabled rows). In
practice the merged loaders prune revoked/tombstoned shares before they reach the
index, so this is a defensive state, not a common one. The index never shows a
record the loaders excluded.

### 7.4 Sharing-dark deployments

Cross-boundary identity features are gated behind `SHARING_ENABLED` (dark in prod).
That does not affect core global search, the four core loaders return own +
folder-shared records regardless, and none of the four core types depends on the
directory/relay. Lab MEMBERS as an entity type are deferred (1.3) partly for this
reason.

---

## 8. Performance and UX

- DEBOUNCE, 120 ms (4.3). The index is in memory; the debounce is for typing calm,
  not load.
- RESULT CAPS, 5 per type, 12 overall (4.3); the long tail is the `/search` handoff.
- EMPTY STATE, no index dump; Context + Suggested + page entities + a slim global
  nav section + optional "Recent records" MRU (5.2).
- TYPED-NO-MATCH STATE, when the index yields nothing, still show the "Search
  everything for <query>" handoff row and the global nav/app commands, so the
  palette is never a dead end.
- SLOW / COLD STATE, on first shell mount before the prefetch resolves, the global
  groups simply have fewer entries; the palette never blocks on the index (the
  page source renders immediately, global results stream in as the caches fill). No
  spinner inside the palette; a missing-yet entry just is not there.
- ERROR STATE, a loader rejection leaves that type's slice empty (the `useQuery`
  error is swallowed for index purposes, the merged loaders already
  `console.warn` and degrade); the other three types still search. The palette
  never surfaces a loader error to the user.
- KEYBOARD, inherited from the shared provider, up/down skip disabled and
  non-selectable rows, Enter runs the highlighted NAVIGATE (jumps), Escape closes
  and restores focus, combobox/listbox aria. A cross-page jump that pushes a route
  closes the palette as part of `onRun`.

---

## 9. Rollout (chunked build plan) and open questions

### 9.1 Rollout

A small, self-contained build for the four-type core. Each chunk is shippable.

1. THE INDEX HOOK. Add `useGlobalObjectIndex()` + `buildGlobalIndex()` reading the
   four canonical loaders by their existing query keys, with the one-time
   shell-mount prefetch and the `GlobalIndexEntry` shape (3). Pure data, unit-
   testable without rendering (mirror the `editor-commands.ts` test posture).
2. THE GLOBAL SOURCE. Feed the index into the provider as the cross-app NAVIGATE
   contributor, with the per-type grouping, the type-weight + recency ranking (4),
   the caps, and the on-page de-dup (5.5). Reuse `fuzzyScore`. Empty-query shows
   nothing from the index (optionally the MRU).
3. THE HANDOFF. The "Search everything for <query>" row plus the tiny `/search`
   `?keywords=` reader so the deep page lands pre-seeded (6).
4. RECENT RECORDS MRU (optional, recommended). The per-user `localStorage` MRU
   pushed on every global jump, surfaced in the empty global section (5.2).

Sequences, Tasks, Projects, Methods all land together in chunk 1/2 because they
share the index shape; there is no per-type sub-rollout inside core.

### 9.2 Open questions

1. METHODS QUERY-KEY SEAM (3.4). The Methods page reads `["methods"]`, `/search`
   and this index read `["methods", currentUser]`. Confirm we standardize the
   index on `["methods", currentUser]` and align the Methods page (or bridge the
   invalidation), rather than maintaining two method caches.
2. V2 ENTITY ADDITIONS. Which deferred type lands first in v2, and what does it
   need? Notes are the highest-value deferral but need a merged loader AND an
   `?openNote=` deep-link. Recommend notes-first in v2, gated on those two pieces.
   Calendar events and links are lower value and can wait further.
3. EAGER VS LAZY, FINAL CALL. This doc recommends a one-time shell-mount prefetch
   of the four loaders (eager-once) on top of lazy React Query reads. Confirm that
   versus pure-lazy (search only finds a type after its page has been visited). The
   eager-once cost is four local reads per session; recommend taking it.
4. SHOULD `/search` AND THE PALETTE SHARE ONE RANKING MODULE? Today `/search` does
   keyword AND-includes filtering; the palette does `fuzzyScore` ranking. They are
   intentionally different (faceted filter vs instant fuzzy). Unifying them is
   possible (extract one ranking module) but not required for v1; flag whether the
   shared-module refactor is wanted before v2 grows the index, or whether the two
   stay deliberately distinct.
5. RECENT-RECORDS MRU SCOPE. Confirm `localStorage` per `currentUser` is acceptable
   for the global "Recent records" list (client-only, survives reloads, never
   touches the data folder), matching the Workbench/Methods MRU decision.
6. TYPE-WEIGHT CONSTANTS (4.2). The Task +3 / Project +2 / Sequence +1 / Method +0
   ordering is a starting guess. Confirm or tune once the source is live and the
   ranking can be felt against real data.
