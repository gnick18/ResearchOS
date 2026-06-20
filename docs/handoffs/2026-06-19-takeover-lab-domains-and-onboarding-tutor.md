# Takeover session handoff: lab-domains fixes + onboarding-tutor redesign (2026-06-19)

BeakerAI lane. Took over from `docs/handoffs/2026-06-19-lab-domains-gate-bug-handoff.md`.
Everything below is on `origin/main` and LIVE on prod (research-os.app, Vercel
project `research-os`, scope `grant-nickles-projects`) unless marked. House voice:
no em-dashes, no emojis, no mid-sentence colons.

---

## A. Lab-domains lane (ALL FIXED + browser-verified on prod)

1. **Blocker 1, lab subdomain showed the welcome page (FIXED `b693619ea`).** `<slug>.research-os.com` rendered the app welcome/login instead of the lab site. Root cause was the client `AppContent` gate in `frontend/src/lib/providers.tsx` having no lab-origin exemption (the lab HTML was only in the RSC flight payload, so curl looked fine but the browser overlaid WelcomePage after hydration). Fix: a lab-origin bypass in AppContent keyed off a new `isLabPublicHost({host,enabled})` in `lib/social/lab-byo.ts` (same single source as the proxy, custom-domain-ready), gated on `LAB_SITES_COM_ORIGIN_ENABLED` + `mounted` (hydration-safe, byte-identical when off). Verified live via headless Playwright (executes JS; curl cannot catch a hydration overlay).

2. **Slug-permanence confirm gate (FIXED, same lane).** `LabSiteDashboard.tsx` claim step now has a "permanent web address, cannot be changed, breaks every link" warning + a confirm checkbox showing the exact `<slug>.research-os.com`, and refuses the claim until confirmed. Confirmed there is NO user-facing rename path (POST `/api/social/lab-site` is idempotent, returns the existing slug; `createSite` ON CONFLICT is unreachable as a rename).

3. **Blocker 2, app-origin 301 did not fire (FIXED `b8e2864bd`, in middleware).** `research-os.app/<slug>` rendered 200 instead of 301ing to the subdomain. The env `sensitive`-vs-`encrypted` angle (DEBUG lane recreated the two `*_COM_ORIGIN` vars as encrypted) was a genuine cleanup but a RED HERRING. REAL root cause, proven via a temp prod log: `permanentRedirect()` to an EXTERNAL cross-origin URL inside a Server Component render falls back to a 200 client-side redirect, never a real 3xx. So the page can never issue it. Fix: the redirect lives in `proxy.ts` middleware via a new pure `resolveAppOriginLabRedirect` in `lib/social/lab-byo.ts` (true 308), gated on slug-shape + the drift-tested `RESERVED_SLUGS` set so real app routes are never redirected. `[[reference_layout_notfound_not_gating_prod]]` cousin: route-tree redirects belong in proxy.ts.

4. **Static-file regression from #3 (FIXED `84b2e4164`).** The first cut normalized the path segment before the slug check, so `normalizeSlug("frappe-gantt.css")` became the slug-shaped `frappe-gantt-css` and the middleware 308ed `/frappe-gantt.css` (and `/robots.txt`, `/sitemap.xml`, `/manifest.json`) to phantom subdomains (the matcher excludes `.svg/.png` but NOT `.css/.txt/.xml/.json`). Caught by a prod browser smoke. Fix: match the RAW first segment against the slug charset, no normalize rescue, so any dotted/uppercase/underscored path passes through. LESSON: a middleware path-redirect must be tested against root static-file paths.

Verified live: `fakeyeast-lab.research-os.com` renders the lab; `research-os.app/fakeyeast-lab` -> 308 -> subdomain (nested path preserved); `/frappe-gantt.css` `/robots.txt` -> 200; `/datahub` `/settings` etc. untouched; zero console errors. CAVEAT: only labs whose subdomain has a TLS cert load post-redirect (the `*.research-os.com` wildcard cert never auto-issued; only `fakeyeast-lab` has one). Memory `[[project_lab_domains_companion_sites]]`.

---

## B. Onboarding tutor (MERGED + LIVE + redesigned; visual polish handed to the Design Studio)

Came in from the Icon Lib lane: the tutor never showed Emile because the real
mount (`TourHost` in providers.tsx) lived ONLY on the unmerged
`feat/onboarding-tour-mount` branch.

1. **Merged + flagged (`09e76a601`).** Merged that branch (594 commits behind) onto current main in an isolated worktree, kept BOTH the lab-origin AppContent bypass AND the TourHost mount. `NEXT_PUBLIC_ONBOARDING_WIZARD` is on in Production (= `ONBOARDING_TUTOR_ENABLED`), so it fires for a fresh lab head.

2. **Live walkthrough found a real bug: the deep tour did not run.** The deep coupled tour hard-reloaded into `/demo`, but the merged mount was only in AppContent's main authed render, not the `isDemoOrWikiCapture` early-return branch.

