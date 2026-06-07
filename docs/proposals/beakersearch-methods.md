# BeakerSearch on Methods (exhaustive interaction spec)

This is the build-ready expansion of the Methods section in
[`beakersearch-website-wide.md`](./beakersearch-website-wide.md). That master
doc fixes the architecture (one global `BeakerSearchProvider`, per-page
`useBeakerSearchSource` contributors), the four context signals (SELECTED,
HOVERED, ON SCREEN, OPEN / FOCUSED), the item kinds (COMMAND, NAVIGATE, RESULT,
CONTEXT CARD), and the global layer. This doc does NOT restate any of that. It
takes the Methods section from concept depth to a full interaction spec grounded
in the real `src/app/methods/page.tsx` and its data layer, so a builder can wire
the source object without re-reading the page.

Voice rule for this doc and any copy it specifies, no em-dashes, no en-dashes,
no emojis, no mid-sentence colons.

Reference shapes are the ones the Sequences palette already ships
(`components/sequences/editor-commands.ts`), so the Methods source produces the
same `PaletteItem` union the provider already ranks and renders. The relevant
real types are `EditorCommand` (with `id`, `label`, `group`, `iconName`,
optional `shortcut`, `run`, optional `enabled`, optional `detail`, optional
`keywords`), `SequenceNavItem` / `ArtifactNavItem` (the NAVIGATE and RESULT
analogues), and the `PaletteItem` discriminated union over `kind`. Methods adds
one conceptual wrinkle the other pages do not have, two distinct navigable
entity kinds, the user's own / shared METHODS and the static CATALOG TEMPLATES,
covered in section 4 and the open questions. It still adds no new `PaletteItem`
kind, it only supplies new items.

---

## 1. Entity model, data sources, keys

Everything below is read by `MethodsPage` today. BeakerSearch reads the SAME
React Query cache (`["methods"]`) plus the static catalog manifest the template
library already fetches, so it is always in sync with the page and costs no new
data fetch beyond the one lazy manifest read the template browser already makes.

### 1.1 Entities

| Entity | What it is | Identity in memory |
| --- | --- | --- |
| Method (own) | A `Method` the current user authored, returned by `methodsApi.list()` inside `fetchAllMethodsIncludingShared`, decorated with `owner = m.owner ?? currentUser` and `is_shared_with_me = false`. Carries `id`, `owner`, `name`, `source_path`, `method_type`, `folder_path`, `parent_method_id`, `tags`, `excerpt`, `components` (compounds only), `is_public`, `shared_with`, `created_by`, `received_from`. | composite `` `${owner}:${id}` `` (the page keys cards as `` `${m.owner}-${m.id}` `` in `renderMethodCard`). Per-user id spaces are NOT globally unique, so the id alone collides across owners. |
| Method (shared with me) | A `Method` read from `users/${entry.owner}/methods/${id}.json` via the `_shared_with_me.json` manifest, overlaid with `owner = entry.owner`, `is_shared_with_me = true`, `shared_permission = "view" \| "edit"`. Read-only unless `shared_permission === "edit"`. | same composite `` `${owner}:${id}` ``; the owner is the original author, not the current user. |
| Public (lab-wide) method | A `Method` with `is_public === true` (or `shared_with` carrying `{ username: "*" }`, see `isWholeLabShared`). Owner is effectively `"public"`. Ownerless once published, so `canModifyMethod` is false for every viewer; the only mutating affordance is `handleRetirePublicMethod` (any member may retire, confirm-gated). | `` `public:${id}` `` in practice; the deep-link resolver falls back to `m.owner === "public"`. |
| Compound method (kit) | A `Method` with `method_type === "compound"`, `source_path === null`, and an inline `components: [{ method_id, owner, ordering }]` array. Edited through `CompoundMethodBuilder`, viewed through `CompoundViewer` / `CompoundMethodTabContent`. Compounds are private-only (Q-V1 lock). | same composite `` `${owner}:${id}` ``; `findAffectedCompounds(id, owner, methods)` walks `components` to find compounds referencing a child. |
| Catalog template | A `MethodCatalogManifestEntry` from the static `/method-catalog/manifest.json` (91 entries today), NOT a `Method`. Carries `slug`, `title`, `description`, `category`, `method_type` (`CatalogMethodType`), optional `tags`, optional `source_pdf` (a bundled "kit" PDF flag). The full payload is fetched lazily per slug on use. | `slug` (globally unique, no owner). This is the second navigable entity kind and never collides with a method's composite key. |

### 1.2 Data sources (exact hooks, already on the page)

```ts
// All methods, own + public + shared-with-me, merged + decorated.
useQuery({ queryKey: ["methods"], queryFn: fetchAllMethodsIncludingShared })
//   => partitionMethodsByOwnership(methods, currentUser) => { own, shared }

// Current user (drives ownership partition + every permission check).
useQuery({ queryKey: ["users"], queryFn: usersApi.list })
//   => currentUser = userData?.current_user ?? ""

// The static catalog manifest, fetched lazily by the template browser.
fetchMethodCatalogManifest() // GET /method-catalog/manifest.json, parsed/validated
//   => MethodCatalogManifestEntry[]
```

The page's derived state BeakerSearch reuses verbatim (no recompute):

- `ownMethods` / `sharedMethods` from `partitionMethodsByOwnership`.
- `filteredOwnMethods` / `filteredSharedMethods` after `matchesMethodSearch(m, searchQuery)`.
- `ownGrouped` (by `folder_path`) / `sharedGrouped` (by owner label).
- `allFolders` (own categories + empty categories) and `existingFolders`.
- `emptyCategories` (per-user, from `localStorage["emptyMethodCategories:{currentUser}"]`).

