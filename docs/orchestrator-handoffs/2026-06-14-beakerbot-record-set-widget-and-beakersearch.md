# BeakerBot — record-set widget, the ">4" rule, and BeakerSearch one-front-door (session 8, 2026-06-14)

Lane: BeakerAI. All work on local `main`, **NOT pushed** (a push to origin is the
lab-tier launch trigger per `[[project_cloud_accounts_local_data]]`; these are flag-free
AI changes held with the rest of local `main`). Picks up from the session-7 handoff
(`2026-06-14-beakerbot-summary-robustness-resolvers.md`).

## What happened, in order

1. **Took over the session-7 lane + live-verified it.** Ran all 7 deterministic-resolver
   Chrome checks on `/demo` (script: `docs/handoffs/CHROME_VERIFY_BEAKERBOT_RESOLVERS.md`).
   Result 7/7, every hard guardrail intact. Two soft (graceful-degradation) deviations,
   both fixed:
   - **Check 7** — an impossible filter dimension ("color tag" on experiments) returned
     empty instead of degrading. Fix = system-prompt degrade rule (drop the un-honorable
     dimension, run the closest doable summary, say what was ignored). `af5ea3d1c`.
   - **Check 4** — an owner name matching nobody returned a misleading $0. Fix = when the
     roster is KNOWN and no owner ref resolves, return a no-match signal so the model asks
     who was meant; roster-aware so a solo user / empty roster keeps the raw filter.
     `9367c2fab`.

2. **Record-set widget** (Grant: a bare count is a dead end). When any record tool
   returns a SET, the chat renders an inline searchable master-detail browser below the
   reply. DETERMINISTIC: it appears because the tool RAN, not because the model emitted a
   link. The full set rides UI-only under `_ui`, which the loop STRIPS before the result
   reaches the model, so model context stays lean.

