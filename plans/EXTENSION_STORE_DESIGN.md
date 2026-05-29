# Extension Store: Unified Architecture Design Doc

Author: extension-store design
Date: 2026-05-29
Status: Proposal (no code written; this is a design only)

Umbrella doc. The deep method-specific detail lives in
[plans/METHOD_LIBRARY_DESIGN.md](METHOD_LIBRARY_DESIGN.md); this doc generalizes
that pattern and adds the widget instance.

## 0. TL;DR

The product owner wants ONE "extension store" architecture that covers TWO things
as instances of a single pattern:

- Instance A: structured METHOD TYPES (PCR, plate, mass spec, etc.), already
  designed in [plans/METHOD_LIBRARY_DESIGN.md](METHOD_LIBRARY_DESIGN.md).
- Instance B: lab-overview / home WIDGETS (announcements, comments, purchases,
  trainee notes, etc.).

The shared pattern is: a formal Module interface, a central registry, a CURATION
store layer (browse, enable/disable per scope, request a new one), account-type
plus surface visibility gating, and a peer-reviewed GitHub-PR contribution
pipeline. Extensions are React code, so they ship inside the reviewed app build
and are NEVER downloaded and executed at runtime. A data/content catalog applies
where the extension's payload is data, not code (method TEMPLATES are data;
widgets are code-only, see Section 3.6).

The headline finding for widgets: most of this ALREADY EXISTS. The widget catalog
(`frontend/src/components/lab-overview/widgets/registry.ts`) already ships every
widget for every surface and gates with `memberVisible` / `labHeadVisible` /
`labHeadVisibleOn` plus a `surfaces: { canvas, home, sidebar }` map. The two
"canvases" are actually ONE component (`SnapshotCanvas`) parameterized by a
`surface` prop, with `HomeCanvas` as a thin wrapper. So "universal across Home vs
Lab Overview" and "PI-only vs member widgets in one store" are largely built. What
is NEW for widgets is the store UX itself (a browse-and-curate surface beyond the
inline Add-widget palette), an enable/disable persistence layer, the request flow,
and the formalized `WidgetModule` projection.

Recommendation: build the SHARED store machinery (browse/curate UX shell,
enable/disable persistence, request flow, contributor pipeline + docs, gating
model) ONCE, then wire each instance's per-domain Module interface into it. Method
types and widgets sequence under one umbrella plan (Section 5).

---

## 1. The shared pattern (the umbrella)

### 1.1 The generic Extension / Module concept

An EXTENSION is a unit a lab can add to its workspace. Today there are two kinds,
but they share one anatomy:

| Concept | Method type instance | Widget instance |
| --- | --- | --- |
| The Module (code + metadata) | `MethodTypeModule` (proposed, METHOD doc §3) | `WidgetModule` (Section 3.2, projects today's `WidgetDefinition` + `ToolDefinition`) |
| Central registry | `METHOD_MODULES` (proposed) / `METHOD_TYPE_REGISTRY` (exists) | `WIDGET_CATALOG` + `TOOL_REGISTRY` (exist) |
| Cosmetic metadata | `MethodTypeMeta` (id, label, color, icon, description, category) | `WidgetDefinition.title/description/helpText` + `ToolDefinition.title/Icon/description` |
| Render components | `TabContent` / `LibraryViewer` / `CreateEditor` | `SnapshotTile` / `SidebarTile` / `ExpandedView` |
| Per-instance data | structured sidecar record + per-task instance snapshot | `WidgetInstanceConfig` (e.g. `pinnedMember`) in the layout |
| Visibility gating | `enabled_method_types` (proposed) + `hiddenFromPicker` | `memberVisible` / `labHeadVisible` / `labHeadVisibleOn` + `surfaces` (exist) |
| Curation state | per-account enabled set | per-account layout order (exists) + future enabled set |

The umbrella claim: both are "a metadata-described, code-backed unit registered in
a catalog, rendered through lazy/known components, gated by who-can-see-it rules,
and curated per account." One store, two registries behind it.

### 1.2 Central registry

Each instance keeps its own registry (a typed array or record of Module entries).
The store does not need a single physical registry; it needs a single SHAPE so the
store UX can iterate either one uniformly. The shared store layer asks each
registry for: "give me the entries visible to this account, on this surface, with
their cosmetic metadata and enabled state." Both registries can satisfy that with a
thin adapter (Section 4.1).

### 1.3 Curation store layer

A common store shell that does three things for either instance:

- BROWSE: list every extension the build ships, grouped by category, each a tile
  with icon, label, description, attribution (later), and an enabled toggle.
- ENABLE / DISABLE per scope: flip an extension on or off for the current scope
  (Section 1.6). Disabling only hides from creation/placement surfaces; it never
  deletes existing records or breaks rendering of already-placed instances.
- REQUEST a new one: a button that opens a prefilled GitHub issue via the existing
  `generateGitHubIssueUrl` rail (`frontend/src/lib/error-reporting.ts`, used today
  by `frontend/src/components/FeedbackModal.tsx` against `gnick18/ResearchOS`).

### 1.4 Peer-reviewed GitHub-PR contribution pipeline

Outside contributors author a Module in the public repo implementing the
instance's interface and open a PR. Maintainers review the code (the PR review IS
the peer review), merge it, and it ships in the next app build like any
first-party extension. This is identical for method types and widgets: a widget is
a `WidgetDefinition` entry + a `ToolDefinition` entry + the three tile/expanded
components; a method type is a `MethodTypeModule`. Both are React code reviewed in
a PR.

