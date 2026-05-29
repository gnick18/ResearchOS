# Method Library / Store: Design Doc

Author: method-library design
Date: 2026-05-29
Status: Proposal (no code written; this is a design only)

## 0. TL;DR

The product owner wants a "prebuilt method library / store": offer many structured
method types and ready-made protocol templates, let users add only the ones they
want (anti-clutter), let them request new ones, and eventually let outside people
build and contribute their own method modules after peer review, with an open-source
community feel.

The single hardest fact this doc has to confront: method TYPES are CODE (React
viewers plus editors plus per-type create/serialize logic), not data. ResearchOS is
local-first with no application server and no sandbox (only thin Vercel proxy routes
under `frontend/src/app/api/`, capped near 4.5MB, no compute). You therefore cannot
safely download and execute arbitrary third-party plugin code at runtime in the app.

Recommendation:

1. Distribute method TYPES as open-source GitHub pull requests that implement a
   formal `MethodTypeModule` interface and register into the existing registry. The
   PR review IS the peer review. Modules ship inside the normal app build. The in-app
   "store" becomes a CURATION layer (browse, enable/disable per scope, request a new
   type), not a code-download mechanism.

2. Ship a separate, much-easier, data-only TEMPLATE CATALOG first: standard protocols
   (a PCR recipe, a western-blot markdown, an LC gradient as data) that are just
   instances of EXISTING types. Pure static JSON plus assets on the Vercel deploy.
   No code shipping, no security surface, shippable far sooner.

Sequence: Phase 1 template catalog, Phase 2 formalize `MethodTypeModule` plus
per-scope enable/disable curation, Phase 3 contributor docs plus the PR/peer-review
pipeline plus the request flow.

---

## 1. Current-state analysis of the method-type framework

### 1.1 What a "method type" is made of today

A method type is spread across four layers. Nine of the ten types are first-class
picker entries; `compound` is reachable only by extending an existing method.

The ten types: `markdown`, `pdf`, `pcr`, `lc_gradient`, `plate`, `cell_culture`,
`mass_spec`, `compound`, `coding_workflow`, `qpcr_analysis`.

Layer A. The discriminator union (source of truth)

`frontend/src/lib/types.ts:784` defines `Method.method_type` as a hand-written string
literal union, duplicated across `Method`, `MethodCreate`, and `MethodUpdate`
(lines 784, 814, 840). Adding a type means editing all three literals. The cosmetic
registry's `MethodTypeId` (`frontend/src/lib/methods/method-type-registry.ts:34`) is a
parallel copy of the same union that the file comment says "widen in lockstep" with
`types.ts`. So the discriminator lives in two places that must stay manually in sync.

Layer B. Cosmetic registry (the one genuinely modular piece)

`frontend/src/lib/methods/method-type-registry.ts` holds `METHOD_TYPE_REGISTRY`, a
`Record<MethodTypeId, MethodTypeMeta>`. Each entry carries `id`, `label`, `shortLabel`,
`color` (Tailwind bg/text), `icon` (a component from `method-type-icons.tsx`),
`description`, `hasStructuredProtocol`, `category` (`"standard" | "structured"`), and
optional `hiddenFromPicker` (used by `compound`). The file comment is explicit that it
is "cosmetic-only" and DELIBERATELY excludes viewer/editor components, repair
functions, and API surfaces, because a component registry "would couple bundle weight
to every registered type". `getMethodTypeMeta` falls back to `markdown` for null/legacy
records. `getMethodTypesByCategory` powers the picker sections and filters
`hiddenFromPicker`.