Permissions come from `useMethodPermissions()` =>
`{ canModifyMethod(method), canReadMethod(method) }`, which wraps the unified
`canWrite(record, viewer, editSession)` (owner / lab_head-unlocked-session /
shared-with-edit). The page also uses a local `effectiveOwnerOf(method)` +
`ownerScopedMethodsApi(method)` so a shared-with-edit method's writes route to
the owner's directory; BeakerSearch MUST reuse those exact helpers for any
mutating command on a shared method.

### 1.3 Composite keys (NAVIGATE must preserve these)

- Method: `` `${method.owner}:${method.id}` `` (the page's card key uses a `-`
  separator, `` `${m.owner}-${m.id}` ``, but the logical key is owner + id).
- Catalog template: `slug` (no owner, never composite).
- Compound child reference: `` `${component.owner ?? compound.owner}:${component.method_id}` ``
  (the fallback chain `findAffectedCompounds` / `validateCompoundComponents` use).

A NAVIGATE item that opens a method MUST carry the full `{ owner, id }`, never a
bare numeric id, or a shared / public method opens in the wrong owner namespace
(the exact class of bug `fetchAllMethodsIncludingShared` and `ownerScopedMethodsApi`
were written to avoid, and which the PCR viewer's `protocolOwner = method.owner`
read guards against at the protocol-record layer). Selecting a method in
BeakerSearch sets the page's `viewingMethod` to the actual `Method` object, so
the existing `ViewMethodModal` open path stays correct and routes to the right
per-type viewer.

The deep-link `?openMethod=<id>` already exists and resolves own-first, then
`owner === "public"`, then any. A BeakerSearch jump should set `viewingMethod`
directly (it holds the object, no id round-trip needed) and only fall back to
the `?openMethod=` param when jumping from ANOTHER page via the global layer.

### 1.4 Query keys for invalidation (what each command must invalidate)

| After | Invalidate |
| --- | --- |
| Create method (modal save) | `["methods"]`. Matches `handleMethodCreated` (`refetchQueries({ queryKey: ["methods"] })`). |
| Use a catalog template (instantiate) | `["methods"]`. Matches `handleTemplateUsed` (refetch + open the created method in the viewer). |
| Rename a method | `["methods"]`. Matches `MethodNameEditor.handleSaveName` (`scopedMethodsApi.update` then refetch). |
| Edit markdown body / PDF / structured protocol | `["methods"]`. The per-type viewers each `refetchQueries({ queryKey: ["methods"] })` after their write (markdown `handleSave` re-stamps `excerpt`, PCR `handleSaveRecipe`, etc.). |
| Move method to a folder (drag-drop) | `["methods"]`. Matches `handleDrop` (`scoped.update({ folder_path })` then refetch). |
| Share / unshare (UnifiedShareDialog) | `["methods"]`. Matches every viewer's `onShared` (refetch + re-read the single record into local state). |
| Delete (simple / cascade / retire-public) | `["methods"]`. Matches `handleDelete`, `handleJustDelete`, `handleCascadeDelete`, `handleRetirePublicMethod`. |
| Wrap into a kit / convert compound to single | `["methods"]`. Matches `handleWrapped` -> `onEditCompound` and `onConvertedToChild` flows. |
| Edit compound components (builder save) | `["methods"]`. Matches `CompoundMethodBuilder onSaved` (refetch). |
| Fork a method | `["methods"]`. The fork API (`methodsApi.fork`) lands a new row in the current user's namespace; the page does not own a viewer-level fork button today (fork lives in `DeviationModal`), see section 3.5 + open question 2. |

The provider does not own the `["methods"]` cache. Each Methods COMMAND `run`
calls the same `rawMethodsApi` / `ownerScopedMethodsApi` / per-type protocol API
the page uses and invalidates `["methods"]`, so the page re-renders identically
whether the action came from a card / button or from BeakerSearch. The catalog
manifest is static (no cache key to invalidate); only the instantiated method
side-effect touches `["methods"]`.

---

## 2. Context model (the four signals on Methods)

The source's `context()` returns `{ focused?, selected?, hovered?, onScreen? }`
plus a render hint for the CONTEXT CARD.

### 2.1 OPEN / FOCUSED

There IS a single open document on Methods, unlike Purchases. FOCUSED maps to
`viewingMethod: Method | null` when a method viewer is open, OR
`editingCompound: Method | null` when the compound builder is open. When either
is set, that method is the page's identity and leads the card. When both are
null, FOCUSED falls back to the page-level frame (the library itself), surfaced
as the card's first line.

Note the page can ALSO be in a transient create / browse mode (`creating`,
`browsingTemplates`, `creatingCategory`). These are modal flows, not a focused
entity. BeakerSearch treats them as ON SCREEN state (section 2.4) that biases
Suggested, not as FOCUSED.

### 2.2 SELECTED

