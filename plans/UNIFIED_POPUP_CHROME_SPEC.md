# Unified Popup Chrome — Spec

**Status:** Spec, no code yet (2026-06-14). Extends `UNIFIED_EDITOR_SURFACE_DESIGN.md` (that doc owns the *editor atom* internals; this doc owns the *chrome* — header, actions, meta, tabs, surface — and its application across **every** object detail popup).
**Source of truth:** `docs/mockups/2026-06-13-unified-focus-surface.html` (Grant-approved). The header/tab/control treatment in that mockup is the canonical target for ALL object types.
**Why:** The experiment popup now reads ~9/10 (calm surface + Focus). Notes, lists, purchases, projects, molecules, supplies still read ~5/10 old-school (banded headers, crowded action clusters, persistent toolbar bands). One polished surface beside five legacy ones makes the app feel like five apps. The fix is **one shared chrome primitive every popup inherits**, not per-popup polish.

---

## 1. The gap (measured against the approved mockup)

Comparison done live 2026-06-14 (experiment Lab Notes popup vs `unified-focus-surface.html`). The live popup stacks **five opaque bands**; the mockup is **one continuous surface**. Six concrete chrome diffs — these are the canonical "calm header anatomy" every popup must adopt:

| # | Gap (live now) | Target (mockup) |
|---|----------------|-----------------|
| C1 | Header is a solid band with `bg` + `border-b border-border` (when docked). | Header is **transparent on the surface** at every size — no band, no divider. |
| C2 | Action cluster = 7 controls: 💬 ⋯ ●Saved Done ⤢ 🗑 ✕. | **Two** ghost icon buttons: ⤢ Focus + ✕ Close. Everything else demoted (see C2-map). |
| C3 | Type chip (`EXPERIMENT`) clutters the title. | No chip; object type is conveyed by context/the meta subline. |
| C4 | **Two** meta rows (`DEMO: … · dates · 1 day` then `alex · In progress · Private`). | **One** `.s-meta` subline: `date · author · status · tag/visibility`. |
| C5 | Persistent bordered editor toolbar band (`Edit ǀ Preview ǀ ＋ ǀ Attachments ǀ / to insert … Saved ǀ ↻ ǀ Save checkpoint`). | **No toolbar band.** Editing controls live in a **floating centered pill** that dozes while writing (fullscreen) + the `/` insert affordance. |
| C6 | `Shortcuts / Style Guide` sub-rail with collapse chevron. | Retired. Insert = the floating right rail; help/shortcuts fold into `/` and a single quiet affordance. |

