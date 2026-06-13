# BeakerAI session 6 handoff (2026-06-13)

The BeakerAI lane (BeakerBot in-app assistant + BeakerSearch palette + AI under
`frontend/src/lib/ai/`, `frontend/src/components/ai/`, `frontend/src/components/beaker-search/`,
the proxy `frontend/src/app/api/ai/chat/`). Continues
`docs/orchestrator-handoffs/2026-06-13-beakerbot-ai-session-5-handoff.md`.

This session: shipped the WHOLE A-list + PDF-reproduce Output 4, then LIVE-VERIFIED
all three A-features end-to-end with a real model (Claude-in-Chrome on a contained
dev server), which surfaced and fixed two PROD-BREAKING bugs. Everything is on
`origin/main` (Grant pushed). Gate-verified (tsc 0, AI suites green) and, unusually,
also LIVE-verified.

## What shipped this session (all merged to main, then pushed)

### @ mentions + / commands (merged `b03d4c02e`)
The composer A-list feature. Was a halted background build (session 5 left only the
store layer uncommitted in a stale worktree); salvaged that + rebuilt the rest.
- `@` opens `ComposerMentionPicker` over the existing global object index
  (`components/beaker-search/global-index.ts` + `useGlobalObjectIndex`). Selecting
  an object stages a PER-TYPE COLORED chip above the composer; remove by clicking
  the x OR Backspace at caret 0.
- `/` opens `ComposerSlashMenu` from a data-driven registry `lib/ai/slash-commands.ts`
  (summarize/plot/cite/digest/setup/draft), each pre-fills an intent phrase that maps
  to an existing deterministic tool. New command = one registry entry.
- Store: `attachedRefs` + `addAttachedRef`/`removeAttachedRef`/`clearAttachedRefs` in
  `conversation-store.ts`; on send, refs inject a per-turn `refsMessage` (system) that
  is identity-filtered out of persisted history (same pattern as `contextMessage`), so
  they are not re-billed every turn.
- Per-type colors live in a `REF_TYPE_TINT` map in `BeakerBotConversation.tsx`
  (task=sky, project=amber, method=violet, sequence=emerald, inventory=teal, note=slate,
  datahub=indigo, molecule=cyan, purchase=rose).

### Editable Canvas (merged `475c391de`, polish `6b0a9fa54`)
The other A-list item. The deterministic editing surface over content the model drafts.
- DOCKED right panel beside the chat (`components/ai/BeakerBotCanvas.tsx` +
  `lib/ai/canvas-store.ts`). TABS per draft with an unsaved-dot; buffers preserved
  across switch/close. Closing collapses (never loses a draft); Discard confirms.
- The read-only draft approval card is GONE for `kind:"draft"` approvals, replaced by a
  compact "Drafted in Canvas" pointer line in chat (transform/step/plan cards unchanged).
- SAVE = CONSENT. Save writes the user's EDITED content (not the model's original draft).
  Mechanism: the draft descriptor gained an `applyEdit(args, editedContent)` hook + a new
  `draft-save` `ApprovalDecision`; the agent-loop draft gate calls `applyEdit` then
  proceeds, so `execute()` writes the edited text. Composed-body tools
  (`save_summary_as_note`, `extract_paper_method`) stash the edited markdown on a reserved
  arg used verbatim; absent `applyEdit` falls back to the model's original content (legacy
  Approve path, no regression).
- The editor reuses `LiveMarkdownEditor` SLIMMED. Polish round fixed: it was rendering the
  full editor chrome (shortcuts sidebar + Images/Files manager) which crushed the chat
  composer. Fixed by passing `showShortcutsHelper={false}` (a latent never-wired prop) +
  adding a new opt-in `hideAttachments` prop (default false, no regression for
  notes/methods/results), plus a `min-w-[20rem]` chat-column floor and widening the Ask
  palette to `min(1200px, 100vw-40px)` when Canvas is docked (`CommandPalette.tsx`).

### PDF-reproduce Output 4: `match_figure_style` (merged `3aea4b024`)
The last PDF-reproduce output. In `lib/ai/tools/phylo-tools.ts`.
- Vision reads a paper FIGURE's visual STYLE into a `PhyloFigureSpec`, writes it onto the
  user's OWN tree (`phyloApi.updateMeta` for a saved tree, `phyloApi.create` for pasted
  Newick), and opens Tree Studio via the deep link `/phylo?doc=<id>#ros=studio`.
- Built to the Phylo lane's LOCKED contract: target `PhyloFigureSpec` (lib/phylo/types.ts),
  per-layer style in `AlignedPanel.options`, column->track bindings in
  `PhyloMetadataBinding`; hydration ONLY through `phyloApi`; NEVER bind PhyloStudio.tsx
  internals (it is mid-refactor, but the figure model + phyloApi + `initialTreeId`/?doc
  hydration are stable — Phylo confirmed the seam hydrates a passed-through `panels[]`
  stack cleanly post-refactor). Thin adapter `sanitizeFigureSpec` normalizes the model's
  loose spec. Added `createTree`/`updateTreeMeta` to `phyloToolsDeps`; registered non-gated.
- NO-INTERPRETATION held: style off the image only; the user's Newick is the sole source
  of topology; the tool errors and tells the model to ASK if no tree is supplied.

## LIVE VERIFICATION (the big deal this session)
All three A-features were driven end-to-end with a REAL model via Claude-in-Chrome on a
CONTAINED dev server (a detached worktree off main with its own `.next` on port 3010, COW
node_modules, copied `.env.local`, an empty scratch data folder the user connected).
- Test 1 Canvas: PASS — model called `write_note` -> Canvas docked with the real draft ->
  edit showed "Unsaved edits" -> Save wrote the note ("Created a note titled ...").
