# Handoff — BeakerAI: Smart Data Binding chat front door (+ create_datahub_table, compare_tree_recipes)

**Date:** 2026-06-14
**Lane:** BeakerAI (the BeakerBot chat front door) — cross-lane with **Phylo / Tree Studio** (`/phylo`)
**Status:** BUILT + on origin/main. Joint Chrome check ran: **CORE PROVEN** (one engine, two doors, identical detection). Chat door had 2 bugs, **BOTH FIXED**. **The only thing left is a fast chat-door re-run** to close it.

This is the BeakerAI-side companion to the Phylo lane's handoff (`docs/handoffs/2026-06-14-phylo-phase4-smart-data-binding.md`), which carries the engine/GUI detail and the locked decisions. Read that for the feature contract; read this for the chat-door surface + the two new standalone BeakerBot tools.

Memory: `project_beakerbot_crud_tools`, `project_phylo_tree_studio_redesign` (Phase 4). Re-run prompt: `docs/test-prompts/2026-06-14-overlay-chat-door-rerun.md`.

---

## What this lane shipped (all on origin/main)

### Chat front door for Smart Data Binding
- **`suggest_tree_overlays`** (`60b2af01a`, deictic-resolve `95260f087`) — resolves the open tree via the context bridge (handles "this tree"), calls the SAME deterministic engine the GUI uses (`frontend/src/lib/phylo/smart-binding.ts`), narrates ranked facts ("joins 7 of 8 tips"), and mounts `<SmartDataWizard>` inline via the `_ui` seam (payload stripped before the model — the model only narrates, never invents the numbers).
- **`overlay-commit.ts`** host commit — `mergeTableColumnsIntoMetadata` + `makePanel(geom)` spliced before labels, persisted via `phyloApi.updateMeta`.
  - **Bug 1 fix (silent no-op persist):** `15c7425ff` — fails LOUDLY instead of reporting false-success when no panel resolves. Pairs with Phylo's engine reuse refinement (`ed9a3cc1f`) so a re-added column lands in `addedColumns`.
  - **Bug 2 fix (no tree card):** `c8c838f24` — on success the wizard is replaced **in place** by a live `<ObjectEmbed>` tree card, no navigation.
  - Pass-through confirmed: `overlay-commit.ts:66` passes `columnIds` straight to the engine, NO "already-bound" filter.

### Two standalone BeakerBot tools (this session, now pushed)
- **`create_datahub_table`** (`0b8d69552`) — one-shot Data Hub table from pasted text: `importTextToTable` + `dataHubApi.create`, `table_type:"column"` (shape confirmed correct). Gated, own-only, no interpretation.
- **`compare_tree_recipes`** (`ffdb9ab2c`) — the PDF-reproduce **light-comparison carve-out**: inline widget comparing tree recipes. Closes the last item on the PDF-reproduce memory.

All four tools respect the hard BeakerBot scope (`feedback_beakerbot_no_interpretation`): expand/relay/operate, never interpret.

---

## THE ONLY THING LEFT — fast chat-door re-run

Artifacts from run 1 are still on Grant's `:3000` (Phase4 Test project, resistance_assay table, Phase4 Tree). Run `docs/test-prompts/2026-06-14-overlay-chat-door-rerun.md` (chat-door-only, no re-seeding):
1. Open **Phase4 Tree** in `/phylo` → BeakerBot → **"What data can I overlay on this tree?"**
2. Confirm `suggest_tree_overlays` narrates "joins 7 of 8 tips" + the wizard mounts inline.
3. Pick **MIC → Heatmap → Add**. VERIFY: heat lands as a 2nd panel on the one `MIC` column (Bug 1), survives reload, and the wizard is replaced in place by a live tree card (Bug 2).

Decisive: persists = closed. Still no-ops = the loud-fail guard surfaces it and we pair with Phylo immediately. When it runs, BeakerAI watches the chat door, Phylo watches the GUI door.

## Open follow-up (post re-run, coordinated with Phylo)
- **Bridge `projectIds`:** Phylo will surface the open tree's `projectIds` on the context-bridge selection (proposed `selection.projectIds?: string[]`). Once the field name is confirmed, default `create_datahub_table` into the tree's project so "make a table from this and put it on my tree" works end-to-end. **Do NOT ship unilaterally** — Phylo owns the bridge publish; BeakerAI confirms the field name and consumes it.

## DEPLOY POSTURE (read before pushing)
Grant said push this session, so the BeakerAI commits (`60b2af01a`/`95260f087`/`15c7425ff`/`c8c838f24`/`0b8d69552`/`ffdb9ab2c`) + the re-run prompt are on origin/main. As of this handoff `main` is **1 commit ahead of origin** (`88fd0f130`, the Figure Composer lane's handoff) — that is the Figure Composer lane's call to push, not ours. **Do NOT `git push origin main` without checking `git log origin/main..main` and confirming no other lane is holding commits.** Multiple lanes share this one main checkout.

## Gate before any change here
`cd frontend && npx tsc --noEmit` (0) + `npx vitest run src/lib/phylo` + the icon-guard. The chat tools are additive and flag-safe; lab tier stays flag-gated.
