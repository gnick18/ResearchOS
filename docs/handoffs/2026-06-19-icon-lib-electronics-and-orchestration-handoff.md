# Icon Lib session wrap: electronics expansion + cross-lane orchestration (2026-06-19)

Owner: the "Icon Lib" master/orchestrator session. This session ran the icon-library
electronics expansion end to end and orchestrated four peer lanes (DEBUG, Billing,
BeakerAI, Buisness Boi). House style throughout: no em-dashes, no emojis, no
mid-sentence colons. Everything below is on origin/main and LIVE in prod unless marked
otherwise.

## TL;DR state

- Open icon library: 27,726 -> **29,982 (~30k), LIVE on prod**. New "Electronics" leaf = 2,321 symbols.
- Wikimedia as a source is **DROPPED** (tar pit, see below). Do not revisit Commons.
- Several UI fixes shipped this session (permanent gate sign-out, two-column folder gate, /admin IA redesign + widen, page-width sweep, trial countdown banner) and are live.
- Two cross-lane features finished by their owners (LLM onboarding mount + no-warp redesign by BeakerAI; 90-day lab trial by Billing). Both functionally live; only Grant-side verification + design-studio polish remain.
- Nothing of mine is mid-flight or blocked. No background ingests running.

## 1. Electronics expansion (Icon Lib lane) - DONE + LIVE

Library went 27,726 -> 29,982. New work, all on origin/main + live on R2 (Grant ran the Cloudflare purge):

