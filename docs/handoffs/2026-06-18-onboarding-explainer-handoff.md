# Onboarding rewrite + data-privacy explainer series, handoff

Date 2026-06-18. Lane: onboarding / data-privacy explainer. Memory: `[[project_onboarding_rewrite]]`.

## TL;DR
The stale "3-minute walkthrough" is rewritten and a full data/privacy/cost explainer series is built. Everything user-facing lives on one branch, `feat/data-privacy-explainer-wiring`, ready for Grant to merge. Two related billing gates are on their own branches. The source-of-truth docs and house-style mockups are already committed to main.

## What is on main (committed)
- `docs/proposals/2026-06-18-onboarding-walkthrough-rewrite.md` — audit of the old walkthrough + the 5-beat rewrite plan + exact beat copy (section 5).
- `docs/proposals/2026-06-18-data-and-privacy-explainer-architecture.md` — THE verified architecture source of truth. Every claim is code-checked. Read this before touching any explainer copy.
- `docs/mockups/2026-06-18-how-your-data-works.html` — full 13-section house-style explainer (review prop, not production).
- `docs/mockups/2026-06-18-local-vs-cloud-explainer.html` — the 4-step local/share/collab/cost interactive.
- Committed as `d74273927`.

## The deliverable branch (NOT merged)
`feat/data-privacy-explainer-wiring`, checked out in worktree `.claude/worktrees/agent-adb5ea733f73b6f4e`, 8 commits ahead of main, tsc 0, ~49 tests green, house-style guard clean. Commits in order:
1. wire the explainer (DataFlowExplainer component + 5-beat PickerWalkthroughModal + StartScreen fix + wiki page).
2. reconcile copy to the committed proposal + expand wiki to all 13 sections.
3. add `/dev/picker-walkthrough` preview route.
4. unified MarketingBackdrop (replaced the old dark slate overlay) + darkened SkipLink.
5. AI-voice humanize pass (contractions + de-cliche).
6. signature sky-500 BeakerBot outline (was a washed-out sky-300).
7. OCVR funding-acknowledgment wording.
8. BeakerBot beside the card on the tall data-flow beat (lg+), stacked on small screens.

Files: `components/picker-walkthrough/*` (PickerWalkthroughModal, the 5 beats, SpeechBubble, SkipLink), `components/data-flow/DataFlowExplainer.tsx`, `components/onboarding/StartScreen.tsx`, `app/wiki/trust/how-your-data-and-privacy-work/page.tsx`, `lib/wiki/nav.ts`, `app/dev/picker-walkthrough/page.tsx`, `lib/providers.tsx` (one dev-route allowlist line).

## Honesty rules baked in (never break these)
- One-time SEND is end-to-end. LIVE COLLAB (in-lab or external) is encrypted in transit and at rest but NOT end-to-end (the relay merges edits, Option B in `relay/src/worker.ts:20`). Never call collab E2E.
- Receiving is always free. Sending a copy and hosting live collaboration are paid.
- AI sends only the note or table a tool reads, through our server, key server-side, provider default zero-retention. No HIPAA or BAA claim.
- Lab sites and the no-code builder are "coming with lab sites," not live.

## Related billing gates (Grant decided, BUILT on branches, not merged)
The explainer says receiving is free and all outbound is paid. Two gates make that true in code:
- `feat/external-collab-paid-gate` (`f23b7cf0b`): external live-collab HOST gate, paid (Solo and up) via `isProduceEntitled`, server `GET /api/collab/external-entitlement` + `grantExternalCollab`, free gets an upsell.
- `feat/gate-send-outside-paid` (`24545df56`): one-time copy SEND gate, free becomes receive-only. Also rewrote the free-tier marketing that promised sending.

## How to preview it (no auth needed)
A persistent dev server is up: `nohup bash scripts/worktree-dev.sh .claude/worktrees/agent-adb5ea733f73b6f4e/frontend 3066` (launch config `explainer-verify-3066`).
- Walkthrough modal: `http://localhost:3066/dev/picker-walkthrough` (force-opens all 5 beats; the modal normally lives behind sign-in + folder-connect).
- Wiki page: `http://localhost:3066/wiki/trust/how-your-data-and-privacy-work`.
Note: the isolated dev server has no auth env, so the console shows `getSession`/authjs errors and a red "1 Issue" dev badge. Those are environmental, not page bugs. To screenshot via Preview MCP you must stop the nohup server first (one process per port), then relaunch nohup after.

## Conventions worth keeping
- The "Claude designer" is the `visualize` `show_widget` tool. It renders animations inline for review only. There is no export-to-production. Production animations are hand-ported to house-style React/HTML.
- House style allows contractions. Their absence is the strongest AI-voice tell. Only em-dashes, en-dashes, mid-sentence colons, and emojis are banned.
- To preview gated UI without auth, add a `/dev/<x>` page and one line to the dev-route bypass allowlist in `lib/providers.tsx` (near `/dev/onboarding-tutor`). `proxy.ts` 404s the whole `/dev/*` tree in production.
- OCVR funding wording is exactly "grew out of work begun during a UW-Madison Distinguished Research Fellowship."

## Next steps (Grant's gate)
1. Merge `feat/data-privacy-explainer-wiring` into main, then walk the modal on `:3000` (auth works there, where the dev-preview route is not needed).
2. Merge the two gate branches so the copy and enforcement go live together.
3. Optional: a wiki-internal-links `<a>` to `next/link` sweep (the new wiki page matches the sibling pages' existing `<a>` pattern on purpose).
