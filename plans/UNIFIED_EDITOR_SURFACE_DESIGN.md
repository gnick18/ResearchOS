# Unified Editor Surface — Design

**Status:** Design-locked 2026-06-13 (Grant). Orchestrator's main task. No code yet.
**Supersedes:** the sealed-overlay model in `FOCUS_WRITING_MODE_DESIGN.md` (this retires it) and folds in `MARKDOWN_EDITOR_TYPORA_DESIGN.md` (width presets stay).
**Mockups (approved direction):**
- `docs/mockups/2026-06-13-focus-mode-redesign.html` — the "writing room" focus mode
- `docs/mockups/2026-06-13-everyday-editor-redesign.html` — everyday editor, Level 1 vs Level 3
- `docs/mockups/2026-06-13-unified-focus-surface.html` — focus = the page blown up

---

## 1. Thesis

There is **one editor surface that scales**, not two. "Focus mode" is not a separate component you teleport into — it is the experiment **page at a bigger zoom**. Everyday editing and focus are two scales of the same surface, so entering focus is a zoom, not a context switch, and navigation (tabs) comes along for free.

This deletes a component instead of adding one.

## 2. What's wrong today

- **Focus = a sealed single-doc overlay** built on portal/buffer machinery in `LiveMarkdownEditor.tsx` (~1630–1809 enter/exit + focus trap; ~2640–2815 overlay render). It floats *one* document onto a blank screen, can't navigate the experiment's other tabs, and feels like a teleport. The portal exists only to move one editor in/out without remounting (buffer-loss avoidance).
- **The everyday editor** — where users actually live — is a heavy permanent toolbar (`Edit/Preview`, Add File, Browse, Insert ref, Number figs, Attachments) on a flat `surface-sunken` bar + a left shortcuts rail, crammed into a popup. The surface that matters most gets the least care.

## 3. Target model

### A. The calm editor "atom" (Level 1)
The reusable editing surface, **identical whether docked-small or fullscreen** — this sameness is what makes the unification free.

- **Writing-room typography:** ≈17–18px, line-height ≈1.75, readable measure (the `MARKDOWN_EDITOR_TYPORA_DESIGN.md` width presets stay; default feels composed, not cramped).
- **Calm surface:** ambient paper canvas at fullscreen; a tasteful calm treatment of the editor zone when docked.
- **Quiet contextual toolbar** replaces the heavy bar: a low-contrast `Edit/Preview` + a single **＋ insert** menu + Attachments + Focus, plus **"type `/` to insert"**. No permanent button row.
- **"/" insert affordance + slim insert rail** (right gutter, fullscreen): reference, Data Hub table, plot, sequence, molecule, image — drops a live embed at the caret.
- **Focus behaviors (engage at the fullscreen scale):**
  - Self-effacing chrome that **dozes ~2.5s into writing**, wakes on pointer-move.
  - **Typewriter scroll** — active line held at ~42% (per-user toggle, default off).
  - **Focus dimming** — non-active paragraph/sentence to ~30%, **only while writing** (a `.writing` state toggled on focus/blur — never washes out the resting note). Per-user toggle, default off.
  - **Gutter rails with a measured never-overlap rule:** rails render only when the real empty gutter ≥ ~76px; when too narrow (small laptop, split-screen) the tools **fold into the floating chrome** (＋ / ≡); at full-bleed width they hide entirely.

### B. The container: focus = the page expanded (the unification)
- **Retire** the per-editor sealed overlay + portal/buffer machinery.
- The experiment **popup/page itself** expands to fullscreen — same DOM, a CSS size transition (a real zoom).
- The **tab bar (Details / Lab Notes / Method / Results) is retained and navigable in fullscreen.** Click Method while writing Lab Notes → stay fullscreen, swap doc. This is strictly more capable than today's sealed focus.
- Tab behavior in fullscreen — **OPEN FORK:** dozes with the chrome (default, purest focus) vs stays pinned (always navigable). Grant to pick from feel.
- **Single-doc surfaces (Notes, Methods)** scale identically — same surface, just no tab row (nothing to navigate).

### C. Level 3 — continuous surface (the popup shell goes calm)
- Title → **editorial heading** (no input box); metadata → **quiet subline** (`date · author · status`), not chips.
- **Save bar dissolves** into ambient autosave (`● Saved · just now`) with a plain **Done**.
- One continuous paper surface edge-to-edge, no hard dividers.
- **Hard constraint:** ambient autosave must be visibly trustworthy and **Done/close always reachable from every state** — no soft-lock ([[feedback_no_soft_locks]]).

## 4. Open fork (decide at build time)

**"Blow up" mechanism:** the modal growing to fill the viewport **vs** a real **`/experiment/[id]` route** (shareable URL, browser back, deep-link straight to a tab). **Lean route** — makes "it's just a page that gets big" literally true — but it doesn't change the feel, so it's safe to decide when we build the container.

## 5. Sequence

1. **L1 — the calm editor atom.** Lowest risk; lands on notes + experiments + methods simultaneously (shared component). Ship + dogfood.
2. **Unify — the container.** Expand = focus; retire the sealed overlay + portal/buffer; tabs retained.
3. **L3 — continuous-surface popup shell.** The cohesive end state.

## 6. Files & surfaces

- `frontend/src/components/LiveMarkdownEditor.tsx` — the atom. Build the calm surface + quiet toolbar + "/" + insert rail; later **retire** the focus-overlay/portal/buffer (~1630–1809, ~2640–2815).
- `frontend/src/components/TaskDetailPopup.tsx` — the experiment container (tabs at ~836; Lab Notes / Results / Method / Details mounts). Owns expand=focus + retained tabs.
- `frontend/src/components/NoteDetailPopup.tsx` — single-doc container (notes).
- `frontend/src/app/methods/page.tsx`, `CreateMethodModal.tsx`, `VariationNotesPanel.tsx`, `CompoundChildCreator.tsx` — other `LiveMarkdownEditor` mounts; verify they ride the atom redesign cleanly.

