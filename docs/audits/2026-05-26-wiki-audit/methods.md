# Wiki audit: Methods

- Author: wiki audit: methods
- Date: 2026-05-26
- Anchor commit: 14ea9892 (main)
- Wiki page audited: `frontend/src/app/wiki/features/methods/page.tsx`
- App code audited:
  - `frontend/src/app/methods/page.tsx`
  - `frontend/src/components/HybridMarkdownEditor.tsx` (referenced via `/wiki/features/markdown-editor`)
  - `frontend/src/lib/local-api.ts` (`methodsApi.create`, R1d shared_with handling)
  - `frontend/src/lib/methods/method-type-registry.ts`
  - `frontend/src/hooks/useMethodPermissions.ts`
  - `frontend/src/components/methods/CreateMethodModal.tsx`,
    `WrapAsCompoundAction.tsx`, `ConvertCompoundToSingleAction.tsx`,
    `DeleteMethodConfirm.tsx`
  - `frontend/src/components/MethodExperimentsSidebar.tsx`
- Nav check: `frontend/src/lib/wiki/nav.ts` has `"/methods" -> "/wiki/features/methods"` (line 20) and a sidebar child for `/wiki/features/pcr`. No nav entry for any of the other nine method types.
- Proposal cross-reference: `docs/proposals/done/METHODS_EXPANSION_V2_PROPOSAL.md` §9.1 explicitly lists four NEW wiki pages required (compound-methods, coding-workflows, mass-spec, qpcr); none exist yet.

---

## Summary counts

- Bugs in current wiki copy (wrong vs code): 1
- Missing-coverage items (documented surface that has no corresponding wiki text): 11
- Stale screenshot / asset flags: 1
- Out-of-scope items surfaced for other audits: 2

---

## 1. Bug: Markdown method "Edit disappears for everyone, including the creator" is WRONG post-R1c

**Wiki text** (`frontend/src/app/wiki/features/methods/page.tsx:173-179`):

> Once a Markdown method is shared with the lab, the inline Edit button disappears for everyone, including the creator, and the body becomes read-only. To change a published Markdown protocol, flip it back to private via the share popup, edit, then republish.

**Code state** (`frontend/src/app/methods/page.tsx:1286-1327` MarkdownMethodViewer; `frontend/src/hooks/useMethodPermissions.ts:173-178`):

The Edit button is gated only by `canModify = canModifyMethod(currentMethod)`, which resolves through `canWriteRecord(method, viewer, editSession)`. For the original creator (`method.owner === viewer.username`), this returns `true` regardless of whether the method is whole-lab-shared. The creator still sees and can press Edit on a shared Markdown method.

The very next paragraph (lines 180-187) correctly describes Structured-method behaviour ("creator retains edit access even when shared, because the editor is gated by `canWrite` which passes for the original creator regardless of sharing status"). Post-R1c the same is true for Markdown methods, so the carve-out described in the bugged paragraph no longer exists.

**Fix direction:** delete the Markdown-only read-only-after-share carve-out paragraph, or rewrite it to say the creator keeps edit access for Markdown the same way they do for structured types. The "flip to private to edit" workflow described is no longer required.

---

## 2. Missing coverage: 9 of 10 method types have no dedicated wiki page

The wiki landing page enumerates ten method types in one paragraph each. Only PCR has a dedicated subpage (`/wiki/features/pcr`). The proposal at `docs/proposals/done/METHODS_EXPANSION_V2_PROPOSAL.md:1908-1937` explicitly lists FOUR new pages that v2 wiki manager needs to ship: compound-methods, coding-workflows, mass-spec, qpcr. Three additional v1 types (lc_gradient, plate, cell_culture) also lack dedicated pages.

