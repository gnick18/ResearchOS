# Cost guardrails setup (operator checklist)

Two layers protect against a runaway provider bill. This is the part only you can
do, the PROVIDER HARD CAPS (Layer 1), plus arming the in-app breaker (Layer 2,
already built). Work top to bottom; the first item is the most important.

Pick a number first. Decide the most you are willing to eat in a bad month
across everything, e.g. $50. Size each provider cap below it, and set the in-app
breaker budget to roughly that total. During the tiny beta these can be low.

House style note: dashboards change their menus often. Where a path below is
slightly off, search the provider's settings for the named feature in quotes.

---

## 1. Vercel Spend Management (the strongest single guard, do this first)

This can HARD PAUSE the project when spend hits a limit. The project is on the
Pro plan as of 2026-06-07, so this is now both available and important. Pro bills
overages beyond the $20 of included monthly usage, unlike Hobby which had fixed
free caps and no overage, so setting a hard spend cap is the main thing standing
between you and a runaway bill. Do this now.

1. Go to https://vercel.com/dashboard
2. Open the ResearchOS team/project, then Settings.
3. Find "Billing" in the left settings nav, then "Spend Management" (sometimes
   under Billing > Usage, or a top-level "Spend Management").
4. Set a monthly spend amount (suggest $25-50 for beta).
5. For the action when the limit is reached, choose to PAUSE the project /
   deployments (not just notify). This is the hard stop.
6. Add your email for the alert. Save.

Verify: the setting shows an active limit + "pause" action.

---

## 2. Cloudflare usage alerts (no hard cap exists, so alerts + the in-app breaker)

Cloudflare Workers / Durable Objects / D1 / R2 have NO hard spend cap. The best
you can do here is alerts; the in-app breaker (Layer 2) is what actually pauses
cost on the Cloudflare side.

1. Go to https://dash.cloudflare.com
2. Top-level "Notifications" (left nav, account level).
3. "Add" a notification. Look for billing/usage types, e.g. "Billing usage alert"
   or Workers usage notifications.
4. Set a threshold (suggest alerting at $10 and again at $25) and your email.
5. Save. Repeat for any per-service usage alert offered (Workers, R2).

Verify: at least one billing/usage notification is enabled with your email.

---

## 3. Neon limits (the most expensive per-GB tier historically)

1. Go to https://console.neon.tech
2. Open the ResearchOS project, then Settings.
3. Find the billing / usage limits area. Set:
   - A compute autoscaling MAX (cap the max compute units so a spike cannot scale
     compute without bound). Keep it small for beta.
   - A storage limit if offered.
4. If Neon offers a spend cap / budget alert, set it (suggest $10-15).
5. Save.

Verify: a max-compute (autoscaling ceiling) is set.

Note: the storage migration is moving collab off Neon onto Cloudflare D1/DO/R2
(see infra-tiers), so Neon exposure is shrinking, but set the cap while it is
still in the path.

---

## 4. Upstash (Redis) cap

1. Go to https://console.upstash.com
2. Open the database used by ResearchOS (the relay rate-limit store).
3. In its settings, set a "Max Monthly Cost" / budget cap and/or a daily request
   limit if offered (suggest a low cap for beta).
4. Save.

---

## 5. Arm the in-app cost breaker (Layer 2, already built)

This pauses CLOUD WRITES (collab + relay) when the estimated monthly cost reaches
your budget, while the local-first app keeps working. It is INERT until you set a
budget.

1. Sign in with your operator (ADMIN_EMAILS) account.
2. Go to /admin/business.
3. In the "Cost circuit breaker" panel, enter a Monthly budget (USD). This caps
   VARIABLE cost (storage + activity), not the fixed base, so keep it low and
   below your Vercel cap, e.g. 20. Click "Save budget".
4. Optional: click "Trip now (test)" to confirm cloud writes pause, then "Reset
   breaker" to clear it. (Local editing keeps working while tripped.)

Verify: the panel shows your budget and state "OK". The hourly cron will trip it
automatically if the estimated cost ever reaches the budget; reset is manual.

---

## Quick reference (suggested beta numbers, adjust to taste)

| Guard | Where | Suggested |
|-------|-------|-----------|
| Vercel Spend Management (hard pause) | Vercel > Billing > Spend Management | $25-50 |
| Cloudflare usage alerts (alert only) | Cloudflare > Notifications | alert $10 / $25 |
| Neon max compute + spend | Neon > project Settings | low ceiling, $10-15 |
| Upstash monthly cap | Upstash > database settings | low cap |
| In-app breaker budget (pauses writes) | /admin/business | ~$20 variable, below the Vercel cap |

Do not skip the Vercel hard pause and the in-app breaker budget, together they
are the real stop. The alerts are early warning.

Note on the breaker number: the budget now guards VARIABLE cost (storage above
free tiers + activity) only, not the fixed monthly base (Workers + Vercel). So
set it LOW (e.g. $20) and BELOW the Vercel hard cap, so the graceful writes-only
pause fires before Vercel takes the whole site offline. Current settings: Vercel
$25 hard pause, breaker $20 variable.
