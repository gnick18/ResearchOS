# BeakerBot conversation branching — engine done, store/UI wiring spec

Owner: BeakerAI lane. 2026-06-16.

The last unshipped A-list item from `beakerbot-gui-gaps.md` ("Edit-and-resend /
branch" — regenerate + revert-to-here exist, true branching does not). This doc
records what shipped (the engine) and the exact remaining wiring (the live-store +
UI pass, which is browser-coupled and was deliberately NOT done blind).

## Shipped: the pure engine

`frontend/src/lib/ai/conversation-branch.ts` (+ 13 unit tests, tsc 0). A plain
immutable tree of message nodes, zero React, zero store state, fully testable:

- `BranchTree` / `BranchNode` — nodes wrap a `ChatMessage`, carry `parentId`,
  `childIds`, and an optional `historyLen` (the parallel LoopMessage history length
  at that message, so the store can restore `historyStore` on a switch).
- `fromLinear(messages, historyLens?)` — migrate an existing flat chat to a tree.
- `activePath(tree)` / `activePathIds(tree)` — the root-to-leaf message list the
  panel renders (branching is invisible to the panel except the per-fork switcher).
- `appendToActive(tree, message, historyLen?)` — the normal non-branching append.
- `forkAt(tree, messageId, altMessage, historyLen?)` — add an alternate sibling and
  make it active; the original branch and everything under it is preserved. This is
  the engine behind BOTH edit-and-resend (fork an edited user turn) and
  regenerate-as-branch (fork an alternate assistant reply).
- `branchesAt(tree, messageId)` -> `{ ids, activeIndex, total }` — drives the
  switcher ("branch 2 of 3").
- `switchBranch(tree, nodeId)` — re-point the active path through a branch, landing
  on its tip (follows the last child down).
- `hasAnyBranch(tree)` — lets the store skip all branch UI for a plain linear chat.
- `activeHistoryLen(tree)` — the historyStore length to restore for the active tip.

## Remaining: store + UI wiring (browser-coupled, do with eyes on the live chat)

The conversation store (`conversation-store.ts`, ~2000 lines) keeps TWO parallel
structures: `messages: ChatMessage[]` (display) and a module-global `historyStore:
LoopMessage[]` (what the model sees), plus a `conversationEpoch` guard and
persistence via `saveChat` / `StoredBeakerChat`. Branching threads through all of
them, so it is a careful pass, not a drop-in. Steps:

1. **State.** Add `branchTree: BranchTree` to the store, kept in lockstep with
   `messages`. Initialize via `fromLinear` on load; every place that pushes to
   `messages` also calls `appendToActive` (record the current `historyStore.length`
   as `historyLen`). Keep `messages` as the rendered active path so the panel is
   unchanged.

2. **Fork instead of truncate.** `revertToHere` today truncates `messages` +
   `historyStore`. Add an "edit and resend" entry point that instead calls
   `forkAt(tree, userMessageId, editedUserMessage)`, sets `messages =
   activePath(tree)`, and trims `historyStore` to the fork point, then sends. The
   old branch stays in the tree. Optionally make regenerate fork-as-branch too
   (keep the prior reply as a sibling) rather than replace.

3. **Switch action.** `switchToBranch(nodeId)`: `tree = switchBranch(tree, nodeId)`,
   `messages = activePath(tree)`, and restore `historyStore` to the switched tip
   (rebuild from the active path, or slice to `activeHistoryLen`). Bump
   `conversationEpoch` so any deferred queued send cannot cross branches. Guard on
   `sending` (no switch mid-turn), like `revertToHere`.

4. **Persistence.** Add `branchTree` to `StoredBeakerChat` (additive, optional) so
   forks survive reload; `loadThreadAction` rebuilds it (falling back to
   `fromLinear(messages)` for pre-branch saved chats, so old threads load clean).

5. **UI — the switcher.** In `BeakerBotConversation.tsx`, for each rendered message
   call `branchesAt(tree, msg.id)`; when `total > 1` render a tiny inline control
   ("‹ 2/2 ›") that calls `switchToBranch` on the prev/next sibling id. Add an
   "edit" affordance on user messages (pencil) that opens an inline editor and, on
   submit, calls the fork-and-resend entry point. Gate all of it on
   `hasAnyBranch(tree)` so a plain linear chat renders exactly as today.

6. **Verify (browser, the reason this half is a separate pass).** Fork at a turn,
   confirm both branches are reachable and switch cleanly; confirm the model only
   ever sees the active branch's history (no cross-branch bleed) by checking a
   send-after-switch; confirm reload restores the branches; confirm a plain chat is
   visually unchanged. The rAF/persistence/history-desync edge cases are exactly
   why this is done with eyes on the live chat, not blind.

## Why split here

The engine is the hard, deterministic, fully-verifiable core and it is done. The
wiring touches the single most load-bearing surface in the product (the live chat
store), where a subtle history-desync silently corrupts every conversation. That
risk is real enough that the wiring belongs in a focused pass watching the live
chat, not bundled into a long unattended session.
