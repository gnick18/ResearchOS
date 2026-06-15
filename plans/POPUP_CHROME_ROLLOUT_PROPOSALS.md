# Popup Chrome Rollout — Per-Type Proposals (Phase 3)

**Status:** ✅ APPROVED 2026-06-14 (Grant, all 8 types). Depends on Phase 1 (`CalmPopupShell`) landing first. Every rollout PR passes the **Render gate** (§ bottom) before it reaches Grant.
**Parent spec:** `plans/UNIFIED_POPUP_CHROME_SPEC.md` (chrome anatomy C1–C6, decisions D1–D4, the shell API).
**Goal of this doc:** lock, per object type, exactly what fills the shared shell's slots so every popup is the *same frame* with type-appropriate content. Content below is read verbatim from the live components — labels are real.

Every type follows the same anatomy: **transparent header on one surface · title + one meta subline · ⤢ Focus + ✕ Close (+ optional ⋯) · quiet tabs only if multi-view · ambient footer · body on the surface (no inner bands)**. What changes per type is only the meta string, whether there are tabs, the ⋯ items, and the body.

---

## 1. Purchase  (`PurchaseEditor` / `NewPurchaseModal` / `PurchaseHistoryPopup`)
*Highest-visibility win — purchases read most "5/10" today.*

- **Title:** the purchase/order name (e.g. `Reagent Order #2`). No `Purchase` chip (C3).
- **Meta subline:** `{vendor} · {date} · {order status} · {order total}` — e.g. `NEB · Jun 12 · Ordered · $412.40`. Status uses `--action` color.
- **Tabs:** none for a single order. (Inside a purchase *task* the existing Purchases/Details split stays as shell tabs.)
- **⋯ overflow:** Version history, Send to department (approval-gated), Delete.
- **Footer:** ambient "Saved · autosaves" + **Done**.
- **Body:** the line-item table stays, but **de-banded** — drop the heavy header bar; column heads become a quiet caption row; the inline-edit highlight stays amber (semantic). Docs sub-row + totals `tfoot` unchanged. New-line `＋` row sits at the bottom of the table, not a separate band.
- **NewPurchaseModal:** same shell; single-column form (`Item Name · Vendor · Category · Price/unit · Qty · Funding string`) on the surface; "Reorder a recent item" chips stay above Item Name; **Save** → footer.
- **HistoryPopup:** shell with title `Purchase item history`; diff pane + version sidebar as body; **Restore** in footer.

## 2. Project  (`project-surface/ProjectDetailPopup`)
- **Title:** color-dot + project name. `Archived` / `Shared by {owner}` → quiet pills in the meta line, not stacked badges.
- **Meta subline:** `{tasksComplete}/{tasks} complete · {experiments} experiments · Last active {relative}`.
- **Tabs (`.s-tabs`):** map the doorway view-switcher → **Home · Results · Methods · Sequences · Molecules · History** (each shown only when it has content, same conditions as today: `glance.hasResults` etc.).
- **⋯ overflow:** Edit, Archive/Unarchive, Delete (owner-only, red).
- **Footer:** Done. (Project Home is read-style; no autosave line unless editing the overview.)
- **Body (Home):** status-glance bar + funding chip + `#tags` + **About** prose + **Go to** doorway grid + **Recent activity** — all on the surface, section heads in the quiet `uppercase tracking-wide` style, no card bands.

## 3. Molecule  (`chemistry/MoleculeEditorPopup`)
- **Title:** the molecule name input (placeholder `Name this molecule`). `Drawing`/`Editing` → meta line, not a header badge.
- **Meta subline:** `{Editing|Drawing} · {Formula} · {Avg MW} g/mol` (live from RDKit) — e.g. `Editing · C8H10N4O2 · 194.19 g/mol`.
- **Tabs (`.s-tabs`):** **Identity · Papers & patents · History** (History only when enabled & not new) — the right-rail tabs become shell tabs.
- **⋯ overflow:** Copy canonical SMILES, Copy InChIKey, Copy reference for a note.
- **Footer:** the bottom save bar → ambient footer: status text left (`Edits update the stored .mol…`) + **Save to library** right.
- **Body:** Ketcher canvas (left, flex-1) + active-tab panel (right) on the surface; the Identity RDKit table + Lipinski badge + Linked projects render without their own card border (`.ros-detail-card` dissolve).

