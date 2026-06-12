# Handoff: marketing redesign + AI surfacing + demo polish (2026-06-12)

Orchestrator session paused near the usage limit. This is the resume point if Grant switches accounts. All my work is committed on local main (interleaved with other sessions' datahub/embeds/checkins commits). Three sub-bots were in flight, see "In flight" below.

## What this session shipped (all merged to local main)
A long marketing + product-polish arc. Key commits (newest of mine first):
- `c443ac715` feat(pricing): highlight the at-cost AI assistant in the savings calculator
- `360057825` fix(pricing): savings calculator honest about a lab, not just $0 (solo = $0; lab pays optional cloud)
- `ff2f6459d` fix(copy): app-wide stale-claim sweep (roadmap no longer lists shipped collab/cross-lab-sharing as upcoming)
- `720078c85` fix(routing): public marketing/legal pages bypass the folder-connect gate (pricing/about/transparency/etc. were bouncing logged-out visitors to the landing)
- `0da1d8a6a` fix(copy): real-time co-editing is shipped, not coming soon
- `10c49e5a5` fix(login): funding acknowledgment moved to upper-right corner (balances the ResearchOS LLC signature upper-left)
- `1ce4aeb92` feat(ia): split MarketingFooter (rich, public pages) from brand-only AppFooter (in-app); new MarketingNav + /about page; settings rail links thanks+about
- earlier: shared marketing motion system (Reveal + MarketingBackdrop), welcome page rebuilt to approved IA, settings redesign (full-screen left-rail, X+Esc, rail footer), pricing AI section, SciFinder added to cost table, product chrome -> "ResearchOS LLC" (founder name kept only in origin story + legal), brand-only footer.

Full reference: `docs/audits/cross-linking-and-ia-audit-2026-06-11.md` (the route reachability audit + 10-company SaaS IA research + recommended IA that drove the footer/nav split).

## IN FLIGHT (3 background sub-bots, session-bound)
These were dispatched in THIS session. If you switch accounts, their completion notifications are lost, but their work persists in worktrees. For each: pull its changed files onto current main, re-run gates filtered to those files (main is independently tsc-red, see Gotchas), commit with explicit paths, remove the worktree. Same pattern used all session. If a worktree is gone/incomplete, re-dispatch from the brief (the briefs are in this session's transcript).

1. **demo-polish** (agentId a4fc9cb2f17a15d04, branch `worktree-agent-a4fc9cb2f17a15d04`). Makes `/demo` look like a real lab for video recording: (a) strip "DEMO" prefixes from `frontend/public/demo-data` names + realistic grant ids ("NIH R01 GM149023" etc., applied consistently); (b) `/demo?record=1` recording mode that hides ALL demo chrome + skips the entry warning (mirror the `?wikiCapture=1` suppression in `FloatingLeaveDemoButton`); (c) slim the normal demo for everyone, move "Leave demo" into `UserAvatarMenu` + a small subtle pill (keep an escape), soften the entry to one line. Grant chose "also slim it for everyone."

2. **ai-surface** (agentId aa8d1e9b7e53f301d, branch `worktree-agent-aa8d1e9b7e53f301d`). Surfaces BeakerBot + the free-token gift across pricing/welcome/settings with ONE token economy: full analysis ~=30,000 tokens, quick question ~=7,500, free one-time sign-up gift = ~750,000 tokens framed as "about 20 to 25 full analyses or 100-plus quick questions" (SHOW TOKENS, never dollars/cents). Touches PlanPicker (free-token line on Free card), pricing AI section (lead with the gift, stronger heading, move higher, keep `id="ai-pricing"`), welcome AI showcase, and reconciles `lib/usage/usage-fixtures.ts` + `AiUsageSection`.

3. **ai-showcase-mockup** (agentId a98a5a980a1e9dd65). Builds `docs/mockups/ai-showcase-2026-06-12.html`, an interactive REVIEW mockup (settings-mockup harness) of a dedicated `/ai` page selling BeakerBot's real capabilities with prompt -> real-output cards. Worktree was not visible at pause (may have finished or not started). It is a docs/mockups file, pull it to main so the static mockup server (port 8777) serves it, then Grant reviews. Grounded capability list is in the brief (real tools: run_datahub_analysis, make_datahub_graph, design_primers, compute_tm, search_my_work, create_experiment_chain, write_note, etc., NOT navigation-only).

## Pending decisions Grant owes a call on
- **3 ambiguous "coming soon" sharing claims** the stale-sweep flagged (still in code, unchanged): (a) `WhatsNewModal.tsx:262` "Find other ResearchOS users to share with, coming soon" (is user-directory discovery live?); (b) `SharingSection.tsx:701` "inbox opens once the receive screen ships"; (c) `SharingSection.tsx:694` collab storage line. Need Grant to say which are shipped, then fix the copy.
- **The `/ai` page**: after Grant reviews the mockup, build the real page (it becomes the destination the pricing/welcome AI sections link to).
- **No `/terms` page exists** (flagged in the IA build): the footer legal row omits Terms. Draft one when Grant wants (needs his legal review).

## Standing reminders (do NOT drop)
- **PENDING at next deploy**: set `NEXT_PUBLIC_OAUTH_FIRST_LOGIN=true` in Vercel Production to ship the redesigned login (built + enabled in Grant's local .env.local only; prod still on the legacy chooser; it bakes at build). Tracked in `docs/DEPLOYMENT.md` launch checklist + memory `project_pending_vercel_oauth_flag`. Remind Grant on any deploy/push mention.
- The marketing redesign (welcome/pricing/settings/IA) is **gate-verified, not browser-verified** (cannot run a 2nd next dev). Grant eyeballs on :3000.

## Gotchas
- **main is currently tsc-red from ANOTHER session's in-flight Data Hub work** (`datahub/DataHubRail.tsx:617`, `datahub/transform/recipe.ts:130`). NOT from any of my changes. When verifying sub-bot output, FILTER tsc to the touched files. Grant's :3000 may throw a Data Hub type error until that session finishes.
- Shared main checkout: other sessions commit interleaved. When merging a sub-bot, check `git log <merge-base>..HEAD -- <file>` for each file before checkout (none of my merges conflicted, but verify).
- Token economy numbers (above) MUST stay consistent across pricing/welcome/settings; if the ai-surface bot used different numbers, reconcile to 30k/analysis, 7.5k/quick, 750k free gift.

## How to view things on :3000
- Redesigned login + welcome scroll: `http://localhost:3000/?previewLogin=1` (dev hook; works while logged in). `?previewLogin=signin` / `=off`.
- Settings: avatar menu -> Settings (full-screen, X or Esc to leave).
- Pricing/about/transparency: now reachable logged-out (routing fix above).
