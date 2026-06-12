# Handoff: entry-surface unification + welcome scroll + the launch splash (2026-06-12)

Resume point for the session that took over the marketing/AI/demo orchestrator and then spent the session on the entry-flow + welcome-page polish arc. Everything is on `main`. Most of it is PUSHED to `origin/main` (deployed); two commits are local-only (see Prod state). No em-dashes, no emojis, no mid-sentence colons in anything authored here.

## Context
Inherited from `docs/orchestrator-handoffs/2026-06-12-marketing-ai-demo-handoff.md`. Early in the session: set `NEXT_PUBLIC_OAUTH_FIRST_LOGIN=true` in Vercel as a PLAIN var (Prod+Preview) and audited every `NEXT_PUBLIC_*` flag the code reads against Vercel (all present and correct; sharing/collab/inventory true, billing/maintenance false). Then the work pivoted entirely to the entry surfaces and the welcome page.

## Shipped + PUSHED (live on origin/main, gate-verified tsc 0)

### Welcome page scroll + reveal (all on `/welcome`, `/ai`, `/pricing`)
- **Free-scroll OAuth landing** (`9b9483ebe`): the OAuth-first landing used `snap-y snap-mandatory`, which made a tiny trackpad scroll fly a whole viewport (and `snap-proximity` then trapped the user in a dead zone). Now plain `scroll-smooth`; the down-chevron and "Back to get started" arrow are the intentional jumps (Stripe/Linear pattern).
- **Bidirectional Reveal** (`1657108bf`): the shared `components/marketing/Reveal.tsx` was one-shot (disconnected after first reveal). Now it toggles on intersection (reveals on the way down, settles back out on the way up). Tuned to the approved feel: 24px rise + 0.98 scale on brand `cubic-bezier(.2,.7,.2,1)` over 0.65s, trigger margin `-10%`. Has an `once` prop to opt back into one-shot.
- **Staggered card grids** (`8ec287a22`, `bfde4b6cb`): the how-it-works step cards (x3), trust band cards (x4), and the companion-app capability grid (phone leads, then 4 cards) each get their own `Reveal` with a 90ms incremental `delay`, so they cascade instead of popping as one block.
- **Cost-table cascade** (`728f1d341`): the price rows drop in top-to-bottom at a one-time 40ms stagger, the "Thousands per year to free" punchline row last. `CostTable` runs its own IntersectionObserver, one-time (rows do not re-hide on scroll up), off under prefers-reduced-motion.
- **Tree-of-life removed** (`bfde4b6cb`): the d3 explorer section was dropped from the welcome page (component, code-split import, idle preload, and its dedicated test all gone; test replaced with a render smoke test).

### Unified entry surfaces (the shared deck backdrop)
- **`LandingBackdrop`** (`components/onboarding/oauth-first/LandingBackdrop.tsx`, new in `0a222bc6c`): the landing deck stage extracted into one component (light radial wash, masked dot grid, drifting rainbow auroras + floating beakers on a cursor-parallax layer, rainbow bars), reusing `OAuthFirstLanding.module.css` so it can never drift.
- Applied + `light-scope` (pinned light, like the landing) to: **UserLoginScreen** (account-select, `0a222bc6c`), **FolderConnectGate**, **StagedLoadingScreen**, **WelcomeBackSignIn**, **LabSignInGate**, and **AccountTierChooser** (`583d99f58`). The tier chooser uses a negative-z `StepBg` so the per-tier `BeakerBotScene` marks stay. `IntroBubbleBot` is the header mascot on the gates/login/lab; `StartScreen` was deliberately skipped (dormant under the OAuth-first flag).
- **DRY pass** (`326867483`): `OAuthFirstLanding` now renders `<LandingBackdrop />` too (its inline copy + the `FloatBot` helper + the cursor-parallax effect deleted). Single source of truth.

### Heart easter egg on the bubble beaker
- **`269839631`**: clicking `IntroBubbleBot` pops pink hearts that drift up and fade, matched to the SVG `BeakerBot` mark (same `#ff5b8a`, 6-heart cap, 700ms pop, fan-out drift). Since `IntroBubbleBot` is the one shared mascot, this is live on every entry/loading surface. Hearts use the approved `<Icon name="heart">` (a CSS `fill` makes the outline solid) so the icon guard is not tripped; cleanup timers drain on unmount.

