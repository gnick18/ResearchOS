# Billing build-out handoff (2026-06-13)

Picks up the "Billing Build out" chat that hit the usage limit mid-wrap-up. Continued by a fresh session. All four org tiers (Member / Lab / Department / Institution) are now built and dark in prod; this session added the payer cascade and captured an open auth design decision for the dept/inst portals.

## Landed this session

**Org-tier payer cascade (`4a1ac1264`, `feat(billing): org-tier payer cascade`).** A non-gated resolution layer that decides who pays for a given account by walking member -> lab -> dept -> institution. Sits below the existing tier features; not behind a flag because it is pure resolution logic with no UI surface of its own. See `[[project_dept_institution_tier]]` for the full tier state (Phases 1, 2, and 4 all complete and dark behind `DEPT_TIER_ENABLED` / `INSTITUTION_TIER_ENABLED`).

## Open, unbuilt design decision: dept/inst portal auth

Grant raised this at the end of the session. The shape is decided, none of it is built.

The problem: a department or institution admin needs a durable way into the org portal that does not hang on one person's personal third-party (OAuth) account. Schools may not want a single named individual owning the org login, because that makes it hard for others to take over later.

**Decision (recommended shape):**

- **One mandatory root OAuth recovery account.** Exists only as the un-loseable key. Losing the everyday code never locks the org out, and this one identity can always reset the code. Exactly one, no more.
- **A resettable shared access code as the everyday door.** Hand it around, post it in the lab password manager, reset it when someone leaves. This is the day-to-day login, and it solves the real "do not depend on one person's Google account" problem.
- **Drop the multi-OAuth-with-approval idea.** It is the complicated path Grant already sensed. If per-person attributable logins are ever wanted, the cleaner later version is an in-portal allowlist (someone already inside adds `coworker@uni.edu`), because being inside already is the approval, so no external verification is needed. Later option, not v1.

**Two cautions, because this portal guards money and PII** (it shows every account name plus usage across the org and can change the plan):

1. The access code must be stored hashed, shown once at generation or reset, and rate-limited on entry. Prior art exists in the show-once recovery codes in the sharing-identity flow. Never store the plaintext.
2. Consider gating the highest-stakes actions (change plan or billing, rotate the recovery account) to the root OAuth account, leaving the code for roster, invite, and usage. A leaked code then cannot quietly re-route the bill. Optional, cheap defense in depth.

**Total-loss corner** (lose both the code and the OAuth account): true org loss, handled by support-mediated, out-of-band ownership verification (standard for billing entities). Optionally issue a set of one-time backup codes at creation (like 2FA backups) so losing the code alone is not fatal even without the OAuth account.

This is recorded as an open decision, not built. When it gets built it slots into the dept/inst portal entry (`/department`, `/institution`) alongside the existing invite-link and roster flows.

## Gate on go-live (unchanged)

Dept/inst billing (the Stripe recurring procurement invoice) is the heaviest unbuilt piece and is gated on Grant's Stripe products plus the WI sales-tax question, the same gate as lab go-live. None of the dept/inst billing exists in code yet, only the pricing copy.
