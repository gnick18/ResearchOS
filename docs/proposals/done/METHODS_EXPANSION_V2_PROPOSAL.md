# Methods Expansion v2: proposal

> Scope: this proposal scopes the **v2 arc** of the methods system,
> following the v1 close (Phase 0 registry + LC gradient + markdown
> body_override + plate layout + cell culture passaging, merged
> 2026-05-15 at `98e45aaa`). v2 introduces one architectural primitive
> (method composition) and three new structured method types (coding
> workflows, mass spec parameters, qPCR analysis). The v2 slate was
> locked in [METHODS_EXPANSION_V2_DESIGN_QUESTIONS.md](METHODS_EXPANSION_V2_DESIGN_QUESTIONS.md)
> on 2026-05-15; the open per-type field-shape questions (Q-C2 mass
> spec, Q-D2 qPCR) and the sequencing recommendation are decided
> here for Grant to lock at proposal time. This document does not
> write code; the manager builds chip briefs after Grant locks the
> open questions in §8.

---

## 1. Executive summary

1. **Foundation chip first, every type chip after.** The method
   composition primitive (`method_type: "compound"` + `components`
   array + `compound_snapshots` on `TaskMethodAttachment` + recursive
   renderer + revamped new-method dialog) is the load-bearing
   architectural shift. Nothing else in v2 ships meaningfully without
   it, and the new-method dialog revamp the foundation requires
   conflicts on the same lines of `methods/page.tsx` that the per-type
   chips would touch. Land the foundation first, sequentially, in two
   sub-steps (picker-registry split + composition primitive).

2. **After the foundation, the three type chips run in parallel.**
   Coding workflows + Mass spec parameters + qPCR analysis touch
   disjoint per-type files (each lives in its own
   `users/<u>/<type>/<id>.json` directory, its own editor, its own
   registry entry, its own snapshot field on `TaskMethodAttachment`).
   v1's parallel-chip lessons from AGENTS.md §6 apply directly:
   pre-assign fixture id ranges per chip, spawn a focused merge bot
   per chip (no awk-union for the `TaskMethodAttachment` interface
   add), explicit-path staging.

3. **Q-C2: mass spec field shape: smart-per-ionization-mode editor.**
   Discriminator `ionization_mode` ∈ {`esi_pos`, `esi_neg`, `apci_pos`,
   `apci_neg`, `ei`, `maldi`, `other`}. Editor renders the common
   source/scan/calibration fields plus a small per-mode sub-panel
   keyed off the discriminator. Power users get a "Show all fields"
   collapse toggle. Better UX than always-show; cheaper than two
   separate editors.