### The launch splash (the big behavior change)
- **Once-a-day launch-into-app moment** (`4f7d71711`): the BeakerBot `Splash` used to be a pre-login moment that the rainbow `StagedLoadingScreen` consumed almost every time (a 2026-06-09 anti-double-flash effect), so it was effectively never seen. Per Grant: "the loading should BE the splash, it launches users into the app on their first session each day." Moved the `Splash` to the POST-login slot, gated by a per-DAY `localStorage` stamp (`researchos:splash-day` = local `YYYY-MM-DD`) instead of per-session. The old per-session gate and the loading-consume effect are gone.
- **Retired the per-login SuccessTransition** (`cec740a6d`): the splash is the single launch animation now, so the lighter `SuccessTransition` is out of the real flow (its provider branch, import, the dead `ENTERED_KEY` marker + its four entry-handler writes, and the `successShown` state all removed). The `SuccessTransition` component stays only for the `/dev/account-setup` preview.

### Soft-lock fixes (entry-surface escape-button audit)
- **FolderConnectGate Cancel** (`4c45533de`): the "Initialize New Folder" Cancel only reset `entryAction` while the empty folder stayed attached, so `needsInitialization` kept the same screen up (nothing happened). Now it `disconnect()`s the handle (clearing `needsInitialization`) before backing out.
- **Audit** (a general-purpose sub-agent traced every escape/back/disconnect button across FolderConnectGate, UserLoginScreen, WelcomeBackSignIn, AccountTierChooser, EntrySnapSurface, StagedLoadingScreen against the state that gates each view): no other "Cancel does nothing" re-render bugs remain.
- **LabSignInGate hard-trap** (`74cd254ef`): the `authenticating`/`unlocking` progress card had NO escape at all (a hung OAuth or stalled unlock trapped a lab user). Added the same "Use a different folder" -> `disconnect()` escape after an 8s delay, mirroring StagedLoadingScreen's hatch. Satisfies the no-soft-locks rule.

## LOCAL-ONLY (committed, NOT pushed, tsc 0)
- **Splash rainbow reveals the workbench** (`5574f92ce`): the splash early-returned IN PLACE of the app and its exit faded the flood to a static gradient while the BeakerBot column stayed mounted, so the rainbow "opened" back onto the splash, then hard-cut to the app. Now the splash renders as a fixed OVERLAY on top of the mounted workbench (also covers the initial app data load), and on exit it dissolves its own stage (background to transparent, hide the BeakerBot column + dot grid + Skip once the flood covers) then recedes the flood to reveal the live app underneath.
- **`/dev/splash` harness** (`5b12b1d9f`, `app/dev/splash/page.tsx`): mounts a mock workbench, overlays the real `Splash` exactly like production, and a Replay button remounts it. Confirms the reveal without needing a fresh folder or a new day.

## Prod state
- `origin/main` is deployed; everything PUSHED above is live (the OAuth-first login flag is set in Vercel, so the new login + welcome render correctly). The two LOCAL-ONLY splash commits are NOT yet pushed; Grant pushes when he is happy with the reveal on `:3000`.
- `tsc` on `main` is GREEN as of end of session. Earlier in the session it briefly went RED from another session's half-landed chemistry `starred_papers` feature (consumers committed before `lib/chemistry/api.ts` exported `StarredPaper`/`setStarredPapers` and before the `star` icon existed); that session finished landing it (`1f3dc0044` + `ddff01a9a`) and it compiles now. Worth a tsc check before any push since the tree is shared.

## How to test on `:3000`
- Welcome scroll + reveal: `localhost:3000/welcome` (scroll up/down; the step + trust + companion grids cascade, the cost table tallies in).
- Entry backdrop: account-select at `/workbench` with no user; folder-connect by disconnecting; loading on any reconnect; the tier chooser via Create account; lab gate for a lab account.
- Heart easter egg: click the bubble beaker on any of those.
- The launch splash: `localStorage.removeItem('researchos:splash-day')` then reload + enter (once-a-day gated), or the isolated `localhost:3000/dev/splash` Replay harness.

## Gotchas reaffirmed
- The single `main` checkout is shared across concurrent sessions; the index often holds OTHER sessions' staged files. ALWAYS commit with an explicit pathspec (`git commit --only <path>`), never a bare `git commit` (a bare commit once swept 10 of another session's staged files into mine; recovered with `git reset --soft HEAD~1` then a pathspec commit). For a NEW file, `git add <path>` first, then `git commit --only <path>`.
- `tsc`/vitest must run from `frontend/` (the `@` alias lives in `frontend/vitest.config.mts`); a bare `cd` in the Bash tool persists, so paths can drift, use absolute paths or re-`cd`.
- eslint is NOT in the commit gate (icon-guard is); `tsc` is the verification gate.
- New user-facing icons must use `<Icon name=...>`, never a raw inline `<svg>` (the heart easter egg used `<Icon name="heart">` + a CSS fill for exactly this reason).
- A `stash@{0}` was sitting on the shared tree at end of session (not this session's); never `git stash` in the shared checkout.