The per-type icons are inline SVGs in
`frontend/src/lib/methods/method-type-icons.tsx` (no emoji, no lucide dependency, in
line with the project's custom-SVG convention).

The picker UI, `frontend/src/components/methods/MethodTypePicker.tsx`, is already fully
registry-driven: it renders the Standard and Structured sections purely from
`getMethodTypesByCategory`. Adding a registry entry adds a tile with no picker edit.
It also owns `methodTypeTourSlug` for the onboarding v4 breadth tour.

Layer C. Viewer/editor dispatch (hardcoded switches, NOT registry-driven)

There are three hand-written dispatch sites keyed on `method_type`:

- `frontend/src/components/MethodTabs.tsx` (the per-task attachment view): a `switch`
  around line 281 over `resolvedType` with a `case` per type, each importing a distinct
  `*MethodTabContent` component (imports at lines 11 through 20). The in-file comment
  says "Adding a new method type here adds one case plus one import."
- `frontend/src/app/methods/page.tsx` around line 1156: an if-chain
  (`if (method.method_type === "pdf") ... return <PdfViewer .../>`, etc.) that selects
  the library-page full viewer per type, ending in a markdown default.
- `frontend/src/app/methods/page.tsx` around lines 389 and 492: structured-protocol
  resolution by `source_path` prefix (`pcr://protocol/`, `lc_gradient://`, etc.) for
  hydrating the structured record alongside the method row.

A short-label badge map is also hand-written in `MethodTabs.tsx` around line 155
(`method_type === "lc_gradient" ? "LC" : ...`), duplicating data the registry already
has in `shortLabel`.

Layer D. Per-type structured data, APIs, and create-defaults

Structured types carry a SECOND record alongside the `Method` row. Shapes live in
`types.ts` (e.g. `PCRProtocol` at line 879, `CellCultureSchedule`, `MassSpecProtocol`
at 1429, `CodingWorkflowProtocol` at 1193, `LCGradientProtocol`, `PlateProtocol`,
`QPCRAnalysisProtocol`). The `Method.source_path` field links the row to its structured
record via a URI scheme: `pcr://protocol/{id}`, `lc_gradient://protocol/{id}`,
`plate://protocol/{id}`, `cell_culture://protocol/{id}`, `mass_spec://protocol/{id}`,
`coding_workflow://protocol/{id}`, `qpcr_analysis://protocol/{id}` (see local-api.ts
comments at 2320, 2439, 2534, 2654, 2777, 2892).

Each structured type has its own API object in `frontend/src/lib/local-api.ts`:
`pcrApi` (~2181), `lcGradientApi` (~2330), `plateApi` (~2442), `cellCultureApi`
(~2537), `codingWorkflowApi` (~2658), `qpcrAnalysisApi` (~2774), `massSpecApi`. Each
exposes `list/get/create/update/delete` PLUS create-defaults functions
(`getDefaultGradientSteps`, `getDefaultColumn`, `getDefaultIngredients`,
`getDefaultPlateSize`, `getDefaultCellLine`, `getDefaultMedia`,
`getDefaultIonizationMode`, `getDefaultScan`, `getDefaultCalibration`,
`getDefaultLanguage`, `getDefaultReferences`, etc.). These defaults are the literal
"new blank protocol" seed values.

`frontend/src/components/methods/CreateMethodModal.tsx` is the per-type create funnel:
it imports every per-type API and every structured editor (`InteractiveGradientEditor`,
`LcGradientEditor`, `PlateLayoutEditor`, `CellCultureScheduleEditor`, plus inline mass
spec / coding / qpcr editors), seeds local state from the `getDefault*` functions
(lines ~213 through ~294), and on save runs a per-type branch (`pcrApi.create` then
`methodsApi.create` with `method_type: "pcr"`, etc., lines ~440 through ~625). This is
the single biggest hardcoded-per-type surface in the codebase.

Per-task instance snapshots (a per-task override of the shared protocol) are stored on
the `TaskMethodAttachment`: `types.ts` around lines 438 through 469 documents the
markdown-body override, the cell-culture instance JSON, the compound child-snapshot
blob, and the qPCR analysis snapshot. The compound child snapshot union is at
`types.ts:1516` through 1530.

### 1.2 Persistence model (local-first, per-user JSON)

All records persist through `JsonStore<T>` in
`frontend/src/lib/storage/json-store.ts`. Records live at
`users/<owner>/<entity>/<id>.json`; whole-lab shared records live at
`users/public/<entity>/<id>.json` (the `getPublicStore` variant). Ids come from
per-user `_counters.json`, except the `PUBLIC_ENTITIES` set (methods plus all seven
structured-protocol entities, json-store.ts:4 through 13) which use a global counter so
ids never collide between private and public namespaces. There is owner-routed
read/write (`getForUser`, `saveForUser`, `createForUser`) for the PI-edits-member and
shared-edit flows.

Method instances themselves go through `methodsApi` (local-api.ts ~1761) into the
`methods` entity; the structured sidecars go through their per-type APIs into their own
entities. So every method type already maps cleanly onto "one method row plus an
optional structured sidecar record, both JSON-on-disk".

### 1.3 Sharing model

Sharing is the unified primitive in `frontend/src/lib/sharing/unified.ts`, surfaced on
records via `shared_with: SharedUser[]` and the `[{ username: "*", level: "read" }]`
whole-lab sentinel (documented at `types.ts:818` through 833; `is_public` is
deprecated). The methods page splits My Methods from Shared with Lab via
`frontend/src/lib/methods/library-sections.ts` (`isOwnMethod`, `partitionMethodsByOwnership`,
`groupSharedMethodsByOwner`). Authorship (`created_by`) beats storage location: a method
I authored stays in My Methods even after I publish it to the lab. `is_shared_with_me`
overlay records always read as shared, never mine.

There is also a fork primitive: `MethodForkRequest` (`types.ts:1555`) with a
`deviations` field, plus `methodsApi` fork logic (local-api.ts ~1907 through ~1950)
that copies a shared method into the receiver's namespace.

### 1.4 The request and feedback rails that already exist

`frontend/src/components/FeedbackModal.tsx` plus `frontend/src/lib/error-reporting.ts`
already implement a "Feature request" type that opens a prefilled GitHub issue via
`generateGitHubIssueUrl` against `GITHUB_REPO = "gnick18/ResearchOS"`
(error-reporting.ts:1, returns `https://github.com/<repo>/issues/new?...` at line 197).
This is the exact rail a "request a method type" flow should reuse rather than reinvent.

### 1.5 Static asset hosting that already exists

The Vercel deploy already serves static JSON catalogs that the client `fetch`es
directly: `frontend/public/wiki-search-index.json` (consumed by
`frontend/src/lib/wiki/search.ts`, built by a script) and the entire demo lab under
`frontend/public/demo-data/` (consumed by `frontend/src/lib/demo/lab-demo-data.ts`,
which `fetch`es `${dir}/${id}.json`). This is the existing, proven pattern for a
data-only template catalog: no server, no proxy, just static files plus `fetch`.

### 1.6 Per-user/per-folder settings store that already exists

`frontend/src/lib/file-system/user-metadata.ts` is the per-user, folder-scoped settings
store (`users/_user_metadata.json`, field-at-a-time writes via `setUserMetadataField`).
`UserMetadataEntry` is additive: optional fields like `hide_goals_from_lab`,
`native_calendar_color`, `orcid` were each added without migration. This is the natural
home for "which method types this account has enabled" curation state.

### 1.7 Modularity scorecard

| Concern | Modular today? |
| --- | --- |
| Cosmetic meta (label, color, icon, picker tile, category) | Yes, fully registry-driven |
| Picker UI | Yes, derives from registry |
| Discriminator union | No, hand-written and duplicated in 4 spots (types.ts x3 + registry) |
| Viewer dispatch | No, 2 hardcoded switches/if-chains in page.tsx + MethodTabs.tsx |
| Editor dispatch + create funnel | No, one giant per-type branch in CreateMethodModal.tsx |
| Create-defaults | Partially, per-type `getDefault*` but not behind a common contract |
| Structured data shapes | No, bespoke interfaces per type in types.ts |
| Per-type API (CRUD + source_path scheme) | No, bespoke `*Api` object per type, but all share an identical JsonStore shape |
| Persistence | Yes, uniform JsonStore at `users/<owner>/<entity>` |
| Sharing | Yes, uniform unified primitive |

Read: the SEAMS are good (cosmetic registry, picker, persistence, sharing all already
generalize). The BEHAVIORAL glue (dispatch, create funnel, data shapes, per-type APIs)
is hardcoded, but uniform enough that a single `MethodTypeModule` contract can absorb
all of it without inventing new persistence or sharing machinery.

---

## 2. The core constraint and the recommended distribution model

### 2.1 The constraint, stated plainly

A method type is executable code. ResearchOS runs entirely client-side against the
user's local research folder. There is no application server, no compute, no sandbox.
The only server surface is a handful of thin Vercel proxy routes
(`frontend/src/app/api/`, e.g. `calendar-feed`, `telegram-file`) that exist purely to
add an Authorization header or dodge CORS, are size-capped near 4.5MB, and run no
user-supplied logic. Therefore the app cannot fetch a third-party module's JavaScript
at runtime and execute it: doing so would grant an unreviewed, externally-hosted bundle
full same-origin access to the user's File System Access handle, their IndexedDB
session, their Telegram and calendar tokens, and their entire on-disk research corpus.
That is an unacceptable supply-chain and data-exfiltration surface for an app whose
whole pitch (per the NIH-compliance and LabArchives-trust-flip positioning) is that the
lab's data stays in the lab's hands.

### 2.2 Options evaluated

(a) Open-source GitHub PRs that register into the build (RECOMMENDED)

Contributors author a module implementing the `MethodTypeModule` interface (Section 3)
in the public repo and open a PR. Maintainers review the code (the peer review), merge
it, and it ships in the next app build like any other first-party type. The in-app
"store" is a curation layer over the already-bundled set: browse, enable/disable per
scope, request new types via the existing GitHub-issue rail, and link contributors to
authoring docs.

- Security: every line of shipped code passed human review and lives in version
  control. No runtime code download. Identical trust model to the rest of the app.
- Local-first / no-server: nothing new server-side; GitHub hosts the source, Vercel
  hosts the build, the curation state is local JSON.
- Free / open-source feel: this IS the open-source workflow. The repo is already public
  (`gnick18/ResearchOS`), the feedback modal already files issues against it.
- Cost: contributions ship on the maintainer's release cadence, not instantly. A
  contributor cannot unilaterally publish. This is the correct tradeoff for a
  no-sandbox local-first app: gatekept-but-open beats instant-but-unsafe.

(b) Runtime plugin loading / dynamic import of remote code (REJECTED)

Fetch a remote bundle and `import()` / `eval` it at runtime. Rejected: an unreviewed
external bundle would run with full same-origin privileges (File System Access handle,
IndexedDB, all stored tokens, the entire research folder). There is no server to
sandbox or proxy execution, and no native process boundary in the browser. A compromised
or malicious module silently exfiltrates or corrupts unpublished research data. This is
precisely the threat the product's trust positioning exists to refute. Not viable.

(c) iframe / web-worker sandboxing of third-party module UI (REJECTED for now)

Render each third-party module inside a sandboxed iframe (or run its logic in a Worker)
with a narrow postMessage bridge. Technically the only way to run untrusted UI code
client-side with a real boundary, but the cost is severe and the payoff is low here:
- A method viewer/editor is deeply interactive (the plate layout editor, the gradient
  curve, drag interactions, file/image uploads, the experiments sidebar). Reproducing
  that through a postMessage RPC bridge is a large, brittle surface.
- Styling consistency, focus management, accessibility, the Tooltip convention, and
  the tour-target data attributes all break across the iframe boundary.
- You still have to define and police the data contract the module is allowed to touch,
  which is most of the work of option (a) anyway, plus an RPC layer.
- It does not remove the need for review of the module's data semantics; it only
  contains its DOM.
Revisit only if a genuine untrusted-at-runtime requirement appears (it does not today).

(d) Hosted plugin registry / server (REJECTED)

A central server that stores, signs, and serves plugin bundles, with the app fetching
them. Rejected: directly contradicts the no-server, free, local-first ethos; introduces
hosting cost, an availability dependency, and an attack surface; and still has to solve
the runtime-execution-of-untrusted-code problem from (b). The GitHub repo plus the
Vercel static deploy already provide hosting and distribution at zero marginal cost.

### 2.3 Recommendation

Adopt (a). Method TYPES are distributed exclusively as peer-reviewed PRs that ship in
the build. The in-app surface is a curation and request layer, never a code loader.
Separately and first, ship the data-only TEMPLATE CATALOG (Section 4.4 and Phase 1),
which has none of these constraints because it ships zero code.

---

## 3. Proposed `MethodTypeModule` interface

Goal: collapse the four hardcoded behavioral surfaces (dispatch switch x2, create
funnel, per-type API) behind one contract, so "add a method type" becomes "add one
module file plus register it" instead of "edit five files". The cosmetic registry
already proves the pattern; this extends it with the behavior the registry deliberately
left out, while preserving per-type code-splitting via lazy component refs.

### 3.1 The contract (illustrative TypeScript, not final)

```ts
// frontend/src/lib/methods/module-types.ts  (proposed)
import type { ComponentType, LazyExoticComponent } from "react";
import type { MethodTypeMeta } from "./method-type-registry";

export interface MethodTypeModule<TProtocol = unknown, TInstance = unknown> {
  // ── Identity + cosmetics (folds in today's MethodTypeMeta) ──
  meta: MethodTypeMeta; // id, label, shortLabel, color, icon, description,
                        // hasStructuredProtocol, category, hiddenFromPicker

  // ── Data schema ──
  // The entity name under users/<owner>/<entity>/. Null for code-only types
  // (markdown/pdf) that store everything on the Method row + attachments.
  protocolEntity: string | null;
  // Runtime validator for a structured-protocol record loaded from disk.
  // Returns the parsed protocol or throws/returns an error. Keeps the
  // "is this JSON actually this shape" check colocated with the type.
  parseProtocol?: (raw: unknown) => TProtocol;
  // The source_path URI scheme prefix, e.g. "pcr://protocol/". Used by the
  // resolver that hydrates the sidecar; replaces the hardcoded prefix
  // checks in methods/page.tsx ~389 / ~492.
  sourcePathScheme?: string;

  // ── Create-defaults ──
  // Produce a fresh blank protocol record for the create modal. Replaces the
  // scattered getDefault* calls (CreateMethodModal.tsx ~213-294).
  createDefaults: () => TProtocol;

  // ── Components (lazy refs so per-type bundles stay code-split) ──
  // The per-task attachment editor (today's *MethodTabContent).
  TabContent: LazyExoticComponent<ComponentType<MethodTabContentProps>>;
  // The full library-page viewer (today's PcrViewer / LcViewer / ...).
  LibraryViewer: LazyExoticComponent<ComponentType<MethodLibraryViewerProps>>;
  // The structured create/edit editor (today's LcGradientEditor etc.).
  // Omitted for markdown/pdf which use inline editors in the modal.
  CreateEditor?: LazyExoticComponent<ComponentType<MethodCreateEditorProps<TProtocol>>>;

  // ── Persistence hooks ──
  // Wrap the per-type API create/update/delete. Default implementation can be
  // generated from protocolEntity via a generic JsonStore<TProtocol>, since
  // every existing *Api is the identical shape (see local-api.ts).
  api?: MethodProtocolApi<TProtocol>;

  // ── Per-task instance override (optional) ──
  // Types where the task captures a per-run snapshot (cell_culture instance,
  // qpcr_analysis snapshot, compound child blob). Serialize/parse the blob
  // stored on TaskMethodAttachment. Omitted = shared protocol only, no
  // per-task divergence.
  instance?: {
    createInstanceDefaults?: (protocol: TProtocol) => TInstance;
    serializeInstance: (instance: TInstance) => string;
    parseInstance: (raw: string) => TInstance;
  };

  // ── Export / serialize (optional, forward-looking) ──
  // Render a portable, type-stamped representation for the template catalog
  // (Section 4.4) and for NIH-sharing / Zenodo deposit export. Returns a
  // plain JSON object the catalog format understands.
  toTemplate?: (protocol: TProtocol) => MethodTemplatePayload;
  fromTemplate?: (payload: MethodTemplatePayload) => TProtocol;
}
```

Notes on the design:
- `meta` is exactly today's `MethodTypeMeta`, so the cosmetic registry becomes a
  PROJECTION of the module registry (`Object.fromEntries(modules.map(m => [m.id, m.meta]))`),
  keeping `getMethodTypeMeta` / `getMethodTypesByCategory` working unchanged.
- Components are `LazyExoticComponent` refs (React.lazy) so registering a module does
  NOT pull its bundle into the registry's bundle. This preserves the exact code-split
  property the current "switch, not registry" comment is protecting, while still
  letting dispatch be a registry lookup instead of a hand-written switch.
- `api` is optional because every existing per-type API is structurally identical (per
  the local-api.ts comments: "Storage shape mirrors pcrApi exactly"). A generic factory
  over `JsonStore<TProtocol>` keyed on `protocolEntity` can synthesize the default; a
  module only supplies a custom `api` if it needs nonstandard routing.
- `instance` cleanly captures the existing per-task-snapshot divergence
  (cell_culture / qpcr_analysis / compound) without forcing the simpler types to model it.
- `compound` is special: it composes other modules rather than owning a leaf schema. It
  keeps `hiddenFromPicker: true` and its `TabContent` / `LibraryViewer` walk the
  `components[]` graph via the existing `compound-graph.ts`. The interface supports it
  by allowing `protocolEntity: null` plus a module-level `isComposite` flag (add if
  needed); no leaf `createDefaults` schema required.

### 3.2 The module registry and dispatch

```ts
// frontend/src/lib/methods/module-registry.ts  (proposed)
export const METHOD_MODULES: Record<MethodTypeId, MethodTypeModule> = {
  markdown: markdownModule, pdf: pdfModule, pcr: pcrModule, /* ... */
};
export function getMethodModule(id: MethodTypeId | null): MethodTypeModule {
  return METHOD_MODULES[id ?? "markdown"] ?? METHOD_MODULES.markdown;
}
```

Dispatch sites collapse to a lookup plus a lazy render:
- `MethodTabs.tsx` switch (~281): `const { TabContent } = getMethodModule(resolvedType); return <TabContent .../>`.
- `methods/page.tsx` viewer if-chain (~1156): `const { LibraryViewer } = getMethodModule(method.method_type); return <LibraryViewer .../>`.
- `methods/page.tsx` source_path prefix checks (~389/~492): iterate modules with a
  `sourcePathScheme` and match the prefix, instead of seven hardcoded `startsWith`.
- `MethodTabs.tsx` badge map (~155): read `getMethodModule(type).meta.shortLabel`.
- `CreateMethodModal.tsx` create branch (~440-625): replace per-type branches with
  `module.api.create(module.createDefaults())` then `methodsApi.create({ method_type, source_path })`,
  and render `module.CreateEditor` instead of the hardcoded editor imports.

### 3.3 Discriminator de-duplication

Today the union is written four times (types.ts x3, registry x1). Two clean-up options,
in order of preference:
1. Derive a single `MethodTypeId` from the module registry keys and use it everywhere,
   making the registry the source of truth. `Method.method_type` becomes
   `MethodTypeId | null`. This is the cleanest but touches the core `types.ts` shapes,
   which per the data-shape-touch rule must be FLAGGED in advance and verified before
   merge (it changes a persisted field's TypeScript type, though not its on-disk form).
2. Keep the union in `types.ts` as today and assert at module-registry init that the
   registry keys exactly equal the union (a compile-time `satisfies` plus a runtime test
   like the existing `library-sections.test.ts`). Lower blast radius, keeps the dup but
   makes drift impossible.

Recommend (2) during the refactor, then (1) once the module system is stable.

### 3.4 Refactor scope for the existing ten types

Per type the work is mechanical and uniform:
- Wrap existing `*MethodTabContent` and `*Viewer` in `React.lazy` refs.
- Move `getDefault*` from the per-type API object into the module's `createDefaults`
  (or have the module call the existing functions; no need to physically move them).
- Declare `protocolEntity` and `sourcePathScheme` (both already exist as conventions).
- For `cell_culture`, `qpcr_analysis`, `compound`: fill in `instance`.
- markdown/pdf: `protocolEntity: null`, no `CreateEditor` (keep modal inline fields).

Blast radius: every dispatch site and `CreateMethodModal.tsx` change, but each change
is a like-for-like substitution of "switch case" with "registry lookup of the same
component". No data shape changes on disk in option 3.3(2). High test value: a single
table-driven test can assert every module satisfies the contract and round-trips
createDefaults through parseProtocol.

---

## 4. In-app library / store UX

### 4.1 Where it lives

The `/methods` page (`frontend/src/app/methods/page.tsx`) already has a header with
"+ New Method" and "+ New Category" buttons (~line 757 through 780) and the
My Methods / Shared with Lab split. Add a "Browse method library" entry point in that
header (a button next to "+ New Method"). It opens a Library/Store panel (modal or
slide-over). Do NOT make it a separate top-level nav tab: it is a sub-surface of
Methods, and the orchestrator memory notes the lab recently trimmed nav tabs.

### 4.2 Browse

The store panel lists every method type the build ships, sourced from the module
registry (`Object.values(METHOD_MODULES)`), grouped by `meta.category`
(Standard / Structured), each as a tile with icon, label, description (the data the
cosmetic registry already carries). Each tile shows an enabled/disabled toggle and, in a
later phase, a "by <contributor>" attribution and a link to its source / docs. The
template catalog (4.4) appears as a second tab in the same panel: "Method types" vs
"Protocol templates".

### 4.3 Enable / disable per scope (the anti-clutter mechanism)

The clutter problem is that every lab sees all ten (soon many more) structured types in
the picker even though a molecular-biology lab never touches mass spec. Solution: a
per-account enabled-types set, stored as an additive field on `UserMetadataEntry`
(`frontend/src/lib/file-system/user-metadata.ts`), e.g.
`enabled_method_types?: MethodTypeId[]` (absent = a sensible default set, NOT all types).

- `getMethodTypesByCategory` (and the new module browse) filters the picker to enabled
  types. A user enables "Mass spec" in the store and it appears in "+ New Method".
- Disabling a type only hides it from the PICKER and store-default view. It must NEVER
  hide or delete existing method records of that type, and the viewer/editor must still
  render them (otherwise sharing a mass-spec method to a lab that disabled mass spec
  would break). So enable/disable gates CREATION and PICKER VISIBILITY only; dispatch
  always resolves any persisted type.
- Scope decision (open question 7.1): per-account is the simplest and matches how
  `UserMetadataEntry` already scopes `native_calendar_color` and `hide_goals_from_lab`.
  "Per folder" in the prompt most naturally means "per research-folder account", which
  is what per-account `UserMetadataEntry` already is (it is folder-scoped). A
  per-project-folder override is possible later but adds resolution complexity; start
  per-account.
- Defaults: ship with the broadly-useful set enabled (markdown, pdf, pcr, plus maybe
  plate) and the specialized ones (mass_spec, qpcr_analysis, coding_workflow,
  cell_culture, lc_gradient) discoverable-but-off, so a new lab's picker is short.
  `compound` stays `hiddenFromPicker` regardless.

### 4.4 The template catalog (data, not code)

A downloadable catalog of ready-made PROTOCOL CONTENT, each entry an instance of an
EXISTING enabled type. Examples: a standard Q5 PCR recipe (a `pcr` protocol record), a
western-blot protocol (a `markdown` body), a reverse-phase peptide LC gradient (an
`lc_gradient` record), a 96-well plate scaffold (a `plate` record).

- This ships ZERO code. Each entry is a JSON payload matching a type's protocol shape
  plus light metadata (catalog id, title, description, `method_type`, tags, author,
  version, license). It is pure data distribution, with none of Section 2's constraints.
- Browsing: the store panel "Protocol templates" tab fetches a static index JSON from
  the Vercel deploy (Section 5) and renders cards. Filter by method type, search by name
  and tags (reuse `matchesMethodSearch` from `library-sections.ts`).
- Download: "Add to my library" reads the template payload, runs it through the module's
  `fromTemplate` / `createDefaults`-shaped path, calls the per-type
  `<type>Api.create(...)` to write the structured sidecar, then `methodsApi.create(...)`
  to write the method row with the right `method_type`, `source_path`, and a chosen
  `folder_path`. This is exactly the create flow `CreateMethodModal` already runs,
  seeded from catalog data instead of `getDefault*`. The downloaded copy is a normal
  private method the user owns and can edit; it is decoupled from the catalog after
  download (catalog updates do not mutate it; see versioning 5.3).
- Templates that reference a disabled type: offer to enable that type as part of the
  download (a one-click "Enable Mass spec and add this template").

---

## 5. Where catalogs live, download, versioning, offline, sharing, privacy

### 5.1 Static hosting on the Vercel deploy

Both catalogs are static JSON served from `frontend/public/`, fetched client-side,
exactly like `wiki-search-index.json` and `demo-data/` do today
(`frontend/src/lib/wiki/search.ts`, `frontend/src/lib/demo/lab-demo-data.ts`).

Proposed layout:
```
frontend/public/method-catalog/
  index.json                 # { version, generatedAt, templates: [{ id, title,
                             #   methodType, tags, author, license, version,
                             #   payloadPath, previewImage? }] }
  templates/<id>.json        # the protocol payload for each template
  assets/<id>/...            # optional preview images (watermarked fixtures only)
  types-index.json           # (Phase 2+) catalog of SHIPPED types for the store's
                             # "Method types" tab: id, label, description, contributor,
                             # docsUrl, sourceUrl, availableSinceVersion
```
A build script (mirroring `scripts/build-wiki-search-index.mjs`) can validate every
template payload against its module's `parseProtocol` at build time, so a malformed
template never reaches the deploy.

The `types-index.json` is metadata ABOUT the bundled modules (for attribution and docs
links); the actual type code still ships in the app build, never via this file.

### 5.2 Download writes into the user's folder

A download is a normal local create: per-type sidecar via `<type>Api.create`, method row
via `methodsApi.create`, both landing at `users/<currentUser>/<entity>/<id>.json` through
`JsonStore` with per-user counter ids. No new persistence path. The user picks the
destination `folder_path` (reuse the existing folder picker in `CreateMethodModal`).

### 5.3 Versioning

- Catalog: `index.json` carries a top-level `version` and each template a per-entry
  `version`. The store shows the catalog version; bumping it on the deploy is the
  release mechanism.
- Downloaded methods: stamp the originating `catalogTemplateId` and `templateVersion`
  into the method's `tags` or a small additive field so the UI can later say "a newer
  version of this template is available" without ever auto-mutating the user's copy. A
  downloaded method is fully detached and user-owned; updates are an explicit
  re-download (which creates a new method), never a silent overwrite.
- Module/type versioning rides the app build version. `types-index.json` carries
  `availableSinceVersion` so the store can note "added in vX" and so older deploys do
  not advertise types they do not ship.

### 5.4 Offline behavior

ResearchOS is local-first; the app and the user's data work fully offline. The catalogs
are an online convenience layer:
- If the catalog `fetch` fails (offline or deploy unreachable), the store's template tab
  shows a graceful "catalog unavailable offline" state. Everything else (creating
  methods, viewing/editing existing ones, enable/disable) keeps working, because those
  read only local JSON and the bundled modules.
- Optionally cache the last-fetched `index.json` in IndexedDB so the catalog browses
  read-only offline; downloads of cached template payloads can still work if the payload
  was cached. Treat as a nice-to-have, not Phase 1.

### 5.5 Interaction with the existing sharing model

- Downloaded templates are ordinary private methods. The user can publish or share them
  through the untouched unified sharing primitive (`shared_with`, the `"*"` whole-lab
  sentinel). No special-casing.
- A user can already publish a polished protocol to the whole lab. The catalog is the
  curated, cross-lab, peer-reviewed analogue of that; lab-internal sharing stays the
  local mechanism, the catalog is the global one. They do not conflict: a lab can run
  entirely on local sharing and never touch the catalog.
- Future: a "submit this protocol to the public catalog" action could open a PR/issue
  pre-filled with the template JSON (reusing the GitHub rail), making contribution
  symmetric for templates. Templates need only data review, not code review.

### 5.6 Privacy and the screenshot/fixture rules

This is load-bearing given the memory rules (real research data must never be
screenshotted or shipped; only `?wikiCapture=1` fixture mode and watermarked fixtures
are allowed):
- Catalog template payloads and preview assets that ship in `frontend/public/` must be
  authored from fixture/synthetic data ONLY, never derived from any real lab's folder.
  Treat `public/method-catalog/` with the same discipline as `public/demo-data/`
  (watermarked, fictional).
- The "submit to public catalog" flow (future) must warn the contributor that the
  payload becomes public and must be scrubbed of real sample names, patient identifiers,
  unpublished sequences, etc. Default to NOT including any free-text notes fields unless
  the contributor opts in per field.
- Any store/catalog screenshots for the wiki or marketing use fixture mode, per the
  existing rule.

---

## 6. Phased plan

### Phase 1 — Data-only template catalog (ship first, lowest risk)

Scope: static `public/method-catalog/` (index + templates authored from fixtures), a
"Protocol templates" tab in a Methods-page store panel that fetches and renders the
index, and an "Add to my library" download that seeds the existing create flow. Reuses
`fetch` static hosting (proven), the existing per-type create APIs, and the existing
folder picker. No `MethodTypeModule` refactor required; download can hardcode the same
per-type branch `CreateMethodModal` already has.

Deliverables: catalog dir + schema, a build-time validation script, the store panel
template tab, the download-into-folder action, versioning stamps on downloaded methods.

Risks: low. Pure additive UI plus static data plus a create flow that already exists.
Main risk is authoring good fixture templates (content quality, privacy hygiene).
Blast radius: new files only; one new button in `methods/page.tsx`. No data-shape
change to persisted records (the stamp can ride existing `tags`).

### Phase 2 — Formalize `MethodTypeModule` + refactor existing ten + per-scope curation

Scope: define `MethodTypeModule` (Section 3), build `module-registry.ts`, refactor the
cosmetic registry to project from it, refactor all three dispatch sites and
`CreateMethodModal` to registry lookups with lazy components, and add the
`enabled_method_types` curation field on `UserMetadataEntry` with the store toggle and
picker filtering (Section 4.3).

Deliverables: the interface, the registry, ten module files (mechanical wrap of existing
components/APIs), dispatch refactor, discriminator drift guard (3.3 option 2),
enable/disable UI + persistence, a contract conformance test.

Risks: medium. This is the real refactor and touches the hottest method files
(`MethodTabs.tsx`, `methods/page.tsx`, `CreateMethodModal.tsx`). Mitigations: keep
on-disk shapes byte-identical (option 3.3(2), do not change `types.ts` field types yet),
land it behind the post-redesign verifier loop, and lean on a table-driven module test.
FLAG in advance: the `enabled_method_types` field on `UserMetadataEntry` is a new
persisted field (additive, no migration), surfaced before merge per the data-shape rule.
Blast radius: large file count, but each edit is a like-for-like substitution; behavior
should be unchanged for end users (this is the regression bar).

### Phase 3 — Contributor pipeline, peer review, request flow

Scope: author the `MethodTypeModule` contributor guide (in the repo and/or wiki:
how to implement the interface, the data-schema and privacy rules, the SVG-icon and
no-emoji/no-em-dash conventions, the conformance test to pass), document the PR =
peer-review process and the maintainer merge criteria, build the in-app "Request a
method type" action that reuses `generateGitHubIssueUrl` (a method-type-flavored variant
of `FeedbackModal`'s feature-request path), and populate `types-index.json` with
contributor attribution/docs links shown in the store.

Deliverables: contributor docs, a method-type issue template in the GitHub repo, the
in-app request button on the store panel, attribution metadata in the store, and
(optional) a "submit this protocol to the public template catalog" PR-prefill for
template contributions.

Risks: low-to-medium, mostly process/docs. Real risk is governance: who reviews, what
the quality bar is, license choice for contributed modules. Those are decisions, not
code (Section 7). No data-shape changes.

---

## 7. Open questions / decisions for the product owner

1. Enable/disable SCOPE. Per-account (folder-scoped via `UserMetadataEntry`, simplest,
   recommended) versus per-project-folder override (more granular, more resolution
   complexity)? Recommend per-account to start.

2. DEFAULT enabled set. Which types are on out of the box for a brand-new lab? Proposal:
   markdown, pdf, pcr (and maybe plate) on; the rest discoverable-but-off. Confirm the
   list, since it shapes the first-run picker.

3. CATALOG GOVERNANCE. Who reviews template submissions and type-module PRs, and what is
   the quality/accept bar? This is the "peer review" the vision asks for; it needs a
   named owner and written criteria before Phase 3.

4. LICENSE for contributed modules and templates. An explicit OSS license (e.g. MIT or
   Apache-2.0) is needed to make "free and open-source, community-built" real and to set
   contributor expectations. Pick one.

5. DISCRIMINATOR source of truth. Adopt the module registry as the single source for
   `MethodTypeId` and change `Method.method_type`'s TYPE (not its on-disk form) to derive
   from it (cleaner, but a flagged data-shape-type touch), or keep the drift-guard-only
   approach indefinitely? Recommend guard now, derive later.

6. COMPOUND in the contract. Confirm treating `compound` as a composite module
   (`protocolEntity: null`, composes other modules via `compound-graph.ts`) rather than
   a leaf type, so the interface does not have to pretend it owns a schema.

7. TEMPLATE submission UX. Do we want the symmetric "submit my protocol to the public
   catalog" PR-prefill in Phase 3, or keep public-catalog authoring maintainer-only at
   first? Affects how much privacy-scrubbing UX Phase 3 must build.

8. SEQUENCING confirmation. Confirm shipping Phase 1 (templates) independently and ahead
   of the Phase 2 refactor, so users get value from the catalog before the riskier
   internal rework lands.