### 1.5 The local-first security model (restated, applies to BOTH instances)

Extensions are React code. ResearchOS runs entirely client-side against the user's
local research folder via the File System Access API. There is no application
server, no compute, no sandbox: the only server surface is a handful of thin Vercel
proxy routes (`frontend/src/app/api/`) that add an auth header or dodge CORS, are
capped near 4.5MB, and run no user logic. Therefore the app must NOT fetch a
third-party module's JavaScript at runtime and execute it. Doing so would grant an
unreviewed, externally-hosted bundle full same-origin access to the File System
Access handle, IndexedDB session, stored Telegram/calendar tokens, and the entire
on-disk research corpus. That is exactly the supply-chain and data-exfiltration
surface the product's NIH-compliance / LabArchives-trust-flip positioning exists to
refute.

Consequence, identical for widgets and method types:

- Extensions ship as peer-reviewed PRs IN THE BUILD. Every line passed human review
  and lives in version control. No runtime code download. Same trust model as the
  rest of the app.
- The in-app store is a CURATION and REQUEST layer over the already-bundled set,
  never a code loader.
- Rejected alternatives (runtime dynamic import of remote code; iframe/worker
  sandboxing of untrusted module UI; a hosted plugin server) are analyzed in
  [METHOD doc §2.2](METHOD_LIBRARY_DESIGN.md). The analysis is domain-agnostic and
  applies verbatim to widgets: a widget `ExpandedView` is at least as interactive
  and same-origin-privileged as a method viewer, so none of the runtime-execution
  options become more attractive for widgets. A widget reads lab data
  (announcements, purchases, member workload, shared notes) through the same local
  APIs, so an untrusted widget is, if anything, a higher-value exfiltration target.

### 1.6 Where a data/content catalog applies

Method TYPES have a data-only analogue: protocol TEMPLATES (a Q5 PCR recipe, a
western-blot markdown) are pure data instances of an existing type, shippable as
static JSON with zero code and none of the Section 1.5 constraints (METHOD doc
§4.4 / §5). This is the easy Phase 1 win for the method instance.

Widgets do NOT have a clean data-only analogue. A widget's value IS its code: the
`SnapshotTile` computes a headline stat from live lab data, the `ExpandedView` is a
rich interactive body. There is no "widget template" that is just data. The closest
data-shaped artifacts are:

- per-instance config (`WidgetInstanceConfig`, e.g. `pinnedMember`) and saved
  layouts: these are USER data, already persisted, not a shippable catalog.
- a future "starter layout pack" (a named set of widget ids + default order a lab
  could apply): this WOULD be data (a list of already-bundled widget ids), and is
  the only widget-side analogue worth noting. It composes existing code-backed
  widgets; it ships no new code. Treat as an optional later nicety, not core.