Untouched type-specific behaviour the methods landing page only mentions in one line, with no deeper coverage anywhere:
- **Compound method**: builder workspace, sub-picker, TOC strip, in-place per-child edit, three-button delete prompt, orphan band, cycle detection / depth limit, snapshot forward-compat. Specced in §2 of the proposal; widely implemented (`components/methods/CompoundMethodBuilder.tsx`, `CompoundMethodTabContent.tsx`, etc.).
- **Coding workflow**: language picker, `.ipynb` cell render, syntax-highlighted Python/R/SQL preview. (§3 of proposal.)
- **Mass spec**: smart-per-ionization-mode editor with `ionization_mode` discriminator and per-mode sub-panels. (§4 of proposal.)
- **qPCR analysis**: Cq table, melt curve, standard curve, fold-change, the "PCR + qPCR analysis compound" pattern. (§5 of proposal.)
- **LC gradient**: solvent-gradient chart editor, flow / column / mobile-phase fields.
- **Plate layout**: interactive well-plate grid with sample / control / blank annotations.
- **Cell culture passaging**: passaging schedule, media, cell line, per-task passage history.

Nav drop in: `frontend/src/lib/wiki/nav.ts:197-204` currently lists only PCR as a child of "Methods Library". Each new page needs its own child entry.

---

## 3. Missing coverage: the "Add component (extend into kit)" / "Save & extend into kit" affordances

Two affordances connect existing methods into a compound:

- `WrapAsCompoundAction` (`frontend/src/components/methods/WrapAsCompoundAction.tsx:97`) renders an "Add component (extend into kit)" button on the standalone-view header for any non-compound, non-shared method. Clicking it wraps the current method into a new compound and opens the builder with the original as the first child.
- The CreateMethodModal exposes a "Create & extend into kit" footer button (`frontend/src/components/methods/CreateMethodModal.tsx:1199-1220`) that creates the method then immediately opens the compound builder pre-populated with it.

Wiki only mentions compounds in one line ("Reached by extending an existing method, not as a standalone picker tile") — neither affordance is documented; users have no way to discover them.

---

## 4. Missing coverage: three-button compound-aware delete confirm

`frontend/src/app/methods/page.tsx:394-544` routes deletes through `DeleteMethodConfirm` when the target method is referenced by any compound. The user picks "Just delete" (leaves compounds with an orphan band) or "Cascade delete" (also drops every referencing compound). Wiki only describes deletion implicitly via "Delete this method and all associated files?" and never mentions the cascade prompt.

---

## 5. Missing coverage: convert compound back to single method

`ConvertCompoundToSingleAction` (referenced at `frontend/src/app/methods/page.tsx:2042-2047`) appears on a compound viewer once its component count drops to ≤ 1. It deletes the compound wrapper and navigates to the surviving child. Not covered by the wiki.

---

## 6. Missing coverage: the right-hand "experiments using this method" sidebar

`MethodExperimentsSidebar` (`frontend/src/app/methods/page.tsx:1017`) is rendered alongside every method view modal. It lists every experiment that currently uses the method, with click-through to the experiment popup. The wiki intro mentions it in passing ("a sidebar listing every experiment that currently uses it on the right"), but never describes its filtering, ordering, or interactivity, and no screenshot calls it out.

---

## 7. Missing coverage: Forked methods + the Forked badge + fork flow

The methods page renders an amber "Forked" badge for any method whose `parent_method_id` is set (`frontend/src/app/methods/page.tsx:716-720`). `methodsApi.fork` (`frontend/src/lib/local-api.ts:1702`) is the supported way to make a private editable copy of a shared method. Neither the badge nor the fork flow appears anywhere in the wiki.

---

## 8. Missing coverage: deep-link URL params

Two deep links the methods page handles, used by walkthrough / external link-throughs, are undocumented:
- `/methods?createMethod=public` — auto-opens the create-method modal with whole-lab sharing pre-selected (`frontend/src/app/methods/page.tsx:135-146`, `CreateMethodModal.tsx:77-109,789`). Used by the walkthrough method-attachment step.
- `/methods?openMethod=<id>` — auto-opens the method-detail popup for the matching id (`frontend/src/app/methods/page.tsx:175-191`). Resolves from current-user's library first, then the public namespace.

Optional; deep links rarely need wiki coverage. Flag them as "no need" only after confirming with master.

---

## 9. Missing coverage: per-experiment edits to PCR recipe / gradient and PER-TYPE per-task snapshots

