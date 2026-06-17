# Closing the lab-account funnel, the 3 real gaps

Status: build plan. Owner: PI-experience lane. Date: 2026-06-12.

## Context
The lab lifecycle (create lab, pay, invite, enroll, manage, reconcile billing) is ~90% built and wired behind `LAB_TIER_ENABLED` (off on main). Lab creation works end to end (AccountTierChooser -> LabCreateResume in AppShell -> createLabForCurrentUser -> lab_id + lab_head). The earlier "creation is broken" read was wrong (LabCreateResume is mounted). The genuine remaining gaps are narrow.

## Verified contracts (do not guess, mirror these)
- Mint a generic head-signed invite link: `mintInviteForHead({labId, username, identity, origin, ttlMs?})` -> `{invite, link}` (`src/lib/lab/lab-head-membership.ts:25`). The link is generic; the accepting member's OAuth email binds at accept time, so no recipient identity is needed to mint.
- Deliver an invite email: `POST /api/lab/invite-email { toEmail, senderLabel, labName, inviteUrl }` wraps the /lab/join link in the brand layout and sends via Resend. Gated on SHARING_ENABLED, per-IP rate limited, refuses non-own inviteUrls (`src/app/api/lab/invite-email/route.ts`).
- Look up an existing account: `GET /api/directory/search?q=<name or affiliation>` -> up to 20 profiles (pg_trgm), OAuth-gated, rate-limited (`src/app/api/directory/search/route.ts`). Also `api/directory/lookup` for direct lookups.
- Real lab usage: `GET /api/billing/lab` -> plan + roster + pooled storage/activity usage + sponsoredOwners (`src/app/api/billing/lab/route.ts`).
- The member-management panel that hosts the new UI: `src/components/lab-head/LabMembershipPanel.tsx` (already mounted in Settings under the LAB_TIER_ENABLED gate). Today it can mint a link and approve directory request-to-join, but invites are member-initiated and link delivery is manual.

## Task A, PI-initiated invite flow (folds in the email-auto-send gap)
In `LabMembershipPanel`, add an "Add a member" affordance with two paths, both ending in a sent invite:
1. Search the directory (`/api/directory/search?q=`) for an existing ResearchOS account, pick a result, invite them.
2. Enter any email address to invite a new person.
For both: `mintInviteForHead(...)` to get the link, then `POST /api/lab/invite-email` to deliver it to the inbox (the directory-lookup case uses the profile email when present, else falls back to the existing directory notify path / shows the copyable link). Keep the existing "Create invite link" copy-path as a manual fallback. Show a sent/pending state.
- Data shape: invites are generic, no new persisted field. Best-effort email send (a failure leaves the copyable link). FLAG if any new settings/sidecar field turns out to be needed.
- Gating: stays under LAB_TIER_ENABLED; email path needs SHARING_ENABLED.

## Task B, real billing/usage display
Swap `CloudStorageUsageSection`'s `STORAGE_USAGE_FIXTURE` (`src/components/settings/sections/CloudStorageUsageSection.tsx`, line 6/14) for a live fetch of `GET /api/billing/lab` (plan name, pooled storage used vs cap, activity vs allowance, member count). Graceful states: billing disabled (404) or no lab -> calm "not on a lab plan" copy, not an error. Keep the fixture only for demo/wikiCapture mode.

## Out of scope (yours, not buildable here)
- Flip `LAB_TIER_ENABLED` on main and go live. Blocked on the Stripe live-mode Wisconsin sales-tax determination.

## Verification
Both tasks gate on tsc + targeted vitest + icon-guard. End-to-end (create -> invite -> email -> join -> roster -> billing) needs real OAuth + the flag on, so it is a Grant-on-:3000 flagged smoke test, not orchestrator-verifiable. Land on main behind the flag (dark in prod) for that test. House style: no em-dashes, no emojis, no mid-sentence colons.
