# Handoff: marketing + AI surfacing + demo + /ai + /terms + chemistry wiki (2026-06-12, rev 3)

Resume point for the marketing/AI/demo orchestrator session. Everything below is on LOCAL main (nothing pushed to origin, see Prod state). Supersedes the earlier revisions of this doc.

## Shipped this session (all merged to local main, gate-verified)

### /ai BeakerBot marketing page (DONE, fully routed)
- Retired the old in-app `/ai` palette-opener (Grant's call) and rebuilt `/ai` as a public marketing sell page to the welcome-page quality bar (`MarketingNav` + `MarketingBackdrop` + `Reveal` + `MarketingFooter`, bold-rainbow, `BeakerBot`). Five real-tool capability cards (Data Hub analysis + figure, primers + Tm, PubChem chemistry, cross-type search, experiment chain). Leads HARD on cheapness (penny per analysis, 750k free gift = about 25 cents of compute, no subscription/seat fees, per-seat-tool contrast). Public-route whitelisted, wiki-excluded. Humanizer pass applied.
- Entry points WIRED (was orphaned): `MarketingNav` "BeakerBot" link, footer Product "BeakerBot AI", "See everything BeakerBot can do" links in the pricing AI section and the welcome AI showcase.
- Review mockup: `docs/mockups/ai-showcase-2026-06-12.html` (Grant approved).

### /terms Terms of service (DONE as a DRAFT, needs a lawyer)
- Built `/terms` (`components/terms/TermsOfService.tsx` + `app/terms/page.tsx`), mirroring `/privacy`. Footer legal row = Terms / Privacy / License; whitelisted; wiki-excluded.
- Deep-research-verified vs AGPLv3/open-core SaaS precedent (PostHog, Plausible, Grafana). Applied fixes: a `$100` liability-cap FLOOR (greater-of-fees-or-$100), consumer-law carve-out, AI/no-professional-advice line, standard boilerplate (feedback license, severability, entire agreement, no waiver, assignment, force majeure), eligibility (13+), and a DMCA/takedown clause.
- STILL A DRAFT, do NOT ship to prod without a licensed Wisconsin attorney. Open for the lawyer: exact dollar floor, EU/UK consumer-rights + a possible GDPR DPA for international academic users, sign-off on DMCA + eligibility. Effective date is a placeholder (set at publish).
- `ACTION FOR GRANT` block at the top of AGENTS.md (surfaces 2026-06-13) reminds Grant to find an affordable WI/Madison tech-SaaS-IP attorney and offer to run the search.

### Chemistry wiki (SHIPPED + verified up to date)
- The page + 8 real screenshots + capture entries already existed (chem-workbench session, `e400cc425`). I made `/chemistry` first-class: dropped it from the wiki-coverage `EXCLUDED_PREFIXES` so the mapped route is enforced. Along the way fixed a LATENT PROD-DEPLOY BLOCKER: `/about` was unmapped + unexcluded, which would have failed the prebuild coverage gate; added it to the exclusions.
- Audited the page against the chemistry codebase (it had drifted). Fixed: the Delete callout was BACKWARDS (molecules DO soft-delete to Trash with Undo + restore); softened the "all identity local" framing (PubChem descriptors are carried from PubChem). Documented the missing v2 layer: search-by-structure (substructure + Tanimoto), right-click + bulk actions, Send-to-note/experiment/method, "Referenced in" backlinks, properties panel + Lipinski badge, and the editor's version history.
- 3 chemistry screenshots (molecule-detail, editor, library-rail) are now stale vs the v2 UI; NOT re-captured (Grant will do a wiki-wide re-capture later). Documented the chemistry build-flag requirement so that re-capture does not break them (see below).

### Wiki image audit + capture-script tidy (DONE)
- Cross-checked every wiki image (116 referenced) vs the capture script. It was mostly current. Added 2 missing entries (`feedback-modal-bug`, `settings-ai-helper` best-effort) and pruned 7 dead orphan entries; kept `purchases-new-purchase-modal` (pending TODO) and `feedback-modal` (used by /wiki/security). `node --check` valid, net -5 entries.
- Documented that flag-gated shots (chemistry, Data Hub) need their `NEXT_PUBLIC_*_ENABLED` flag set at BUILD when capturing, in `scripts/WIKI_SCREENSHOTS.md` + an inline `ENV REQUIREMENT` comment, or a wiki-wide re-capture would overwrite good shots with the disabled gate.

### Prior in-flight sub-bots + earlier work
- ai-surface (free-token economy across pricing/welcome/settings: 30k/analysis, 7.5k/quick, 750k gift), demo-polish (`/demo` realism + `?record=1`), ai-showcase-mockup all recovered/merged. WhatsNewModal "coming soon" dropped (user discovery is live). Earlier: shared motion system, welcome rebuild, settings redesign (left-rail SettingsShell), pricing AI section + honest savings calc, ResearchOS LLC rebrand, footer/nav IA split + `/about`.

## Prod state (IMPORTANT)
- NOTHING from this session is in production. `research-os.app` deploys from `origin/main`; local `main` is ~80+ commits AHEAD of origin (all sessions' unpushed work). `/ai`, `/terms`, the chemistry wiki, the marketing redesign are LOCAL-ONLY. Going live = a coordinated `git push origin main` (deploys ALL sessions' work + triggers Vercel), which is Grant's call, not the orchestrator's.
- At that deploy: set `NEXT_PUBLIC_OAUTH_FIRST_LOGIN=true` in Vercel Production (redesigned login, built + local-only).

## Open / next
- `/terms` attorney review (AGENTS.md ACTION, 2026-06-13).
- Data Hub + BeakerAI wiki are deliberately NOT written yet (too hot); write them like chemistry once they calm. Data Hub + migration screenshots are deferred placeholders.
- The "penny of compute" cost claim (on `/ai` + `/pricing`) is kept; Grant is aware.
- Parked: sponsor BeakerBot badge mockup (waiting on GitHub Sponsors approval).

## Gotchas reaffirmed
- The single `main` checkout is shared across all running sessions; any session's `git checkout`/`git merge` drags everyone (and Grant's `:3000`). ALWAYS `git branch --show-current` before committing. Build in isolated worktrees off `main`; land by `git merge --ff-only` only when the main checkout is free and not mid-merge (check `MERGE_HEAD`), or by `git push . <branch>:main` when main is not checked out anywhere. NEVER `git stash` in the shared tree. Recovery branch `wip/shared-tree-snapshot-2026-06-12` holds uncommitted shared-tree edits snapshotted when the checkout was re-pinned to `main`.
- For any new top-level route, add it to `APP_ROUTE_TO_WIKI` (with a wiki page) OR `EXCLUDED_PREFIXES` in `scripts/check-wiki-coverage.mjs`, or the prebuild gate fails the deploy (this is how the `/about` blocker happened).