**C2-map — where the 5 demoted header controls go:**
- `● Saved` / autosave state → **ambient footer line** (`.s-foot`, "Saved · just now — autosaves as you write"). Already exists in mockup.
- `Done` → **footer** (right-aligned), not the header.
- `🗑 Delete` → the **⋯ overflow menu** (single kebab inside the footer or as the only secondary header affordance), behind the existing destructive-confirm.
- `💬 Comments` / `↻ History` → **⋯ overflow menu** (or the existing right-rail toggles, but launched from ⋯, not as always-on header buttons).
- `Save checkpoint` → **⋯ overflow** (it's a power action, not primary chrome). Matches the prior `28de3144f`/`ac70764b1` decision for the fullscreen pill.

---

## 2. Canonical calm chrome anatomy (what every popup renders)

Top to bottom, on ONE surface (`.ros-calm-surface` family — see §4):

1. **Header** (`.s-head`, transparent, no divider):
   - **Title** (left, `.s-title`; grows from ~21px docked → ~30px fullscreen).
   - **Meta subline** (`.s-meta`, one line, `paper-dim`): `date · author · status · {type-specific tail}`. Status uses `--action` color. The tail is per-type (experiment: tag; note: notebook; purchase: vendor/status; project: phase; molecule: formula).
   - **Actions** (right, `.s-acts`): **⤢ Focus** (only when the surface supports expand) + **✕ Close**. Optional single **⋯** overflow when a type has secondary actions (delete, history, comments, checkpoint). Max 3 glyphs, ghost style (`.iconbtn`).
2. **Tab row** (`.s-tabs`, transparent, quiet) — **only for multi-view objects** (experiment: Details/Lab Notes/Method/Results/Purchases; project: Home/Results/Methods/…). Single-view objects (note, purchase, molecule, supply) render **no tab row** — nothing to navigate. Tabs doze with chrome at fullscreen.
3. **Body** (`.s-scroll` → children). Editor types host the calm editor atom; non-editor types host their detail content directly on the surface (no inner card bands — see C1 applied to inner sections too, via `.ros-detail-card`).
4. **Footer** (`.s-foot`, transparent, dozes): ambient autosave line (left) + word/▢ count + **Done** (right). Optional ⋯ overflow anchored here.
5. **Floating pill** (`.s-float`, fullscreen only, dozes): `Edit/Preview · ＋ · 📎 · ⤡ dock`. Already built in `LiveMarkdownEditor`/the experiment path — generalize it (see §5).
6. **Insert rail** (`.s-rail`, fullscreen gutter only, never-overlap rule from the editor design doc).

---

## 3. Decisions (derived from the approved mockup — not re-opening)

- **D1 — Calm at BOTH sizes.** The mockup's docked card already shows the transparent header on the room surface. So the calm-surface treatment (transparent header/tabs, no `border-b`) applies **docked too**, not only `isExpanded`. Today `border-b border-border` is only dropped when expanded (`TaskDetailPopup.tsx:1165`, `NoteDetailPopup.tsx:1578/2127`) — extend that to docked. *(If Grant wants docked to keep a faint divider for density, that's a one-line revert — flag at review.)*
- **D2 — Floating pill is the only editing chrome.** Retire the persistent docked toolbar band (C5). Pill at fullscreen; docked shows the minimal quiet `Edit/Preview` + `/`-insert hint only (no Save-checkpoint/Attachments band).
- **D3 — No type chip** (C3). Drop `EXPERIMENT`/etc. from the title across all types.
- **D4 — Non-editor types still adopt header + surface + action chrome** (molecule, supply, cell, taxonomy, purchase-history) even though they have no editor room — so the *frame* is identical app-wide even when the body differs.
- **Deferred (unchanged from editor doc):** "blow up = modal-grow vs real `/[type]/[id]` route" stays open; does not block this chrome work.

---

## 4. Shared primitive — `CalmPopupShell`

**Problem:** `LivingPopup` (`components/ui/LivingPopup.tsx`) only owns scrim/zoom/escape/card — **not** header/tabs/toolbar/footer. Every popup hand-rolls its chrome, so the experiment's polish can't propagate. This is the root cause of the 5/10-vs-9/10 split.

**Build `components/ui/CalmPopupShell.tsx`** — wraps `LivingPopup`, owns the canonical anatomy (§2), exposes slots:

```
<CalmPopupShell
  open origin onClose
  title={ReactNode}                 // .s-title
  meta={ReactNode}                  // .s-meta single subline (caller composes date·author·status·tail)
  tabs={[{key,label}] | undefined}  // .s-tabs; omit → no tab row
  activeTab onTabChange
  expandable                        // show ⤢ Focus; owns isExpanded + .ros-calm-surface toggle + Cmd/Ctrl+Shift+F
  overflow={MenuItem[] | undefined} // single ⋯ (delete/history/comments/checkpoint)
  footer={{ saveState, doneLabel, onDone, wordCount? }}
  insertRail floatingPill           // opt-in for editor types
>
  {children}                        // body on .s-scroll
</CalmPopupShell>
```

The shell owns: `isExpanded` state + `.ros-calm-surface` class toggle (D1: applied docked + expanded), the ⤢/✕ cluster, the transparent header/tabs, footer ambient save + Done, doze timing, focus-trap/Escape (lifted from the two existing popups so the logic lives once). Callers stop hand-rolling chrome and just pass slots.