## 4. Supply / inventory item  (`supplies/SupplyDetailPanel`)
- **Title:** supply name (e.g. `Taq Polymerase`).
- **Meta subline:** `{category} · {vendor} · Cat# {catalogNumber} · CAS {cas}` (omit blanks).
- **Tabs:** none.
- **⋯ overflow:** none initially (Reorder is primary — see footer).
- **Footer:** **Reorder** primary (toggles to `In cart`); Done/Close.
- **Body:** **On hand** + **Ordering** sections on the surface (quiet `uppercase` section heads); stock rows + order-line pills unchanged; **Add stock** stays inline under On hand.

## 5. Storage cell  (`inventory/CellDetailDialog`)
- **Title:** `{item?.name ?? 'Stock'}` (occupied) or `Place a stock here` (empty).
- **Meta subline:** `{box.name} · Position {position} · {status}`.
- **Tabs:** none (occupied/empty/move are body states, not tabs).
- **⋯ overflow:** none (Remove is a body action).
- **Footer:** Close. Occupied primary actions **Open item** + **Move** sit in the body, not the header.
- **Body:** read-style on the surface — lot/container/expiry line + status chip; Move mode (cell grid) and Empty mode (search + unplaced list) render in-body unchanged.

## 6. Taxonomy node  (`sequences/TaxonomyNodeDetail`)
- **Title:** taxon name.
- **Meta subline:** `{rank} · taxon {taxId} · {N species|assemblies}` (count toggle stays interactive on the chip).
- **Tabs:** none.
- **⋯ overflow:** none (actions are body-level).
- **Footer:** provenance line (`From the offline taxonomy backbone.` / `Loaded live from the NCBI taxonomy.`) + Close.
- **Body:** **Center the view here** + **Import from NCBI** action row, then **Genome assemblies** section (loading/empty/list states, `Reference` pills, per-assembly **Import this assembly`) — on the surface.

## 7. Method library detail  (`methods/MethodLibraryDetail`, read-only)
- **Title:** template/type title + the built-on type badge (kept — it's structural, not a redundant object-type chip).
- **Meta subline:** `{type label} · {Enabled|Disabled}` (+ `#tags` for a template).
- **Tabs:** none (the three shapes — type / template / kit — are distinct mounts, not tabs).
- **⋯ overflow:** none.
- **Footer:** the action lives here: **Use template** / **Use kit** + destination line `Will be added to: {dest}` (or the **Enable {label}** path when the type is off).
- **Body:** **The editor** / **Sample** / **Templates built on this type** (type) — or **Preview** + **View full protocol** (template) — or **Built on these types** / **Bundled steps** (kit), section heads in the quiet style, on the surface.

## 8. Simple task / checklist ("lists")  (`TaskDetailPopup` `isSimpleTask`)
- **Title:** completion ○/✓ + task name (strikethrough when done) — the checkbox stays left of the title.
- **Meta subline:** `{N of M done} · {due date} · {assignee}` when present (today the minimal popup shows none — add the subline only if data exists).
- **Tabs:** none docked; expanding (⤢) routes into the full task shell (with Details/Notes/… tabs).
- **⋯ overflow:** Delete task.
- **Footer:** ambient save + Done.
- **Body:** the checklist (○/✓ rows, hover-✕ delete) + the `Add item…` row at the bottom — on the surface, no band.

---

## Rollout order & gating
Per spec §6 step 3, each lands independently from a worktree, tsc-clean, and gets a quick live check before the next:
**Purchase → Project → Molecule → Supply → Cell → Taxonomy → Method → List.**
Purchase first (biggest visible payoff); read-style trio (Cell/Taxonomy/Method) are cheap once the shell + one editor type are proven.

Each type's PR = swap its bespoke header/actions/footer JSX for `CalmPopupShell` slots per its section above; preserve all behavior (gating, actions, data). No body logic changes beyond de-banding sections onto the surface.

---

## Render gate (anti-drift — MANDATORY before any type reaches Grant)

Context: the experiment popup took ~7 review rounds because the human was the diff loop — the build drifted from `unified-focus-surface.html` (re-approximated tokens, a width cap, a white header band) and only Grant's eye caught it. This gate makes the approved mockup a checkable oracle so each build is verified to match **before** Grant sees it. Applies to Phase 1 (shell) and every Phase 3 type.

**Run per type, looped until pass:**
1. Build lands, `cd frontend && npx tsc --noEmit` = 0.
2. Orchestrator opens the live popup on `http://127.0.0.1:3000/demo` (NOT localhost — HSTS) via Claude-in-Chrome; screenshot **light + dark** and (where it expands) **docked + fullscreen**. Dark via avatar menu → Dark mode. (Chrome can't wake the dozing chrome with a synthetic hover — JS-force `opacity:1` to inspect, or read computed state.)
3. Open the approved mockup HTML at the same viewport; screenshot it.
4. Hand both image sets + the **Shared chrome checklist** + that type's **Body checklist** to an **independent verifier agent**, prompted adversarially: *"List every way the build differs from the mockup. Default to FAIL on any uncertainty."*
5. Fix every delta; re-run from step 2. Only a clean pass reaches Grant.

### Shared chrome checklist (every type — lifted from the mockup)
Use the EXISTING globals.css tokens (`--editor-room-top/-bot/-edge`, `.ros-calm-surface`, `.ros-editor-room`, `.ros-detail-card`) — do NOT introduce new hex. Reference values from `unified-focus-surface.html :root`: room-top `#fbfaf7` / room-bot `#f3f1ea` / paper-fg `#1a2230` / paper-dim `rgba(26,34,48,.34)` / action `#1283C9`; dark room-top `#10182a` / room-bot `#0a1120` / paper-fg `#e7eefb` / action `#39a7e6`.
- [ ] Whole popup is ONE continuous surface — header, tabs, body, footer all transparent on the room. No white/sunken band anywhere, no inner card borders (`.ros-detail-card` dissolves).
- [ ] Header has **no bottom border / no divider** at docked AND fullscreen (today's `border-b border-border` is gone at both sizes — D1).
- [ ] Title: weight 800, letter-spacing −.01em, ~21px docked → ~30px fullscreen.
- [ ] Meta is **exactly one line** (`.s-meta`, paper-dim, 12px), status in `--action` color. No second meta row.
- [ ] No object-type chip on the title (EXPERIMENT/NOTE/PURCHASE). (Method's built-on *type* badge is allowed — structural.)
- [ ] Header actions = **⤢ Focus + ✕ Close only**, plus at most one **⋯** overflow. Ghost `.iconbtn` (32×32, radius 9, paper-fg 6% bg). The 5 demoted controls (Saved/Done/Delete/Comments/History/Checkpoint) are NOT in the header.
- [ ] No persistent editor toolbar band (`Edit ǀ Preview ǀ ＋ ǀ Attachments ǀ /to-insert … Save checkpoint`). Editing controls = the floating centered pill at fullscreen only; docked shows just the quiet Edit/Preview + `/` hint.
- [ ] No `Shortcuts / Style Guide` rail.
- [ ] Footer: ambient autosave dot+text (left), Done (right); dozes at fullscreen.
- [ ] Tabs (`.s-tabs`) only for multi-view types; transparent, weight 700 paper-dim, `.on` = paper-fg 8% bg; doze with chrome at fullscreen.
- [ ] Dark mode: every surface/text uses the dark room tokens (no light-scope bleed onto the dark room — re-assert per `db6355a3a`).

### Per-type body checklist
- **Purchase:** line-item table de-banded (no heavy header bar; quiet caption row); amber kept ONLY on the in-edit row; totals in `tfoot`; `＋ Add item` is the last table row; Docs sub-row intact; History/Send-to-dept/Delete in ⋯.
- **Project:** doorways → tabs (each shown only when it has content); Home = glance bar + funding chip + `#tags` + About + Go-to grid + Recent activity, all on the surface; Edit/Archive/Delete in ⋯.
- **Molecule:** Identity/Papers&patents/History as header tabs; Ketcher left + active panel right on the surface; RDKit table + Lipinski + Linked projects un-carded; Save-to-library + status text in footer; Copy SMILES/InChIKey/reference in ⋯.
- **Supply:** On hand + Ordering sections (quiet uppercase heads) on surface; Reorder primary (→ `In cart`); Add stock inline under On hand.
- **Cell:** read-style; lot/container/expiry + status chip; Open item/Move/Remove in body; occupied/empty/move are body states (no tabs); Close in footer.
- **Taxonomy:** Center-here + Import action row; Genome assemblies section (loading/empty/list, `Reference` pills, per-row Import); provenance line in footer; count toggle stays interactive.
- **Method:** built-on type badge kept; The editor/Sample/Templates (or Preview/View-full, or Built-on/Bundled-steps) sections on surface; Use template/Use kit + destination in footer.
- **List (simple task):** ○/✓ checkbox left of title; checklist rows with hover-✕; `Add item…` last row; meta subline only when due/assignee/N-of-M exist; Delete in ⋯; ⤢ routes into the full task shell.