- Test 2 @ mentions: PASS — `@` listed the REAL note from Test 1 and attached it.
- Test 3 Output 4: PASS — vision read fig1.png's style, called `match_figure_style`,
  navigated to `/phylo?doc=4#ros=studio` rendered CIRCULAR PHYLOGRAM with the figure's panel
  stack; the new tree had 6 tips (the pasted A-F tree, NOT the figure's hundreds -> no
  interpretation). Phylo's hydration seam worked live.

## TWO PROD-BREAKING BUGS found + fixed (only a live-model test could catch these)
1. `stream_options` 400 (`f6fd2c311`). The proxy sent `stream_options` on non-streaming
   requests; Fireworks hard-rejects it (`"stream_options is only valid when stream=true"`),
   so EVERY BeakerBot agent-loop turn 400'd. Fixed to send it only when `stream && billingOn`;
   non-streaming reads usage from the native completion JSON. Regression guard added in
   `route.test.ts`. See AGENTS.md Section 6.
2. Dead vision model. `AI_VISION_MODEL=llama-v3p2-11b-vision-instruct` is removed from
   Fireworks (404). On our account only `kimi-k2p6` is multimodal (glm/deepseek reject
   images). Local `.env.local` updated to `kimi-k2p6`; PROD Vercel var must be set too
   (full path, never shortened).

## Duplicate-send report: investigated, NON-bug (regression guard `44eec7b52`)
A reported "single submit creates two chats" was traced and confirmed NOT a code bug. A
spawned task built a deterministic vitest StrictMode-isolation test of the real
escalate -> bridge -> send -> createChat path: one escalation = one thread in all
conditions (normal, StrictMode double-mount, cold-queue). The send layer is idempotent
(`sending` set synchronously before the await; bridge clears the queue before delivering;
escalation is event-driven so StrictMode never double-fires it). The report was a
double-submit. A clarifying comment + the regression guard landed. That same lane also
fixed a prebuild wiki-coverage gate (`/department`+`/institution` unmapped) that was
blocking Vercel deploys (`873085a49`).

## Vision model DECISION (Grant approved)
Use `kimi-k2p6` for vision/image turns. It is Chinese-TRAINED (Moonshot AI) but US-HOSTED
on Fireworks (inference + data stay on Fireworks US infra, no data to China; same provider
as gpt-oss). The BeakerBot no-interpretation safeguards live in `system-prompt.ts`, which
is sent on EVERY turn regardless of model (the router only swaps the model), so vision
turns inherit the same guardrails. Vision is non-essential + flag-gated, so text BeakerBot
can ship without it. Original plan was Llama 3.2 11B Vision (dead on Fireworks). See
`[[reference_ai_stream_options_400]]`.

## ENV / FLAGS (prod state Grant must finish)
- BOTH code fixes are on `origin/main` (pushed). Vercel deploys from origin.
- `AI_VISION_MODEL` = `accounts/fireworks/models/kimi-k2p6` — set in Vercel (full path).
  Same Fireworks key local + prod (confirmed), so the model is available in prod.
- `NEXT_PUBLIC_BEAKERBOT_VISION=true` (bakes at build -> needs a redeploy to take effect).
- `AI_MODEL=accounts/fireworks/models/gpt-oss-120b` (text/tool). `AI_API_KEY` is the only
  secret. `AI_BILLING_ENABLED=true` in prod (BeakerBot go-live still gated on Stripe).
- `NEXT_PUBLIC_DEV_AI_IN_DEMO` — local `.env.local` ONLY; never in Vercel (hard-gated to
  NODE_ENV !== production, inert on any Vercel build).
- REMAINING manual step: confirm `AI_VISION_MODEL` is set in Vercel and REDEPLOY if it went
  in after the push.

## Model-behavior notes (for whoever tunes the model choice)
- `gpt-oss-120b` is SLOW (~1-2 min/turn, a reasoning model returning `reasoning_content`)
  and has WEAK tool-calling: with natural phrasing ("draft a note") it writes text instead
  of calling `write_note`; it only reliably calls the tool with explicit phrasing ("use
  your write_note tool"). `kimi-k2p6` called tools fine. Worth reconsidering the text model.

## Gotchas / lessons
- Gate checks (tsc/vitest) CANNOT catch provider-contract bugs (they mock fetch). The live
  path must be smoke-tested against the REAL provider. To read a provider error the route
  swallows, temporarily log `await upstream.clone().text()` in a disposable worktree.
- Contained dev-server testing: detached worktree off main + own `.next` (port 3010) so it
  never corrupts Grant's :3000 Turbopack cache; the FSA folder re-grant + image drag need a
  HUMAN click (Chrome MCP cannot click native dialogs or drag a disk file via file_upload).
- `system-prompt.ts` is ONE backtick template literal; inline backticks in added guidance
  break the build.
- When landing a fix via worktree: COMMIT on the branch BEFORE `git merge` (a no-op merge +
  `--force` worktree removal will silently discard uncommitted edits — happened once this
  session, caught + redone).

## Open / next
- B-list only: workflow macros, resumable plan card. Everything else on BeakerBot is built.
- Memory: `[[project_beakerbot_at_mentions_commands]]`, `[[project_beakerbot_pdf_reproduce]]`,
  `[[reference_ai_stream_options_400]]`.
