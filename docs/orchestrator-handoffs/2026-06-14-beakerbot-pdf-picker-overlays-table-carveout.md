# BeakerBot — PDF figure picker verified, Smart Data Binding chat door, create_datahub_table, compare carve-out (session 9, 2026-06-14)

Lane: BeakerAI. Picks up from `2026-06-14-beakerbot-record-set-widget-and-beakersearch.md`.
**ALL WORK PUSHED to origin/main** this session (Grant said push; `main` == `origin/main`,
auto-deploys to prod). Tip at handoff: `4ffc53d9d`. Whole-tree tsc 0, icon-guard clean,
~1576 AI/composer tests green.

## What happened, in order

1. **PDF-reproduce was already built** (the session-8 handoff was STALE calling it the
   "biggest net-new unbuilt"). Verified all 4 outputs + ingestion present + 111 unit tests.
   `[[feedback_verify_broken_missing_claims]]`. Wrote `docs/handoffs/CHROME_VERIFY_PDF_REPRODUCE.md`.

2. **Figure-vision gap found + closed** (Grant: text-only PDF defeats figure-aesthetic match).
   Built the **figure picker**: `lib/ai/pdf-render.ts` (renderPdfThumbnails + renderPdfRegion;
   region rendered DIRECTLY into a region-sized canvas via a page transform = no full-page
   memory blowup; pure `computeRegionPlan`/`normalizeRect` unit-tested) + `components/ai/
   PdfFigurePicker.tsx` (page-thumbnail grid -> click page -> drag-crop -> cropped high-res PNG
   staged into the existing pendingImages vision path). Chose full picker+crop over the cheaper
   auto-send-all-pages shortcut per the new philosophy. `ccdb0f9d5`.

3. **Browser-verified the picker end-to-end** on Grant's authed :3000 (full PASS): focused-tab
   render+crop incl two-figures-on-a-page precision; paperB page-2 multi-page nav; the 200 vision
   match (match_figure_style). Two caveats were PREVIEW-ENV artifacts NOT bugs: pdf.js render
   needs a visible tab (rAF is paused in a hidden/automation tab); the AI proxy 401s in
   demo/worktree (not authorized). Test papers generator committed: `frontend/scripts/make-test-papers.mjs`.