Wiki §"Recording variations on a single experiment" (lines 218-225) calls out PCR as having editable gradient + recipe per experiment with a "Reset to Method" affordance. The same per-task snapshot pattern exists for at least LC, plate, cell-culture, and qPCR analysis (see `task.method_attachments` snapshot fields `lc_gradient`, `plate_annotation`, `cell_culture_schedule`, `qpcr_analysis`, plus `compound_snapshots`). Only PCR is named in the wiki; users with LC / plate / cell-culture / qPCR methods don't know per-experiment edits are even possible.

---

## 10. Missing coverage: image / file drop into the markdown method body

Wiki mentions "you can drag images and attachment files directly into the editor" in passing (lines 116-120). It does not mention:
- The pre-drop rename popup (`useFileRenamePopup`, `frontend/src/app/methods/page.tsx:1150-1199`).
- Image vs file routing (images land in `<methodDir>/Images/`, files in `<methodDir>/Files/`).
- The auto-rename-on-collision behaviour (`pickUniqueImageName`).

The Markdown Editor wiki page (`/wiki/features/markdown-editor`) covers the editor mechanics but not the methods-specific dir layout. Add a callout in methods or a "see also" on the editor page.

---

## 11. Missing coverage: drag-and-drop reorganize is described, but the drop-on-uncategorized bar at the top of the page is missed

Wiki line 134 says "Drop a card on the 'Drop here to move to Uncategorized' bar at the top to clear its category." This is described, but the bar only appears WHILE a card is being dragged (`frontend/src/app/methods/page.tsx:625-640`); the wiki copy implies it is always visible. Minor wording fix: "While you're dragging a method, a 'Drop here to move to Uncategorized' bar appears at the top of the page; drop on it to clear the method's category."

---

## 12. Stale-asset flag: `methods-library.png` predates the 10-type rewrite

The wiki page already carries an inline comment (line 14): `{/* methods-library.png needs recapture: predates 10-type rewrite; alt text still lists only 3 types */}`. The alt text on the screenshot itself ("categories of method cards, with type pills marking the method type on each card") was updated, but the underlying PNG was not. Confirm by sending the screenshot through the wiki-capture script in fixture mode (`?wikiCapture=1`) and reusing the existing alt copy.

---

## 13. Minor: "is_public boolean (now retired)" is forward-correct but slightly aspirational

Wiki text line 170: "the migration from the older `is_public` boolean (now retired)." `methodsApi.create` (`frontend/src/lib/local-api.ts:1599-1656`) still writes `is_public: true` on the persisted record for one release of back-compat (R1d comment block at lines 1599-1611), and the methods page badge falls back to `m.is_public || isWholeLabShared(m.shared_with)` (line 711). The narrative is forward-correct and matches where R1 is heading, so this is non-blocking — but if a reader inspects on-disk records they will still see the boolean. Optional wording softening: "is being retired (one release of back-compat remains)."

---

## Out-of-scope items surfaced for sibling audits

- The HybridMarkdownEditor used by methods bodies has its own dedicated wiki page (`/wiki/features/markdown-editor`); deep audit of that page belongs to the wiki audit: markdown-editor stream.
- Onboarding walkthrough method-attachment cursor demo (clone Stream A) — explicitly out of scope per brief.

---

## Recommended fix bundling (for HR follow-up chips)

1. **single-line bug fix** (#1): remove or rewrite the Markdown-shared read-only paragraph. Low risk, 5 minutes. Ship as its own chip.
2. **per-type wiki pages bundle** (#2): the four v2 type pages already have proposal sections to lean on; the three v1 type pages (LC, plate, cell culture) need fresh outlines. Likely 3-4 chips, one per type, run in parallel.
3. **compound-methods page** (#2 / #3 / #4 / #5): single combined chip — covers WrapAsCompound + Save & extend + cascade delete + convert back.
4. **methods landing-page polish** (#6 + #7 + #9 + #10 + #11 + #12 + #13): one chip can land all of these as additive edits to the existing methods page.
5. **deep-link doc** (#8): optional; flag for master.

No data-shape changes required for any of the above. All edits are pure wiki copy + asset recaptures.