This collapses the duplicated `isExpanded`/calm-surface/Focus-toggle/Escape blocks currently copy-pasted in `TaskDetailPopup` and `NoteDetailPopup` into one component, and gives every other type the same chrome for free.

---

## 5. Migration map (every object detail popup)

| Popup | Type | Today | Work |
|-------|------|-------|------|
| `TaskDetailPopup.tsx` | Experiment | calm-surface wired; banded docked header; 7-btn cluster; toolbar band; chip; double meta | **Reference migration.** Move to `CalmPopupShell`; apply C1–C6. Keep tabs (Details/Notes/Method/Results/Purchases). Validates the shell. |
| `NoteDetailPopup.tsx` | Note | calm-surface wired; single-view; history/comments rails; chip-ish | Move to shell; no tab row; comments/history → ⋯ overflow; C1–C6. |
| `ProjectDetailPopup.tsx` | Project | no calm wiring; view-switcher (Home/Results/Methods/…) | Adopt shell; map view-switcher → `.s-tabs`; add `expandable`. |
| `PurchaseEditor.tsx` / `PurchaseHistoryPopup.tsx` / `NewPurchaseModal.tsx` | Purchase | old-school modal chrome | Adopt shell (non-editor body); single meta subline (vendor · date · status); footer Done. Highest visible win — "purchases look 5/10". |
| `MoleculeEditorPopup.tsx` | Molecule | banded header px-4 py-3 + rail tabs + bottom save bar | Adopt shell; Identity/Papers/History → `.s-tabs`; Ketcher canvas as body; save → footer. |
| `SupplyDetailPanel.tsx` | Supply/Inventory | banded two-section | Adopt shell; On Hand/Ordering as body sections on surface. |
| `CellDetailDialog.tsx` | Storage cell | banded | Adopt shell (read-style). |
| `TaxonomyNodeDetail.tsx` | Sequence node | banded | Adopt shell (read-style). |
| `MethodLibraryDetail.tsx` | Method (library) | read-only pane | Adopt shell header/surface (no editor). |
| Simple-task path (`TaskDetailPopup` `isSimpleTask`, "lists") | List/checklist task | minimal modal | Route through shell so even the lightweight list item matches. |

"Lists" = the simple-task / checklist surface (`TaskDetailPopup.tsx:929 isSimpleTask`). Confirm with Grant if he means a different list surface, but this is the checklist-style task popup.

---

## 6. Sequencing

1. **Foundation:** build `CalmPopupShell` + lift the calm-surface/Focus/Escape logic out of the two existing popups into it. Extend `.ros-calm-surface` to docked (D1). Generalize the floating pill so it's shell-owned, not experiment-only.
2. **Reference migrations:** `TaskDetailPopup` + `NoteDetailPopup` onto the shell with C1–C6. **Browser-verify** (Grant, :3000 `/demo`) light+dark, docked+fullscreen. These two already work, so regressions are obvious.
3. **Cross-type rollout (the actual "one app" payoff):** Purchase → Project → Molecule → Supply → Cell → Taxonomy → Method. Each lands + gets a quick live check; non-editor types verify the frame matches without an editor body.
4. **Cleanup:** delete the per-popup duplicated chrome JSX, the persistent toolbar band, the Shortcuts/Style-Guide rail.

Each phase is independently mergeable from a worktree. Phase 1 is the gate — nothing else should start until the shell's API is proven on the two reference popups.

---

## 7. Files
- New: `frontend/src/components/ui/CalmPopupShell.tsx`
- Touch: `frontend/src/app/globals.css` (`.ros-calm-surface` docked application; `.s-*` chrome rules promoted from mockup), `LiveMarkdownEditor.tsx` (pill generalization + drop docked toolbar band), every popup in §5.
- Reference: `UNIFIED_EDITOR_SURFACE_DESIGN.md` (editor atom), `docs/mockups/2026-06-13-unified-focus-surface.html` (chrome target). Memory: `project_focus_mode_unification`.