4. **Two bugs found + fixed along the way:**
   - **drag-drop a PDF did nothing** (onDrop only handled images, drop zone vision-gated). Fixed
     `f32d92902`.
   - **chat-embed scroll-flicker** (Grant repro'd): inline phylo tree embed cycled
     loading/fitted/oversized + jumped the scroll. Root cause = AssistantMarkdown built its
     react-markdown `components` INLINE -> new identities every re-render -> react-markdown
     remounts the embed subtree -> PhyloEmbed resets to "loading". Fixed by hoisting the
     components map to module scope + React.memo. `77c3984fb`. Reference memory
     `[[reference_react_markdown_inline_components_remount]]` (STANDING RULE: never inline
     react-markdown `components`). Fixes ALL inline chat embeds, not just trees.

5. **Progressive PDF thumbnails** (`f2b66535f`): renderPdfThumbnails takes onStart/onThumb; the
   picker shows the grid as the doc opens + appends each page as it renders with an "N of M
   ready" line. (Before/after shown to Grant via a visualize widget.)

6. **Smart Data Binding chat front door** (Phase 4, coordinated with the Phylo lane). New
   read-only tool **`suggest_tree_overlays`** (`lib/ai/tools/phylo-tools.ts`): ranks the open
   tree's project Data Hub tables that join its tips via the SAME engine the /phylo GUI uses
   (`rankJoinCandidates`), relays facts, and rides the candidates UI-only so
   BeakerBotConversation mounts the SAME `SmartDataWizard` inline. Seam: `lib/ai/overlay-wizard.ts`
   (reuses the record-set `_ui` key + strip, discriminated `widget:"overlayWizard"`, captured via
   `captureInlineWidgets` in conversation-store). Host commit `components/ai/overlay-commit.ts`
   mirrors PhyloStudio.addSmartOverlays (mergeTableColumnsIntoMetadata + makePanel, persist via
   phyloApi.updateMeta). Deictic "this tree" resolves to the open tree via the context bridge.
   `60b2af01a` + fixes.

7. **Joint Chrome check with the Phylo lane** (one-script-two-doors on Grant's :3000). Shared
   engine PROVEN (both doors identical detection/ranking). GUI door PASSED. Chat door fired +
   narrated + wizard mounted, but TWO host-commit bugs (now fixed):
   - **bug 1**: Add reported success but the overlay did not persist (re-adding a column already
     on the tree). Fix = phylo's `mergeTableColumnsIntoMetadata` reuse (`ed9a3cc1f`, reports the
     existing column in addedColumns) + my **loud-fail guard** (`15c7425ff`, no silent success).
     My host passes columnIds straight to the engine with NO filter (confirmed).
   - **bug 2**: no result card after Add. Fix (Grant's pick, richer than the wizard done-step
     button) = on Add the chat host replaces the wizard IN PLACE with a live tree-embed card of
     the overlaid tree (no auto-navigate). `c8c838f24`. Phylo reverted their unused done-step
     props (`308b136db`).

8. **create_datahub_table** (`0b8d69552`): gated tool that parses pasted CSV/TSV via the existing
   `importTextToTable` and creates a "column" table via `dataHubApi.create` (mirrors the import
   path; Phylo confirmed the shape). Fills the CRUD gap + closes the Phase 4 loop (create a table,
   then suggest_tree_overlays it onto a tree, all in chat). `lib/ai/tools/create-datahub-table.ts`.

9. **Light-comparison carve-out** (`ffdb9ab2c`): the LAST spec'd PDF-reproduce piece. Tool
   **`compare_tree_recipes`** (read-only) diffs the paper's recipe vs the user's deterministically
   (`resolveBuilderOptions` on both -> `lib/ai/recipe-compare.ts` `compareBuilderOptions`) and
   renders an inline `RecipeComparisonWidget` (Grant's pick B, so the model never reformats a
   number). FACTS ONLY by construction; system-prompt enforces descriptive-not-prescriptive. The
   ONE scoped no-interpretation loosening.

## AGENTS.md / conventions added this session
- **§4 Product philosophy** (Grant): "Efficiency is the name of ResearchOS" — pick the best
  solution for the USER even when it's the most work for us. `[[feedback_efficiency_first]]`,
  `4bf8cd07e`.
- **§4 Inter-lane messaging**: always use the CDD message tool (`mcp__ccd_session_mgmt__send_message`),
  not hand-Grant-text. `c555fcef2`, `[[feedback_relay_signoff_to_from]]`.

## NOT done / next

- **Joint re-run of the overlay chat door** (the one live confirmation left): prompt is written,
  `docs/test-prompts/2026-06-14-overlay-chat-door-rerun.md` — fast, chat-door-only, reuses the
  :3000 artifacts. Grant runs it; BeakerAI watches chat door, Phylo watches GUI door. Expected:
  MIC->heat persists as a 2nd panel on the one MIC column.
- **create_datahub_table project auto-default** (coordinated follow-up): Phylo will surface the
  open tree's `projectIds` on the context-bridge selection (field `projectIds?: string[]`); then
  default the create tool's project_ids to it so "make a table then overlay it" just works.
- **Browser-verify the two new tools** (`compare_tree_recipes`, `create_datahub_table`) — unit-only
  so far (both need the live model).
- BeakerSearch single-runtime-index merge remains explicitly NOT recommended (registry + adapters
  solved the drift).

## Memory updated
`[[project_beakerbot_pdf_reproduce]]` (feature COMPLETE), `[[reference_react_markdown_inline_components_remount]]`,
`[[feedback_efficiency_first]]`, `[[project_beakerbot_record_set_widget]]` (sibling seam).
