# Lab dormancy lifecycle (lapse, retain, reactivate)

Status: design, locked decisions below, ready to build in phases. Author: Billing lane, 2026-06-17.

## Goal

A lab head whose payment lapses should drop to a free individual account WITHOUT losing the lab. The lab goes dormant, not deleted. We keep every lab setting and the whole sharing graph, just stop hosting the live cloud features. Reactivation (paying again) brings everything back instantly, and former members get a push asking if they want to rejoin. Plus a gentle countdown so a lab head is never surprised by a lapse.

This pairs with the no-card-up-front decision (2026-06-17). A new lab gets a 30 day full-access trial, then converts at the natural moment, and if it never converts it lapses gracefully into this dormancy flow.

## Locked decisions (Grant, 2026-06-17)

1. On lapse, the lab head lands on FREE individual (a failed or stopped payment cannot fund paid Solo anyway). Their own data is local, so it stays usable. They restore the lab, or pick paid Solo, once billing is fixed.
2. Members revert to their own Free/Solo account and keep ALL their local data, with a gentle heads-up that lab cloud sync and sharing have paused. The membership and sharing graph is PRESERVED (rows kept, live features off), not torn down.
3. On reactivation, every former member gets a push notification that the lab is back, asking if they want to rejoin (one tap). Because the graph was preserved, rejoin re-lights existing shares rather than rebuilding them.
4. Dormant labs are retained INDEFINITELY until the head reactivates or explicitly deletes. A dormant lab's cloud footprint is tiny (settings, roster, slug), so there is no cost pressure to purge.
5. Nothing is deleted on lapse. Dormancy is a state flip, never a data wipe. (The admin full-account wipe is the separate, explicit, operator-only path.)

## What already supports this (no work needed)

- Lapse already reverts `billing_subscriptions.plan_id` to `free` + `status = inactive` and deletes nothing (`webhook/route.ts`). So the lab rows already persist after a lapse.
- Plan resolution already maps a non-active subscription to `free`, which already revokes produce features (send, co-edit, app pairing) via the existing gates. So "stop hosting the live features" is already the effect of dropping to free.
- Calendar links, tasks, purchases, and all content are LOCAL on the user's disk (`_calendar-feeds.json`, `users/<u>/tasks`, `users/<u>/purchases`, content stores). They survive any cloud mode switch automatically. The "90% of settings transfer" is mostly free because it never left the disk.
- The membership table `billing_lab_members` and the sharing graph persist on lapse already. We just must NOT tear them down.
- The `UpgradeNudge` dismissible-card pattern (pub/sub + cooldown + root mount) is reusable for the countdown and lapse warnings.
- `getLabLapse(labOwnerKey)` already reports `{ lapsedAt }` from the subscription status.

## What is net-new

### A. Dormancy state (data-shape change, FLAG)

There is no `status`/`dormant` column on any lab-level row today. Add an explicit lifecycle so the system KNOWS a lab is dormant (versus never-existed) and can drive the right UI.

FLAG (new fields): add to `billing_subscriptions` (the PI row) a `lifecycle text` in `active | trialing | dormant | reactivated` and a `dormant_since timestamptz null` and `trial_ends_at timestamptz null`. Keep it on the existing row rather than a new table, since one PI = one lab billing row. Idempotent `ensureSchema` add-column, no backfill needed (null = legacy active).

State machine:
- `trialing` (trial_ends_at set) -> on convert -> `active`; on trial end with no card -> `dormant`.
- `active` -> on sub canceled / past_due / accrual charge repeatedly failing -> `dormant` (dormant_since = now). Plan still resolves to free, so features are already off; the marker is what makes it a recoverable lab rather than a bare free user.
- `dormant` -> on pay again -> `reactivated` -> `active`.

### B. Gentle warnings (trial countdown + lapse notice)

Reuse the UpgradeNudge card pattern, new trigger = a session-startup check against `trial_ends_at` / `getLabLapse`, new copy, lab-head context:
- Trial: a calm banner from ~7 days out ("Your lab trial has N days left. Add a card to keep the lab running, nothing is charged until you actually use cloud services."), escalating gently at 3 days and 1 day. State the why, no scare copy.
- Lapsed: a one-time-per-period notice ("Your lab is paused. Your data is safe and nothing was deleted. Reactivate any time to bring the lab and your members back.") with a Reactivate action and a "Stay solo for now" dismiss. No soft-lock, both exits visible.

### C. Account-mode switch + reactivation actions (server)

- `dormantizeLab(labOwnerKey)`: set lifecycle = dormant + dormant_since, leave plan free, leave `billing_lab_members` / `directory_labs` / `slug_registry` / `lab_sites` rows in place (mark the companion site as serving a gentle "this lab is currently inactive" placeholder, not a 404, per no-soft-locks), notify members (D). Idempotent.
- `reactivateLab(labOwnerKey)`: requires a fresh successful charge / card-on-file, set lifecycle = active, re-light the companion site + collab pool, fire the member rejoin push (D). Instant because nothing was deleted.
- Voluntary "just keep me solo" stays available too (the head can choose paid Solo instead of free); same dormantize path for the lab.

### D. Member notifications

- On dormancy: a gentle in-app + (if enabled) push heads-up to each active member, "Lab X paused, your data is safe on your computer, sync is off for now."
- On reactivation: a push to each former member, "Lab X is active again, rejoin?" with one-tap rejoin that re-activates their preserved `billing_lab_members` row and re-lights their shares. Reuses the existing notification/relay rails.

### E. Companion site dormant placeholder

While dormant, `lab_sites` serves a calm "this lab is currently inactive" page (kept, not deleted), so an external link never hard-404s. Restored instantly on reactivation.

## Phasing

- Phase 1 (data + resolution): the lifecycle column + state transitions + `dormantizeLab` / `reactivateLab` server actions, fully unit-tested, flag-gated. No UI yet. This is the data-shape change, so it merges only after verification.
- Phase 2 (warnings): trial countdown + lapse notice cards (UpgradeNudge variant) + the session-startup trigger.
- Phase 3 (members): dormancy heads-up + reactivation rejoin push + one-tap rejoin.
- Phase 4 (companion-site placeholder + polish + wiki).

## Open micro-decisions (recommend, not blocking)

- Trial length = 30 days (Grant, earlier). Adjustable constant.
- Grace between a failed charge and flipping to dormant = CONFIRMED (Grant, 2026-06-17): a 7 day "we could not charge your card" grace with retries before dormancy, so a transient card failure never dormantizes a paying lab. Stripe Smart Retries handles the dunning, and the lab stays fully active during the grace.
- Trial applies to Lab tier (the countdown is a lab-head surface). Solo has no trial (it is cheap + pay-as-you-go from day one).