## 7. Cross-lane constraints (2026-06-13)

**BeakerAI** (cleared, no file collision):
- **Preserve the Canvas consumer prop surface.** `frontend/src/components/ai/BeakerBotCanvas.tsx` (~256–262) consumes the editor slimmed via `showShortcutsHelper={false}` + `hideAttachments` (real public props: `LiveMarkdownEditor.tsx:147,153`; `showToolbar:139`). Keep them working through the restructure, and **ping BeakerAI BEFORE the public prop surface changes.**
- **Keep the two "/" UXs visually consistent.** BeakerBot's composer "/" is a separate component (`components/ai/ComposerSlashMenu.tsx` + @-mention picker) — no file collision, but align the look so users learn one "/" mental model, not two.

**MobileUI** (converging, non-blocking — mobile surfaces already lean the same calm direction):
- **Share insert/embed vocabulary** between the editor's "/" insert + slim insert rail and the mobile capture/insert flow + the reformatter's figure-inline + checklist embeds. Locked decisions in `docs/proposals/2026-06-13-method-phone-projection-reformatter.md`.
- **Keep the quiet contextual strip visually consistent** with mobile read-mode's receding bottom controls (prev / variation / next) — same "controls recede until needed" idea.
- Mobile will fold the shared language into the mobile-contract mockups when the mobile editor surfaces get their pass; ping MobileUI when the editor reaches a reviewable state.

## 8. Risks

- **Autosave trust / no soft-lock** (L3) — Done/close always reachable; autosave state obvious.
- **Buffer / data loss on expand** — today's portal machinery exists to avoid remount + in-flight buffer loss; the expand transition must **commit the buffer before expanding** (the current focus toggle already does `commitBufferRef.current?.()`, ~LiveMarkdownEditor.tsx:384) and must not remount the editor subtree mid-edit.
- **Canvas prop-surface stability** — see §7.
- **Expand-transition performance** — the size animation must stay smooth with a real document mounted.

---

## 9. Unify build plan (forks resolved 2026-06-14, Grant)

**Forks resolved:**
- **Tabs in fullscreen = PINNED** (a quiet tab bar stays visible + navigable; they do not doze).
- **Mechanism = MODAL GROWS IN PLACE** (not a route). Same DOM, CSS size transition. Rationale: ResearchOS is local-first, so a `/experiment/[id]` URL is only meaningful on the owner's machine (cross-user sharing already goes through the relay/embed system, not URLs) — the route's main win (shareable links) is muted, while its cost (popup-as-page render, route-level data load, buffer-on-navigate) is the highest risk in §8. Modal-grows delivers the whole feel at a fraction of the risk. **Route stays a clean, feel-neutral follow-up** if deep-linking demand shows up (e.g. BeakerBot operating the app, embed-hybrid path links pointing at experiments).

**Current model (to replace):** `LiveMarkdownEditor` owns focus — its Focus button teleports the editor subtree into a body-level portal overlay (`portalContainerRef` ~371-404, `createPortal` render, focus trap ~1760-1798, buffer-safe portal flip via `commitBufferRef`). Only one doc, can't navigate tabs.

**Target:** the POPUP owns expand. It grows to fill the viewport with the tab bar pinned; the editor renders inline at the larger size (no teleport, no remount). The portal/buffer/trap machinery is retired.

**Chunks (each merges to local main at a clean checkpoint; build in a worktree):**
- **U1 — Container expand (TaskDetailPopup).** `expanded` state + calm size transition growing the popup shell to viewport-fill, same DOM (no remount of tab content). Tab bar pinned + navigable while expanded. Esc / Done / a collapse control reachable from every state ([[feedback_no_soft_locks]]). Commit the editor buffer before expanding (reuse the commitBuffer bridge).
- **U2 — Repoint the Focus affordance.** The editor's Focus button drives the CONTAINER expand instead of its own overlay. Keep the `focusMode`/`onFocusModeChange` prop contract working for tour/other callers (thin pass-through); BeakerBotCanvas (no popup, showToolbar=false) unaffected.
- **U3 — Retire the sealed overlay.** Delete the portal container, the `createPortal` relocation, the focus trap, and the buffer-safe portal machinery. Buffer-loss risk dissolves (no remount). Keep commitBuffer as a plain flush if still referenced.
- **U4 — NoteDetailPopup expand.** Same expand, single-doc, no tab row.
- **U5 — Calm fullscreen polish.** At expanded scale the docked editor KEEPS `.ros-editor-room`, so the dark-room/warm-paper surface + writing-room type now apply in fullscreen too. Chrome (toolbar) dozes ~2.5s into writing; tabs PINNED (never doze). Typewriter scroll + focus dimming stay per-user toggles, default off (the amber decision). Ambient footer optional.
- **U6 — Cleanup + tests.** Remove dead overlay code + stale FOCUS_WRITING_MODE_DESIGN refs, update focusMode tests to the unified model, verify no-soft-lock + buffer-on-expand + Canvas + every other LiveMarkdownEditor mount (methods page, CreateMethodModal, VariationNotesPanel, CompoundChildCreator).

**Risks (§8) recheck:** buffer/data loss is now LOWER (no portal remount); watch expand-transition perf with a real doc mounted, Canvas prop stability, and no-soft-lock on the expanded shell.