Methods has no row-multi-select; the strongest explicit pick is the open viewer.
So SELECTED = `viewingMethod ?? editingCompound`. When non-null it is the
strongest signal and drives the top Suggested actions ("do this to the method
I have open"). A selected compound additionally exposes `method.components`, so
component-scoped suggestions ("edit components", "convert to single") can target
it. There is no second-level "selected component" persisted at the page level
(component edit state lives inside `CompoundMethodBuilder`), so BeakerSearch
treats the open compound as the selection unit and offers "Edit components" as
the entry into the builder rather than per-component rows.

### 2.3 HOVERED / UNDER THE MOUSE

The provider tracks the last hovered `[data-beaker-target]` element app-wide. For
Methods, tag one row type so hover gives mouse-aware suggestions for free:

- The method card (`renderMethodCard`, the `onClick={() => setViewingMethod(m)}`
  div). Tag it `data-beaker-target` with a payload key
  `` `method:${m.owner}:${m.id}` ``. This covers both sections (My Methods and
  Shared with Lab) because both render through the same `renderMethodCard`.

Optionally tag the catalog cards inside `MethodTemplateLibraryModal` with
`` `template:${entry.slug}` `` so a hovered template can be promoted to "Use
this template" while browsing. Because that surface is a modal, hover-as-context
there is lower value than on the main library grid; the open questions flag it as
a second-phase opt-in.

When the palette opens with no SELECTED (no open viewer) but a hovered method
card, that hovered method is promoted to the same Suggested treatment as a
selection, with a softer card line ("Pointing at 'qPCR master mix'"). Methods is
a good early hover prototype because the cards are already discrete, clickable,
and uniform across both sections (the master doc's "prototype hover on one
surface first" guidance).

### 2.4 ON SCREEN

ON SCREEN = the live search query plus which surface the user is looking at:

- `searchQuery`, the cross-section live filter (drives `filteredOwnMethods` /
  `filteredSharedMethods`). When non-empty, BeakerSearch's empty-query ENTITIES
  should respect it (show the same filtered set first).
- Which surface is active, the main library (default), the template browser
  (`browsingTemplates === true`), the create-method modal (`creating === true`),
  or the create-category modal (`creatingCategory === true`).
- The visible-method counts after the search filter (`filteredOwnMethods.length`,
  `filteredSharedMethods.length`) and the category count (`allFolders.length`).

Methods has NO persistent method-type or category FILTER state the way Purchases
has `categoryFilter` / `orderStatusFilter`. The page filters ONLY by the
free-text `searchQuery`, which `matchesMethodSearch` runs over name + type +
tags + folder. This is a grounding correction to the master doc's "switch the
type filter" language, there is no type-filter state to switch today; a
"filter by type" command would either (a) push a `method_type:` token into
`searchQuery` so the existing `matchesMethodSearch` does the work, or (b) be a
NEW lightweight type-facet the source owns. The spec below picks (a) to avoid new
page state, and flags (b) as open question 3.

ON SCREEN scopes ENTITIES (empty-query jump list is the currently visible
methods first, honoring `searchQuery`) and biases Suggested (e.g. while
`browsingTemplates` is open, Suggested leads with template-use actions).

### 2.5 The CONTEXT CARD contents

The card is non-selectable. Its lines, computed from the signals above:

- Line 1 (FOCUSED + ON SCREEN), the scope and snapshot:
  `Method Library, 14 of yours, 6 shared` (own + shared visible counts), or while
  searching `Method Library, "qpcr" matches 3`. While the template browser is
  open it reads `Template library, 91 protocols`.
- Line 2 (SELECTED / FOCUSED), when a method viewer is open:
  `Open, "qPCR master mix" - PCR - Molecular Biology` (name + type label from
  `getMethodTypeMeta(m.method_type).label` + `folder_path` or "Uncategorized").
  A compound reads `Open, "RNA-seq kit" - Kit - 4 components`. A shared / public
  method appends a read-only hint, `read-only, shared by alex` or
  `read-only, lab-wide`.
- Line 2 alt (HOVERED, no open viewer): `Pointing at "Plate layout 96-well"`.
- Line 3 (provenance, only when the open method has `received_from`):
  `Received from alex@lab.org, verified` (mirrors `ReceivedFromBadge`). This is
  the only provenance card line and self-hides on native methods.

While the query is typed, the card collapses to its one-line header
(`Method Library, "qpcr" matches 3`) exactly like the Sequences card slims.

---

## 3. SUGGESTED (contextual + permission-aware)

Suggested items are COMMANDs (kind `"command"`) with the focused method echoed in
the row's `detail`, identical to how Sequences echoes "from 612..632". Each lists
its exact real handler, its `enabled` predicate, and the row echo. Ranking
follows the master priority, SELECTED > HOVERED > ON SCREEN > FOCUSED.

### 3.1 The permission split (applies to every method command)

Write and destructive actions are gated exactly the way the page gates them, via
`useMethodPermissions().canModifyMethod(method)` (the unified
`canWrite(record, viewer, editSession)`). There are three permission tiers:

- OWN method, `canModifyMethod === true`, writes go to the current user's dir
  (`ownerScopedMethodsApi` returns the unscoped owner = `undefined`).
- SHARED-WITH-EDIT, `is_shared_with_me === true && shared_permission === "edit"`,
  `canModifyMethod === true`, but every write MUST route through
  `ownerScopedMethodsApi(method)` so it lands in the owner's directory
  (`effectiveOwnerOf(method) === method.owner`). Delete is intentionally NOT
  owner-routed (only the original owner can destroy the file), so a
  shared-with-edit receiver gets Edit but not Delete.
- READ-ONLY, shared-with-view OR public OR no write grant, `canModifyMethod ===
  false`. The only mutating affordance is, for a PUBLIC method, the
  confirm-gated `handleRetirePublicMethod` (any member may retire). For a
  shared-with-view method there is no write at all; Suggested offers read + fork
  + copy-style actions only.

BeakerSearch sets `enabled: canModifyMethod(method)` on every write command and
puts the reason in `detail` ("Read-only, shared by alex" or "Lab-wide method,
only retire is available"). The retire-public command is a SEPARATE row,
`enabled` only when `method.is_public`.

### 3.2 A method SELECTED or HOVERED (the open / pointed-at method)

Let `m` be the selected (open viewer) or hovered method, and
`scoped = ownerScopedMethodsApi(m)`.

| Suggested label | When shown | Handler | `enabled` | Row echo (`detail`) |
| --- | --- | --- | --- | --- |
| `Open "{m.name}"` | hovered, not already open | `setViewingMethod(m)` (routes to the per-type viewer in `ViewMethodModal`) | always (read allowed for shared / public) | type label + folder |
| `Edit "{m.name}"` | always | open the viewer in edit mode (`setViewingMethod(m)`, the markdown viewer's `setEditing(true)`; structured types open their own editor; the call is the viewer's existing Edit affordance) | `canModifyMethod(m)` | "opens the editor" or the read-only reason |
| `Rename "{m.name}"` | always | `scoped.update(m.id, { name })` via an inline rename step (mirrors `MethodNameEditor.handleSaveName`), then invalidate `["methods"]` | `canModifyMethod(m)` | current name |
| `Move "{m.name}" to a category` | own / shared-edit | follow-on category picker (NAVIGATE sub-list over `existingFolders` + "Uncategorized"), then `scoped.update(m.id, { folder_path })` + invalidate `["methods"]` (mirrors `handleDrop`) | `canModifyMethod(m) && !isSharedMethod(m, currentUser)` (shared methods are non-draggable today) | current folder |
| `Fork "{m.name}" into my library` | always (the canonical move for a read-only / public / shared method) | `scoped.fork(m.id, { new_name, new_source_path, deviations })` (lands a copy in the current user's namespace, `parent_method_id = m.id`, `is_public = false`), then invalidate `["methods"]` | always (fork is "make my own copy", allowed even when read-only) | "copies it to your library" |
| `Extend "{m.name}" into a kit` | own, non-compound (`m.method_type !== "compound"`) | `WrapAsCompoundAction` -> `methodsApi.wrapAsCompound(m.id, ...)`, then open `CompoundMethodBuilder` on the new compound | `canModifyMethod(m) && m.method_type !== "compound"` | "wraps it as the first component" |
| `Edit components of "{m.name}"` | selected compound (`m.method_type === "compound"`) | `setEditingCompound(m)` (opens `CompoundMethodBuilder`) | `canModifyMethod(m)` | "{n} components" |
| `Convert "{m.name}" back to a single method` | compound with <= 1 component | `ConvertCompoundToSingleAction` on the compound, then navigate to the surviving child | `canModifyMethod(m) && m.method_type === "compound" && (m.components?.length ?? 0) <= 1` | "removes the kit wrapper" |
| `Share / unshare "{m.name}"` | own (`!m.is_shared_with_me`) | open `UnifiedShareDialog` (`target: { kind: "method", method: m, owner }`); the page's Public / Private pill | `canModifyMethod(m) && !m.is_shared_with_me` | current state (`isWholeLab ? "Public" : "Private"`) |
| `Delete "{m.name}"` | own (and shared-edit is excluded from delete) | `handleDelete(m.id)` (keeps the compound-aware `DeleteMethodConfirm` branch + the per-type protocol cascade + `confirm()`) | `canModifyMethod(m) && !m.is_shared_with_me` | "removes the method and its files" |
| `Retire "{m.name}" from the lab` | public only (`m.is_public`) | `handleRetirePublicMethod(m)` (strong `confirm()` naming the lab-wide impact) | `m.is_public` | "removes it for everyone, cannot be undone" |
| `Add an experiment with "{m.name}"` | always | OUT OF SCOPE for v1, the methods page has no create-experiment handler (the experiments sidebar is read-only here); flag in open questions | n/a | n/a |

When the selected method is a compound, collapse the per-component rows into
"Edit components" plus "Convert to single" (when eligible), so Suggested never
balloons. The Edit vs Rename split mirrors the viewer, Rename is the
`MethodNameEditor` inline path (no full editor), Edit opens the type-appropriate
body / protocol editor.

### 3.3 A catalog template HOVERED (while browsing the template library)

When `browsingTemplates === true` (or a `template:` hover key is present), let
`entry` be the hovered `MethodCatalogManifestEntry`.

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Use "{entry.title}" template` | `fetchMethodCatalogTemplate(entry.slug)` then `instantiateMethodFromTemplate(template, { folderPath: destFolder })`, then `handleTemplateUsed(created)` (refetch `["methods"]`, close the browser, open the new method) | always |
| `Use "{entry.title}" into a category` | same as above with a follow-on category picker setting `folderPath` (over `existingFolders`) | always |
| `Preview "{entry.title}"` | open the template's detail pane in `MethodTemplateLibraryModal` (the modal's `handleOpenTemplate(entry)`) | always |

Instantiation lands an OWNED method (current user's namespace), so there is no
permission gate, every template is usable by every user. A compound template
(`entry.method_type === "compound"`) recurses its child slugs during
instantiation (handled inside `instantiateMethodFromTemplate`); BeakerSearch does
not special-case it beyond the row label noting "kit, {n} components" when the
detail is known.

### 3.4 The template browser open, nothing hovered

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `Browse by category` | scroll / filter the modal's category list (no page-state change) | always |
| `Close the template library` | `setBrowsingTemplates(false)` | always |
| `New blank method instead` | `setBrowsingTemplates(false)` then `setCreating(true)` | always |

### 3.5 Nothing selected, no hover, main library

| Suggested label | Handler | `enabled` |
| --- | --- | --- |
| `New method` | `setCreating(true)` (opens `CreateMethodModal`) | always |
| `Browse the template library` | `setBrowsingTemplates(true)` (opens `MethodTemplateLibraryModal`) | always |
| `New category` | `setCreatingCategory(true)` (opens `CreateCategoryModal`) | always |
| `Publish a new lab-wide method` | `setCreating(true) + setForceWholeLabOnCreate(true)` (the `?createMethod=public` deep-link path, whole-lab sharing pre-selected) | always |
| `New compound method (kit)` | OUT OF SCOPE as a standalone entry today, the page only creates a compound by wrapping an existing method (`wrapAsCompound`) or via a compound catalog template; flag in open questions. The honest Suggested row is `Extend a method into a kit` once a method is selected, or `Use a kit template` in the browser. | n/a |

When the user has zero own methods (`filteredOwnMethods.length === 0 &&
allFolders.length === 0`), Suggested shows only `New method` + `Browse the
template library`, mirroring the page's empty-state CTA.

The fork affordance lives in Suggested 3.2 (per-method), not here, because fork
targets a specific source method. The page has no standalone "fork" entry point
on the library frame; the viewer-context fork in section 3.2 is the BeakerSearch
generalization of `DeviationModal.handleForkMethod` (`methodsApi.fork`), surfaced
on the open / hovered method.

---

## 4. NAVIGATE (two entity kinds to jump to)

NAVIGATE items reuse the `SequenceNavItem` `{ id, label, detail, iconName }`
shape (or a small `MethodNavItem` / `TemplateNavItem` variant if the builder
prefers explicit types). Methods is the one page with TWO navigable entity kinds,
the user's METHODS and the static catalog TEMPLATES, kept visually distinct by an
iconName (the method-type icon vs the template-library glyph) and a group header.
Selecting a method opens its viewer in place; selecting a template opens the
template browser focused on it.

Empty query, the list is the on-screen methods first (the visible
`filteredOwnMethods` then `filteredSharedMethods`, honoring `searchQuery`), then
widens to ALL methods as the user types, then the catalog templates below.

| NAVIGATE target | Effect | Carries |
| --- | --- | --- |
| A method by name | `setViewingMethod(method)` (opens the per-type viewer) | `{ owner, id }`, so a shared / public method opens in the right namespace |
| A method by type | filter to that `method_type` by pushing a `method_type:`-style token into `searchQuery` (uses the existing `matchesMethodSearch`), or scroll to the first method of that type | the `MethodTypeId` |
| A category (folder) | scroll to / highlight the `allFolders` group; no persistent filter state exists, so this is a scroll-to-section, not a filter set | the folder string |
| A catalog template by name | `setBrowsingTemplates(true)` then focus the modal on `entry.slug` (the modal's `handleOpenTemplate`) | `slug` |
| The template library | `setBrowsingTemplates(true)` | none |
| A shared-by owner group | scroll to that owner's group in the Shared with Lab section | the owner label |

Detail (sub) lines, a method nav row reads
`PCR - Molecular Biology - 3 tags` (type label + folder + tag count); a shared
method reads `shared by alex - read-only`; a public method reads `lab-wide`; a
template row reads `Template, PCR - Molecular biology` (or `Template, Kit, 4
components`). Fuzzy match runs over label + detail just like
`scoreSequenceNav`, AND mirrors the page's own `matchesMethodSearch` (name +
method_type + tags + folder), so typing a type ("pcr"), a tag, an organism in a
name, or a category surfaces the matching methods. Templates fuzzy-match over
`title + description + category + tags`.

The two kinds are grouped under distinct headers ("Your methods" /
"Template library") in the empty-query view; in the typed view they collapse into
the single fuzzy list but keep the iconName cue so a user can tell a template
("Use") from a method ("Open").

---

## 5. RESULTS (recently opened / edited methods)

Methods, like Gantt and Workbench, produces NO throwaway computed artifact the
way Sequences produces an alignment or a domain scan. There is no report, no
export, no generated view to reopen. So the master doc's RESULT slot maps to
"recently opened / edited methods" as the reopenable substitute, the same
substitution the Gantt section makes ("Recently edited tasks").

What a Methods RESULT is:

- A small in-memory MRU list (kept by the source, capped at ~6) of the methods
  the user most recently opened (`setViewingMethod`) or mutated (rename, edit
  body, save recipe, instantiate from a template). Each entry stores
  `{ owner, id, name, method_type, lastTouchedAt }`, never the file body.
- Surfaced under "Recent methods" as
  `qPCR master mix - PCR - opened 2m ago` with an "Open" hint.
- Reopening re-runs `setViewingMethod` on the live `Method` object resolved from
  the `["methods"]` cache by `{ owner, id }` (so a since-deleted method drops out
  gracefully, the resolve returns nothing and the row is pruned).

This is honest, there is no persisted artifact to fabricate; the MRU is the
freshest reopenable signal the page actually has, and it costs only an in-memory
list updated on the same handlers the commands already call. A freshly
instantiated catalog template is a natural first MRU entry (the page already
opens it via `handleTemplateUsed`), so "Recent methods" doubles as "the template
I just used".

Why not a reopenable "diff" or "version" result, the methods page itself does not
expose version history (notes VC is a separate surface); pulling VC into
BeakerSearch here would be new scope, flagged in open question 5.

---

## 6. COMMANDS (the full long tail, grouped)

These are the page's complete command set, the `commands()` half of the contract.
Groups print in a fixed order (mirroring `CommandGroup` on Sequences). Every row
lists its real handler and permission gate.

### Create
- `New method` -> `setCreating(true)` (`CreateMethodModal`). Always.
- `New method in {category}` -> `setPrefilledFolder(folder) + setCreating(true)` (the empty-folder "+ Add Method" path). Per existing `existingFolders`.
- `New category` -> `setCreatingCategory(true)` (`CreateCategoryModal`). Always.
- `Publish a lab-wide method` -> `setCreating(true) + setForceWholeLabOnCreate(true)`. Always.

### Templates
- `Browse the template library` -> `setBrowsingTemplates(true)` (`MethodTemplateLibraryModal`). Always.
- `Use a template` -> open the browser; on a chosen `entry`, `fetchMethodCatalogTemplate(entry.slug)` -> `instantiateMethodFromTemplate(template, { folderPath })` -> `handleTemplateUsed(created)`. Always.
- `Use a template into {category}` -> same with `folderPath` preset. Always.

### Open / edit
- `Open a method` -> `setViewingMethod(method)`. Read allowed for shared / public.
- `Edit a method` -> open the viewer in edit mode (markdown `setEditing(true)`, structured types open their editor). `canModifyMethod(m)`.
- `Rename a method` -> `ownerScopedMethodsApi(m).update(m.id, { name })` + invalidate `["methods"]`. `canModifyMethod(m)`.
- `Move a method to a category` -> `ownerScopedMethodsApi(m).update(m.id, { folder_path })` + invalidate. `canModifyMethod(m)` and not shared (non-draggable).

### Kits (compound)
- `Extend a method into a kit` -> `methodsApi.wrapAsCompound(m.id, ...)` then open `CompoundMethodBuilder`. `canModifyMethod(m) && m.method_type !== "compound"`.
- `Edit kit components` -> `setEditingCompound(compound)`. `canModifyMethod(m) && m.method_type === "compound"`.
- `Convert a kit back to a single method` -> `ConvertCompoundToSingleAction`. `canModifyMethod(m) && components.length <= 1`.

### Share
- `Share / unshare a method` -> open `UnifiedShareDialog` (`{ kind: "method", method, owner }`). `canModifyMethod(m) && !m.is_shared_with_me`.

### Copy
- `Fork a method into my library` -> `ownerScopedMethodsApi(m).fork(m.id, { new_name, new_source_path, deviations })` + invalidate `["methods"]`. Always (the "make my own copy" path, allowed even on read-only / public / shared).

### Delete
- `Delete a method` -> `handleDelete(id)` (compound-aware `DeleteMethodConfirm` + per-type protocol cascade `deleteOneMethod` + `confirm()`). `canModifyMethod(m) && !m.is_shared_with_me`.
- `Retire a lab-wide method` -> `handleRetirePublicMethod(m)` (strong `confirm()`). `m.is_public` (any member).

### Find / filter
- `Search methods for {query}` -> set `searchQuery` (drives `matchesMethodSearch` across both sections). Always.
- `Filter to {type}` -> push a `method_type` token into `searchQuery` (no dedicated filter state exists). Always. See open question 3.
- `Clear the search` -> `setSearchQuery("")`. `enabled` when `searchQuery` non-empty.

The fork command sits in its own "Copy" group because it is the universal move
for read-only methods and should be discoverable in the typed long-tail search,
not only on a selected method. The retire-public command is the only mutating
action a member can run on an ownerless public method.

---

## 7. `useBeakerSearchSource` implementation sketch

The page calls one hook. It reads the same `["methods"]` cache the page already
holds (so this hook lives inside `MethodsPage` or a colocated
`useMethodsBeakerSource()` that takes the page's already-fetched data + setters
as input, to avoid a second fetch). The catalog manifest is fetched once lazily
(reusing `fetchMethodCatalogManifest`) and memoized. Types are illustrative;
`PaletteCommand` is the page's local alias for the provider's `EditorCommand`,
and `MethodNavItem` / `TemplateNavItem` reuse `SequenceNavItem`'s field shape.

```ts
function useMethodsBeakerSource(args: {
  // already-fetched page state + setters
  methods: Method[];                 // from ["methods"]
  ownMethods: Method[];
  sharedMethods: Method[];
  filteredOwnMethods: Method[];      // the on-screen list (searchQuery applied)
  filteredSharedMethods: Method[];
  allFolders: string[];
  existingFolders: string[];
  searchQuery: string;
  setSearchQuery: (q: string) => void;
  viewingMethod: Method | null;
  editingCompound: Method | null;
  setViewingMethod: (m: Method | null) => void;
  setEditingCompound: (m: Method | null) => void;
  setCreating: (b: boolean) => void;
  setCreatingCategory: (b: boolean) => void;
  setBrowsingTemplates: (b: boolean) => void;
  setForceWholeLabOnCreate: (b: boolean) => void;
  setPrefilledFolder: (f: string) => void;
  handleDelete: (id: number) => void;            // compound-aware delete
  handleRetirePublicMethod: (m: Method) => void;
  currentUser: string;
  hoveredKey: string | null;                     // from [data-beaker-target]
  recentMethods: Array<{ owner: string; id: number; name: string;
                         method_type: MethodTypeId; lastTouchedAt: number }>;
}): BeakerSearchSource {
  const queryClient = useQueryClient();
  const { canModifyMethod } = useMethodPermissions();
  const catalog = useCatalogManifest();           // memoized fetchMethodCatalogManifest

  const scopedFor = (m: Method) => ownerScopedMethodsApi(m);
  const isShared = (m: Method) => isSharedMethod(m, args.currentUser);

  // helpers that wrap the real handlers + invalidation
  const rename = (m: Method, name: string) =>
    scopedFor(m).update(m.id, { name }).then(() =>
      queryClient.invalidateQueries({ queryKey: ["methods"] }));

  const move = (m: Method, folder: string) =>
    scopedFor(m)
      .update(m.id, { folder_path: folder === "Uncategorized" ? null : folder })
      .then(() => queryClient.invalidateQueries({ queryKey: ["methods"] }));

  const fork = (m: Method) =>
    scopedFor(m)
      .fork(m.id, {
        new_name: `${m.name} (copy)`,
        new_source_path: deriveForkSourcePath(m),  // mirrors DeviationModal
        deviations: "",
      })
      .then(() => queryClient.invalidateQueries({ queryKey: ["methods"] }));

  const useTemplate = async (slug: string, folderPath?: string) => {
    const template = await fetchMethodCatalogTemplate(slug);
    const created = await instantiateMethodFromTemplate(template, { folderPath });
    await queryClient.refetchQueries({ queryKey: ["methods"] });
    args.setBrowsingTemplates(false);
    args.setViewingMethod(created);                // == handleTemplateUsed
    return created;
  };

  return {
    id: "methods",

    context() {
      const open = args.viewingMethod ?? args.editingCompound;
      const hovered = !open && args.hoveredKey?.startsWith("method:")
        ? args.methods.find(m => `method:${m.owner}:${m.id}` === args.hoveredKey)
        : undefined;
      const hoveredTemplate = !open && args.hoveredKey?.startsWith("template:")
        ? catalog?.find(e => `template:${e.slug}` === args.hoveredKey)
        : undefined;
      return {
        focused: open ? { kind: "method", method: open } : { kind: "page", label: "Method Library" },
        selected: open ? { kind: "method", method: open } : undefined,
        hovered: hovered ? { kind: "method", method: hovered }
               : hoveredTemplate ? { kind: "template", entry: hoveredTemplate }
               : undefined,
        onScreen: {
          searchQuery: args.searchQuery,
          ownVisible: args.filteredOwnMethods.length,
          sharedVisible: args.filteredSharedMethods.length,
          categories: args.allFolders.length,
          browsingTemplates: /* the page's browsingTemplates flag */ false,
        },
        cardHint: buildMethodsCardLines(/* signals above */),
      };
    },

    suggested(ctx) {
      const focus = ctx.selected ?? ctx.hovered;            // SELECTED beats HOVERED
      if (focus?.kind === "template") return suggestForTemplate(focus.entry); // 3.3
      if (focus?.kind === "method")  return suggestForMethod(focus.method);   // 3.2
      if (ctx.onScreen.browsingTemplates) return suggestTemplateBrowser();    // 3.4
      return suggestNothingSelected();                                        // 3.5
    },

    entities(ctx, query) {
      const methodBase = query
        ? args.methods                                        // widen on typing
        : [...args.filteredOwnMethods, ...args.filteredSharedMethods]; // on-screen first
      return [
        ...methodBase.map(toMethodNavItem),                   // carries { owner, id }
        ...(catalog ?? []).map(toTemplateNavItem),            // carries slug
      ];
    },

    results() {
      return args.recentMethods
        .map(r => args.methods.find(m => m.owner === r.owner && m.id === r.id))
        .filter(Boolean)
        .map(toRecentMethodResultItem);                       // section 5
    },

    commands() {
      return methodsCommandSet(args);                         // section 6, full long tail
    },
  };
}
```

Permission gating is centralized, `suggestForMethod` sets
`enabled: canModifyMethod(m)` on writes, `enabled: canModifyMethod(m) && !m.is_shared_with_me`
on delete + share (matching the viewer, which hides Share / Delete for shared
records and never owner-routes delete), `enabled: m.is_public` on retire, and
leaves fork ungated (the universal copy). Every mutating `run` routes through
`ownerScopedMethodsApi` for shared-with-edit correctness and invalidates
`["methods"]`. The template branch never gates (instantiation always lands an
owned method). The provider handles ranking, rendering, keyboard, and merging
with the global layer.

---

## 8. Keyboard, states, edge cases, open questions

### Keyboard
Inherits the shared model, up / down skipping disabled (greyed read-only Edit /
Delete / Share rows on shared and public methods) and non-selectable (the context
card), Enter runs / navigates / reopens the highlighted item, Escape closes,
focus trap + restore, combobox / listbox aria. No Methods-specific shortcuts
beyond what the rows carry in `shortcut`. One nuance, a NAVIGATE to a template
(`Use`) and a NAVIGATE to a method (`Open`) both resolve on Enter, but they open
different surfaces (the template browser vs the method viewer); the iconName cue
keeps them distinguishable in the list.

### Empty vs typed
- Empty query, CONTEXT CARD (section 2.5), then SUGGESTED (3), then on-screen
  methods as ENTITIES (grouped "Your methods" / "Template library", section 4),
  then Recent methods (5), then the grouped COMMANDS (6), then the slim global
  section.
- Typed query, card slims to one line, everything collapses into one fuzzy list
  over commands + method / template entities + recent methods + global, grouped
  by kind. Typing a method type ("pcr"), a tag, a category, or a word in a name
  surfaces matching methods (via the `matchesMethodSearch`-mirrored scorer) and
  matching templates (title + description + category + tags).

### Empty states
- No methods at all of the user's own AND none shared (`ownSectionIsEmpty &&
  sharedSectionIsEmpty`), Suggested shows only `New method` + `Browse the
  template library`, the method ENTITIES list is empty (templates still list),
  and the card reads `Method Library, no methods yet, 91 templates available`.
  Mirrors the page's "No methods yet" empty block.
- Search matches nothing (`filteredOwnMethods` and `filteredSharedMethods` both
  empty but methods exist), the card shows the global counts, ENTITIES widens to
  ALL methods (ignoring the empty search) so the user can still jump, and
  Suggested offers `Clear the search`.

### Edge cases
- Shared (with-edit) method, Edit / Rename / Move are enabled but route through
  `ownerScopedMethodsApi` (write to the owner's dir); Delete is hidden (only the
  owner can destroy the file). Built from the merged `fetchAllMethodsIncludingShared`
  list so a shared method never double-lists (the loader already overlays
  `is_shared_with_me` and skips tombstoned owners).
- Shared (with-view) / public method, all writes greyed; Fork and Open stay
  enabled; for a public method the only write is the confirm-gated Retire row.
- Public method by a since-deleted author (the ghost case), `fetchAllMethodsIncludingShared`
  already skips tombstoned shared-in owners, but a PUBLIC ghost method still
  lists; the Retire row is exactly how the page lets any member remove it, so
  BeakerSearch surfaces it.
- Compound method, Suggested offers Edit components + (when <= 1 child) Convert
  to single, not per-component rows; the card line counts `components.length`.
- Method with a missing `source_path` / file, Open still works (the viewer shows
  its own "Method file not found" state); BeakerSearch does not pre-validate the
  file, it just sets `viewingMethod`.
- Provenance, a method with `received_from` shows the verified-sender card line
  and is otherwise treated as an own method (the receiver materialized a copy);
  it is the user's to edit / re-share unless `is_shared_with_me`.
- Type taxonomy, `getMethodTypeMeta(m.method_type)` is the single source for the
  type label / icon / color in both the card line and nav detail; a null /
  legacy `method_type` falls back to the Markdown meta (the registry default),
  so an un-typed legacy method still renders a sane badge.

### Permissions summary
- OWN method, every command (create / edit / rename / move / share / delete /
  fork / extend-into-kit).
- SHARED-WITH-EDIT, Edit / Rename / Move (owner-routed) + Fork + Open; NO Delete,
  NO Share.
- SHARED-WITH-VIEW, Open + Fork only.
- PUBLIC (any member), Open + Fork + Retire-from-lab (confirm-gated); no per-user
  edit (ownerless).

### Methods-specific open questions
1. Two navigable entity kinds. Methods is the only page that lists BOTH owned
   entities (methods) and a static catalog (templates) in NAVIGATE. The spec
   groups them under separate headers with distinct icons. Confirm that two
   kinds in one source is acceptable, or whether the catalog should be a
   SEPARATE global source ("Templates") that any page can reach, since templates
   are page-independent. The current spec keeps them in the Methods source
   because the use-template side-effect (instantiate + open) is Methods-page
   behavior.
2. No viewer-level fork button exists today. Fork lives in `DeviationModal`
   (`methodsApi.fork` from an experiment context). Surfacing Fork in
   BeakerSearch on the open / hovered method needs a `new_source_path` derivation
   for the markdown case (a fresh `methods/<slug>/<slug>.md` path) and is a no-op
   for structured types whose `source_path` is a `pcr://protocol/{id}`-style ref
   (the fork copies the row, not the protocol record). Confirm fork should be a
   first-class library action or stay experiment-scoped.
3. No persistent type / category FILTER state exists. The page filters only by
   the free-text `searchQuery`. "Filter to {type}" is implemented by pushing a
   token into `searchQuery` (so `matchesMethodSearch` does the work) rather than
   adding new filter state. If a real faceted type filter is wanted, it is new
   page state the source would own; flagged rather than built.
4. "New compound method" as a standalone entry. The page has no direct
   create-compound path; a kit is born only by wrapping an existing method
   (`wrapAsCompound`) or instantiating a compound catalog template. Suggested
   reflects that (Extend-into-kit / Use-a-kit-template), not a phantom "new
   compound" button. Confirm that matches intent or whether a direct
   create-compound entry should be added to the page first.
5. RESULTS as version history. Methods has no in-page version control surface
   (notes VC is separate), so RESULT maps to a recently-opened MRU rather than a
   reopenable diff. If method version history lands, "recent method versions"
   could become a richer RESULT; out of scope for v1.
6. HOVERED-as-context depends on tagging the `renderMethodCard` div with
   `[data-beaker-target]` (one tag covers both library sections). Worth
   prototyping on the main grid first (discrete, already clickable) before the
   denser template-browser cards, matching the master doc's "prototype hover on
   one surface first" caution.
7. Add-experiment-from-a-method is OUT OF SCOPE. The methods page's experiments
   sidebar is read-only (it lists experiments USING a method, it does not create
   one). A "use this method in a new experiment" command would cross into the
   tasks surface and is flagged, not built.
