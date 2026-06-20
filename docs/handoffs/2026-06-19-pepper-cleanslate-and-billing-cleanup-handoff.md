# Handoff: pepper clean-slate + lab-site/admin/billing cleanups (2026-06-19, DEBUG session)

Orchestrator session. Picks up from the lab-sites .com go-live handoffs. House style throughout (no em-dashes, no emojis, no mid-sentence colons). Everything below is on `origin/main` at the time of writing (`0f7ef92a5` or later, the tree moves fast with multiple concurrent lanes).

## TL;DR, the KEYSTONE blocking Emile's lab + identity

The prod `DIRECTORY_HMAC_PEPPER` was rotated and the OLD value is UNRECOVERABLE (Grant confirmed he does not have it). Every layer derives its owner key as `HMAC-SHA256(DIRECTORY_HMAC_PEPPER, lowercase-trimmed-email)` hex (lib/sharing/directory/email.ts + lib/billing/owner.ts), so all PRE-rotation stored identities no longer match any new email->key derivation. This is the ROOT cause of: Emile's half-written lab, the PI showing as solo/Free, divergent owner keys, and email-gifting mis-keying. Evidence: 0 of 16 stored `directory_identities.email_hash` match any of 11 known beta emails under the current pepper. Full detail in agent memory `[[reference_directory_pepper_rotation]]`.