So: the data-only template catalog is a method-instance feature. Widgets are
code-only and ride entirely on the PR pipeline. The store UX should expose a
"templates" affordance only for instances that declare one.

---

## 2. Instance A: Method types (condensed; see the method doc)

Fully specified in [plans/METHOD_LIBRARY_DESIGN.md](METHOD_LIBRARY_DESIGN.md). In
umbrella terms:

- Module: `MethodTypeModule` collapses today's four hardcoded behavioral surfaces
  (two dispatch switches in `MethodTabs.tsx` and `methods/page.tsx`, the create
  funnel in `CreateMethodModal.tsx`, and the per-type `*Api` objects in
  `local-api.ts`) behind one contract, with lazy component refs to preserve
  code-splitting. The existing cosmetic registry
  (`frontend/src/lib/methods/method-type-registry.ts`) becomes a projection of the
  module registry.
- Registry: `METHOD_MODULES` (proposed), source of truth for `MethodTypeId`.
- Curation: `enabled_method_types` on `UserMetadataEntry`
  (`frontend/src/lib/file-system/user-metadata.ts`) gates picker visibility and
  creation only; dispatch always resolves any persisted type so shared records
  never break.
- Data catalog: the static `frontend/public/method-catalog/` template catalog,
  fetched client-side like `wiki-search-index.json` and `demo-data/`, downloaded
  into the user's folder through the existing create flow.
- Phasing (method-local): Phase 1 template catalog, Phase 2 `MethodTypeModule` +
  per-scope curation, Phase 3 contributor pipeline + request flow. Reconciled with
  the umbrella sequence in Section 5.

Do not duplicate the method doc; consult it for the interface shape, the dispatch
refactor scope, the discriminator de-duplication, and the open method questions.

---

## 3. Instance B: Widgets (new analysis)

### 3.1 What already exists (confirmed by reading the code)

This is the load-bearing finding: the widget framework already implements most of
the umbrella pattern. Concretely:

UNIVERSAL SURFACES (Home vs Lab Overview, already one catalog).
`frontend/src/components/lab-overview/widgets/types.ts` defines
`WidgetSurfaces { canvas?, sidebar?, home? }` and the helper
`widgetHasSurface(widget, target)`. Each `WIDGET_CATALOG` entry
(`frontend/src/components/lab-overview/widgets/registry.ts`) declares a `surfaces`
map. The file comment is explicit: "The catalog ships every widget for every
surface; the visibility filter happens at consumer time via `visibleCatalog`." So
one catalog already spans /lab-overview (`canvas`), /home (`home`), and the
customizable rail (`sidebar`). A widget opts into any combination
(announcements/comments/lab-activity set `canvas` + `home`; metrics/purchases stay
`canvas` only; the task-list tiles are `sidebar` plus selective `home`).

ACCOUNT-TYPE GATING (PI-only vs member in one store, already built).
`WidgetDefinition.memberVisible` (false = PI-only), `labHeadVisible` (false = the
carve-out that hides a widget from the PI surface even though it works), and the
per-surface refinement `labHeadVisibleOn { sidebar?, home?, canvas? }`. Resolved by
the pure helpers `visibleCatalog(catalog, accountType, surface)` and
`isWidgetVisibleForLabHead(widget, surface)`. The `TOOL_REGISTRY` in
`frontend/src/lib/lab-overview/tool-registry.tsx` mirrors the same model on Tools
(`memberVisible` / `labHeadVisible`) and `visibleTools(accountType, surface)`
intersects Tool visibility with widget-surface eligibility so a launcher never
offers a Tool the user cannot pin.

TWO TILE SHAPES + ONE POPUP BODY, ALREADY SPLIT.
A widget definition ships `SnapshotTile` (square canvas/home card), `SidebarTile`
(narrow rail row), and an `ExpandedView` (the rich popup body). Multiple widget
entries can share a Tool via `toolId` (the three purchases variants
`funding-bars` / `burn-rate` / `pending-count` all open the one LabPurchases
popup); `resolveExpandedView(widget)` looks the body up through the Tool registry.

