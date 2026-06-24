# Next three: builder deploy-history, network feed/follow, PI billing forecast

Status: Grant-approved 2026-06-20 in his ranked order. Pre-flag for the three
data-shape changes before the write paths ship. Owner lane: BeakerAI. House
voice: no em-dashes, no emojis, no mid-sentence colons. Each ships behind a flag,
built on a branch, merged-tree verified, then a single Grant-gated deploy.

## 1. Builder deploy-history + Restore (citation permanence)

Today `lab_site_pages` keeps ONE row per (lab_owner_key, path); publish bumps a
`version` integer but the PRIOR published body is overwritten in place, so an old
companion-site version is gone and a citation to it can 404. Fix: keep every
published version.

DATA-SHAPE (additive, idempotent): new table `lab_site_page_versions`
(lab_owner_key, path, version, title, body_md, blocks_json, snapshots_json,
hosted_json, published_at, PRIMARY KEY (lab_owner_key, path, version)). On each
publish, snapshot the just-published representation into this table (in addition
to the live row). Restore = copy a chosen version back into the live row and
publish it as a new version (never destructive, the restored-from version stays
in history). No change to the public render contract (it still reads the live
row); history is read only by the owner dashboard.

UI: a "Deploy history" list per page in the dashboard (version, published_at,
draft/live marker) with a Restore action behind a confirm. Rides the existing
LAB_SITES flag (the builder is already live, this is additive capability).

## 2. Network feed + follow graph (turn /network real)

The /network feed and "people you may know" are placeholders. Make them real.

DATA-SHAPE (two additive idempotent tables):
- `feed_events` (id text PK, actor_owner_key, kind, subject_type, subject_id,
  subject_label, target_slug, created_at). kind in (site_published,
  work_shared, lab_joined, ...). NO private content, only public facts (a
  published site, a public lab join), since the feed is shown to signed-in users
  but must never leak private data. Emitted fire-and-forget so a failed feed
  write never breaks the source action.
- `follow_edges` (follower_owner_key, followee_owner_key, created_at, PRIMARY KEY
  (follower_owner_key, followee_owner_key)). The follow graph. A follow is a
  1-click action from a profile/search result.

EMIT POINTS: site publish (lab-site publish path), work shared to a researcher
(share-recipient path), lab join. The publish emitter is wired by the orchestrator
on integration (it shares a file with build 1, so build 2 does NOT touch the
publish path, it ships the emitter helper + the non-publish call sites + the read
+ UI).

READS: `getNetworkFeed(viewerOwnerKey)` = recent events from people the viewer
follows plus their own labs (fallback to a global recent feed when the viewer
follows no one yet, so the feed is never empty for a new user);
`getFollowSuggestions(viewerOwnerKey)` = listed researchers the viewer does not
yet follow (same-institution first), excluding self + already-followed.

UI: replace the two NetworkAppShell placeholders with the real feed + suggestions.
Behind a NEW flag NEXT_PUBLIC_NETWORK_FEED (default off), falling back to the
current placeholder when off, so it ships dark and flips when verified.

## 3. PI billing forecast + history (money transparency)

The new lab-site usage panel shows current hosting $/mo, but a PI has no single
projected monthly charge or past-charge view. NO schema change, reads existing
data.

- Forecast: reuse `periodCharge(plan, usage)` (model-a/pricing.ts) on the CURRENT
  period's live usage (pool writes + stored bytes + hosted bytes) to show a
  projected month-end charge, broken down (base + usage + storage + hosted). The
  cost circuit-breaker cap (enforcement.ts) is shown alongside.
- History: read `cloud_usage_ledger` (accrual + charge + credit rows) for a
  past-charges/receipts list with running balance.
- A read route mirroring the gating of `/api/billing/model-a/status`, owner-only.
- UI: a Billing forecast + history section in Settings, next to
  `CloudStorageUsageSection` / `AiUsageSection`. Behind the existing billing flag.

## Verification + go-live

Each builds on a branch, reports back. Orchestrator integrates onto one branch,
verifies the MERGED tree (tsc + vitest + icon-guard), wires the shared publish
feed-emitter, then a single Grant-gated merge + push + deploy. Pricing untouched
[[feedback_pricing_decisions_locked]] [[feedback_keep_billing_facts_current]].

Related: [[project_lab_domains_companion_sites]], [[project_researcher_social_layer]],
[[project_ai_billing_build]], [[feedback_copy_state_the_why]], [[feedback_no_soft_locks]].
