# BeakerSearch v2 build spec (one unified surface)

Status: APPROVED 2026-06-11 (Grant: "approve this as the v2... better than v1"). Build NOT started. Author: HR.
Approved mockup: docs/mockups/beakersearch-unified-redesign.html (all 3 sections approved, morph confirmed).
Supersedes the v1 escalate-to-dock approach (docs/proposals/beakersearch-v1-build.md, shipped 608e23f4e).

House voice applies to this doc and every string it specifies, no em-dashes, no emojis, no mid-sentence colons.

## What v2 is

ONE surface that glides between instant search and a full BeakerBot chat, in the same container, with no second GUI. The search bar is the anchor (never moves). Pressing enter on the ask row (or a Search/Ask toggle) GROWS the same palette into a chat workspace, the body cross-fades from result rows to the conversation thread, and the modern chat chrome fades in (New chat, History of past chats, Ask/Auto autonomy, credit). Back to search shrinks it to the result list and preserves the conversation. Commands and page-jumps tuck behind a ">" prefix so the default view is calm.

## Why v1 was wrong

v1 added an "Ask BeakerBot" row to the existing busy command palette, and escalation OPENED THE SEPARATE DOCKED PANEL. That is two surfaces and a hard handoff, the opposite of the approved design. v2 makes the conversation render INSIDE the search surface and retires the separate dock as the AI entry point.

## The core architectural change

Today the conversation lives in BeakerBotDock -> BeakerBotPanel -> useAiChat (state owned by the panel, mounted in the root layout). For v2 the SAME conversation must render inside the BeakerSearch palette (a Cmd+K modal). Two things follow:

1. Conversation STATE must outlive the palette modal. A modal opens and closes; the chat must persist across that (and across navigation) so reopening resumes it, and so History is possible. So the conversation state lifts OUT of the panel into a root-level store/provider.
2. Conversation RENDERING must be reusable. The thread, the plan/draft/choice approvals, the composer, the status line, all of it becomes a standalone <BeakerBotConversation> component that the palette renders in Ask mode (and that the legacy dock can render during transition).

Everything already built carries over unchanged: message-bridge (seed a query), context-bridge (what is open), navigation-bridge, the agent loop, the tools, the root popup host and result tiles.

## Phased build (sequential, each verified and landed before the next)

### Phase 1: lift the conversation to a persistent root store
- Extract the conversation state from useAiChat into a root-level store (Zustand, like panel-store.ts) or a root provider, so messages, the running agent loop, pending approvals, and autonomy survive the palette closing. Keep useAiChat's public surface (send, messages, status, approvals) but back it with the persistent store.
- Extract the rendering (thread, AssistantMarkdown with the ObjectChip tiles, plan/action/draft/choice approval cards, status, composer) into a reusable <BeakerBotConversation> component.
- Keep the existing dock working by having it render <BeakerBotConversation> from the store (no user-visible change yet). This phase is a pure refactor, verifiable on its own (the dock still works, state now persists).
- Verify: tsc, vitest, the existing live note-summary flow still works through the dock.

### Phase 2: the unified surface (the morph)
- CommandPalette gains an Ask mode. The palette container grows (the approved animation, ~0.4s grow, 0.2s cross-fade, matching easing), the search body cross-fades to <BeakerBotConversation>, and the chat chrome appears (a header with: back-to-search, BeakerBot title, New chat, a History affordance, the Ask/Auto autonomy toggle reading from autonomy-store, and a static "uses credit" / credit readout, billing not live so it is a placeholder).
- The escalation (enter on the ask row, or the Search/Ask toggle) MORPHS the surface instead of opening the dock. It seeds the query via the message bridge into the persistent conversation, which now renders right here.
- Back-to-search shrinks the surface to the result list, conversation preserved in the store.
- Verify: live, the morph feels smooth, a query escalates and the answer (with tiles, approvals) renders in the palette, back-and-forth preserves state.

### Phase 3: de-clutter the default view
- The empty/typing search view leads with the user's work (results) and the single Ask BeakerBot row. The "Go to X" nav commands and app commands move behind a ">" prefix (type ">" to enter command mode), so they are one keystroke away without crowding. Confirm the existing global commands still reachable via ">".
- Open question Grant flagged: ">" for ALL commands, or keep a couple visible. Default to all-behind-">", revisit if it feels too hidden.

### Phase 4: retire the separate dock as the AI entry point
- The floating summon FAB opens the palette in Ask mode (not a separate dock). Remove the standalone docked panel, or reduce it to a minimized "resume chat" pill that reopens the palette in Ask mode. The persistent conversation store means no state is lost.
- Keep context-bridge, navigation-bridge, message-bridge, popup host, result tiles all functioning from the new surface.
- Verify: there is now ONE BeakerBot surface, the palette. No second GUI.

## Deferred (v2.1, do not build now, stub the affordance)
- Full History (multiple past conversations, the list behind the clock icon). Phase 1 makes the CURRENT conversation persist; storing and listing MANY past chats needs its own persistence design. Show the History icon, wire New chat (clears to a fresh conversation), defer the past-chats list.
- Live credit meter (billing not live), static hint only.
- Streaming polish (the agent loop is non-streaming today, the panel fakes a reveal, keep that).

## Animation spec (from the approved mockup)
- Container grow/shrink: min-height (or height) transition ~0.4s cubic-bezier(.4,0,.2,1).
- Body cross-fade: opacity + a 5px translateY, ~0.2s, sequenced (fade current out ~190ms, swap, fade next in).
- The bar (input + BeakerBot icon) is the fixed anchor across the morph.

## Sequencing and conflicts
Start after the tasks/experiments-in-place build lands (it touches system-prompt and ObjectChip, this touches the panel and palette, sequence to avoid overlap). Each phase lands on main before the next so Grant can feel it incrementally (his standing rule, work on an unmerged branch is invisible to him).