- New **"Electronics" taxonomy leaf**: `frontend/src/lib/figure/asset-library.ts` CATEGORY_SECTIONS, the old "Physics & math" section is renamed **"Physics, math & electronics"** and carries Physics, Math, Electronics. `electricalSymbolCategory` in `frontend/scripts/asset-ingest/lib.mjs` now returns "Electronics" (NOT "Computer hardware"); circuit symbols belong to electrical engineering, not computer hardware (Grant). Electronics leaf now holds 2,321.
- **KiCad**: 2,140 curated generic circuit symbols (CC-BY-SA). The repo restructured to `<Lib>.kicad_symdir/` directories of per-symbol `.kicad_sym` files; the adapter (`ingest-kicad-symbols.mjs`) was reworked for that + curated to ~28 generic libraries (Device, Switch, Diode, Transistor_*, Amplifier_Operational, Relay, Connector_Generic, etc.), deliberately skipping the ~190 vendor part-number families (MCU_*, CPU_*, DSP_*, ...). It needs `kicad-cli`, which ships inside the KiCad app; the brew cask install fails on a sudo prompt, so this session mounted the cached DMG and ran kicad-cli from there (see gotchas).
- **chris-pikul/electronic-symbols**: 116 MIT symbols (IEEE/IEC/COM standards). Adapter `ingest-electronic-symbols.mjs`.
- **electricalsymbollib**: its existing 74 entries were remapped from "Computer hardware" to Electronics (the ingest seed rewrote their category).
- **Search**: electronics + physics keyword synonym groups added to `asset-search.ts`. Semantic search auto-covers everything (the ingest re-embeds the full corpus). Both deployed.
- **Copy**: all icon-count verbiage updated from a stale "14,559" to "around 30,000" (wiki library page, wiki nav blurb, /library landing + metadata).
- **Tooling preserved on main** (commit `9c60eabac`): the reworked KiCad adapter + the new chris-pikul adapter + the lib.mjs mapper/credits + lib.test.mjs, so future re-ingests are consistent (otherwise main's lib.mjs would still map electronics to "Computer hardware").

Full durable record is in agent memory `[[project_bioart_icon_library]]`.

## 2. Wikimedia DROPPED (do not revisit Commons)

Goal was complementary physics/electronics/bio DIAGRAMS from Wikimedia Commons. It is a
tar pit and Grant approved dropping it:

- The adapter repeatedly stalled at 0% CPU. Root cause is a download body-read hang that
  resists AbortController in node/undici on Commons' flaky connections, compounded by
  huge categories (Metabolic pathways alone is tens of thousands of files) and oversized
  multi-MB pathway-map SVGs (a poor fit for a lightweight icon library anyway).
- Five fixes did not make it tractable: body-read abort timeout, per-file size pre-skip
  via the imageinfo size field, per-unit candidate cap, listing-pagination cap, 12s
  timeout. The adapter + that hardening live on branch `feat/electronics-leaf` but were
  intentionally NOT merged to main and NOT run.
- If more bio DIAGRAMS are ever wanted, use a purpose-built source with clean per-asset
  licensing and sane file sizes, not Wikimedia scraping.

## 3. Other things shipped this session (all live on origin/main)

- **Permanent gate sign-out** (`PersistentGateSignOut`, mounted in providers.tsx): a fixed
  top-right Sign out on every login/gate screen, shown when signed-in + no folder
  connected. Fixes a real soft-lock where the only sign-out was a footer link below the
  fold that did not even scroll into view.
- **Two-column folder gate** (`FolderConnectGate.tsx`): the connect screen was a narrow
  max-w-2xl column in a non-scrollable fixed container. Now a width-using two-column
  layout (Pick up where you left off | Start a new folder) that fits one screen, with an
  overflow-y-auto scroll backstop; BeakerBot + walkthrough moved in-header.
- **/admin IA redesign** (`OperatorShell.tsx`): the 22-section flat-rail mega-scroll
  became area tabs (Overview, Metrics, Accounts, Finances, Modeling, Comms), a Cmd-K
  jump-to-anything search wired into BeakerSearch, and Finances sub-grouped (Money in/out,
  Accounting, Vendors & infra). Also widened the console from max-w-4xl to screen-2xl.
- **Storage inventory** at /admin (Metrics tab): operator-gated per-bucket, per-prefix R2
  breakdown (icon library, lab-site data, relay), so Grant can see what is stored on .com.
  `lib/library/storage-inventory.ts` + `/api/admin/storage-inventory`.
- **Page-width sweep**: new shared `<PageContainer width="prose|wide|full">` primitive +
  an AGENTS.md convention, and 11 genuinely-narrow dense pages widened (lab-experiments,
  lab-notes, lab-work, approvals, funding, people, lab-overview = full; settings,
  researchers, activity, trash = wide). An audit flagged ~30 but the bot verified ~14
  were already full-bleed and were left alone. Prose pages stay narrow.
- **Trial countdown banner** (`TrialCountdownBanner.tsx`, just pushed `9bfbe8272`): the
  one open item on the 90-day trial. Self-gates on the live trial status from
  `/api/billing/model-a/status`; reassures (no card needed) early, escalates as it ends;
  pure `lib/billing/trial-countdown.ts` helper with 7 tests.

## 4. Cross-lane state (owned by other sessions, tracked here)

- **LLM onboarding (BeakerAI lane).** Was the Emile bug: the tutor was built but only
  rendered in `/dev`, never mounted in the real flow. BeakerAI merged the mount, then did
  a no-warp redesign so the deep demos play as centered popups in place (no /demo warp).
  Functionally live + verified on a fresh prod account. Remaining: Grant's foreground
  eyeball on the live rAF cursor glide (invisible to automation), and the choreographed
  animation scenes via the Claude Design Studio (Grant drives the studio; BeakerAI wires
  scenes back into SurfacePage/BeakerSays). Grant greenlit a north-star Data Hub
  "table -> figure" morph mockup as the studio target; BeakerAI is building it.
  See `[[project_llm_onboarding_tutor]]`.
- **90-day lab trial (Billing / Billing-account lanes).** Was doc-only; now built + LIVE
  (no-card, `LAB_TRIAL_DAYS=90`, `start-trial` route, app-side `trial_ends_at`,
  `labTrialDecision` gates charge + accrual, the setModelAPlan getPlan("lab") bug fixed,
  charge engine verified in Stripe test mode, dispute/refund handlers shipped). The
  original Billing session is archived. Remaining (Grant-side): owner-mapped refund/
  dispute live test, set the Stripe account-level statement-descriptor prefix, and a
  visual pass on the no-card copy. See `[[project_ai_billing_build]]`.

## 5. Awaiting Grant (deployed, just needs his eyes; no builds pending)

VERIFICATION PASS 2026-06-19 (takeover session, on Grant's live :3000 via Chrome + code-read + unit tests). Items marked DONE are signed off and need no further action; the two remaining are genuine human-judgment calls.

- DONE (verified, no longer awaiting): **Permanent gate sign-out** confirmed live, top-right "Sign out" renders on both the /admin gate and the account-setup gate, with a "Back to the app" escape, so there is no soft-lock. **/admin operator gating** confirmed live (a non-operator hits Admin-access-required with an escape, not the console). **/admin widen** confirmed in code (`OperatorShell.tsx` content wrapper is `max-w-screen-2xl`). **Two-column folder gate** confirmed in code (`FolderConnectGate.tsx` uses `lg:grid-cols-2` "Pick up where you left off | Start a new folder" with an `overflow-y-auto` backstop and a `max-w-4xl` width-using container; the two columns only render when there is a recent folder to resume, single centered column otherwise by design). **Page-width sweep mechanical half** confirmed in code (lab-experiments, lab-notes, lab-work, approvals, funding, people, lab-overview all carry `width="full"`; researchers, activity, trash carry `width="wide"`). **Trial-countdown logic** confirmed (the 7 `trial-countdown.test.ts` unit tests pass).
- SUPERSEDED (drop, not mine to verify): the /admin **tab order + Finances sub-group mapping** in this lane (6 tabs Overview/Metrics/Accounts/Finances/Modeling/Comms, Money-in-out/Accounting/Vendors) was REPLACED by the later "admin 7-group IA reorg" (pepper clean-slate lane, 2026-06-19). Current live IA is Dashboard/Accounts/Metrics/Finances/Compliance/Pricing/Comms with Finances subgroups Overview/Ledger/Subscriptions/Payment methods/Cost breaker. Verify that reorg under its own lane, not this one.
- STILL AWAITING GRANT (genuine human-judgment, cannot be automated):
  - Page-width "reads sparse?" on lab-overview, funding, people. The pages render full-width correctly (mechanically verified above); whether the un-reflowed grids look sparse depends on real lab data density, which fixture data cannot reproduce, so it needs Grant's eye on his folder. If sparse, drop that page to `width="wide"` or add a grid column.
  - Trial countdown banner VISUAL at a live lab-head trial state (the logic is green; only the on-screen escalation copy needs an eyeball).
  - Onboarding cursor glide (live rAF, invisible to automation) and the trial refund/dispute Stripe-test items from section 4.

## 6. Mechanics + gotchas for the next agent

- **Adding icon sources**: seed the LIVE manifest (`curl https://assets.research-os.com/manifest.json -o out/bundle/manifest.json`), run the adapter(s) (they append), re-embed (`embed-assets.mjs --manifest out/bundle/manifest.json --out out/bundle`, model loads from R2), then `rclone copy` the new SVG dirs + `rclone copyto` manifest + embeddings (COPY never sync, `--ignore-times`, the gotchas that bit repeatedly). Then Grant runs a Cloudflare Custom Purge, type Hostname, `assets.research-os.com` (manifest + embeddings are edge-cached 4h). See `[[reference_assets_cdn_4h_cache]]`.
- **R2 publish permission**: the auto-mode classifier blocks the manifest/embeddings R2 write as an unverified destination; ask Grant for an explicit go each time (he approved twice this session). The SVG-dir uploads went through without a prompt.
- **kicad-cli**: not installed (cask needs sudo). This session mounted the cached DMG at `/tmp/kicad-mnt` and prepended `/tmp/kicad-mnt/KiCad/KiCad.app/Contents/MacOS` to PATH. The mount is gone on reboot; remount the DMG from `~/Library/Caches/Homebrew/downloads/*kicad*.dmg` or have Grant finish the cask install in a real terminal.
- **Branches not merged**: `feat/electronics-leaf` (carries the shelved Wikimedia adapter + the full ingest setup + out/bundle at 29,982). The electronics TOOLING was already cherry-picked to main (`9c60eabac`); do not merge the whole branch (it would drag the Wikimedia adapter + a stale asset-library.ts back in).
- **Inter-lane coordination**: use `mcp__ccd_session_mgmt__send_message` with the To:/From: + sign-off house format; rebase any branch onto current origin/main before merging (origin moved many times this session); the primary checkout is shared, so build in isolated worktrees and push to origin, never merge in the dirty primary tree.

## 7. NEXT (nothing in flight; pick up as Grant directs)

There is no in-progress build to resume. Likely next directions, all Grant-gated:
1. Grant's verification passes (section 5), then any one-line tweaks he asks for.
2. If Grant wants more bio diagrams: a purpose-built source, not Wikimedia.
3. Optional icon-library follow-ups from `[[project_bioart_icon_library]]`: KiCad cap tuning, the deferred CS taxonomy leaf, a dynamic live-manifest count instead of the hard-coded "around 30,000".
4. The cross-lane items in section 4 belong to BeakerAI + Billing; coordinate, do not duplicate.