4. **Q-D2: qPCR shape: analysis-only method type composed with PCR.**
   New `method_type: "qpcr_analysis"` that carries Cq values, melt
   curve, standard curve, and fold-change calculation. Users wire it
   to a PCR cycling protocol via the composition primitive ("qPCR
   full kit" = PCR + qPCR analysis). Wins on every axis: smallest new
   editor, perfect fit for the new primitive, no duplication of the
   1,708-LOC PCR thermocycler editor, no field bloat on the PCR
   record. Alternatives discussed in §5.

5. **v2 total cost estimate: 70–105 sub-bot hours** of
   implementation work plus 10–14 hours of separate wiki manager
   handoff. The composition primitive alone is 28–40 hours (the
   builder UI is the largest single component v2 ships, comparable to
   the LC editor at 851 LOC). Coding workflows is 14–20 hours, mass
   spec 14–18, qPCR 8–12. Up-front picker-registry split adds 4–7.
   Breakdown in §7.

6. **Single biggest risk: snapshot-blob forward compatibility.** The
   composition primitive piles per-child snapshots into a single
   `compound_snapshots: string | null` JSON field on
   `TaskMethodAttachment`. Today's per-type snapshots
   (`pcr_gradient`, `lc_gradient`, `plate_annotation`,
   `cell_culture_schedule`) each have their own field and their own
   read-time normalizer can be added independently. After v2, when a
   child method type rolls its schema, every existing compound
   attachment carrying that child's old snapshot needs to read
   forward-compatibly OR run through a repair pass. Mitigation: ship
   a per-child blob version field from day one. Detail in §10.

---

## 2. Method composition primitive: deep spec

This is the load-bearing architectural addition. The rest of v2 is
straightforward per-type work that follows v1's patterns; the
composition primitive is genuinely new, and its shape determines
how every later method-type addition behaves. Spec follows.

### 2.1 Data shape

#### 2.1.1 The Method record (compound type)

A new discriminator value `"compound"` on
[types.ts:439](frontend/src/lib/types.ts:439)'s `Method.method_type`
union. The compound method record carries `components` directly on
the Method row (no parallel protocol record), because there is no
extra "protocol data" beyond the component list:

```ts
// On Method (additive: only meaningful when method_type === "compound")
export interface CompoundComponent {
  /** Id of the child method in its owner's namespace. */
  method_id: number;
  /** Explicit owner of the child method. Mirrors TaskMethodAttachment.owner
   *  for the same disambiguation reasons: per-user id collisions force
   *  every cross-method reference to carry an owner. `null` = same user as
   *  the compound. */
  owner: string | null;
  /** Stable insertion order within the compound. The renderer sorts by
   *  this; reordering rewrites the array, never mutates indices in place. */
  ordering: number;
  /** Optional label override. When unset, the renderer uses the child's
   *  `Method.name`. Allows "Day 1 plate" / "Day 2 plate" labels on two
   *  copies of the same plate template inside one kit. */
  label?: string;
}

// Extends Method (additive, optional)
export interface Method {
  // ...existing fields...
  /** Only meaningful when `method_type === "compound"`. Null/empty for
   *  every other method type. */
  components?: CompoundComponent[];
}
```

**On-disk layout choice: inline on the Method record, not a parallel
`compound_protocols/<id>.json` file.** Justification:

- PCR / LC / plate / cell culture all have rich protocol data
  (gradients, ingredients, region labels, schedules) that benefits
  from a separate JSON file the editor reads + writes independently
  of the Method row.
- A compound's "protocol data" is just the components list: a small
  array of references. Splitting it into its own file adds an extra
  store, an extra fetch, and an extra source-path scheme
  (`compound://protocol/<id>`) for zero data-shape benefit.
- Folding `components` inline on the Method row means a `methods/<id>.json`
  read returns the full compound definition in one shot. The renderer
  then fans out to the child Method rows (and their per-type protocol
  rows) through the existing per-type API surfaces.

Reject the alternative `compound_protocols/<id>.json` shape unless
v2.1 introduces compound-specific persistent data beyond the
components list (e.g. compound-level notes that don't belong on any
individual child: flagged in §2.10).

#### 2.1.2 The TaskMethodAttachment snapshot field

```ts
// On TaskMethodAttachment (additive: only meaningful when the attached
// method's method_type === "compound")
compound_snapshots: string | null;
```

JSON shape:

```json
{
  "version": 1,
  "children": {
    "<child_method_id>": {
      "schema_version": 1,
      "snapshot": { /* type-specific blob */ }
    }
  }
}
```

Where `<child_method_id>` is the stringified `CompoundComponent.method_id`
(the JSON object key is necessarily a string; readers `parseInt` it
when looking up the corresponding child Method). The per-child
`snapshot` blob is the same shape that lives on a standalone
attachment for that type:

- child of `method_type: "pcr"` → snapshot is the
  parsed `pcr_gradient` JSON object (the same shape currently
  serialized into `TaskMethodAttachment.pcr_gradient`'s JSON string)
- child of `method_type: "lc_gradient"` → snapshot is the parsed
  `LCGradientProtocol` (mirrors `lc_gradient`)
- child of `method_type: "plate"` → `PlateAnnotationSnapshot` (mirrors
  `plate_annotation`)
- child of `method_type: "cell_culture"` →
  `CellCultureScheduleInstance` (mirrors `cell_culture_schedule`)
- child of `method_type: "markdown"` → `{ body_override: string }`
  (mirrors `body_override`)
- child of `method_type: "pdf"` → `null` (PDFs have no per-task state
  today; the snapshot key is absent from the children map)
- child of `method_type: "coding_workflow"` → `null` (per Q-B4 lock,
  no per-task state)
- child of `method_type: "mass_spec"` → mass spec has no per-task
  state in v2 (parameters are static); snapshot absent
- child of `method_type: "qpcr_analysis"` → snapshot key holds the
  per-experiment Cq values + melt curve fields the qPCR analysis
  type defines (see §5.2)
- child of `method_type: "compound"` (nested) → snapshot is the
  recursive `{ version, children }` shape one level deeper

**Why a single `compound_snapshots` field rather than peeling each
type's snapshot into its own column:** the per-child snapshot data
is heterogeneous; the alternative ("add `compound_pcr_gradient`,
`compound_lc_gradient`, ..." parallel fields) leaks into
`TaskMethodAttachment` for every type the user might ever compose,
and breaks the rule that the attachment row stays type-agnostic
beyond the existing per-type fields that v1 already carries.

The `version: 1` outer wrapper is a forward-compatibility hedge: if
v2.1 introduces a richer compound snapshot shape (e.g. compound-level
mid-execution notes), readers gate on `version` and the existing v1
shape stays untouched. The per-child `schema_version` covers the
case from §10's biggest-risk: a child method type rolls its schema
and existing compounds' stored snapshots fall behind.

#### 2.1.3 Type-side interfaces

Add to `frontend/src/lib/types.ts` in a new banner section between
the existing cell-culture banner and the `MethodForkRequest` banner:

```ts
// ── Compound Methods ─────────────────────────────────────────────────────────

export interface CompoundComponent {
  method_id: number;
  owner: string | null;
  ordering: number;
  label?: string;
}

export interface CompoundChildSnapshotEntry {
  schema_version: 1;
  /** Type-specific snapshot blob. Shape is determined by the child method's
   *  method_type; readers narrow via the child Method's `method_type` field
   *  before unpacking. */
  snapshot:
    | PCRGradient
    | LCGradientProtocol
    | PlateAnnotationSnapshot
    | CellCultureScheduleInstance
    | { body_override: string }
    | QPCRAnalysisSnapshot
    | CompoundSnapshotPayload
    | null;
}

export interface CompoundSnapshotPayload {
  version: 1;
  children: Record<string, CompoundChildSnapshotEntry>;
}
```

The `Method` interface gains an optional `components?: CompoundComponent[]`
line. The literal union for `method_type` widens by `"compound"`,
`"coding_workflow"`, `"mass_spec"`, `"qpcr_analysis"`: see §3 / §4 / §5.

### 2.2 Storage layout

#### 2.2.1 `users/<u>/methods/<id>.json`

The compound method's Method row carries `method_type: "compound"`
and a `components` array. No parallel `compound_protocols/<id>.json`
file (per §2.1.1). Example:

```json
{
  "id": 12,
  "name": "Assay X full kit",
  "source_path": null,
  "method_type": "compound",
  "folder_path": "Assays",
  "parent_method_id": null,
  "tags": null,
  "is_public": false,
  "created_by": "alex",
  "owner": "alex",
  "shared_with": [],
  "components": [
    { "method_id": 7,  "owner": null,     "ordering": 0, "label": "Plate layout" },
    { "method_id": 10, "owner": "public", "ordering": 1 }
  ]
}
```

`source_path` is `null` for compounds: the components live inline.
No `compound://protocol/<id>` scheme is needed.

#### 2.2.2 `users/<u>/_counters.json`

No new counter entry is required. Compound methods consume the
existing `methods` counter (the compound IS a Method row, just with a
new discriminator value). v1's counter list at
[json-store.ts:4-10](frontend/src/lib/storage/json-store.ts:4) stays
unchanged for the compound primitive; only the per-type chips add new
counters (`coding_workflows`, `mass_spec_methods`, `qpcr_analyses`:
see §3.4, §4.4, §5.3).

#### 2.2.3 `PUBLIC_ENTITIES` in `json-store.ts`

`"methods"` is already in [PUBLIC_ENTITIES](frontend/src/lib/storage/json-store.ts:4),
so `is_public: true` compounds inherit the public-mirror path
(`users/public/methods/<id>.json`) for free. The recursive children
each handle their own public-mirroring through their own per-type
counter and store.

### 2.3 Renderer: `MethodTabs.tsx`

#### 2.3.1 The case branch

Add to the `switch (resolvedType)` block at
[MethodTabs.tsx:228](frontend/src/components/MethodTabs.tsx:228):

```tsx
case "compound":
  return (
    <CompoundMethodTabContent
      task={task}
      method={activeMethod}
      methodId={activeMethodId}
      attachment={activeAttachment}
      onTaskUpdate={onTaskUpdate}
      readOnly={readOnly}
    />
  );
```

Add `"compound"` to the `resolveMethodType` return-type literal union
at [MethodTabs.tsx:314](frontend/src/components/MethodTabs.tsx:314).
No `source_path` sniff is needed for compound (compounds always have
`source_path: null`, the discriminator carries it).

#### 2.3.2 `CompoundMethodTabContent` component

New component in `frontend/src/components/CompoundViewer.tsx`. Its
job is to:

1. Read the compound's `components` array.
2. Run cycle detection (§2.7) against the in-memory methods list.
   Detected cycles render an inline error band ("Cycle detected:
   compound 12 contains itself via 12 → 7 → 12") and stop recursion.
3. Render a sticky TOC at the top of the tab (§2.3.3).
4. For each component in order, fetch the child Method (by `method_id`
   + `owner`) and render its viewer inline in a stacked vertical
   column with section headers and visual dividers between
   components. Each child viewer is the SAME component the
   single-method tab uses today (e.g. `LcMethodTabContent` for an LC
   child), parameterized so its snapshot read/write threads
   through `compound_snapshots[child_id].snapshot` rather than the
   top-level per-type attachment field.
5. Orphan handling (§2.9): a `CompoundComponent` whose `method_id`
   no longer exists renders an inline "Method deleted" placeholder
   card.

LOC estimate: 200–350 (the renderer is thin; the heavy lifting lives
in the per-type sub-viewers, which already exist).

#### 2.3.3 TOC component

**Recommend a sticky horizontal chip strip at the top of the compound's
tab content**, not a sidebar. Reasoning:

- The methods tab area already has its own horizontal tab strip at
  the top of the page (one tab per attached method). A second
  vertical sidebar inside the compound's tab content competes with
  the page-level sidebar for real estate and feels nested.
- A horizontal chip strip mirrors the page-level tab strip (chips of
  the same visual weight, one per child), which makes the
  composition feel like an extension of the existing tab pattern
  rather than a new navigation paradigm.
- For deep nesting (compound-in-compound), the chip strip flexes by
  wrapping; the nested compound's own TOC renders BELOW the parent's
  in the rendered content, so each level's nav stays local.

Shape:

```tsx
<div className="sticky top-0 z-10 bg-white border-b border-gray-200 px-3 py-2">
  <div className="flex flex-wrap gap-1.5">
    {components.map((c, i) => {
      const meta = getMethodTypeMeta(childMethod.method_type);
      const Icon = meta.icon;
      return (
        <a
          key={c.method_id}
          href={`#component-${c.method_id}`}
          className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs ${meta.color.bg} ${meta.color.text} hover:opacity-80`}
        >
          <Icon className="w-3 h-3" />
          <span>{c.label || childMethod.name}</span>
        </a>
      );
    })}
  </div>
</div>
```

Each component's rendered section gets `id={`component-${method_id}`}`
and the chip links scroll-target onto it. Lives in
`CompoundViewer.tsx` as a sub-component `CompoundToc`.

### 2.4 Compound editor + new-method dialog revamp

This is v2's largest UX scope, comparable to v1's Phase 0 (registry
+ viewer extraction + picker grouping). Specs follow.

#### 2.4.1 Today's new-method dialog (the thing being revamped)

`CreateMethodModal` at
[methods/page.tsx:547-559](frontend/src/app/methods/page.tsx:547)
is a single modal with:

- `MethodTypeCategoryPicker` at
  [methods/page.tsx:582-610](frontend/src/app/methods/page.tsx:582)
  that renders two grouped tile sections (Standard / Structured) keyed
  off `methodTypeRegistry`'s `category` field
- A name input
- A folder picker
- Type-specific body (empty for most types: they jump straight to
  the editor on create)

The structure works for flat types (markdown / pdf / pcr / lc /
plate / cell culture) and will continue to work for the v2 flat types
(coding workflow / mass spec / qpcr analysis). It does NOT work for
compound, which needs a builder workspace.

#### 2.4.2 Post-revamp shape

Replace `CreateMethodModal` with a two-stage flow:

**Stage 1: type picker (mostly unchanged from today).**

- The picker tile grid stays. Adds two tiles per new v2 type:
  Compound, Coding workflow, Mass spec, qPCR analysis. The Compound
  tile sits in a third category `"composition"` (rendered as its own
  group label below Structured) so users see the architectural
  distinction.
- Selecting Compound flips the modal into stage 2 (builder
  workspace). Every other type behaves as today (single-stage modal
  closes on save).

**Stage 2: compound builder workspace.**

A second modal (or in-place panel swap) titled "Build compound
method". Layout:

```
┌────────────────────────────────────────────────────────────┐
│ Build compound method                              [Cancel]│
├────────────────────────────────────────────────────────────┤
│ Name [______________________]   Folder [Assays   ▾]        │
│                                                            │
│ Components                                                 │
│ ┌────────────────────────────────────────────────────┐    │
│ │ ⋮⋮ 1. [Plate layout]: Plate                       │    │
│ │     [edit][rename][remove]                         │    │
│ ├────────────────────────────────────────────────────┤    │
│ │ ⋮⋮ 2. [Assay PDF instructions]: PDF               │    │
│ │     [edit][rename][remove]                         │    │
│ └────────────────────────────────────────────────────┘    │
│ [+ Add component]                                          │
│                                                            │
│ ┌─────────────────────────────────────────────[Cancel]┐    │
│ │                                                [Save]│    │
│ └─────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────┘
```

The list of components is drag-to-reorder (using the same dnd-kit
patterns already in use elsewhere in the app: verified via
`react-rnd` and the existing drag affordances in
`InteractiveGradientEditor`'s row drag). Each row has:

- A drag handle (`⋮⋮`) on the left
- The component's label (clickable to set `label`)
- The component's method type pill (from the registry)
- An [edit] button that opens the child's editor inline (for
  inline-created children) or links to the standalone method page
  for a library-picked child
- A [remove] button (no confirm: the compound isn't saved yet; if
  it's an edit-mode session, removing pops the row from the
  in-memory list and persists on save)

The `[+ Add component]` button opens a sub-picker (§2.4.3).

**On Save:** writes a new `Method` row with `method_type: "compound"`
and the `components` array. Any inline-created children that haven't
been saved yet get saved first (in dependency order: children
before the compound), to ensure ids exist when the compound's
`components` array references them.

**Edit-existing-compound mode** reuses the same builder workspace.
Triggered by an "Edit" button on a compound's row in the methods
list (mirrors the existing edit affordances for other structured
types). The differences from create mode:

- The components list is prefilled
- Existing components show a read-only badge ("Existing: used by N
  experiments") so the user knows reordering / removing has reach
- Save persists the updated Method row

LOC budget: 800–1,200 for the builder + sub-picker (versus v1's LC
editor at 851 actual LOC). If it crosses 1,200, decompose into:

- `frontend/src/components/CompoundMethodBuilder/index.tsx`:
  orchestrator + save callback
- `ComponentList.tsx`: the draggable row list
- `ComponentRow.tsx`: single row with drag handle + actions
- `AddComponentPicker.tsx`: the "+ Add component" sub-picker
- `InlineChildCreator.tsx`: wraps the existing per-type editor
  modals when a sub-picker's "Create new" path is chosen

**Hard ceiling: 1,500 LOC for the builder.** Above 1,500, the file
becomes hard to maintain (PCR's editor at 1,708 is already past the
manageable threshold; the v1 retrospective in v1 proposal §3.6
called 1,000 the soft budget). The builder is more orchestration
than dense editor logic so 1,500 is realistic.

#### 2.4.3 The "+ Add component" sub-picker

A small modal with two tabs:

- **Pick existing**: fuzzy search across the user's existing
  methods (and shared/public methods). One-click adds to the
  components list. Excludes the compound being edited (to prevent
  immediate self-reference, though §2.7's cycle detection catches
  the deeper case).
- **Create new**: the stage-1 type picker again, minus the
  Compound tile (preventing inline-creation of nested compounds at
  this step; users who want a nested compound build it standalone
  first, then add via "Pick existing"; this avoids modal-on-modal
  on-modal recursion). Selecting a type opens that type's editor
  inline; on the inline editor's save, the new method gets:
  1. saved to the methods library (added to the user's methods
     list with its own id),
  2. added to the compound's components array.

The reason for splitting nested-compound creation out of the inline
flow is purely UX: the builder workspace itself is the
"create-a-compound" surface, and reusing it for nested compounds
during another compound's creation produces a modal stack that
disorients users. The Q-A3 lock allows recursion; the recommendation
is just that recursion enters via "build child compound first, then
attach by reference," not "modal-on-modal-on-modal."

#### 2.4.4 Per-child label override

The `label?: string` on `CompoundComponent` is the "rename" affordance
on each row. When set, the renderer uses it in the TOC chip and the
section header inside the rendered compound. When unset, falls back
to the child's `Method.name`.

Use cases:

- Two copies of the same plate layout in one kit, labeled "Day 1
  plate" and "Day 2 plate"
- An LC gradient labeled "Method-development run" when it's part of
  a higher-level method-dev compound

### 2.5 Per-child snapshot persistence

#### 2.5.1 Read path

When a task with an attached compound method is loaded:

1. Read the `TaskMethodAttachment` row for the compound: including
   `compound_snapshots` (JSON string, null when never edited).
2. Parse `compound_snapshots` once. If null, treat as
   `{ version: 1, children: {} }`.
3. For each component in the compound, look up the child Method
   (cycle detection + orphan check happen here).
4. For the child Method, read its native protocol record from disk
   (e.g. `pcr_protocols/<child.method_id>.json`) AS the source
   template.
5. For per-task state, look up
   `compound_snapshots.children[<child.method_id>]`. If present,
   `entry.snapshot` becomes the per-task overlay; if absent, the
   child renders against the source template only (mirrors how a
   single-method attachment with `pcr_gradient: null` renders today).
6. Pass `entry.snapshot` AND a write-callback into the child's
   viewer. The write-callback wraps the existing per-type editor's
   "save my snapshot" hook, writing the new snapshot into the
   `compound_snapshots.children[<child.method_id>]` slot AND
   serializing the parent's `compound_snapshots` JSON string back
   to `TaskMethodAttachment` via `tasksApi.update`.

#### 2.5.2 Type narrowing for the child viewer

Each per-type child viewer needs a small adapter so it can accept
either the standalone snapshot field (existing path) OR the
compound-nested snapshot blob. The cleanest shape is an optional
prop `nestedSnapshot?: { read: () => SnapshotType | null; write:
(s: SnapshotType) => Promise<void> }` on each existing
`<Type>MethodTabContent` component. When `nestedSnapshot` is passed,
the viewer reads/writes through it; when absent, the viewer
defaults to the existing top-level attachment-field path.

Adapter LOC: ~30–50 per existing viewer. Five viewers (markdown,
pcr, lc_gradient, plate, cell_culture) plus the new v2 viewers
(coding_workflow, qpcr_analysis) plus a recursive compound viewer =
seven adapter touches.

#### 2.5.3 Write path

When the user edits a child component inside a compound:

1. The child's editor calls its existing save hook with the new
   snapshot.
2. The wrapped `nestedSnapshot.write` callback intercepts and:
   - Mutates the in-memory `compound_snapshots.children[<child_id>]
     = { schema_version: 1, snapshot: <new> }`
   - Re-serializes `compound_snapshots` to JSON
   - Calls `tasksApi.update(task.id, { method_attachments: [...]
     })` with the updated attachment
3. No write to the source `pcr_protocols/<id>.json` (etc.) record
   from this path: mirrors v1's per-task snapshot pattern. The
   source is the template; the snapshot is the experiment overlay.

### 2.6 Cycle detection + depth limit

#### 2.6.1 Algorithm

Standard DFS with a visited-this-path set:

```ts
function detectCycle(
  rootCompoundId: number,
  methodsByOwnerAndId: Map<string, Method>,
  maxDepth = 4,
): { cycle: number[] | null; depthExceeded: boolean } {
  function dfs(
    currentId: number,
    currentOwner: string,
    path: number[],
    depth: number,
  ): { cycle: number[] | null; depthExceeded: boolean } {
    if (depth > maxDepth) return { cycle: null, depthExceeded: true };
    if (path.includes(currentId)) {
      return { cycle: [...path, currentId], depthExceeded: false };
    }
    const key = `${currentOwner}:${currentId}`;
    const m = methodsByOwnerAndId.get(key);
    if (!m || m.method_type !== "compound" || !m.components) {
      return { cycle: null, depthExceeded: false };
    }
    for (const c of m.components) {
      const childOwner = c.owner ?? currentOwner;
      const r = dfs(c.method_id, childOwner, [...path, currentId], depth + 1);
      if (r.cycle || r.depthExceeded) return r;
    }
    return { cycle: null, depthExceeded: false };
  }
  return dfs(rootCompoundId, /* owner of root */ ..., [], 0);
}
```

Lives in `frontend/src/lib/methods/compound-graph.ts` (new file).
Used by:

- The renderer (`CompoundMethodTabContent`): runs once per render
  before fanning out; cycle → inline error band, depth → "Nested
  too deep" band
- The builder save path: runs after the user clicks Save; if a
  cycle is detected, save is blocked with a toast naming the cycle
- Optionally, a background sweep at app load to flag pre-existing
  cycles (only relevant if a future bug ever lets one slip through)

#### 2.6.2 Depth limit: **4**

Picked over 3 / 5 / 6 for these reasons:

- **3 is too tight.** A reasonable nested-kit case (top-level
  experiment kit → daily-prep sub-kit → assay sub-kit → plate
  template) hits depth 4. Capping at 3 forces flattening.
- **5+ is too loose.** A 5-level deep compound's TOC chip strip
  becomes unreadable (5 nested chip rows on the page); the depth
  cap doubles as a UX guardrail.
- **4 covers every realistic lab use case Grant has described,**
  and the chip strip stays readable at 4 levels.

The constant lives in `compound-graph.ts:MAX_COMPOUND_DEPTH = 4`.
The builder UI surfaces a soft warning ("This compound is N levels
deep; consider flattening") when N >= 3, hard-blocks at N > 4.

### 2.7 Child-delete prompt

Locked at Q-A4: when the user deletes a method that's referenced by
N compounds, the modal asks them whether to delete just the method
(compounds keep placeholders) or to cascade.

#### 2.7.1 Where the prompt lives

Inside `handleDelete` at
[methods/page.tsx:288](frontend/src/app/methods/page.tsx:288). The
existing simple `confirm("Delete this method and all associated
files?")` stays for the no-references case. The compound-reference
case replaces the `confirm` with a custom three-button modal.

#### 2.7.2 How affected compounds are discovered

At delete time:

```ts
const allMethods = await fetchAllMethodsIncludingShared();
const affectedCompounds = allMethods.filter(
  (m) =>
    m.method_type === "compound" &&
    m.components?.some(
      (c) => c.method_id === id && (c.owner ?? m.owner) === method.owner,
    ),
);
```

The owner-match preserves per-user id collision semantics: alex's
method 7 and morgan's method 7 are different methods; only compounds
whose component reference matches both `(method_id, owner)` are
"affected."

For a typical 1-user 50-method dataset, this is O(n) over methods
with O(n) over each compound's `components` array: fast in the
extreme. No new index is needed.

#### 2.7.3 Prompt UX

A three-button modal (component `DeleteMethodConfirm.tsx`):

```
┌────────────────────────────────────────────────────────────┐
│ Delete "Method A"                                          │
├────────────────────────────────────────────────────────────┤
│ "Method A" is part of 2 compound methods:                  │
│   • Method C: "Assay X full kit"                          │
│   • Method E: "Day 1 prep kit"                            │
│                                                            │
│ Choose one:                                                │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ [Just delete Method A]                                 │ │
│ │ Keeps the 2 compounds; they will show                  │ │
│ │ "Method A (deleted)" where it used to render.          │ │
│ └────────────────────────────────────────────────────────┘ │
│ ┌────────────────────────────────────────────────────────┐ │
│ │ [Delete Method A AND the 2 compounds]                  │ │
│ │ Removes all three. Experiments using Method C or       │ │
│ │ Method E lose those attachments.                       │ │
│ └────────────────────────────────────────────────────────┘ │
│ [Cancel]                                                   │
└────────────────────────────────────────────────────────────┘
```

The two action buttons fire different code paths:

- **Just delete**: calls the existing `methodsApi.delete(id)` plus
  the existing per-type cleanup (PCR / LC / plate / cell culture
  protocol record deletion). Compounds' `components` arrays are
  left untouched; the orphan path in §2.9 handles the rendering.
- **Cascade**: deletes the method AND all `affectedCompounds`.
  For each affected compound, also deletes its corresponding `Method`
  row. Receivers of any cascaded compounds get a sharing-cascade
  notification (mirroring how task delete propagates to receivers
  today: out of scope for v2 if cross-user compound sharing is
  also out of scope per §2.10).

#### 2.7.4 When the affected list is empty

The simple "Are you sure?" stays: no extra modal cost on the common
case.

### 2.8 Read-time orphan normalization

A compound whose `components` array references a `method_id` that no
longer exists (because the user picked "Just delete" in §2.7) renders
the missing component as an inline placeholder:

```tsx
<div className="border border-amber-200 bg-amber-50 rounded p-3 my-2">
  <div className="text-xs font-medium text-amber-700">Component deleted</div>
  <div className="text-sm text-amber-900 mt-1">
    A component of this compound has been deleted. Remove it from the
    compound, or restore the source method.
  </div>
  <button className="mt-2 text-xs text-amber-700 underline">
    Remove from this compound
  </button>
</div>
```

The "Remove from this compound" affordance is a one-click cleanup
that fires the same edit-compound write path the builder uses. No
silent auto-removal: the user sees the historical structure and
decides.

This mirrors the cross-owner sharing manifest-drift pattern in
AGENTS.md §6's `normalizeProjectHostedManifest` entry: read-time
detection of drift, in-place rendering of the broken state, explicit
user action to repair. No async background sweep: the orphan only
matters when the user opens the compound, so detect-on-render is
sufficient.

### 2.9 Sharing carve-out: explicitly OUT OF SCOPE for v2

Cross-user sharing of compound methods is **deferred to v2.1.**

The reason: v1's method-sharing path
(`sharingApi.shareMethod` / `unshareMethod` at
[local-api.ts:2835](frontend/src/lib/local-api.ts:2835)) only walks
the source method row, not its dependent records. For a compound,
sharing would need to either:

1. Walk the `components` array and share each child too (with all
   their per-type protocol records, recursively for nested
   compounds), OR
2. Share the compound row only and let the receiver hit
   permission-denied on each child until they're shared individually.

Option 1 is the user-intuitive behavior but adds substantial code:
the share path becomes recursive, the unshare path needs to know
when to cascade vs leave shared children alone, and the
cross-owner-id-collision rules need to be re-thought (when alex
shares her compound that references public method 7 into morgan's
view, does morgan's method 7 win over alex's reference?).

Option 2 is cheap but produces a half-shared compound that always
renders broken: bad UX.

**Recommendation:** v2 ships with the compound builder gating
`is_public` to **false-only** for compounds. The "Make public"
toggle is hidden on compound creation/edit. The methods-list filter
"Public" simply doesn't show compounds. v2.1 adds the recursive share
path; the methods-expansion manager picks this up after v2 lands.

Surface in §8 as a Grant question: is the public-toggle-hidden
behavior acceptable for v2?

### 2.10 LOC budget for the compound editor

Verified v1 actual editor sizes (LOC):

| File | LOC | Notes |
|---|---|---|
| `InteractiveGradientEditor.tsx` (PCR) | 1,708 | The 1,562 number quoted in the brief is older; current HEAD is larger. Still the ceiling. |
| `LcGradientEditor.tsx` (LC) | 851 | Decomposed across multiple sub-files |
| `CellCultureScheduleEditor.tsx` (cell culture) | 713 | Single file, dense |
| `PlateLayoutEditor.tsx` (plate) | 614 | Single file, plate-grid heavy |

**Compound builder LOC budget: 1,500 LOC across the
`CompoundMethodBuilder/` folder.** Decompose if any single sub-file
crosses 800 LOC. Reasoning:

- The compound builder is **orchestration-heavy**, not editor-heavy
 : it doesn't draw a gradient curve or render a 96-well plate; it
  manages a list of cards, a drag handle, and a sub-picker. So a
  higher ceiling than the densest single editors (LC at 851, cell
  culture at 713) is appropriate.
- The builder DOES inline the sub-picker, which adds another ~300
  LOC of fuzzy-search + tile-grid logic.
- The builder DOES inline launchers for every existing editor
  (PCR's, LC's, plate's, cell culture's, plus v2's new ones), but
  each launcher is a 20-line dialog wrapper, not a re-implementation.
- A 1,500 ceiling buys headroom for the orchestrator + the
  sub-picker + the 7 type-editor launchers without forcing premature
  decomposition.

If the implementation chip approaches 1,500, decompose into the file
layout outlined in §2.4.2.

---

## 3. Coding workflows spec

### 3.1 The use case (recap)

Per-experiment reusable scripts and Jupyter notebooks. The
differentiation rule from the design doc holds: code that's
templated across many experiments is a method; one-off code per
experiment goes in notes.

### 3.2 Data shape

#### 3.2.1 Type interfaces

Add to `types.ts` in a new banner section after the cell-culture
banner:

```ts
// ── Coding Workflows ─────────────────────────────────────────────────────────

/** Curated languages with first-class icons + syntax-highlighter
 *  profiles. "other" pairs with `language_label` for freeform fallback. */
export type CodingWorkflowLanguage =
  | "python"
  | "r"
  | "bash"
  | "sql"
  | "julia"
  | "matlab"
  | "javascript"
  | "other";

/** Auto-derived from `language` for most cases; explicitly stored so the
 *  renderer can short-circuit without recomputing on every render. */
export type CodingWorkflowOutputRenderer = "syntax-highlight" | "ipynb" | null;

export interface CodingWorkflowProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  language: CodingWorkflowLanguage;
  /** Free-form label shown next to the icon when `language === "other"`. */
  language_label?: string | null;
  /** Embedded code body. Null when the workflow is external-only
   *  (`external_path` set without `embedded_code`). */
  embedded_code: string | null;
  /** Optional path on the user's machine for the "open in your editor"
   *  handoff. Null when the workflow is embed-only. Path is relative to
   *  the data folder root, mirroring how `Method.source_path` is
   *  interpreted for markdown/pdf methods. */
  external_path: string | null;
  /** Drives the inline preview component:
   *   - "syntax-highlight": embedded_code rendered via rehype-highlight
   *   - "ipynb"            : embedded_code parsed as nbformat JSON +
   *                           cells rendered with static outputs
   *   - null                : no inline preview (external-only) */
  output_renderer: CodingWorkflowOutputRenderer;
}

export interface CodingWorkflowProtocolCreate {
  name: string;
  description?: string | null;
  is_public?: boolean;
  language: CodingWorkflowLanguage;
  language_label?: string | null;
  embedded_code?: string | null;
  external_path?: string | null;
  output_renderer?: CodingWorkflowOutputRenderer;
  folder_path?: string | null;
}

export type CodingWorkflowProtocolUpdate = Partial<{
  name: string;
  description: string | null;
  is_public: boolean;
  language: CodingWorkflowLanguage;
  language_label: string | null;
  embedded_code: string | null;
  external_path: string | null;
  output_renderer: CodingWorkflowOutputRenderer;
}>;
```

The `method_type` literal union on `Method` widens by
`"coding_workflow"`.

#### 3.2.2 No per-task snapshot field

Per Q-B4 lock (no per-task state), `TaskMethodAttachment` does NOT
gain a new field for coding workflows. When a coding workflow is
attached as a child of a compound, the corresponding entry in
`compound_snapshots.children[<id>]` simply doesn't exist (the
recursive renderer treats absence as "no per-task overlay").

### 3.3 Per-language icon + color in the registry

Add a new registry entry to `METHOD_TYPE_REGISTRY` for
`coding_workflow`:

```ts
coding_workflow: {
  id: "coding_workflow",
  label: "Coding workflow",
  shortLabel: "Code",
  color: { bg: "bg-indigo-100", text: "text-indigo-600" },
  icon: CodingWorkflowIcon,
  description: "Reusable scripts (Python/R/SQL/etc.) and Jupyter notebooks.",
  hasStructuredProtocol: true,
  category: "structured",
},
```

The per-language icon (e.g. Python snake, R logo, bash prompt) lives
INSIDE the type's editor + viewer, not in the top-level registry.
Reasoning: the registry's job is method-type cosmetics (badge color
on the methods list, picker tile), not per-language affordances.
Per-language icons render in the editor's header strip and in the
methods-list row when the type is `coding_workflow` (as a small
secondary badge next to the type badge).

Per-language icon component file:
`frontend/src/lib/methods/coding-language-icons.tsx`, mirroring
`method-type-icons.tsx`'s shape:

```ts
export const PythonIcon: ComponentType<...>;
export const RIcon: ComponentType<...>;
// ...one per CodingWorkflowLanguage
export function getCodingLanguageIcon(lang: CodingWorkflowLanguage): ComponentType<...>;
```

Icons can be SVG paths from a free icon set (Devicons / Simple Icons
have all of these); license-permissive options exist for every
listed language.

### 3.4 `.ipynb` parsing strategy

#### 3.4.1 Recommend: hand-rolled nbformat v4 parser

The nbformat v4 spec is straightforward JSON:

```json
{
  "cells": [
    {
      "cell_type": "code" | "markdown" | "raw",
      "source": "..." | ["line1\n", "line2"],
      "outputs": [
        { "output_type": "stream", "text": "..." },
        { "output_type": "display_data", "data": { "text/plain": "...", "image/png": "<base64>" } },
        { "output_type": "execute_result", "data": { "text/plain": "..." } }
      ],
      "execution_count": 1
    }
  ],
  "metadata": { ... },
  "nbformat": 4,
  "nbformat_minor": 5
}
```

A 100–150 LOC TypeScript parser handles every cell type:

```ts
interface ParsedNbCell {
  cellType: "code" | "markdown" | "raw";
  source: string;
  outputs: ParsedNbOutput[];
}

interface ParsedNbOutput {
  kind: "stream" | "text" | "image" | "html";
  payload: string; // text for stream/text/html, base64 for image
}

function parseNotebook(raw: string): { cells: ParsedNbCell[]; error?: string } {
  // JSON.parse + walk cells + normalize source (array | string)
  // + walk outputs + pick best mime type per output
}
```

**Reject `@jupyterlab/nbformat`** (the official package) as a
dependency: it pulls in 100+ KB of TypeScript types + helper code
for content the parser doesn't actually need. The parser is a small
pure-JSON walker; rolling it costs less than the bundle hit of
importing.

#### 3.4.2 Static cell-output rendering

For a parsed cell of type `code`:

```tsx
<div className="ipynb-cell">
  <div className="ipynb-execution-count text-xs text-gray-400">In [{cell.execution_count}]:</div>
  <pre className="ipynb-source">
    <code className={`language-${language}`}>{cell.source}</code>
  </pre>
  {cell.outputs.length > 0 && (
    <div className="ipynb-outputs border-l-4 border-gray-200 pl-3 mt-1">
      {cell.outputs.map((o, i) => (
        <NotebookOutput key={i} output={o} />
      ))}
    </div>
  )}
</div>
```

`NotebookOutput` switches on `output.kind`:

- `image` → `<img src="data:image/png;base64,..." />`
- `text` / `stream` → `<pre>{output.payload}</pre>`
- `html` → `<div dangerouslySetInnerHTML={...} />` (sanitized via
  existing markdown's DOMPurify path; `.ipynb` HTML outputs are
  occasionally rich and can carry inline event handlers from
  pandas-style table styling)

For `markdown` cells: pipe `cell.source` through the existing
markdown renderer (the one used by `method_type: "markdown"`). This
gets free LaTeX, code-fence highlighting, and image support for
notebook prose cells.

For `raw` cells: render as `<pre>{cell.source}</pre>`.

### 3.5 Editor + new-method dialog

The new-method dialog stage-1 picker (post-revamp per §2.4.2) shows a
"Coding workflow" tile. Selecting it opens a coding-workflow editor
modal:

```
┌────────────────────────────────────────────────────────────┐
│ New coding workflow                                [Cancel]│
├────────────────────────────────────────────────────────────┤
│ Name [______________________]   Folder [Scripts  ▾]        │
│                                                            │
│ Language  [Python ▾]                                       │
│  ⓘ When "Other," a freeform label appears.                 │
│                                                            │
│ Embedded code                                              │
│  ╔══════════════════════════════════════════════════════╗  │
│  ║ # Paste your script here, or leave blank and only    ║  │
│  ║ # set "External path" below.                         ║  │
│  ║ import pandas as pd                                  ║  │
│  ║ ...                                                   ║  │
│  ╚══════════════════════════════════════════════════════╝  │
│                                                            │
│ External path (optional)  [____________________________]   │
│  ⓘ Relative to your data folder. Used for "open in editor". │
│                                                            │
│                                          [Save method]     │
└────────────────────────────────────────────────────────────┘
```

The embedded-code textarea is a plain `<textarea>` (per Q-B5 lock:
no Monaco / CodeMirror). The "Embedded code" field is read-only in
the viewer (syntax-highlighted preview); editing happens via this
modal (the editor IS a textarea: minimal but functional) or
externally via the path.

When `language === "other"`, the modal shows a `language_label` text
field below the language picker. When the user pastes content that
looks like a `.ipynb` (JSON with a `nbformat` key), the editor
auto-detects and offers to switch `output_renderer` to `"ipynb"`.

Editor LOC budget: 300–450 (small editor, single file). File:
`frontend/src/components/CodingWorkflowEditor.tsx`. Mirrors
`CellCultureScheduleEditor.tsx`'s save/load shape.

Viewer LOC budget: 200–300, split across:

- `CodingWorkflowViewer.tsx`: orchestrator, dispatches by
  `output_renderer`
- `IpynbRenderer.tsx`: the parsed-notebook renderer (also used by
  the wiki's planned coding-workflow page)
- `SyntaxHighlightedCode.tsx`: thin wrapper over
  `rehype-highlight` (already in deps; see §3.6)

### 3.6 Source storage + path scheme + PUBLIC_ENTITIES

- Source-path scheme on the parent Method row:
  `coding_workflow://protocol/{id}` (mirrors
  `pcr://protocol/{id}`, `lc_gradient://protocol/{id}`).
- Storage directory: `users/<u>/coding_workflows/<id>.json` and
  `users/public/coding_workflows/<id>.json`.
- `PUBLIC_ENTITIES` in
  [json-store.ts:4-10](frontend/src/lib/storage/json-store.ts:4)
  adds `"coding_workflows"`.
- Per-user counter line: `coding_workflows` in
  `users/<u>/_counters.json` and `users/public/_counters.json`.
- New API in `local-api.ts`: `codingWorkflowApi` mirroring
  `pcrApi` / `lcGradientApi` / `plateApi` / `cellCultureApi` exactly.

### 3.7 Reuse of v1 patterns

- **No diff display.** Per Q-B4 lock (no per-task state), there's
  nothing to diff against the source. Phase 0's `diff-display.ts`
  constants stay untouched.
- **Syntax highlighting via `rehype-highlight`.** Already in deps
  (`frontend/package.json:32`). No new bundle weight for in-line
  preview of embedded code: the markdown body's fenced-code path
  already uses this. Re-use the same theme.
- **`rehype-highlight` covers all curated languages.** Verified
  against highlight.js's default language set: Python, R, bash,
  SQL, Julia, MATLAB, JavaScript are all standard. `language: "other"`
  with `language_label` falls back to highlight.js's auto-detect
  (limited but workable).
- **No new dep for ipynb.** Hand-rolled parser per §3.4.1.

---

## 4. Mass spec parameters spec

### 4.1 Q-C2 recommendation: smart-per-ionization-mode editor

**Recommend the smart-per-mode editor with a "Show all fields"
escape hatch.** Reasoning:

- ESI-specific fields (capillary voltage, nebulizer gas flow, drying
  gas) are noise to a MALDI user; MALDI-specific fields (laser
  wavelength, laser power, matrix) are noise to an ESI user. Showing
  every field always doubles the field count visible to the user and
  makes the editor feel cluttered.
- Power users sometimes want to see the full field set (e.g., when
  documenting an unusual ESI+APCI dual-source run, or when the
  default mode-specific field set misses something idiosyncratic to
  their instrument). The "Show all fields" toggle is one checkbox at
  the top of the editor.
- The discriminator-driven render pattern is the same v1's
  `qPCR`-vs-PCR question would have used; familiar architecture.

**Alternatives considered:**

- **Always-show all fields**: simpler editor; uglier UX for the
  90% case. Reject.
- **Two separate method types (ESI method + MALDI method)**: clean
  separation; bad for fixture maintenance and the registry tile
  count. Reject.
- **Free-text "ionization params" field**: punts the structure
  question entirely; loses the visualization payoff of structured
  params (color-coded field groups, future per-vendor instrument
  template). Reject.

### 4.2 Data shape

```ts
// ── Mass Spec Parameters ─────────────────────────────────────────────────────

export type IonizationMode =
  | "esi_pos"
  | "esi_neg"
  | "esi_switching"
  | "apci_pos"
  | "apci_neg"
  | "ei"
  | "maldi"
  | "other";

export interface MassSpecSourceParams {
  /** Source temperature in °C. ESI / APCI / EI all use; MALDI usually does not. */
  source_temp_c?: number | null;
  /** Capillary voltage in kV (ESI / APCI). */
  capillary_kv?: number | null;
  /** Nebulizer gas flow in L/min (ESI / APCI). */
  nebulizer_gas_lpm?: number | null;
  /** Drying gas flow in L/min (ESI / APCI). */
  drying_gas_lpm?: number | null;
  /** Drying gas temperature in °C (ESI / APCI). */
  drying_gas_temp_c?: number | null;
  /** Electron ionization energy in eV (EI only). */
  ei_energy_ev?: number | null;
  /** MALDI laser wavelength in nm. */
  maldi_laser_nm?: number | null;
  /** MALDI laser energy (instrument-specific units; free text). */
  maldi_laser_energy?: string | null;
  /** MALDI matrix (free text: "CHCA", "DHB", "SA"). */
  maldi_matrix?: string | null;
  /** Free-text catch-all for instrument-specific params not modeled. */
  other_notes?: string | null;
}

export interface MassSpecScanParams {
  /** Lower m/z bound. */
  scan_mz_low?: number | null;
  /** Upper m/z bound. */
  scan_mz_high?: number | null;
  /** Scan rate in scans/sec (or Hz; user labels). */
  scan_rate_hz?: number | null;
  /** Mass resolving power (R; full-width-half-max). */
  resolution_r?: number | null;
  /** True for MS/MS workflows; false for MS-only. */
  is_msms: boolean;
  /** MS/MS isolation window in m/z (only meaningful when is_msms=true). */
  msms_isolation_window_mz?: number | null;
  /** MS/MS collision energy in eV (only meaningful when is_msms=true). */
  msms_collision_energy_ev?: number | null;
}

export interface MassSpecCalibration {
  /** Reference standard ("sodium formate", "MRFA", "Calmix"): free text. */
  reference_standard?: string | null;
  /** ISO date the calibration was last performed. */
  calibration_date?: string | null;
  /** Expected mass accuracy in ppm. */
  expected_accuracy_ppm?: number | null;
  /** Free-text notes. */
  notes?: string | null;
}

export interface MassSpecProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  /** The discriminator that drives smart-per-mode field rendering in the editor. */
  ionization_mode: IonizationMode;
  /** Free-text label when `ionization_mode === "other"`. */
  ionization_label?: string | null;
  /** Instrument identifier: "Thermo Q-Exactive", "Bruker timsTOF Pro 2", etc. */
  instrument?: string | null;
  source: MassSpecSourceParams;
  scan: MassSpecScanParams;
  calibration: MassSpecCalibration;
}

export interface MassSpecProtocolCreate { /* same minus id */ }
export type MassSpecProtocolUpdate = Partial<...>;
```

The `method_type` literal union widens by `"mass_spec"`.

### 4.3 Source path + storage + counters

- Source-path scheme: `mass_spec://protocol/{id}`.
- Storage: `users/<u>/mass_spec_methods/<id>.json` and
  `users/public/mass_spec_methods/<id>.json`.
- `PUBLIC_ENTITIES` gains `"mass_spec_methods"`.
- Counter line: `mass_spec_methods`.
- `massSpecApi` in `local-api.ts` mirrors `lcGradientApi`.

### 4.4 Editor

`frontend/src/components/MassSpecEditor.tsx`. Sections:

```
┌────────────────────────────────────────────────────────────┐
│ Mass spec method                                           │
├────────────────────────────────────────────────────────────┤
│ Name [______________________]   Folder [Methods  ▾]        │
│                                                            │
│ Instrument  [Thermo Q-Exactive_______________]             │
│ Ionization  [ESI+ ▾]      [ ] Show all fields              │
│                                                            │
│ ─── Source params ────────────────────────────────────────  │
│   Source temp °C        [120____]                          │
│   Capillary voltage kV  [3.5____]   ← ESI / APCI only      │
│   Nebulizer gas L/min   [1.2____]   ← ESI / APCI only      │
│   Drying gas L/min      [10____]    ← ESI / APCI only      │
│   Drying gas temp °C    [350___]    ← ESI / APCI only      │
│                                                            │
│ ─── Scan params ──────────────────────────────────────────  │
│   m/z range             [100__]–[1000__]                   │
│   Scan rate Hz          [2_____]                           │
│   Resolution R          [70000_]                           │
│   [ ] MS/MS workflow                                       │
│      Isolation window m/z [1.2_]                           │
│      Collision energy eV  [25__]                           │
│                                                            │
│ ─── Calibration ──────────────────────────────────────────  │
│   Reference standard    [Calmix______________]             │
│   Calibration date      [2026-05-01]                       │
│   Expected accuracy ppm [2_____]                           │
│   Notes                 [_____________________]            │
│                                                            │
│                                          [Save method]     │
└────────────────────────────────────────────────────────────┘
```

Per-mode visibility rules (smart-per-mode):

| Field | ESI+/− | APCI+/− | EI | MALDI | other |
|---|---|---|---|---|---|
| Source temp °C | yes | yes | yes | no | yes |
| Capillary kV | yes | yes | no | no | yes |
| Nebulizer gas | yes | yes | no | no | yes |
| Drying gas | yes | yes | no | no | yes |
| EI energy eV | no | no | yes | no | yes |
| MALDI laser nm | no | no | no | yes | yes |
| MALDI laser energy | no | no | no | yes | yes |
| MALDI matrix | no | no | no | yes | yes |
| Scan m/z + rate + resolution | yes | yes | yes | yes | yes |
| MS/MS toggle | yes | yes | yes | yes | yes |
| Calibration | yes | yes | yes | yes | yes |

"Show all fields" overrides the visibility table: every field
renders regardless of mode.

`ionization_mode === "esi_switching"` shows the ESI fields and adds
a small "Switching schedule" note (timing of polarity switches is
modeled as free text via `MassSpecSourceParams.other_notes` in v2;
structured switching schedules are a v2.1 punt).

Editor LOC budget: 400–550 (mostly form fields + the
per-mode-visibility table). Single file. File:
`frontend/src/components/MassSpecEditor.tsx`.

Viewer LOC: 150–250. File: `frontend/src/components/MassSpecViewer.tsx`.

### 4.5 No per-task snapshot

Mass spec parameters are static method-level configuration. The
per-experiment state (the actual `.raw` / `.mzML` file the
instrument produced) lives in the task's results subtree, not on the
method attachment. So `TaskMethodAttachment` gets no new field;
`compound_snapshots.children[<mass_spec_child_id>]` is always absent.

### 4.6 Integration with composition: free

Once §2 ships, "LC-MS" is just a compound method with two children:
an LC gradient + a mass spec method. No special-case code in either
type: the composition primitive handles the combination by design.
This is the whole point of the architectural shift: every future
combinable-method case ("Western blot + ECL detection params",
"plate + spectrophotometer params") rides on the same primitive.

---

## 5. qPCR spec

### 5.1 Q-D2 recommendation: analysis-only method type composed with PCR

**Recommend Option 1.** A new `method_type: "qpcr_analysis"` that
carries the analysis half: Cq values, melt curves, standard
curves, fold-change calculation. Users compose it with an existing
PCR method via the composition primitive to get "qPCR full kit."

**Why this wins:**

- The composition primitive is exactly the right tool for "PCR
  cycling + qPCR analysis." Option 1 is the natural fit.
- **Smallest new editor.** The qPCR analysis fields are flat (per-well
  Cq + reference + standard-curve points + fold-change config) and
  fit in ~400–500 LOC. Compare with Option 2's full qPCR-protocol
  type which would duplicate ~70% of `InteractiveGradientEditor`'s
  1,708 LOC for the cycling half.
- **No PCR record bloat.** Option 3 would add ~10 optional fields to
  the PCR record that 80% of PCR users (non-qPCR runs) would
  permanently see as null/empty: leaks qPCR-specific state into the
  general PCR shape.
- **Doesn't compromise PCR's editor.** Forking the PCR editor for
  qPCR (Option 2's fallback) was flagged in v1 §2.4 as the "v2
  qPCR" path; the composition primitive in v2 makes that fork
  unnecessary.
- **Lets users compose alternative cycling protocols.** A user can
  build "Fast PCR + qPCR analysis" or "two-step PCR + qPCR analysis"
  via different parent compound configurations, without duplicating
  the analysis fields per cycling protocol.

**Alternatives considered:**

- **Option 2: Full qPCR-protocol method type (cycling + analysis).**
  Standalone; self-contained. Duplicates the PCR editor. Cost: the
  largest single chip in v2. Rejected.
- **Option 3: Extend PCR with `qpcr_analysis?: ... | null`.** Cheap;
  conflates two workflows on one method. Every PCR record carries
  the field set even when null. Rejected.

### 5.2 Data shape

```ts
// ── qPCR Analysis ────────────────────────────────────────────────────────────

export type QPCRChemistry = "sybr" | "taqman" | "evagreen" | "other";

/** One reference dye / amplicon in a relative-quantitation analysis. */
export interface QPCRReference {
  id: string;
  /** Gene/target name. */
  target: string;
  /** Dye/channel ("FAM", "ROX", "VIC"). */
  channel: string;
  /** Treated as the reference housekeeping for ΔΔCq calculations. */
  is_reference: boolean;
  /** Expected Cq (informational, not used in calc). */
  expected_cq?: number | null;
}

/** A standard-curve dilution series point (input to efficiency calc). */
export interface QPCRStandardCurvePoint {
  /** Log10(quantity). */
  log_quantity: number;
  /** Cq value at this quantity. */
  cq: number;
  /** Optional replicate count for averaging. */
  replicate_n?: number | null;
}

export interface QPCRMeltCurveConfig {
  /** Initial temperature in °C. */
  start_c: number;
  /** Final temperature in °C. */
  end_c: number;
  /** Ramp rate in °C/sec. */
  ramp_rate_c_per_sec: number;
}

export interface QPCRAnalysisProtocol {
  id: number;
  name: string;
  description?: string | null;
  is_public: boolean;
  created_at?: string;
  updated_at?: string;
  created_by: string | null;
  chemistry: QPCRChemistry;
  /** Free-text chemistry label when `chemistry === "other"`. */
  chemistry_label?: string | null;
  references: QPCRReference[];
  standard_curve: QPCRStandardCurvePoint[];
  melt_curve?: QPCRMeltCurveConfig | null;
  /** ΔΔCq calculation enabled. When true and the references list
   *  carries an `is_reference: true` row, the experiment-page viewer
   *  computes fold-change relative to the reference and displays it. */
  use_delta_delta_cq: boolean;
}

/** Per-task snapshot: the actual experimental Cq readouts the user
 *  enters at experiment time. Lives in TaskMethodAttachment for
 *  standalone qPCR, or in compound_snapshots for composed qPCR. */
export interface QPCRAnalysisSnapshot {
  /** Per-target Cq readouts. Keyed by QPCRReference.id. */
  cqs: Record<string, {
    /** Mean Cq across replicates. */
    cq: number;
    /** Per-replicate Cq values (when entered). */
    replicates?: number[];
    /** Free-text notes (e.g. "off-scale", "primer-dimer detected"). */
    notes?: string | null;
  }>;
  /** Melt-curve Tm readouts per target, keyed by QPCRReference.id. */
  melt_tms?: Record<string, number>;
  /** Free-text per-experiment notes. */
  notes?: string | null;
}
```

The `method_type` literal union widens by `"qpcr_analysis"`. The
`TaskMethodAttachment` gains a `qpcr_analysis: string | null` field
(JSON string of `QPCRAnalysisSnapshot`) for the standalone-attachment
path; the same payload shape is used as the `snapshot` value inside
`compound_snapshots.children` when composed.

### 5.3 Storage + counter + API

- Source-path scheme: `qpcr_analysis://protocol/{id}`.
- Storage: `users/<u>/qpcr_analyses/<id>.json` +
  `users/public/qpcr_analyses/<id>.json`.
- `PUBLIC_ENTITIES` gains `"qpcr_analyses"`.
- Counter line: `qpcr_analyses`.
- `qpcrAnalysisApi` in `local-api.ts` mirrors `pcrApi`.

### 5.4 Editor

`frontend/src/components/QpcrAnalysisEditor.tsx`. Sections: chemistry
+ references table + standard-curve points table + melt-curve
config + ΔΔCq toggle. The references table is the heaviest part
(~120 LOC including add/remove/edit rows). Editor LOC budget:
400–550.

### 5.5 Visualization

Standard-curve plot (Cq vs log(quantity), with linear regression and
efficiency calculation) renders via recharts (already in deps).
Melt-curve plot is per-task, not per-method (the melt-curve curve is
data the user uploads or pastes; v2 ships entering Tm values, not
visualizing raw -dF/dT data: that's a v2.1 punt).

`QpcrAnalysisViz.tsx`: ~150–250 LOC for the standard-curve plot +
ΔΔCq results table on the per-task experiment page.

### 5.6 Composed-with-PCR workflow

Recommended onboarding: ship a public "qPCR full kit" compound in
the demo fixture data that pairs an existing public PCR method (the
DemoCheck PCR at `users/public/pcr_protocols/1.json`) with a public
qPCR analysis method. This makes the composition primitive
self-documenting: users open `/methods`, see the kit, and understand
the pattern.

---

## 6. Implementation sequencing

### 6.1 The constraints

From AGENTS.md §6's parallel-chip integration trap (commit
`407aff8e`, surfaced 2026-05-15 at v1's Methods Expansion ARC close):

1. Shared method-id picks collide. Two parallel chips can both
   pick the same fixture-method id, detected only at merge time.
2. `awk`-union doesn't survive structurally interleaved conflicts.
   `methods/page.tsx` conflicts mid-JSX, `apply.ts` conflicts in
   if-chain branches, etc.: the orchestrator can't mechanically
   resolve.
3. `git add -A` in mid-merge sweeps `.claude/worktrees/*` as embedded
   git repos.

Plus v2's specific risk:

4. **The new-method dialog revamp** (§2.4) touches the same
   `methods/page.tsx` regions the per-type chips need to touch (each
   type chip adds a tile to the picker; the dialog revamp restructures
   that picker). Doing them in parallel guarantees the conflict.

### 6.2 Recommended sequencing: sequential foundation, then parallel types

#### Phase 0a: picker-registry refactor (sequential, ~1 day, ~4–7 hours)

**Goal:** Extract the new-method dialog's `MethodTypeCategoryPicker`
(currently at
[methods/page.tsx:582-610](frontend/src/app/methods/page.tsx:582))
into its own component file, plus the `CreateMethodModal` orchestrator
(currently at
[methods/page.tsx:547-559](frontend/src/app/methods/page.tsx:547)).
Move the picker and modal to:

- `frontend/src/components/methods/CreateMethodModal.tsx`
- `frontend/src/components/methods/MethodTypePicker.tsx`

After this refactor, per-type chips that need to add a tile to the
picker only edit the registry (`method-type-registry.ts`): they
never touch `methods/page.tsx`. The chip count of files touching
`methods/page.tsx` drops from "every type chip" to "the foundation
chip only."

This is a v1-style cosmetic refactor: same shape as Phase 0
(registry + viewer extraction): and is the right precondition for
v2's parallel chips. Mirrors v1 proposal §3.3.

Critically: this MUST land before the foundation chip (§6.2 Phase 0b)
so the foundation chip doesn't drag both extraction + composition
into one mega-chip.

#### Phase 0b: foundation chip (sequential, ~3–4 days, ~28–40 hours)

**Goal:** Land the composition primitive end-to-end:

1. `CompoundComponent`, `CompoundChildSnapshotEntry`,
   `CompoundSnapshotPayload` interfaces in `types.ts`
2. `Method.method_type` widened by `"compound"`
3. `Method.components?: CompoundComponent[]` field
4. `TaskMethodAttachment.compound_snapshots: string | null` field
5. Cycle-detection algorithm + depth-limit constant in
   `frontend/src/lib/methods/compound-graph.ts`
6. `CompoundMethodTabContent` viewer with sticky-chip TOC,
   inline error bands for cycles + orphans
7. `CompoundMethodBuilder` workspace with drag-reorder + sub-picker
   (+ inline-create child via type-specific editor launcher)
8. Per-type child-viewer adapters
   (`nestedSnapshot?: { read, write }` prop on the seven existing
   viewers, including the recursive compound case)
9. `DeleteMethodConfirm` three-button modal in
   `frontend/src/components/methods/DeleteMethodConfirm.tsx` + wire
   into `handleDelete` in
   [methods/page.tsx:288](frontend/src/app/methods/page.tsx:288)
10. Registry entry for `compound` in
    [method-type-registry.ts](frontend/src/lib/methods/method-type-registry.ts)
11. Fixture record (one demo compound in
    `wiki-capture-fixture.ts` per HR memory, plus
    `scripts/generate-demo-data.mjs` mirror: flagged for wiki
    manager handoff)

#### Phase 1: three type chips in parallel (~3–4 days wall-clock, ~36–50 hours of sub-bot work)

After phase 0b lands, the three type chips run in parallel. Each
chip is constrained to its own per-type files:

| Chip | Touches |
|---|---|
| Coding workflows | `types.ts` (CodingWorkflow* banner), `local-api.ts` (codingWorkflowApi block + store), `json-store.ts:4` (PUBLIC_ENTITIES: add `"coding_workflows"`), `method-type-registry.ts` (one entry), `methods/page.tsx` (one branch in `handleDelete`'s switch: see [methods/page.tsx:296-345](frontend/src/app/methods/page.tsx:296)), `MethodTabs.tsx` (one branch in `resolveMethodType` + one switch case), new components |
| Mass spec | Same shape; new files: `MassSpecEditor.tsx`, `MassSpecViewer.tsx`, new banner in types |
| qPCR analysis | Same shape; new files: `QpcrAnalysisEditor.tsx`, `QpcrAnalysisViewer.tsx`, `QpcrAnalysisViz.tsx`, new banner; also new `TaskMethodAttachment.qpcr_analysis` field |

**Parallel-chip lessons applied:**

1. **Pre-assign fixture method-id ranges.** The demo data has
   methods up through id ~8 today (post v1 close at `98e45aaa`).
   Assign:
   - Coding workflow chip: fixture method gets id 9
   - Mass spec chip: fixture method gets id 10
   - qPCR analysis chip: fixture method gets id 11
   - Coding workflow public protocol: id 1 in `coding_workflows/`
   - Mass spec public protocol: id 1 in `mass_spec_methods/`
   - qPCR analysis public protocol: id 1 in `qpcr_analyses/`
2. **Pre-assign `TaskMethodAttachment` field order.** Only qPCR
   adds a field (`qpcr_analysis: string | null`) since coding
   workflows and mass spec carry no per-task state per Q-B4 /
   §4.5. The qPCR chip lands its field BEFORE the foundation
   chip's `compound_snapshots` field in the interface; manager
   pre-resolves the diff by specifying field order in the brief.
3. **Build the merge-bot pattern in from the start.** Each chip's
   merge to local main runs through a dedicated merge bot per the
   AGENTS.md §6 trap entry. The orchestrator does NOT attempt
   `awk`-union for any chip: the `TaskMethodAttachment` interface
   add (qPCR's `qpcr_analysis` field) sits right next to the
   foundation chip's `compound_snapshots` field, and the resulting
   conflict region is mid-interface, which is exactly where
   `awk`-union breaks.
4. **Explicit-path staging.** All merges finalize with
   `git add <conflicted-files> && git commit --no-edit`, never
   `git add -A`.

#### Phase 2: wiki manager handoff (~10–14 hours, separate manager)

Wiki manager takes the handoff after all v2 chips merge. Out of
scope for this proposal beyond surfacing the implications in §9.

### 6.3 Why not pure parallel from the start

Pure-parallel would mean: phase 0a + phase 0b + three type chips all
running in parallel. Cost reasons against:

- **Phase 0a touches the same `methods/page.tsx` region as every
  type chip.** Doing them in parallel guarantees an N-way conflict
  on the picker.
- **Phase 0b's foundation chip is a precondition for all v2 features
  that USE composition.** Coding workflows + mass spec + qPCR don't
  technically depend on the compound primitive (they can each ship
  standalone). But the qPCR analysis type's onboarding story
  (§5.6 "qPCR full kit" fixture) and the mass spec type's design
  promise ("LC-MS = LC + MS compound") both depend on phase 0b
  having landed. Shipping the types before the primitive means the
  user sees broken-feeling individual types until the primitive
  catches up.
- **The compound builder's UX overlaps with the per-type editors'
  patterns.** If phase 0b finishes after the per-type chips, the
  per-type chips may inadvertently set patterns the compound builder
  has to retroactively conform to.

Sequential phase 0a → phase 0b → parallel phase 1 trades ~2 days of
wall-clock for substantial integration-cost savings.

---

## 7. Cost estimates per chip

Estimates in **sub-bot hours** (rough), broken into the line items
the v1 retrospective identified as load-bearing. Fixture data is
counted per HR memory (it is a first-class cost).

### 7.1 Phase 0a: picker-registry refactor (one-time)

| Line | Hours | Notes |
|---|---|---|
| Extract `CreateMethodModal` + `MethodTypePicker` to new files | 2–3 | ~250 LOC moved across two new files |
| Update import sites in `methods/page.tsx` | 1 | Single-file edit |
| Test coverage update if any tests pin the modal at the old path | 1–2 | Probably none today, but verify |
| Fixture data | 0 | None |
| **Subtotal** | **4–6** | |

### 7.2 Phase 0b: composition primitive (foundation)

| Line | Hours | Notes |
|---|---|---|
| Type interfaces (`CompoundComponent` + snapshot shapes) | 1 | `types.ts` banner add |
| `compound-graph.ts` (cycle detection + depth limit) | 2–3 | New file, ~120 LOC + tests |
| `CompoundMethodTabContent` viewer + sticky-chip TOC | 4–5 | ~250–350 LOC |
| `CompoundMethodBuilder` workspace + sub-picker | 10–14 | Largest single component v2 ships; 1,200–1,500 LOC budget |
| Per-type child-viewer adapters (7 viewers) | 3–4 | ~30–50 LOC each, plus careful threading |
| `DeleteMethodConfirm` three-button modal + wire-in | 2–3 | ~150 LOC component + delete-handler rewire |
| Registry entry for `compound` | 0.5 | One-line in `method-type-registry.ts` |
| Foundation fixture record (one demo compound) | 0.5–1 | Flagged for wiki manager |
| `TaskMethodAttachment.compound_snapshots` field + JSON store | 1 | Single field add + readers/writers in `local-api.ts` |
| Adapter for `methods/page.tsx`'s `handleDelete` to handle compound | 1 | One branch addition |
| Manual test pass (cycle / orphan / per-child snapshot edit) | 2–3 | Cycle case + orphan case + per-child edit verification |
| **Subtotal** | **27–39** | |

### 7.3 Phase 1a: Coding workflows

| Line | Hours | Notes |
|---|---|---|
| Interfaces + `codingWorkflowApi` in `local-api.ts` | 2–3 | Mirror `cellCultureApi` |
| `PUBLIC_ENTITIES` + counter line | 0.5 | One-line additions |
| Registry entry | 0.5 | One-line in `method-type-registry.ts` |
| `CodingWorkflowEditor.tsx` | 3–4 | 300–450 LOC |
| `CodingWorkflowViewer.tsx` + sub-renderers | 3–4 | 200–300 LOC across `SyntaxHighlightedCode.tsx` + `IpynbRenderer.tsx` |
| `parseNotebook` parser + tests | 2 | 100–150 LOC + nbformat-v4 fixture |
| `methods/page.tsx` `handleDelete` branch + inline viewer dispatch + `MethodTabs.tsx` switch | 1 | Single-file 2-branch additions |
| Per-language icons | 0.5–1 | Pull SVG paths from Devicons / Simple Icons for 7 languages |
| Fixture data (1 demo coding workflow) | 0.5–1 | Flagged for wiki manager |
| **Subtotal** | **13–17** | |

### 7.4 Phase 1b: Mass spec parameters

| Line | Hours | Notes |
|---|---|---|
| Interfaces + `massSpecApi` in `local-api.ts` | 2–3 | Mirror `lcGradientApi` |
| `PUBLIC_ENTITIES` + counter line | 0.5 | |
| Registry entry | 0.5 | |
| `MassSpecEditor.tsx` (smart-per-mode rendering) | 4–5 | 400–550 LOC |
| `MassSpecViewer.tsx` | 1.5–2 | 150–250 LOC |
| `methods/page.tsx` handler + viewer-dispatch branches | 1 | |
| Fixture data (1 demo MS method, ideally as part of a public LC-MS compound) | 0.5–1 | Flagged for wiki manager |
| **Subtotal** | **10–13** | |

### 7.5 Phase 1c: qPCR analysis

| Line | Hours | Notes |
|---|---|---|
| Interfaces + `qpcrAnalysisApi` in `local-api.ts` | 2–3 | |
| `PUBLIC_ENTITIES` + counter line | 0.5 | |
| `TaskMethodAttachment.qpcr_analysis` field | 0.5 | |
| Registry entry | 0.5 | |
| `QpcrAnalysisEditor.tsx` | 4–5 | 400–550 LOC |
| `QpcrAnalysisViewer.tsx` | 1.5–2 | 200–300 LOC |
| `QpcrAnalysisViz.tsx` (standard curve + ΔΔCq) | 2 | 150–250 LOC, recharts-based |
| `methods/page.tsx` handler + viewer-dispatch branches | 1 | |
| Fixture data ("qPCR full kit" compound pairing PCR + qPCR analysis as a demo) | 1 | Flagged for wiki manager |
| **Subtotal** | **13–15** | |

### 7.6 v2 grand total

| Bucket | Hours |
|---|---|
| Phase 0a: picker-registry refactor | 4–6 |
| Phase 0b: composition primitive | 27–39 |
| Phase 1a: coding workflows | 13–17 |
| Phase 1b: mass spec | 10–13 |
| Phase 1c: qPCR analysis | 13–15 |
| **v2 total (implementation, excl. wiki)** | **67–90** |
| Wiki manager handoff (separate) | 10–14 |

Wide spread reflects:

- The compound builder's LOC budget (1,200 floor vs 1,500 ceiling)
- The orphan-handling / delete-prompt edge cases (a 2x range
  between best-case and "found a snapshot-blob versioning bug during
  manual test pass")
- The depth of the parallel-chip merge work in phase 1

---

## 8. Open questions for Grant lock-in

Each pre-bundled with options ready for `AskUserQuestion` relay
(clickable). Recommended option is first, marked **(recommended)**.

### Q-C2. Mass spec field shape

How should the mass spec editor present fields across ionization
modes?

- **Smart-per-mode editor with "Show all fields" escape hatch
  (recommended)**: Discriminator `ionization_mode` ∈ {esi+,
  esi−, esi-switching, apci+, apci−, ei, maldi, other}; editor shows
  mode-specific source-param fields only (e.g. capillary kV for ESI
  / APCI, MALDI matrix for MALDI). Scan / calibration fields always
  show. "Show all fields" power-user toggle. See §4.4 visibility
  table.
- **Always-show all fields**: Simpler editor; every field renders
  regardless of mode. Uglier UX for the 90% case.
- **Two separate method types (ESI method + MALDI method)**:
  Clean separation; doubles fixture maintenance + registry tile count.

### Q-D2. qPCR shape

How should qPCR enter v2?

- **Analysis-only method type composed with PCR via the composition
  primitive (recommended)**: New `method_type: "qpcr_analysis"`
  carrying Cq + melt + standard curve + ΔΔCq. Pairs with any PCR
  cycling method via a compound. Smallest editor (400–550 LOC);
  zero PCR record bloat; perfect fit for the composition primitive.
- **Full qPCR-protocol method type (cycling + analysis,
  independent)**: Self-contained but duplicates ~70% of PCR's
  1,708-LOC thermocycler editor.
- **Extend PCR with optional `qpcr_analysis` fields**: Cheapest in
  code; conflates two workflows on one record; field bloat for
  non-qPCR PCR users.

### Q-S1. Implementation sequencing

After the foundation lands (phase 0a + phase 0b), how should the
three type chips proceed?

- **Parallel after foundation (recommended)**: Coding workflows +
  mass spec + qPCR all in parallel after phase 0b lands. Apply v1
  parallel-chip lessons (pre-assigned id ranges, dedicated merge
  bots, explicit-path staging). ~3–4 days wall-clock for the type
  chips.
- **Sequential one-at-a-time after foundation**: Each type chip
  fully ships before the next starts. Lower integration risk; ~6–9
  days wall-clock.
- **Hybrid: coding workflows ships first (it's the most
  user-distinct), then mass spec + qPCR in parallel**: Two-week
  timeline but lets the first type validate the registry+composition
  surface before stressing it with three chips at once.

### Q-V1. Compound public sharing

Per §2.9, cross-user sharing of compound methods is recommended
**out of scope for v2** (the share path would need recursive
walking; v2.1 work). v2's compound builder hides the "Make public"
toggle for compound methods.

- **Hide the "Make public" toggle for compounds in v2 (recommended)**
 : Compounds are private-only in v2; v2.1 adds the recursive
  share path.
- **Allow public compounds but warn users that public sharing won't
  cascade to children**: Public compound row exists, but
  receivers see "Method N (not shared)" placeholders for any child
  that isn't independently public. Half-shared compounds render
  broken.
- **Block v2 entirely until v2.1 ships compound sharing**: Delays
  v2 by another arc.

### Q-V2. Compound TOC layout

Per §2.3.3, the recommended TOC is a sticky horizontal chip strip
at the top of the compound's tab content. Confirm or override.

- **Sticky horizontal chip strip (recommended)**: Mirrors the
  page-level tab strip; flexes for deep nesting via chip wrapping.
- **Sticky vertical sidebar**: More room for long labels; competes
  with the page-level sidebar for real estate; feels nested.
- **Inline TOC at the top of the tab content (non-sticky)**:
  Cheapest; user has to scroll back up to navigate.

### Q-V3. Compound depth limit

Per §2.6.2, recommended depth = 4. Confirm or override.

- **Depth 4 (recommended)**: Covers every realistic lab use case;
  TOC chip strip stays readable.
- **Depth 3**: Slightly tighter; forces flattening for the
  4-level nested-kit case.
- **Depth 5**: Looser; TOC chip strip starts feeling busy at
  5 levels.

---

## 9. Wiki implications (surface, don't write)

Per AGENTS.md §6, the wiki manager owns `frontend/src/app/wiki/**`,
`frontend/src/lib/wiki/nav.ts`, `scripts/capture-wiki-screenshots.mjs`,
and `frontend/src/lib/file-system/wiki-capture-fixture.ts`. v2's
planning sub-bot does NOT write wiki pages. Surface only.

### 9.1 New wiki pages required

- `frontend/src/app/wiki/features/compound-methods/page.tsx`: the
  composition primitive concept page. Probably the most
  screenshot-heavy of all v2 wiki pages because the UX is
  meaningfully new (builder workspace, TOC strip, in-place per-child
  edit). The wiki voice memory (`feedback_wiki_voice.md`) applies:
  concept-first ("a compound method is a kit"), screenshot-heavy.
- `frontend/src/app/wiki/features/coding-workflows/page.tsx`: code
  + Jupyter notebook concept page.
- `frontend/src/app/wiki/features/mass-spec/page.tsx`: MS
  parameters concept page; explicitly demos the "LC-MS = LC + MS
  compound" pattern.
- `frontend/src/app/wiki/features/qpcr/page.tsx`: qPCR analysis
  concept page; demos the "PCR + qPCR analysis compound" pattern.

Plus updates to:

- `frontend/src/app/wiki/features/methods/page.tsx`: the methods
  parent page (current mentions of v1 types) updated to include the
  v2 types + a paragraph framing the composition primitive.
- `frontend/src/lib/wiki/nav.ts`: new nav entries pointing the v2
  features at their pages, mirroring v1's pattern.

### 9.2 Per-type fixture coverage seeds for the wiki capture script

Per HR memory `feedback_screenshot_privacy.md`: every screenshot
uses `?wikiCapture=1` fixture mode (real user data must never be
screenshotted). Each v2 type needs at least one realistic record in
`wiki-capture-fixture.ts` + the matching `scripts/generate-demo-data.mjs`
seed.

Recommended fixture seeds (manager-to-manager handoff via the master):

- **Compound primitive demo:** one public compound method ("Assay X
  full kit") composing the existing public plate method + an
  inline-created public markdown PDF instructions method.
- **Coding workflow demo:** one public coding workflow ("RNA-seq QC
  pipeline.py") with realistic Python content (~30 lines) + one
  public notebook-flavored coding workflow that embeds a parseable
  `.ipynb` with two markdown cells + two code cells with cached
  outputs.
- **Mass spec demo:** one public ESI+ mass spec method (Thermo
  Q-Exactive instrument, realistic source/scan params), wired into a
  public "LC-MS combined kit" compound that pairs the existing
  public LC gradient method + the new MS method.
- **qPCR analysis demo:** one public qPCR analysis method (SYBR
  chemistry, GAPDH reference + target_of_interest target,
  realistic standard curve points), wired into a public "qPCR full
  kit" compound that pairs the existing DemoCheck PCR method +
  the qPCR analysis method.

Plus per-type demo methods in each demo user's `methods/`
referencing the public protocols via `source_path`, so the wiki
capture flow shows "Alex has a method using this compound" not
just an orphan record.

### 9.3 Screenshot list (handoff to wiki manager: not v2 scope)

Per type, the wiki capture pass needs approximately:

- **Compound primitive page:** Hero (the rendered compound with TOC
  + stacked children), the builder workspace, the sub-picker, a
  before/after of in-place per-child edit, the three-button delete
  prompt, the orphan-handling band.
- **Coding workflows page:** Hero (the inline-rendered Python
  preview with syntax highlighting), the `.ipynb` cell-stack render,
  the editor modal.
- **Mass spec page:** Hero (the smart-per-mode editor showing only
  ESI fields), the LC-MS compound rendering both LC + MS sections.
- **qPCR analysis page:** Hero (the qPCR full kit compound rendering
  PCR cycling above qPCR analysis with its standard-curve plot),
  the editor showing references table + standard curve points.

Estimated 12–16 screenshots total. Wiki manager batches post-merge
of all v2 chips per v1's pattern.

### 9.4 No diff display for v2 types

Per Q-B4 lock (no per-task state for coding workflows + mass spec)
and the static-template-only design for those types, the v1 Phase
2B markdown-diff-overlay pattern doesn't apply. qPCR analysis has
per-task snapshot (the actual Cq readouts) but its diff is "did the
user enter Cq values" rather than line-by-line text; the
default-renderer-no-diff path is correct. No `diff-display.ts`
extensions needed.

---

## 10. Cost-vs-value verdict: risks and what to watch

### 10.1 The composition primitive is genuinely architectural

Unlike v1's type additions (which extended an established pattern),
v2's foundation chip changes assumptions about how the snapshot
pattern works:

- v1 puts each per-type snapshot on its own field on
  `TaskMethodAttachment` (`pcr_gradient`, `lc_gradient`,
  `plate_annotation`, `cell_culture_schedule`, `body_override`).
  When a type rolls schema, you add a per-type read-time normalizer
  and the other types are untouched.
- v2's `compound_snapshots` field bundles N per-child snapshots
  into a single JSON-string column. If a child method type rolls
  schema, every compound attachment carrying that child's old
  snapshot needs a forward-compatible reader OR a repair pass over
  the compound_snapshots blob to update the nested per-child
  blob.

**Mitigation: ship the per-child `schema_version` field from day
one (§2.1.2).** Readers gate on `schema_version` per child and can
selectively migrate. Without it, a schema roll on (say) plate
methods in v2.1 forces every compound's read path to either tolerate
the old shape or do a full sweep. With the version field, the read
path knows when to migrate that one child snapshot in place.

### 10.2 What to watch during phase 0b

The implementation sub-bot for the foundation chip should
specifically verify, before reporting COMPLETE:

1. **The sticky TOC stays sticky.** Verify by scrolling the
   compound's tab content past one screen and confirming the chip
   strip pins to the top of the visible area. Don't trust CSS
   `position: sticky` to "just work": its behavior depends on the
   ancestor overflow chain; if a parent has `overflow: hidden`, the
   stickiness silently breaks. Reference AGENTS.md §6's `h-full`
   chain trap.
2. **The per-child edit save round-trips.** Open a compound on an
   experiment task, edit one child (say, paint a well in a plate
   child), save, reload, verify the painted well persists. This is
   the snapshot-write path's golden case.
3. **Cycle detection catches the obvious case.** Create compound A,
   try to make A reference itself. Builder save must block with a
   toast naming the cycle.
4. **Orphan rendering doesn't crash.** Build a compound, then
   delete one of its children via "Just delete." Reload the
   compound; verify the inline placeholder renders without throwing.
5. **Public-toggle is hidden** for compounds (per §2.9's sharing
   carve-out).

### 10.3 What to watch during phase 1's parallel arc

Per AGENTS.md §6's parallel-chip trap entry:

1. **Verify the fixture-method-id assignments before each chip
   merges.** Each chip's brief should call out its assigned id; the
   orchestrator (master) verifies none have drifted before
   approving the merge.
2. **Do NOT awk-union the `TaskMethodAttachment` interface.** The
   `qpcr_analysis` field add sits adjacent to the foundation's
   `compound_snapshots` field. Spawn a focused merge bot for the
   qPCR merge specifically; it lives in its own worktree and
   resolves by hand. The other two chips (coding workflows + mass
   spec) don't add fields to `TaskMethodAttachment` and can merge
   more mechanically.
3. **Explicit-path staging on every merge.** No `git add -A` in
   any merge. Use `git add <files> && git commit --no-edit`.

### 10.4 Latent-bug risk areas

The composition primitive touches three load-bearing v1 patterns;
each is a possible latent-bug surface:

- **The snapshot pattern.** Already covered above (§10.1).
- **The per-task attachment storage layout.** `TaskMethodAttachment`
  is read on every task load. Adding `compound_snapshots` widens
  the row size (a large compound's snapshot blob could be 5–10 KB
  of JSON). For a task with 10 method attachments, this could add
  50–100 KB to the read. The disk-only architecture is fine with
  this, but the in-memory `tasksApi` cache might churn more. Not
  expected to be a problem at lab-scale data sizes but worth a
  manual check at phase 0b's end.
- **The receiver-edit path for shared tasks.** When alex shares a
  task with morgan, and the task has a compound method attached,
  morgan's edit to a child component writes back to alex's
  `compound_snapshots` field on the task row. This rides on the
  existing shared-task editable-edit path (commit `b748... ish`,
  cross-reference v1's "editable shared tasks" line in AGENTS.md
  §7) which writes to the owner's directory. The compound's
  per-child snapshot doesn't change the routing: it's still on the
  task row in alex's namespace: but the new field needs to survive
  the writer routing without dropping. Verify during phase 0b's
  manual test pass.

### 10.5 Why the verdict is still "ship it"

Despite the risks, v2 is worth shipping for the same reasons v1 was:

- The composition primitive is the right architectural shift. Lab
  workflows ARE composite by nature (assay = plate + protocol +
  reagents + analysis). Trying to force everything through
  single-typed methods fights the user's mental model. v2
  finally lets the data shape match how labs think.
- The three type chips are tractable. None of them exceeds the v1
  editor-LOC ceiling; none of them changes load-bearing patterns
  outside its own files; each one's design is in this proposal.
- The risk surface is well-mapped and locally bounded. The biggest
  unknown (snapshot-blob versioning) has a cheap mitigation
  (per-child `schema_version` field). The other risks are
  process-shaped (merge discipline, parallel-chip lessons), and v1
  proved the orchestrator can apply those.

The cost-vs-value verdict: 67–90 hours for the composition primitive
+ three type additions, with a clear sequencing plan and well-mapped
risks. v2 is a meaningful expansion of the methods system without
betting the architecture on an unproven pattern.

---

## Appendix A: files referenced

Reference set used in writing this proposal. Useful for the manager's
chip briefs:

- [METHODS_EXPANSION_V2_DESIGN_QUESTIONS.md](METHODS_EXPANSION_V2_DESIGN_QUESTIONS.md)
 : the design-questions doc this proposal answers
- [frontend/src/lib/types.ts:179-214](frontend/src/lib/types.ts:179)
 : `TaskMethodAttachment` with per-type snapshot fields (the
  new `compound_snapshots` field sits beside these)
- [frontend/src/lib/types.ts:435-472](frontend/src/lib/types.ts:435)
 : `Method` shape + `method_type` discriminator at line 439 (widens
  by 4 new literals in v2)
- [frontend/src/lib/methods/method-type-registry.ts](frontend/src/lib/methods/method-type-registry.ts)
 : the cosmetic-only registry (one entry per v2 type to add)
- [frontend/src/lib/storage/json-store.ts:4-10](frontend/src/lib/storage/json-store.ts:4)
 : `PUBLIC_ENTITIES` (gains 3 new entries in v2)
- [frontend/src/components/MethodTabs.tsx:202-302](frontend/src/components/MethodTabs.tsx:202)
 : viewer-dispatch switch (gains 4 new cases in v2)
- [frontend/src/components/MethodTabs.tsx:311-320](frontend/src/components/MethodTabs.tsx:311)
 : `resolveMethodType` legacy-fallback (4 new types in the
  return union)
- [frontend/src/app/methods/page.tsx:288-354](frontend/src/app/methods/page.tsx:288)
 : `handleDelete` per-type cleanup (gains compound + 3 new types)
- [frontend/src/app/methods/page.tsx:547-559](frontend/src/app/methods/page.tsx:547)
 : `CreateMethodModal` mount (phase 0a extracts to its own file)
- [frontend/src/app/methods/page.tsx:582-658](frontend/src/app/methods/page.tsx:582)
 : `MethodTypeCategoryPicker` + `MethodTypeSection` (phase 0a
  extracts to its own file)
- [frontend/src/lib/local-api.ts:1452-1586](frontend/src/lib/local-api.ts:1452)
 : `pcrApi` CRUD pattern (per-type APIs mirror this)
- [frontend/src/lib/local-api.ts:1587-1704](frontend/src/lib/local-api.ts:1587)
 : `lcGradientApi` (more recent precedent, also useful)
- [frontend/src/lib/local-api.ts:2773-2870](frontend/src/lib/local-api.ts:2773)
 : `sharingApi` (the v2 compound-sharing carve-out lives at this
  surface; v2.1 work)
- [frontend/src/components/InteractiveGradientEditor.tsx](frontend/src/components/InteractiveGradientEditor.tsx)
 : 1,708 LOC PCR editor (the ceiling reference for the compound
  builder's 1,500 budget)
- [frontend/src/components/LcGradientEditor.tsx](frontend/src/components/LcGradientEditor.tsx)
 : 851 LOC LC editor (v1 precedent)
- [frontend/src/components/CellCultureScheduleEditor.tsx](frontend/src/components/CellCultureScheduleEditor.tsx)
 : 713 LOC cell culture editor (v1 precedent)
- [frontend/src/components/PlateLayoutEditor.tsx](frontend/src/components/PlateLayoutEditor.tsx)
 : 614 LOC plate editor (v1 precedent)
- [frontend/package.json:31-32](frontend/package.json:31)
 : `recharts` + `rehype-highlight` already in deps; no new
  bundle weight for v2's coding-workflow preview or qPCR viz
- AGENTS.md §6: known traps; the parallel-chip integration trap
  entry (logged at v1 close `98e45aaa`) shapes §6's sequencing
- AGENTS.md §6: wiki manager carve-out for `/wiki/**`
- `METHODS_EXPANSION_PROPOSAL.md` (v1 proposal, on branch
  `claude/elegant-rhodes-bff093` at commit `48f793bb`): voice
  + structure precedent this proposal mirrors

## Appendix B: out-of-scope notes for the manager

These items the manager should explicitly carve out of v2 chip
scope and defer:

- **Cross-user sharing of compound methods.** §2.9. v2.1 work; v2
  hides the "Make public" toggle for compounds.
- **Repair scripts per v2 type.** Mirrors v1 §7: a repair script is
  a response to schema drift, not a precondition. v2 types start
  clean. The compound primitive's per-child `schema_version` is the
  forward-compat hedge.
- **Plate-map widget reuse for v2 (mass spec or qPCR).** Plate
  layout is its own v1 type; qPCR plate maps are a v2.1 candidate
  if users start asking for them.
- **Run-log fields for coding workflows.** §3 / Q-B4 lock: no
  per-task state.
- **In-page Monaco / CodeMirror editor.** §3.5 / Q-B5 lock:
  textarea-based editor only.
- **Full interactive notebook execution.** §3.4: read-only static
  outputs only. Pyodide / Jupyter-in-browser is out of scope.
- **MS/MS scheduling beyond a simple toggle + isolation/collision
  fields.** §4.4: structured DDA / DIA scheduling is v2.1.
- **qPCR melt-curve raw -dF/dT plotting.** §5.5: v2 stores Tm
  values, not raw curves.
- **ELN auto-detection of compound shape.** Flag for the LabArchives
  revamp manager at v2.1 stage (mirrors v1 §10's punt for structured
  type auto-detection).
- **`StructuredMethodEditor<TProtocol>` framework shell.** Still
  rejected: v1 §3 endorsed per-type bespoke, v2 inherits the
  verdict. Composition is composition, not a framework.

v2 planning sub-bot