3. **NO-WARP REDESIGN (Grant: warping into the full /demo app feels bad).** The keeper. `OnboardingTutor` no longer calls `onBeginShow` (no warp); `onStart` always `beginReel`; deep_demo beats render the contained `ShowcaseStage` (never `LiveCursorLayer`). The whole tutor now plays as CENTERED POPUPS in place over the page the user is on, never entering /demo, never touching the real folder. The `/demo` branch mount was removed (moot). `live`/`onBeginShow` props are deprecated/dead.

4. **Beaker consistent + on-brand on every beat.** New shared `BeakerSays` = full-size `<BeakerBot>` (h-40) + a `var(--font-ai)` speech bubble; routed ShowcaseStage + MemoryProposeBeat + RecapBeat + AiDemoBeat through it (the earlier beats had a tiny h-7/h-8 Beaker + plain font). Removed a confusing blue `humanizeTarget` "Export" debug label; the action control is absolutely placed and the cursor tip lands on it.

5. **Per-surface preloaded pages (`1c4a7c9b9`).** New `SurfacePage` renders a recognizable mock per surface + a matched action: Data Hub table->figure ("Make figure"), Sequences base-strip->annotation ("Annotate"), Phylo cladogram->export frame ("Export"), Methods protocol->phone ("View on phone"), Chemistry SMILES->structure ("Render"), Inventory stock->reorder ("Reorder"), People roster ("Lab overview"). Replaced the generic "sample item" rows.

All BUILT + LIVE + browser-verified (Data Hub beat driven live on a fresh account;
all beats use full-size signature Beaker). tsc/lint clean, tutor suite green.
Memory `[[project_llm_onboarding_tutor]]`.

### B6. NEXT for the tutor: ANIMATIONS via the Claude Design Studio (in flight, Grant driving)
Grant's bar: the per-surface pages are static mocks; they should be ENTIRE
choreographed animations. Deliverables produced this session:
- **Vision + handoff doc** `docs/proposals/2026-06-19-onboarding-tutor-animation-vision.md` (current beat system + hard constraints + per-surface motion scripts + a paste-able studio brief). Grant SENT this to the Claude Design Studio ("ResearchOS Design" system).
- **North-star mockup** (a self-running interactive Data Hub table->figure morph) produced via the visualize tool as the motion target for the studio.

When the studio returns scenes, wire each into `SurfacePage` / `BeakerSays` / the
beat components AGAINST the existing `showcase-player.ts` step clock (so
pause/resume + hidden-tab freeze keep working), keep the constraints (full-size
Beaker, font-ai, custom inline SVG, reduced-motion -> cross-fade, ephemeral), and
verify live, then report.

### Tutor verify mechanics (important, save time)
- Fresh user = NO `users/<name>/settings.json`, NO `_onboarding.json`, NO `_user_metadata.json` entry (`isFreshUserForWizard`). CONNECTING re-writes settings + metadata, so to re-fire the tutor reset those on disk then reload IMMEDIATELY.
- Synthetic test folder exists at `~/Desktop/ROS-tutor-test`: `users/Grant/projects/{1,2}.json` (per-user; the fresh-gate ignores projects) so the tutor fires WITH data present. Reset = `rm users/Grant/settings.json` + `echo '{"users":{}}' > users/_user_metadata.json`.
- The rAF showcase player FREEZES while the tab is `document.hidden` (Claude-in-Chrome backgrounds the tab), so the STATIC composition is screenshot-verifiable but the cursor glide / auto-advance is GRANT'S FOREGROUND EYEBALL. Drive beats manually with the Skip-demo / Continue buttons to advance without the rAF.

---

## C. Coordination state (other live lanes touch shared files)
- **Icon Lib lane**: admin IA redesign (operator-route BeakerSearchProvider in providers.tsx) merged; coexists with the AppContent changes (different branches). Icon Lib also owns the trial-countdown banner in the app shell (Billing 90-day trial) and added "Industry role opens a contact form" to InterestPicker. Coordinated all providers.tsx overlaps live (rebase, no clobber).
- **DEBUG lane**: did the env sensitive->encrypted cleanup, then stood down on Blocker 2 once the real (cross-origin-redirect) root cause was found; building lab-site network-presence P1/P2 (LabSitePageView/LabDirectoryCard/lab-site-db.ts).
- `providers.tsx`, `lib/social/lab-byo.ts`, the `[labSlug]` route, and the tutor components are hot. Build in an isolated worktree, rebase before each push, never commit in Grant's dirty primary checkout. `[[feedback_integrate_from_worktree]]`.
- Deploys auto-promote to research-os.app on git push to main (the prior "auto-promote off" note is no longer true). There is a build+promote lag, so confirm the prod alias points to your build before verifying.

## D. Worktrees + cleanup
- `.claude/worktrees/lab-gate-bypass` (lab-domains work, merged) and `.claude/worktrees/onboarding-tutor` (tutor work, merged) are both fully on origin/main and safe to remove. The synthetic `~/Desktop/ROS-tutor-test` folder is intentionally kept for tutor re-verification.
