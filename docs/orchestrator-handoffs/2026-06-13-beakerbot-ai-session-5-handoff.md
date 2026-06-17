# BeakerAI session 5 handoff (2026-06-13)

The BeakerAI lane (BeakerBot in-app assistant + BeakerSearch palette + AI under
`frontend/src/lib/ai/`, `frontend/src/components/ai/`, `frontend/src/components/beaker-search/`,
and the proxy `frontend/src/app/api/ai/chat/`). One of several parallel sessions.
Everything below is on LOCAL `main`, UNPUSHED (local is far ahead of origin; other
lanes' work is interleaved). Gate-verified (tsc 0, AI suites green) unless noted.
NOT browser-verified by the orchestrator (Grant runs his own `:3000`).

Continues `docs/orchestrator-handoffs/2026-06-12-beakerbot-ai-session-4-handoff.md`.

## What shipped this session (all local main)

### Tools (the "operate the app" surface, all deterministic, model only narrates)
- Per-user memory: `lib/ai/user-memory.ts` + `tools/user-memory-tools.ts` (remember_preference / forget_preference). File `users/<username>/_beakerbot_memory.json` (MAX 3500 chars, consolidates near-duplicates). Read into context capped each turn via the same identity-filter-before-persist pattern as the context bridge.
- setup_experiment (`tools/setup-experiment.ts`): one consented composite, creates the experiment + attaches methods + FS-linked prep tasks on the Gantt + results scaffold + navigate-and-highlight.
- save_summary_as_note (`tools/summary-artifact-tool.ts`): composes a summary-suite result into a structured note (timeline + breakdown + drill-down chips), numbers verbatim from the deterministic tools.
- PDF-reproduce outputs 1+2 (`tools/paper-reproduce-tools.ts`): draft_paper_summary, extract_paper_method. Text-in, verbatim, no-interpretation.
- Calculator (`tools/calculator-tools.ts`): list_calculators + run_calculator (engine owns every number).
- Purchase (`tools/purchase-tools.ts`): create_purchase (gated, verbatim money, task + line-item write).
- Inventory (`tools/inventory-tools.ts`): add_inventory_item + adjust_inventory_stock (gated, resolve by name).

### Output 3 (reproduce a paper's tree pipeline) -- COMPLETE
- generate_tree extended (`tools/phylo-tools.ts`): reproduces a paper's pipeline. Substitution MODEL routes through `fixedModel` free-string pass-through (never nearest-mapped); catalog-miss surfaces `catalogMissNotes` (factual, no judgment); a miss never blocks the recipe.
- assemble_tree_fasta (`tools/assemble-tree-fasta.ts`): pulls the user's library sequences, builds a raw FASTA via `@/lib/sequences/export` toFasta, delivers as a browser download in the Allow-gesture window. Single-locus only.
- Fixture harness `tools/generate-tree-fixtures.test.ts` regression-locks generateRecipe against the phylo lane's 3 validated `builder-options.json` (hpv58 nucleotide, craugastor supermatrix, firefly_opsin protein). Followed the phylo lane's turtle->craugastor swap + their new `have:"alignment"` supermatrix branch (`iqtree2 -s input_alignment.fasta -p partitions.nex`, skips AMAS). CONTRACT CONVERGED with the phylo lane.

### Chat modernization (the new chat look)
- Live STATUS LINE (`components/ai/TurnStatusLine.tsx`): elapsed . tokens . N running . phase, clickable to expand the step list; a per-turn settled token line. SEAMLESS (the grey box was removed per Grant) and the settled line now FADES ~2.5s after the thought (Grant reversed the earlier always-show choice; SETTLED_VISIBLE_MS=2500, SETTLED_FADE_MS=400).
- TOKEN PLUMBING: `route.ts` adds `stream_options.include_usage`; sse/proxy parse usage; conversation-store accumulates per-turn tokens via onUsage + a turn timer + running-tool count.
- Message affordances: Copy (every message), Regenerate (last assistant), Revert-to-here (DISCARD later turns, with a confirm). In conversation-store regenerate()/revertToHere() + the hover rows in BeakerBotConversation.
- AI BALANCE RING (`components/ai/BeakerSearchAskHeader.tsx`): reads `fetchAiStatus`. enabled=false -> "AI free in beta" pill; enabled=true -> a ring denominated against STARTER_GRANT_TOKENS (the gift) with amber/red low thresholds. DENOMINATOR FLAGGED to the account/billing lane (add a poolCap/refillAmount to AiStatus so the ring is exact after a pack purchase).

### Image support (vision) -- behind NEXT_PUBLIC_BEAKERBOT_VISION
- Plumbing: `LoopMessage.content` widened to `string | LoopContentBlock[]` + `getMessageText` helper (agent-loop.ts). Vision ROUTER in `route.ts` (`vision-router.ts` hasImageContent/selectModel): image-containing turns -> `AI_VISION_MODEL`, else `AI_MODEL`, falls back to AI_MODEL when AI_VISION_MODEL unset (inert until set).
- Composer: image attach/paste/drop + thumbnails + cost-collapse (the image is sent on its turn, collapsed to "[image attached]" in persisted history so it is not re-billed every turn; the display message keeps the thumbnail). Gated behind `NEXT_PUBLIC_BEAKERBOT_VISION` (config.ts BEAKERBOT_VISION_ENABLED).
- System-prompt image scope: describe images factually + give figure presentation/aesthetic feedback, NEVER interpret the data or conclude science.
- Model decision (Grant): Llama 3.2 11B Vision, ROUTER approach (keep the text/tool model for normal turns, route only image turns to vision; Llama 3.2 Vision's tool-calling is weaker). Economics writeup in `docs/proposals/beakerbot-economics-for-billing.md` section 8 (estimates, to be measured once live). See `[[reference_beakerbot_model_and_vision]]`.

### PDF ingestion -- live (no flag, the paper tools are already live)
- pdfjs-dist added; `lib/ai/pdf-extract.ts` extracts text client-side; the REAL worker at `frontend/public/pdf.worker.min.mjs` (1.2MB). Composer paperclip + drag-drop attaches a PDF; on send the extracted text is injected per-turn (cost-collapsed) and the system-prompt offers the summary / method / generate_tree drafts. SALVAGED from a stalled agent (it shipped a 28-line stub worker + a hanging test; replaced the worker, fixed the hang by mocking pdf-extract in the component test so pdfjs never loads under jsdom).

### Voice input -- live
- `lib/ai/useVoiceInput.ts` (Web Speech API) + mic button in the composer. Feature-detected (hidden in Brave/Firefox). Dedicated `mic` glyph added to the icon registry (Grant approved).

### BeakerSearch always-on (search is free, only AI gated)
- The bottom bar no longer fully deactivates when `canUseAI` is false; it stays a working SEARCH bar (label drops "Ask"). The "Ask BeakerBot" escalation in the palette becomes a gentle "comes with a free account" upsell row (routes to /settings?section=profile) when AI is locked; instant search still works. `BeakerSearchBottomBar.tsx` + `BeakerSearchProvider.tsx` + `CommandPalette.tsx` (aiLocked/aiLockedHref).

### Account/billing-adjacent + misc
- DEV_AI_IN_DEMO escape in `hooks/useAccountCapabilities.ts`: canUseAI also passes when `NEXT_PUBLIC_DEV_AI_IN_DEMO` is set AND `NODE_ENV !== production` (so AI works in the demo lab for testing, can NEVER relax the account-only lock in prod). useAccountCapabilities + InboxBadge are the ACCOUNT-CAPABILITIES lane's files (not lab-head's).
- Notifications settings section icon -> a new `bell` glyph (was the `alert` warning triangle).
- Dev play page `/dev/beakerbot` (mock model, no real tokens) to demo the morph + status line + affordances; uses a dev-only setModelCallerOverride seam in conversation-store.
- Recovered Grant's GUI-gaps brainstorm into `docs/proposals/beakerbot-gui-gaps.md` (the A-list/B-list/C backlog with status).

## IN FLIGHT / QUEUED (the A-list, both approved)
- `@` mentions + `/` commands: BUILDING (background agent at pause). Locked decisions: trigger "@", PER-TYPE colored chips, curated-but-extensible command list (summarize/plot/cite/digest/setup/draft as a data-driven registry), chip removal by x OR backspace-at-start. @ reuses the BeakerSearch object index; attached refs inject as a per-turn context note (mirror the contextMessage identity-filter pattern). Mockup `docs/mockups/2026-06-13-beakerbot-mentions-commands.html` (APPROVED).
- Editable Canvas: QUEUED, build right after @/commands lands (shares the chat shell, sequential). Locked decisions: DOCKED right panel; TABS for multiple drafts (Grant chose the better-for-final option, add an unsaved-tab indicator); REPLACE the approve card with a compact "Drafted, review in Canvas" pointer line (Save = consent, matches ChatGPT Canvas / Claude Artifacts); reuse the site's BUILT-IN markdown editor SLIMMED (strip its top/bottom/side chrome, just editor space to fit the box). Mockup `docs/mockups/2026-06-13-beakerbot-canvas.html` (APPROVED).
- Still OPEN (A-list done after Canvas): Output 4 of PDF-reproduce (match a paper figure's style) -- vision is now available but it still needs the phylo lane's Figure Studio style model. B-list (workflow macros, resumable plan card) untouched.

## ENV VARS + FLAGS Grant must know (RESTART :3000 after any change)
- `AI_VISION_MODEL=accounts/fireworks/models/llama-v3p2-11b-vision-instruct` (set local). Needed for image turns; router falls back to AI_MODEL if unset.
- `NEXT_PUBLIC_BEAKERBOT_VISION=true` (set local). Shows the image-attach UI. NEXT_PUBLIC bakes at build, restart needed.
- `NEXT_PUBLIC_DEV_AI_IN_DEMO=1` (set local, DEV ONLY). Lets BeakerBot run in the demo lab for testing; prod-gated, never affects real users.
- `AI_BILLING_ENABLED`: TRUE in Vercel (prod), set FALSE locally so the demo's AI works (billing requires a real signed-in account; demo is account-less -> 401 signin_required). To test billing locally: sign in (not demo) + flip it true + restart.
- `AI_MODEL=accounts/fireworks/models/gpt-oss-120b` (the text/tool model). Provider is Fireworks (OpenAI-compatible), NOT OpenAI. BeakerBot perceives the app via the DOM, never screenshots.

## BROWSER-VERIFY BACKLOG (orchestrator cannot do these, Grant on :3000, in an ACCOUNT context not demo unless DEV_AI_IN_DEMO is on)
- Image attach -> a real photo/figure, confirm extraction + the model sees it (needs AI_VISION_MODEL + the flag + restart).
- PDF attach -> a real paper PDF, confirm pdf.js worker loads (the one unverified piece, Next 16/Turbopack serving /pdf.worker.min.mjs) + the draft fan-out.
- Voice -> real dictation in Chrome.
- Chat modernization (status line ticking, copy/revert/regenerate, the balance ring, the fade) + the seamless restyle.
- Once vision is live: instrument ~5-10 real image calls to replace the economics ESTIMATES in `docs/branding/BILLING_FACTS.md`.

## Relays still owed to the ACCOUNT & BILLING lane (signed, Grant relays)
- Add `poolCap`/`refillAmount` to `AiStatus` so the header balance ring denominates correctly after a pack purchase (today it clamps at the gift size).
- BeakerSearch upsell reshape heads-up (their `canUseAI === false` path no longer kills the free local search).

## Gotchas / lessons reaffirmed
- pnpm STORE MISMATCH bit once: node_modules was installed with a newer pnpm (store v11) but the pin is 10.34.3 (store v10); `pnpm install` (pinned) realigns. ALWAYS check before adding a dependency.
- The pdf.js WORKER is the fragile part in Next 16/Turbopack. The committed worker is the REAL `node_modules/pdfjs-dist/build/pdf.worker.min.mjs` copied to public/ (a stub breaks extraction). Tests must MOCK pdfjs (vi.mock) so the real worker never loads under jsdom, or the combined suite HANGS.
- INVASIVE content-type changes (LoopMessage.content) ripple; tsc finds the sites, getMessageText centralizes them.
- Sub-bots can stall on a too-broad vitest run in their COW worktree; brief them to commit INCREMENTALLY (the PDF + chat-mod bots survived stalls because they committed each step). Salvage from the worktree: cherry-pick committed steps, apply uncommitted source via `git diff > patch` + `git apply --check`, replace any broken asset, fix the test hang.
- Only ONE chat-shell build at a time (conversation-store.ts + BeakerBotConversation.tsx are the contended files); new tool files run in parallel. Orchestrator owns registry.ts + system-prompt.ts wiring (sub-bots emit diffs) to avoid collisions.
- New glyph needs Grant sign-off; adding to registry.tsx does NOT trip the icon-guard (registry is the source), no baseline change needed for a new glyph in it.

## Memory
New/updated: `[[reference_beakerbot_model_and_vision]]`, `[[project_beakerbot_gui_gaps]]`. The GUI-gaps doc `docs/proposals/beakerbot-gui-gaps.md` is the living A/B/C backlog with shipped/open status.