DECISION (Grant): CLEAN SLATE + re-onboard. Local research data (folders on disk) is NOT pepper-keyed, so nothing real is lost. Steps (Grant's, in the operator console + sign-in):
1. Wipe the stale cloud accounts in `/admin` -> Accounts roster (all ~16 are old-pepper, mostly test artifacts). The per-account "Wipe account" is the sanctioned path (runs account-wipe.ts, frees handles/slugs). Do NOT raw-delete in Neon. The demo lab (`fakeyeast-lab`, sentinel owner `demo-fakeyeast-lab`, NOT pepper-keyed, not in the wipeable roster) stays live, leave it.
2. Real users (Grant, Emile, Sullivan, wisc beta folks) sign in again -> fresh correct identities under the current pepper. Emile re-creates his lab (the lab-create write-consistency fix shipped this session now writes the directory_labs row correctly) + re-invites.
3. Comp Sullivan + Emile 12-month Lab via the per-row gift button in `/admin` Accounts (shipped this session). After re-onboard, email-gifting works again too (new keys match the current pepper).

NEXT AGENT: after Grant does 1-3, read-only-verify the new identities key correctly under the current pepper (hash a known email, compare to the stored value), then do the two GB-ladder follow-ups below (the wipe unblocks them). DO NOT rotate DIRECTORY_HMAC_PEPPER ever again without a re-key migration plan.

## What shipped this session (all on origin/main, verified)

- Lab-site network presence P1+P2: enriched public lab page (LabIdentityHeader, LabSiteNav, native-vs-BYO LabSiteSwitcher, LabCompanionList, LabCitation) + 4 collaboration CTAs that deep-link to research-os.app (PI-as-recipient), origin-aware same-origin links (`labLinkBase`/`labSamePath` in lib/social/lab-collab.ts, slug-less on the subdomain), and a full-width page layout. Browser-verified on `fakeyeast-lab.research-os.com`. Plan: docs/proposals/2026-06-19-lab-site-network-presence.md. `[[project_lab_domains_companion_sites]]`.
- Tool/software pages (repo-type detection) A+B: connecting a public GitHub repo auto-detects static SITE vs code TOOL (lib/social/lab-repo-classify.ts) and routes to BYO hosting vs a native tool page (lib/social/lab-tool-ingest.ts fetches README + GitHub WIKI via raw.githubusercontent.com/wiki/<owner>/<repo>/<Page>.md, no git; ToolSitePageView.tsx renders it). Flag-gated. So FungalICS_Website = BYO site, starfish/chtc = tool pages.
- Admin: per-row "Gift" button on the Accounts roster (posts the STORED owner key, pepper-safe) + the grants route now accepts `ownerKey` directly + a much smaller, less-scary icon-only wipe trigger (same WipeConfirm guard).
- Admin IA reorg: OperatorShell collapsed from ~25 flat sections to 7 groups (Dashboard, Accounts [gifts moved here], Metrics [Users+growth / Infrastructure], Finances, Compliance, Pricing, Comms). Section ids stable (deep links intact). Mockup: shown inline this session.
- Lab-create write-consistency fix (`[[project_lab_profile_write_bug]]`): the directory_labs write was a name-gated fire-and-forget swallowed fetch that stranded on failure (the bug behind Emile's lab). Now: name-independent upsert, clear-pending only when relay AND directory both succeed, + a PI-boot self-heal (lib/lab/lab-directory-self-heal.ts ensureLabDirectoryRow). NOTE the self-heal derives the key from the session email, so it only keys correctly AFTER the clean-slate re-onboard.
- Gift-card premium comps: operator can comp a lab a plan tier for X months (no permanent, AI separate, all tiers giftable). The comp now lights up ALL paid gates (isProduceEntitled, plan resolver, allowance), not just publish. Design: docs/proposals/2026-06-19-gift-card-premium-entitlement.md. An initial version wrongly mapped comps to dead GB-ladder ceilings; that was corrected to Model A.
- GB-ladder retirement (`[[reference_gb_ladder_retired]]`): Model A is the only model. Deleted lib/pricing/modeling.ts (kept 3 cadence helpers in new cadence.ts), the dead activity throttle, per-plan storage caps, and the flat-plan billing routes (api/billing/status,/lab,/plan). The user-settable monthly SPEND cap already exists (ModelABilling.tsx -> /api/billing/model-a/cap).

## OPEN WORK (ordered)

1. PEPPER CLEAN-SLATE (Grant's 3 steps above) -> then NEXT AGENT verifies + does (2) and (3).
2. GB-ladder follow-up A (unblocked by the wipe): delete the `plus`/`pro`/`lab_plus`/`lab_pro` tier objects + `storageBytes`/`activityWritesPerMonth` from lib/billing/plans.ts AND the legacy resolver bridge in lib/billing/model-a/resolve.ts (modelAPlanForSubscription). Kept ONLY because a real `billing_subscriptions` row had `plan_id='lab_plus'` (the `edd168f1` test sub); the wipe deletes that row. Update resolve.test.ts / cron.test.ts after.
3. GB-ladder follow-up B: build a Model-A lab-pool-usage display endpoint (wrap getLabPoolUsage/getLabPoolWrites under the Model-A auth pattern) + repoint CloudStorageUsageSection.tsx and the lib/billing/client.ts flat-plan stubs (fetchBillingStatus/fetchLabStatus/choosePlan) off the deleted routes. Today they 404 and fall back to a calm "not on a lab plan" state (harmless, billing off).
4. Emile dogfood (after re-onboard + comp): connect gnick18/FungalICS_Website as a BYO site, starfish + chtc as tool pages, author a native home/people. `[[project_cofounder_lab_dogfood]]`.
5. Blocker 2 (lab .com 301) was FIXED by the lab-domains lane (proxy.ts middleware). Not open.

## COORDINATION + GOTCHAS (read before touching the tree)

- MULTI-AGENT DIRTY MAIN: `origin/main` moves fast; the shared main working tree often has UNCOMMITTED edits and UNTRACKED WIP files from other lanes (e.g. an untracked `frontend/src/lib/lab/class-dashboard-store.ts` from the Class Mode lane that does NOT compile yet, it is NOT on origin, leave it alone). Never `git add -A`; stage explicit paths only. Build in isolated worktrees (`git worktree add ... origin/main`, COW-clone node_modules with `cp -c -R`), commit on a branch, conflict-check, then merge.
- VERIFY BEFORE PUSH (`[[feedback_verify_merged_tree_before_push]]`): a sub-agent's branch-level "tsc 0" is NOT the merged-tree truth. After merging, run tsc on the MERGED tree as a STANDALONE step, and CLEAR stale `.next/types` first (`rm -rf frontend/.next/types`) or you get false TS2307 errors for deleted route files. Confirm the push actually landed (rev-list 0/0 + `git show origin/main:<file>`). A broken merge reached prod once this session before I caught it.
- The lab-domains lane (peer session "BeakerAI") owns proxy.ts + the lab-site routing/directory + GitHub-connect core. Coordinate (cross-session message) before editing those; flag overlaps.
- SECRETS + DB: pulling prod env (`vercel env pull`) and any raw prod DB write are BLOCKED by the safety classifier unless Grant explicitly authorizes in-chat, and even then prefer the operator console (the per-row gift button / Wipe account) over raw SQL. Read-only Neon queries are fine with Grant's OK; always delete the pulled `.env` after. Comps must use the STORED owner key (per-row gift button), email-gifting is pepper-broken until the clean-slate re-onboard.
- KEY FACTS: Emile lab owner key = `f362fd4b248cc51f594e8bb8085e5726b0cd29ee1d5c4ff36378354e7397f91b` (== his directory email_hash); Sullivan lab owner key = `4cbfe649e8cd6b7349f48f49b88ea586c2e079939953bf0a04bfc83ca1c22ddf`; Owen Sullivan email = osullivan@carleton.edu. These are OLD-pepper keys and will be wiped + replaced on re-onboard.

## Pointers
- Memory: `[[reference_directory_pepper_rotation]]`, `[[project_cofounder_lab_dogfood]]`, `[[reference_gb_ladder_retired]]`, `[[feedback_verify_merged_tree_before_push]]`, `[[feedback_dotcom_public_dotapp_gated]]`, `[[project_lab_domains_companion_sites]]`.
- Design docs: docs/proposals/2026-06-19-lab-site-network-presence.md, docs/proposals/2026-06-19-gift-card-premium-entitlement.md.
- Nothing of mine is running in the background at handoff time.