PER-INSTANCE CONFIG, ALREADY PERSISTED.
`WidgetInstanceConfig` (`frontend/src/lib/settings/user-settings.ts`, currently
`{ pinnedMember? }`) rides the layout under
`LabOverviewLayoutV2.widgetConfig: Record<widgetId, WidgetInstanceConfig>`,
persisted via `patchWidgetConfig` in
`frontend/src/lib/lab-overview/layout-persistence.ts` and threaded into tiles and
the popup as `config` + `onConfigChange`.

DISCOVERY AFFORDANCES, TWO TODAY.
(1) the inline Add-widget palette built into `SnapshotCanvas` (a popover listing
the surface-and-account-filtered catalog, each item a checkbox toggle that
add/removes from the saved order). (2) the `ToolsLauncher` button (a popover over
`visibleTools` so a Tool's popup is reachable even with no tile pinned). Both are
already account- and surface-aware.

### 3.2 The formalized `WidgetModule` interface

A widget "module" today is spread across THREE artifacts: a `WidgetDefinition`
catalog entry, a `ToolDefinition` registry entry (looked up by `toolId`), and the
tile/expanded components. That is structurally the same "metadata + render
components + gating" shape as `MethodTypeModule`. Formalize it as a projection that
folds the catalog entry and the Tool entry into one declared unit, WITHOUT changing
the on-disk layout shape or the consume-time filters.

```ts
// frontend/src/components/lab-overview/widgets/module-types.ts  (proposed)
import type { ComponentType } from "react";
import type {
  WidgetSurfaces,
  SnapshotTileProps,
  SidebarTileProps,
  ExpandedViewProps,
} from "./types";

export interface WidgetModule {
  // ── Identity + cosmetics (folds in today's WidgetDefinition meta) ──
  id: string;                 // stable layout key (today's WidgetDefinition.id)
  title: string;
  description?: string;
  helpText?: string;          // the "?" badge copy on /lab-overview tiles
  popupTitle?: string;        // per-variant popup header override

  // ── Tool linkage (folds in toolId + the ToolDefinition) ──
  // A module either OWNS a tool (provides toolMeta) or is a VARIANT of a
  // tool another module owns (references toolId only). This preserves the
  // "N tile variants, one popup" relationship without duplicating popups.
  toolId: string;
  variantId?: string;
  toolMeta?: {                // present only on the variant that owns the Tool
    description?: string;
    Icon: React.ReactElement; // small inline SVG, no emoji / no lucide
    ExpandedView: ComponentType<ExpandedViewProps>;
  };

  // ── Render components (the tile shapes) ──
  SnapshotTile: ComponentType<SnapshotTileProps>;
  SidebarTile: ComponentType<SidebarTileProps>;
  // ExpandedView is resolved via the owning module's toolMeta, mirroring
  // today's resolveExpandedView(toolId). A variant module reuses the
  // owner's body; it does NOT carry its own.

  // ── Surface eligibility (today's surfaces map) ──
  surfaces: WidgetSurfaces;   // { canvas?, sidebar?, home? }
  defaultLayout: { w: number; h: number; minW?: number; minH?: number };

  // ── Visibility gating (today's three fields) ──
  memberVisible: boolean;
  labHeadVisible?: boolean;
  labHeadVisibleOn?: { sidebar?: boolean; home?: boolean; canvas?: boolean };

  // ── Per-instance config (optional) ──
  // Declares that this widget supports per-placement config and how to
  // render its in-popup config control. Absent = the widget ignores config
  // (today's default for every widget except trainee-notes' pinnedMember).
  config?: {
    // Validate / normalize a persisted WidgetInstanceConfig for this widget.
    parseConfig?: (raw: unknown) => import("@/lib/settings/user-settings").WidgetInstanceConfig;
  };
}
```

Notes on the design:

- This is a PROJECTION, not a rewrite. `WIDGET_CATALOG` becomes
  `WIDGET_MODULES.map(toWidgetDefinition)` and `TOOL_REGISTRY` becomes
  `WIDGET_MODULES.filter(m => m.toolMeta).map(toToolDefinition)`. Every existing
  consumer (`visibleCatalog`, `widgetHasSurface`, `resolveExpandedView`,
  `resolveToolTitle`, `visibleTools`, the layout reader) keeps working unchanged
  because it still sees the same `WidgetDefinition[]` / `ToolDefinition[]` shapes.
- It collapses the "edit TWO files to add a widget variant" friction (you add a
  `registry.ts` entry AND, for a new tool, a `tool-registry.tsx` entry) into one
  module file, the same ergonomics win `MethodTypeModule` gives method types.
- Components stay direct refs (not lazy) to match TODAY's behavior, where widget
  bodies are imported eagerly so their data hooks register query keys (see the
  `void AnnouncementsWidget` block in `registry.ts`). If bundle weight becomes a
  concern later, the projection can switch to lazy refs without changing the module
  shape. (Method modules DO use lazy refs because a method viewer is heavier and
  not eagerly needed; this is the one shape difference between the instances and it
  is deliberate, see Section 4.3.)
- The owner/variant split keeps the "three purchases tiles, one popup" model exact:
  one module declares `toolMeta` (owns the popup), the others reference its
  `toolId`. A drift guard (a test) asserts every non-owning `toolId` resolves to an
  owning module, replacing today's runtime `MissingToolPlaceholder` safety net with
  a build-time check.

### 3.3 The two-canvas situation: keep two renderers over one registry (recommend)

Finding: there are NOT two separate canvas renderers. There is ONE component,
`SnapshotCanvas` (`frontend/src/components/lab-overview/SnapshotCanvas.tsx`),
parameterized by a `surface: "canvas" | "home"` prop. It selects a `SurfaceAdapter`
(`CANVAS_ADAPTER` vs `HOME_ADAPTER`) that swaps the read/write persistence functions
(`readResolvedLayout` vs `readResolvedHomeLayout`, `patchCanvasOrder` vs
`patchHomeCanvasOrder`, etc.) and the `surfaceKey`. The body, drag-and-drop,
Add-widget palette, popup, and edit mode are a single render path.
`HomeCanvas.tsx` is a 90-line wrapper that mounts `<SnapshotCanvas surface="home">`
with home-specific copy and a `<ToolsLauncher surface="home">`. The /lab-overview
page mounts the same component with `surface="canvas"` plus the customizable
sidebar.

Recommendation: KEEP the one-component-two-adapters shape. Do NOT try to collapse
/home and /lab-overview persistence into a single field. Reasons:

- They are intentionally INDEPENDENT layouts: a PI can have a dense dashboard on
  /lab-overview and a quiet personal canvas on /home, stored in distinct settings
  fields (`lab_overview_layout` vs `home_layout`). Merging them loses that.
- The renderer is already unified; the only per-surface variation is the adapter
  (which field to read/write) and three behavioral choices that are correct as-is:
  /lab-overview appends every new catalog widget to a saved layout (it is a
  dashboard), /home does NOT auto-append (it is user-curated, see
  `resolveHomeLayout`'s deliberate no-op append); per-instance config is persisted
  only on /lab-overview today; the help-badge ("?") copy is shown only on
  /lab-overview tiles.
- "Unify the renderers" is therefore already done. The remaining work is a SHARED
  STORE surface (Section 3.4) that both canvases can launch into, not a renderer
  merge.

One small cleanup worth flagging (not required): the `sidebar` axis is allocated in
`home_layout` but unused; `resolveHomeLayout` always returns `sidebar: []`. Leave it
(it keeps the shape stable for a future customizable-home-sidebar), but the store
design should not assume a home sidebar exists.

### 3.4 The Add-palette to store UX

Today's Add-widget palette (inline in `SnapshotCanvas`) is a per-canvas placement
control: it toggles a widget into/out of the SAVED ORDER for that surface. It is
not a "store" (no enable/disable independent of placement, no attribution, no
request flow, no cross-extension browse). The store is a higher layer.

Proposed relationship:

- KEEP the inline Add-widget palette as the fast in-context "pin/unpin on this
  canvas" control. It already works and matches the dashboard mental model.
- ADD a store entry point (a "Browse widgets" / "Widget store" button in the canvas
  toolbar, alongside Add widget / Edit layout / Reset, and reachable from the
  `ToolsLauncher` popover). It opens the SHARED store shell (Section 4) scoped to
  the widget instance. The store shows every widget the build ships, grouped by
  category (e.g. by Tool, or by canvas/home/sidebar relevance), with description,
  attribution (later), an ENABLE toggle (the new curation layer, Section 3.5), and
  a "pin to this canvas" action that calls the existing `addCanvasWidget` /
  `addHomeCanvasWidget`.
- The store's "Request a widget" button reuses `generateGitHubIssueUrl`, a
  widget-flavored variant of the same rail the method instance uses.

This keeps the cheap inline palette for power users while giving newcomers a single
discoverable browse-and-curate surface that is the same shell as the method store.

### 3.5 Per-instance config and enable/disable for widgets

Two distinct curation axes for widgets, do not conflate them:

- PLACEMENT (exists): which widgets are pinned, in what order, on a given canvas.
  Stored in `lab_overview_layout` / `home_layout`. The Add-widget palette and drag
  reorder drive this.
- ENABLEMENT (new, optional): whether a widget is even OFFERED in this lab's
  palette/store at all. This is the widget analogue of `enabled_method_types`. For
  widgets the anti-clutter pressure is lower than for method types (the catalog is
  curated and account-gated already), so enablement is a softer requirement. If
  adopted, store it the same way the method instance does, as an additive
  per-account field (candidate home: `UserMetadataEntry`, or a new
  `enabled_widgets?` on the settings layout block), gating only the
  palette/store-default view and never breaking an already-placed widget. See open
  decision 6.1 on whether widgets need enablement at all in v1.

Per-instance config (`WidgetInstanceConfig`) is already the widget equivalent of a
method's per-task instance snapshot: a per-placement override (today `pinnedMember`
for the trainee-notes widget). The `WidgetModule.config` block formalizes which
widgets support it. No new persistence is needed; it rides the existing
`widgetConfig` map.

### 3.6 Widgets are code-only (no data catalog)

Per Section 1.6: a widget has no data-only template. Its payload is code. So the
widget instance ships entirely through the PR pipeline and has NO equivalent of the
method `frontend/public/method-catalog/`. The store's "templates" tab is a
method-instance-only affordance, exposed only when the instance declares it (the
store shell asks the adapter "do you have a content catalog?"; the widget adapter
answers no). The optional future "starter layout pack" (a named set of bundled
widget ids) is the only data-shaped widget artifact and is out of scope for v1.

---

## 4. Shared infrastructure vs instance-specific

### 4.1 Build ONCE (shared)

- STORE UX SHELL: the browse-and-curate surface (a modal or slide-over) that lists
  extensions as tiles (icon, label, description, attribution, enable toggle),
  groups by category, supports search/filter, and hosts the request button. The
  shell is generic; each instance supplies an ADAPTER:
  ```ts
  interface ExtensionStoreAdapter {
    kind: "method-type" | "widget";
    listEntries(accountType, surface?): ExtensionStoreEntry[]; // id, label, desc, icon, category, attribution, enabled
    isEnabled(id): boolean;
    setEnabled(id, on): Promise<void>;
    hasContentCatalog(): boolean;        // methods: true; widgets: false
    listContentCatalog?(): Promise<CatalogItem[]>;
    requestNewIssueUrl(): string;        // generateGitHubIssueUrl, instance-flavored
  }
  ```
  The method registry and the widget registry each implement this adapter. The
  store shell renders both identically.
- ENABLE/DISABLE PERSISTENCE: the per-account "enabled set" pattern (additive
  optional field, absent = sensible default, gates offering not rendering). One
  helper shape reused by both adapters.
- THE REQUEST FLOW: the `generateGitHubIssueUrl` rail
  (`frontend/src/lib/error-reporting.ts`) with an instance-flavored title/body. One
  prefill helper, two templates.
- CONTRIBUTION DOCS + PR / PEER-REVIEW PROCESS: a single contributor guide covering
  the security model (Section 1.5), the no-emoji / no-em-dash / inline-SVG / Tooltip
  conventions, the conformance-test requirement, and the maintainer accept bar.
  One process; per-instance interface appendices.
- THE VISIBILITY / GATING MODEL: the account-type plus surface gating concepts.
  Widgets already implement the canonical version (`visibleCatalog`,
  `widgetHasSurface`, `isWidgetVisibleForLabHead`, `visibleTools`); the shared layer
  should adopt that vocabulary so the method instance's gating reads the same way.

### 4.2 Per-instance (one shape, two implementations)

- THE MODULE INTERFACE: `MethodTypeModule` (METHOD doc §3) and `WidgetModule`
  (Section 3.2). Same anatomy (metadata + render components + gating + per-instance
  data), different render-component contracts because a method viewer and a widget
  tile are genuinely different UIs.
- THE REGISTRY: `METHOD_MODULES` vs `WIDGET_MODULES`. Each is the source of truth
  for its instance and feeds its `ExtensionStoreAdapter`.
- INSTANCE-SPECIFIC DATA: method types have a sidecar record + a content template
  catalog; widgets have per-placement config + saved layouts. Neither leaks into
  the shared shell.

### 4.3 The one deliberate shape difference

Method modules use `React.lazy` component refs (heavy viewers, code-split, not
eagerly needed). Widget modules use direct refs (bodies imported eagerly so data
hooks register query keys, per today's `registry.ts`). The shared store shell does
not care: it only touches metadata and the enable/request adapter, never the render
components directly. So this difference stays inside each instance's Module
interface and does not fork the shared layer.

---

## 5. Phased plan (spanning both instances)

The method doc proposes its own three phases (template catalog, `MethodTypeModule`
+ curation, contributor pipeline). The umbrella reconciles them by building the
SHARED store machinery alongside the method instance's Phase 2/3, then attaching the
widget instance, which is cheap because most of its framework exists.

### Phase U0 (already shipped): widget framework

No work. Confirm and document the existing universal-surface catalog, account/surface
gating, one-component-two-adapters canvas, per-instance config, and the two discovery
affordances (Section 3.1). This phase is "recognize what is already built so we do
not rebuild it."

### Phase U1: Method data-only template catalog

Equals METHOD doc Phase 1. Static `frontend/public/method-catalog/`, a "Protocol
templates" surface, download-into-folder. Lowest risk, ships first, no shared
machinery yet. Widgets are untouched (they have no template catalog).

Risk: low. New files + one button. No data-shape change to persisted records.

### Phase U2: Shared store shell + enable/disable + method Module

Build the `ExtensionStoreAdapter` shell, the enable/disable persistence pattern, and
the request-flow prefill ONCE (shared). Wire the method instance into it: formalize
`MethodTypeModule`, project the cosmetic registry from it, refactor the method
dispatch sites + create funnel, add `enabled_method_types` curation (METHOD doc
Phase 2). The shell is built generically here so the widget instance can attach in
U3 with near-zero shell work.

Risk: medium. The method-side refactor touches the hottest method files
(`MethodTabs.tsx`, `methods/page.tsx`, `CreateMethodModal.tsx`). Keep on-disk shapes
byte-identical (METHOD doc 3.3 option 2). FLAG in advance: `enabled_method_types` is
a new persisted field (additive, no migration). The shared shell itself is additive
UI. Land behind the post-redesign verifier loop.

### Phase U3: Widget Module projection + widget store adapter

Project `WIDGET_CATALOG` + `TOOL_REGISTRY` into `WIDGET_MODULES` (Section 3.2), add
the widget `ExtensionStoreAdapter`, and add the "Browse widgets" store entry point
to the canvas toolbar + `ToolsLauncher`. Optionally add widget enablement (open
decision 6.1). Because the catalog, gating, canvas, config, and palette already
exist, this is mostly adapter glue + the projection refactor + one new store entry
point reusing the U2 shell.

Risk: low-to-medium. The projection is a like-for-like refactor guarded by a
conformance test (every module yields a valid `WidgetDefinition` + the owner/variant
`toolId` graph resolves). No layout-shape change. The store entry point is additive
UI. Blast radius is the registry/tool-registry files plus their consumers, but
consumers keep seeing the same array shapes.

### Phase U4: Unified contributor pipeline, peer review, request flow

One contributor guide and PR/issue templates covering BOTH instances (METHOD doc
Phase 3 generalized). Wire the in-app "Request a method type" and "Request a widget"
buttons (both via `generateGitHubIssueUrl`). Populate attribution metadata shown in
the store for both instances. Optionally the method "submit this protocol to the
public template catalog" PR-prefill.

Risk: low-to-medium, mostly process/docs. Real risk is governance (open decisions
6.3, 6.4). No data-shape changes.

### Blast-radius summary

| Phase | Touches | On-disk shape change | Risk |
| --- | --- | --- | --- |
| U0 | nothing (documentation) | none | none |
| U1 | new catalog files + 1 methods button | none | low |
| U2 | shared shell + hot method files + `UserMetadataEntry` | `enabled_method_types` (additive, FLAG) | medium |
| U3 | widget registry/tool-registry projection + 1 store entry | none (config map already exists) | low-to-medium |
| U4 | docs + repo templates + request buttons | none | low-to-medium |

---

## 6. Open decisions for the product owner

1. WIDGET ENABLEMENT, yes or no for v1? Method types clearly need an enabled set
   (anti-clutter for ten-plus structured types). Widgets are already curated and
   account-gated, and the per-canvas Add palette already controls what is pinned. Do
   we ALSO want a per-account "this widget is not even offered" enablement layer for
   widgets, or is placement-only curation enough? Recommend placement-only for v1
   (skip widget enablement), revisit if the widget catalog grows large.

2. ENABLE/DISABLE SCOPE (both instances). Per-account (folder-scoped via
   `UserMetadataEntry`, simplest, matches existing `native_calendar_color` /
   `hide_goals_from_lab` precedent) versus a per-project-folder override? Recommend
   per-account to start, consistent with the method doc.

3. DEFAULT ENABLED SETS. Methods: which types ship on for a fresh lab (proposal:
   markdown/pdf/pcr, maybe plate; the rest discoverable-but-off). Widgets: confirm
   the current default layouts (`defaultMemberLayout` / `defaultLabHeadLayout` /
   `defaultMemberHomeLayout`) are the intended out-of-box sets, since the store will
   present "enabled by default" against them.

4. GOVERNANCE / WHO PEER-REVIEWS + THE ACCEPT BAR. The single peer-review process
   covers both method-type PRs and widget PRs. Who reviews, and what is the
   quality/security accept bar (especially given a widget reads live lab data and is
   a high-value exfiltration target if malicious)? Needs a named owner and written
   criteria before U4.

5. OSS CONTRIBUTION LICENSE. One explicit license (e.g. MIT or Apache-2.0) for
   contributed modules, widgets, and templates, to make "free and open-source,
   community-built" real and set contributor expectations. Pick one for the whole
   store.

6. THE TWO-CANVAS DECISION. Confirm KEEPING the one-component
   (`SnapshotCanvas`) two-adapter (`canvas` / `home`) shape with independent
   persisted layouts, rather than merging /home and /lab-overview into a single
   layout field. Recommended (Section 3.3): the renderer is already unified;
   independent layouts are a feature, not debt.

7. SEQUENCING SIGN-OFF. Confirm the umbrella order: U1 (method templates) ships
   first and standalone; U2 builds the shared shell alongside the method Module
   refactor; U3 attaches widgets cheaply; U4 is the contributor pipeline. In
   particular, confirm building the shared `ExtensionStoreAdapter` shell in U2
   (rather than method-only, then retrofitting for widgets) so the store machinery
   is genuinely built once.

8. STORE ENTRY-POINT PLACEMENT (widgets). The widget store can launch from the
   canvas toolbar (next to Add widget / Edit / Reset) and/or the `ToolsLauncher`
   popover. Methods launch from the `/methods` page header (METHOD doc §4.1).
   Confirm we are comfortable with two different entry-point homes (one per
   instance's natural surface) sharing one store shell, rather than a single global
   "Extensions" nav tab (the orchestrator memory notes the lab recently trimmed nav
   tabs, so a new top-level tab is discouraged).
