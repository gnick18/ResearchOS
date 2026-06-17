# BeakerSearch v1 build spec (the approved GUI, AI escalation tier)

Status: spec, approved direction 2026-06-11 (Grant: "turn this approved design into v1"). Build QUEUED behind the popup-host land (both touch BeakerBotPanel and root wiring). Author: HR.
Approved design: docs/mockups/beakerbot-gui-review.html (sections 1 to 7, 6 approved + 2 incorporated notes).
Related: docs/proposals/ai-assistant.md section 13 (one front door), docs/proposals/beakerbot-context-and-index.md.

House voice applies to this doc and every string it specifies, no em-dashes, no emojis, no mid-sentence colons.

## The big finding that shapes v1

BeakerSearch is NOT a greenfield build. A mature command palette already exists and ships the instant-search tier of the approved design:
- `components/beaker-search/BeakerSearchProvider.tsx`: global Cmd/Ctrl+K, open/close state, mounted in lib/providers.tsx.
- `components/beaker-search/BeakerSearchPill.tsx`: the visible "BeakerSearch / Cmd K" front-door affordance, already in the AppShell header.
- `components/sequences/CommandPalette.tsx`: the palette UI (results, nav, fuzzy scoring). Not yet relocated into beaker-search/, leave it where it is for v1.
- The instant index: `global-index.ts` (buildGlobalIndex), `global-source.ts` (rankGlobalEntries, fuzzy + type weight + recency, per-type caps), `useGlobalObjectIndex.ts` (React-Query-cache subscribed, instant), `recent-records.ts` (MRU in localStorage).

The instant index covers Tasks, Projects, Methods, Sequences, Inventory, Notes. It does NOT cover Data Hub tables, molecules, or purchases. The approved mockup shows a Data Hub table in results, so coverage is a v1 gap.

The docked BeakerBot panel also already exists and is openable app-wide:
- `components/ai/BeakerBotDock.tsx` (mounted in app/layout.tsx, self-gating).
- `lib/ai/panel-store.ts`: `useBeakerBotPanel` Zustand store with open/close/toggle.
- `components/ai/useAiChat.ts`: the conversation state, exposes `send(text)`, but ONLY BeakerBotPanel calls it. There is no external seam to seed a message.

So the two tiers each exist. What is missing is the BRIDGE between them, the escalation row that takes the user's query from the search box into the AI panel. That bridge is the heart of v1.

## v1 scope (what to build)

### A. Message bridge, seed a query into BeakerBot
New `components/ai/message-bridge.ts`, mirroring navigation-bridge.ts / context-bridge.ts (module-level store, robust registration):
- `setBeakerBotSend(fn | null)`, `sendToBeakerBot(text): Promise<void>` (queues if the panel is not mounted yet, flushes on register, same robustness as the nav bridge), `isBeakerBotReady(): boolean`.
- BeakerBotPanel.tsx registers its `send` from useAiChat into the bridge once on mount (useEffect, stable identity, unregister on unmount only if still itself), exactly like useNavigationBridge.

### B. The "Ask BeakerBot" escalation row (the approved mockup's .ask row)
In CommandPalette.tsx, add a single escalation row, always present, directly under the search input and above the results (per the mockup):
- Content: the BeakerBot mark icon, "Ask BeakerBot about \"<query>\"", a muted meta line "reasons, perceives, can act", a small "uses credit" hint, and an "enter" affordance. When the query is empty, soften to "Ask BeakerBot" with no quoted query.
- It is a SELECTABLE palette row. Enter while it is highlighted (it is the default highlight when the user has not arrowed into a result), or a click, ESCALATES.
- Escalate action: `useBeakerBotPanel.getState().open()`, then `sendToBeakerBot(query)`, then close the palette. Because context-bridge already feeds the panel a "what is open" line at send time, escalating from a page carries that page context automatically.
- The instant results below behave exactly as today, arrow to a result, Enter opens it (router.push(deepLink) or the palette's existing open path). Only the escalation row routes to the AI.

### C. Close the coverage gap (search all your work)
Extend the instant index so the front door covers what the approved design promises and shows (a Data Hub table result):
- Add Data Hub, molecule, and purchase adapters to global-index.ts (map each type's React-Query cache record to a GlobalIndexEntry with type, label, meta, haystack, recencyAt, iconName, href via objectDeepLink), and wire their caches into useGlobalObjectIndex.ts alongside the existing six.
- Use the existing GlobalIndexEntry shape and ranking, do not introduce a second scorer. Reuse the type icons already used elsewhere (Data Hub chart, molecule, purchase).
- This keeps ONE instant index (the mature, cache-subscribed one). The AI side keeps its own searchMyWork tool (different runtime, an LLM tool vs an instant UI index). Unifying the two into a single shared source is explicitly DEFERRED, the duplication is small and the two serve different consumers.

### D. BeakerBot iconography
Where the AI escalation appears (the .ask row, and the panel summon if it still uses a generic vial), use the BeakerBot mark, consistent with the approved mockup change and the standing rule that the mascot is always BeakerBot. Confirm BeakerSearchPill's icon, leave the pill label as is, just ensure the AI escalation row reads as BeakerBot.

## Out of scope for v1 (note, do not silently include)
- Index unification (one shared source for both the palette and the AI tool). Deferred, see C.
- A live credit meter. Billing is not live, so v1 shows only the static "uses credit" hint on the escalation row, no real balance. The meter from the mockup waits for metered billing.
- Hover-as-search bias (the v3 last-hovered capture already stubbed in BeakerSearchProvider). Not part of this pass.

## Decisions (made, not blocking)
- Enter with no result selected escalates to BeakerBot (the escalation row is the default highlight). Enter on a selected result opens it. This matches the mockup's enter affordance on the ask row.
- The escalation row is always shown (even with results), at the top, so the AI is one keystroke away from any query.
- Keep CommandPalette where it lives (components/sequences/) for v1, no relocation churn.

## Sequencing
Queued behind the popup-host land. Both edit BeakerBotPanel.tsx and root wiring, so they run sequentially off main, never two concurrent worktree bots on the same files. Order: popup-host lands and verifies, then BeakerSearch v1 builds off the updated main.

## Verification focus
- tsc + vitest (no new failures), unit tests for the message-bridge (register/queue/flush) and the new global-index adapters.
- Because this is observable UI, the bot should describe the escalation flow precisely (open dock, seed, close palette) and confirm the escalation row renders and routes. Live click-through by Grant after land.
