# Lab-site builder redesign, build plan (approved designs)

Status: DESIGNS APPROVED by Grant 2026-06-20, ready to build. This turns the two
approved interactive mockups into a buildable spec. Authored by the BeakerAI lane
on wind-down, so the hub can assign the build.

House voice: no em-dashes, no emojis, no mid-sentence colons.

## What was approved

Two SEPARATE builders (Grant was explicit they are not the same product):

1. Lab HOMEPAGE builder = a STRUCTURED SECTION builder (hero / about / team /
   publications, pick + reorder + inline-edit section blocks, start from a filled
   template). The lab's standing public face. Lower-effort, on-brand. (Mockup
   direction agreed; a dedicated mockup is a follow-up if needed.)

2. Companion DATA-SITE builder = a WIX-STYLE drag-and-drop fully-customizable
   canvas for a paper's supplemental-data site. APPROVED mockup:
   `docs/mockups/2026-06-20-companion-data-site-builder.html`. The data/embed
   blocks are the moat (a live interactive supplement at a citable URL).
   APPROVAL TWEAK (Grant): when a block is clicked, its settings show in a
   RIGHT-SIDE inspector menu, consistent with how other surfaces on the site do
   select-then-side-panel (mirror the FigureComposer select-to-panel pattern,
   `src/components/figure/FigureComposer.tsx`, but dock the panel on the RIGHT).

3. Publish + deploy progress (shared by BOTH builders). APPROVED mockup:
   `docs/mockups/2026-06-20-publish-deploy-progress.html`. A persistent
   live-vs-draft status pill + a staged deploy view on push (Save -> Freeze
   figures/tables for citation -> Publish -> Reachability check -> Live) + a
   versioned deploy history with Restore. Honest progress, the steps mirror the
   real pipeline, not a fake bar.

## Where it plugs in (real handles)

- Current editor being replaced: `src/components/social/LabSiteDashboard.tsx`
  (the plain markdown "Body (markdown)" textarea + "Insert figure or table" +
  "Save and publish"). The companion builder replaces the markdown editor for
  companion/supplement pages; the homepage builder replaces it for the home page.
- Data model: `src/lib/social/lab-site-db.ts`. `lab_site_pages` stores `body_md`
  (markdown) + `snapshots_json` (baked embeds) + `status` (draft|published),
  keyed by (lab_owner_key, path).
- Publish/bake path: `bakeAllEmbeds` / `BakedEmbedView` (figures + static tables
  frozen on publish). The deploy-progress "Freeze for citation" step surfaces
  exactly this existing step.
- Inspector pattern to reuse: `FigureComposer` select-to-panel, re-skinned to a
  right dock.
- Data/embed sources: the existing ResearchOS figure/table/dataset embeds (the
  `#ros=` embed system + DuckDB-from-R2 dataset streaming) become first-class
  drag-in blocks.

## FLAG, data-shape change (pre-flag before building)

The block-based page model does NOT fit `body_md` (a markdown string). It needs a
structured representation, an ordered array of typed blocks (kind + props +
bound source id + layout width). Options to settle FIRST with Grant/hub:
- Add a new additive column `blocks_json` to `lab_site_pages` (idempotent ALTER),
  keep `body_md` for legacy/markdown pages, render by whichever is present. A
  page is either markdown (old) or blocks (new). This is the lower-risk path
  (additive, no migration, both render).
- The published/baked output still bakes each block's live embed into
  `snapshots_json` on publish, unchanged contract, so the public render + citation
  permanence path does not change.

This is a new column + a new page representation, so it is a data-shape change
that must be pre-flagged and reviewed before the write path ships.

## Phasing (incremental, each shippable behind the existing LAB_SITES flags)

- P1, block model + render. Add `blocks_json`, a typed block schema (heading,
  text, image, figure, table, dataset-explorer, chart, two-column), and a
  read-only renderer for both edit + published views. No editor yet. Bake path
  extended to bake block embeds into `snapshots_json`.
- P2, the companion canvas. Drag from a block palette onto the page, click-select
  -> RIGHT inspector (source picker, caption, width), reorder, delete, inline
  text edit. Replaces the markdown box for companion pages. (This is the approved
  mockup made real.)
- P3, the homepage structured-section builder (separate, simpler, section blocks
  + template). Can lag P2.
- P4, the shared publish/deploy-progress component. The status pill + staged
  deploy panel + deploy history, wired to the real save/bake/publish steps so the
  progress is honest. Used by both builders.
- P5, deploy history + Restore (versioned publishes; an old version stays
  viewable so a citation never 404s).

## Out of scope / deferred decisions

- True freeform pixel positioning (full Wix canvas) is NOT in P2; the approved
  mockup is drag-to-add + reorder + width presets + two-column, which is the
  right amount of freedom for data layout without the off-brand/ugly risk.
- Homepage builder template content (which sections ship by default).
- Whether older deploy versions are kept forever or capped.

## Approved-mockup decisions to honor

Both mockups carry a per-change Approve/Tweak/Needs-work + Export panel; if Grant
exports specific per-item notes, fold those in before P2/P4. The standing tweak
already captured: companion block settings dock on the RIGHT.

## Added 2026-06-20 (Grant), two more requirements

### A. Per-companion-site editor grants (NEW phase, distinct from Lab Manager)
A PI grants a specific MEMBER permanent edit access to a specific COMPANION SITE,
so e.g. a grad student fully runs one paper's site without lab-wide powers. This is
GRANULAR + per-site, NOT the lab-wide Lab Manager role (`[[project_lab_manager_delegation]]`).
LOCKED (Grant): a granted member has FULL access, create + edit + PUBLISH/deploy
the site themselves (owner-operator), the PI keeps revoke.
- Data: a new editor-grants table, (lab_owner_key, site, member_key, granted_by,
  granted_at). Permanent until revoked.
- Authz: SERVER-SIDE on the builder + publish routes, allow when caller is the lab
  owner OR holds an active grant for that site. A published companion page is a
  PUBLIC artifact (no private-key sharing), so this is write/publish authz only,
  far simpler than private-data delegation. (`[[project_lab_manager_delegation]]`
  already noted companion-site delegation needs server authz.)
- UI: a "Who can edit this site" panel per site in the dashboard, PI adds/removes
  members. Build AFTER the foundation + canvas (it gates who can use the builder).

### B. Seamless network <-> app navigation (separate nav-UX thread, mockup-first)
Make the research-os.com (public network/lab sites) <-> research-os.app (gated
builder/app) hop one click with context preserved, from a public lab site an
"Edit this site" affordance deep-linking the PI/granted editor straight into the
builder (sign in once if needed, land on the right page), and from the app a clean
"View public site" jump, with session continuity so crossing origins does not feel
like leaving. Gets an interactive before/after mockup before any build, per
`[[feedback_ui_review_interactive_mockup]]`. Ties `[[feedback_dotcom_public_dotapp_gated]]`.

Related: `[[project_lab_domains_companion_sites]]`, `[[feedback_ui_review_interactive_mockup]]`,
`[[feedback_laptop_native_redesign]]`, `[[project_lab_manager_delegation]]`.