3. **The universal ">4" rule** (Grant's bigger idea). A SET of records is NEVER
   prose-listed; it always renders the widget, sized by count. Then he picked the ≤4
   presentation ("Option D") from a visualize-tool mockup.

4. **Live-verified the widget + fixed three things** (Grant ran the 12-check script
   `docs/handoffs/CHROME_VERIFY_RECORD_SET_WIDGET.md`). `406248cd1`.

5. **Finished BeakerSearch one-front-door** (Phases 1 + 2), which turned out ~80% already
   built.

## The record-set widget (the core build)

**Sizing rule (locked):** a SET renders the widget, sized by count.
- **1 item** = inline chip (a single mention, not a set).
- **2-4 items** = COMPACT "Option D" layout: a row of selectable chip-tabs + ONE shared
  preview pane below + Open-full. The big widget in miniature.
- **5+ items** = FULL layout: search box + type-filter chips + scrollable left rail +
  preview pane.
- Constants: `RECORD_SET_MIN_ITEMS = 2`, `RECORD_SET_COMPACT_MAX = 4` in `record-set.ts`.

**Architecture (the seam):**
- `frontend/src/lib/ai/record-set.ts` — `RecordSet`/`RecordSetRow`/`RecordSetRowType`,
  `withRecordSetUi` / `stripRecordSetUi` / `recordSetFromResult` / `briefToRow` /
  `attachRecordSetIfBig` (gates on `>= RECORD_SET_MIN_ITEMS`) / `maybeRecordSet`.
- `frontend/src/lib/ai/agent-loop.ts` — new `onToolResult(toolName, args, result)` option,
  fired after `runToolCall`; the tool LoopMessage pushed to the model uses
  `stripRecordSetUi(result)` so `_ui` never costs a token.
- `frontend/src/lib/ai/conversation-store.ts` — `ChatMessage.recordSets`, populated from
  `onToolResult` on the in-flight assistant message (both `runAgentLoop` call sites).
- `frontend/src/components/ai/RecordSetWidget.tsx` — `RecordSetWidget` (branches on
  `items.length` → `CompactRecordSet` vs `FullRecordSet`), preview pane reuses
  `ObjectEmbed` (the per-type embed renderers), Open-full via `openObjectRef`
  (popup-capable types) or `requestNavigation` (pageless: purchase → /purchases,
  inventory → /inventory).
- Rendered in `BeakerBotConversation.tsx` below the assistant bubble for each `recordSet`.

**Tools that attach `_ui` (gated `>=2`):** list_records, search_full_text,
summarize_experiments/notes/purchases/projects/inventory, lab_digest (one combined
cross-type set), search_my_work.

**list_records is special** (verification fix): it is a deterministic top-N, so its widget
carries exactly the requested `limit` (NOT the whole table), `_ui.total` = shown count;
the model still gets the real total for narration.

## Fonts (Beaker speaks Hanken, you speak Geist)

The panel root applies `--font-ai` (Hanken) — that is BEAKER'S voice. The composer and the
user's own message bubbles drop to the app font. Fix uses the full chain
`var(--font-geist-sans), system-ui, -apple-system, sans-serif` (bare `var(--font-sans)`
was a no-op — it resolves to an unloaded Geist var at `:root`). `e8143ae16` + `406248cd1`.
The app-wide root cause (body hardcoded to Arial boilerplate) was owned + fixed by the
**Live-editor lane** (`7404905a7`), so user-voice elements now render REAL Geist.

## BeakerSearch one-front-door (finished)

Was ~80% built already (instant GUI palette + ask-mode escalation into chat + context
bridge + `search_my_work` + most read tools).

- **Phase 1** `1f0d748b1` — additive completeness: the 3 missing Layer 2 read tools
  (`read_task`, `read_inventory`, `read_datahub`); phylo trees in the GUI palette (now
  @-mentionable too); context-bridge `setBeakerContext` publishers on
  sequences/methods/chemistry/phylo/supplies. SKIPPED: purchases (no 1:1 PurchaseItem id),
  notes/projects (selection lives in panels, no clean page-level state).
- **Phase 2** `4fc0dc00d` — INDEX UNIFICATION the SAFE way. A full single-runtime-index
  merge is INADVISABLE (the GUI must be instant/prebuilt + fuzzy/type-weight/recency
  ranked; the AI runs OUTSIDE React on-demand + token-overlap ranked — merging would stall
  the palette or degrade ranking). Instead: a shared per-type adapter layer + one neutral
  type registry `src/lib/index/indexed-types.ts` (`IndexedType` [AI vocab] / `GuiIndexType`
  [GUI vocab; "task" vs AI "experiment"] + `aiTypeToGuiType`/`guiTypeToAiType` +
  `assertNeverIndexedType`). Anti-drift guarantee = two `Record<…>` exhaustiveness maps
  (`BRIEF_ADAPTERS` in artifact-index.ts, `GUI_TYPE_COVERAGE` in global-index.ts) so a new
  artifact type FAILS TO COMPILE until BOTH sides handle it. GUI builders now source common
  fields (title/keywords/deepLink/date) from the shared `*ToBrief` adapters; GUI-only
  fields (icon/meta/key/href/enabled/ocr) untouched. Closed the inventory gap (new
  `inventoryToBrief` → AI index now covers inventory).
  DELIBERATELY UNTOUCHED: both scorers, both build strategies, GUI key+href byte-for-byte.
  Note OCR stays in the GUI haystack (regression test added); AI keywords stay lean.

## State / verification

- tsc clean (the only standing project-wide error is another lane's uncommitted
  `phylo/render.ts unitsPerPx`). On the final merged main: **1683 tests green** across
  `src/components/beaker-search` + `src/lib/ai`.
- The record-set work and the resolver work are both LIVE-Chrome-verified by Grant on
  `/demo`; BeakerSearch Phase 1/2 are unit-only (additive completeness + a
  behavior-preserving refactor).

## Commit map (local `main`, unpushed)

Resolver verification + fixes: `e8143ae16` (font v1), `af5ea3d1c` (Check 7), `f44814e89`
(verify doc), `9367c2fab` (Check 4). Record-set widget: `c4d04f4f7`→`c69e2ab2c` (v1
merge), `624189791`+`adbeee27d`→`2d57e50a3` (>4 rule + Option D merge), `406248cd1`
(verification fixes). BeakerSearch: `9839cb66b`→`1f0d748b1` (Phase 1), `bcee17226`→
`4fc0dc00d` (Phase 2). Docs: `be22948c3`, `48a77ba9f`, `a397f406e`, `081c7692e`,
`f89eeb74c`, plus this handoff.

## Not done / next frontier

The A/B/C "catch up to modern LLM products" backlog is CLEARED (see the refreshed
`docs/proposals/beakerbot-gui-gaps.md`, the accurate single source). Open epics, by
leverage:
- **PDF-reproduce** — the ingestion UI (attach a PDF, pdf.js extraction) feeding the draft
  tools, plus outputs 3 & 4 (gated on phylo review + the vision model). The biggest net-new
  capability left. See `docs/proposals/beakerbot-pdf-reproduce-analysis.md`.
- **Plan-card flag-on follow-ups** — the 4 upstream polish items before
  `NEXT_PUBLIC_BEAKERBOT_PLAN_STEPS` goes to prod.
- **A-list stragglers** — voice input; true conversation branching (regenerate + revert
  exist).
- **Widget polish** — an optional panel resize handle (the panel is a fixed 820px modal;
  the responsive collapse works); the pending lab_digest crash repro (saw
  "reading 'digest'", the Next 16 undefined-throw class, cleared on retry — Grant is
  gauging frequency, needs a reliable repro to fix precisely).
- **BeakerSearch** — the single-runtime-index merge is explicitly NOT recommended; the
  drift problem is solved by the registry + shared adapters.

## Cross-lane notes

- Relayed the app-wide Geist/Arial finding to the **Live-editor lane**; they root-caused +
  fixed it (`7404905a7`) and reworked LiveMarkdownEditor (focus menu portaled, toolbar
  slimmed) — Canvas's prop contract is unaffected (confirmed by tsc on merged main).
- `send_message` (cross-session relay) requires mode-2 (supervised) approval; it is blocked
  in unsupervised mode.
