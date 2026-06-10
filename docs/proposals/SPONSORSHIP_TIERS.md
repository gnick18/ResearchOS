# Sponsorship tiers (storage-as-thank-you)

Status: DRAFT for the billing manager to verify + lock. 2026-06-09. Author: branding agent.
Related: METERED_STORAGE_PRICING.md, LAB_SHARED_BILLING_POOL.md, project_stripe_setup,
project_sustainability_pricing_model. House style: no em-dashes, no emojis, no mid-sentence colons.

## The idea (Grant, 2026-06-09)

Instead of asking labs to donate out of pure altruism, give a proportional, tangible
reward: sponsor at a tier and your lab's shared cloud pool grows. A real benefit
converts recurring GitHub Sponsors far better than a tip jar, and the surplus over our
cost subsidizes free solo users and sustains the project after the fellowship ends.

Guardrail Grant set: income from a tier should be at least 2-3x the cost of what that
tier gives away. As shown below, storage is so cheap that this is easy to clear.

## Two lanes, kept visibly separate (the honesty model)

Our locked posture is "metered storage = cost recovery, not a profit center." A 2-3x
margin is margin, so we must not blur the two or it reads as a hidden markup. Keep them
distinct:

- **Metered storage (Stripe).** Strict cost-recovery, pass-through pricing for a lab that
  just needs more space and does not want to "sponsor." Unchanged by this proposal.
- **Sponsorship tiers (GitHub Sponsors).** "Support open-source science software; as a
  thank-you, your lab gets a bigger shared pool." The framing is supporting the project,
  not buying storage at a markup. The surplus funds the free solo tier and sustainability.

Both lanes are honest. The trap is presenting the sponsorship margin as "storage pricing."

## Proposed tier ladder

Free baseline is unchanged: every lab and every solo user gets a 1 GB shared pool.
Sponsor tiers ADD to the lab's pool. Numbers are proposals for the billing manager to lock.

| Tier            | USD / month | Lab shared pool | Other perks                          |
|-----------------|-------------|-----------------|--------------------------------------|
| Free            | $0          | 1 GB            | The default for every lab and solo.  |
| Supporter       | $5          | 10 GB           | Sponsor name on the open-source credits wall |
| Lab             | $10         | 25 GB           | + a higher monthly activity allowance |
| Research group  | $25         | 75 GB           | + a say in the feature roadmap (priority requests) |
| Department      | $50         | 200 GB          | + early access to new features        |
| Heavy / custom  | metered     | pay-as-you-go   | Beyond 200 GB, switch to the cost-recovery metered lane |

Notes:
- Storage is the headline reward; the non-storage perks ("and stuff") cost us nothing and
  deepen the lock-in (a credits-wall badge, a roadmap vote, early access).
- Monthly recurring is the target (the lock-in). GitHub Sponsors also allows one-time and
  annual; annual could carry a small thank-you discount, billing manager's call.
- Members are still free to the PI under the shared pool; we never sell seats.

## Margin math (clears the 2-3x rule with huge headroom)

Storage cost basis: the lab pool is the cheap end. Raw R2 is about $0.015/GB-month with no
egress. To be safe, the table also shows a deliberately conservative "loaded" cost of
$0.10/GB-month (about 6.7x raw, a cushion for Durable Object active-time and any overhead).
The billing manager should set the real loaded number; the tiers hold either way.

| Tier        | Pool GB | Cost @ $0.015/GB-mo | Margin | Cost @ $0.10/GB-mo | Margin |
|-------------|---------|---------------------|--------|--------------------|--------|
| Supporter $5  | 10 GB  | $0.15  | ~33x  | $1.00  | ~5.0x |
| Lab $10       | 25 GB  | $0.38  | ~27x  | $2.50  | ~4.0x |
| Research $25  | 75 GB  | $1.13  | ~22x  | $7.50  | ~3.3x |
| Department $50| 200 GB | $3.00  | ~17x  | $20.00 | ~2.5x |

Even at the conservative loaded cost, every tier sits at or above the 2.5x floor; at the
real storage cost they are 17-33x. The constraint is NOT affordability, it is making the
reward feel generous without giving so much that a heavy lab never reaches the metered lane.
The $50 / 200 GB top tier is the deliberate ceiling before metered takes over.

## "What your sponsorship funds" framing

A solo user's free 1 GB costs us at most about $0.015 to $0.10/month. So a single
Department sponsor ($50) covers, very conservatively, the cloud cost of hundreds of free
solo researchers (about 500 at the loaded cost, thousands at the real cost). That is the
honest, compelling line for the PI: your lab's sponsorship keeps the tool free for the
labs that cannot pay. Present it as a range or "hundreds," not a hard number.

## Fulfillment (reuses infra we already built)

The lab pool, the cap, and a gift / cap-raise mechanism already exist (the admin
`GiftPoolsPanel`). So "sponsor at tier X raises that lab's cap by N GB" is mostly wiring
the donation channel to the existing gift mechanism.

- **v1, manual (ship first).** PI sponsors on GitHub, then tells us their lab (email or lab
  id). The operator raises that lab's cap by the tier's GB via the existing gift panel.
  Fine at low volume; no new code beyond a small intake form.
- **v2, automated.** A GitHub Sponsors webhook (sponsorship created / tier-changed /
  cancelled) maps the sponsor to their lab and auto-adjusts the cap. Needs a sponsor-to-lab
  identity link (the sponsor confirms their lab on first sponsor).
- The money channel (GitHub Sponsors payout) and the storage fulfillment (the app's gift
  mechanism) are decoupled, which is fine; one need not gate the other.

## Flags for the billing manager (verify before locking)

1. **Real loaded cost.** Confirm the all-in cost per GB-month for the pool including
   Durable Object active-time and any egress, so the GB-per-tier is locked on real numbers,
   not the $0.10 placeholder.
2. **It is a sale, not a charitable donation.** ResearchOS LLC is a for-profit LLC, so none
   of this is tax-deductible regardless. More importantly, giving a tangible benefit
   (storage) in exchange for payment makes a tier a SALE / subscription, not a gift. Do NOT
   call it tax-deductible.
3. **Sales-tax gate.** Because it is a sale of a cloud service, it ties directly into the
   PENDING WI DOR sales-tax determination (the HARD GATE in the business tracker). Do not
   launch paid sponsorship tiers until that determination lands and the sales-tax handling
   is set. This is the real blocker.
4. **Activity allowance per tier.** The "higher monthly activity allowance" perk needs real
   numbers from the activity-throttle model (out of scope of the storage pool).
5. **GitHub Sponsors vs Stripe.** We already have Stripe live for metered storage. Decide
   whether sponsorship tiers run on GitHub Sponsors (better "support open source" framing,
   separate payout) or fold into Stripe (one payment system, one tax pipeline). The framing
   benefit of GitHub vs the operational simplicity of one Stripe pipeline is a real
   trade-off for the billing manager.

## Marketing copy (draft, for the GitHub Sponsors tier descriptions)

- **Supporter, $5/mo.** "Back free, open science software and keep a photo-light lab fully
  synced. Your lab's shared cloud pool grows to 10 GB, and your name joins the open-source
  credits wall."
- **Lab, $10/mo.** "For a small, active lab. A 25 GB shared pool, a higher activity
  allowance, and you help keep ResearchOS free for labs that cannot pay."
- **Research group, $25/mo.** "A busy, image-heavy lab with room to spare. A 75 GB shared
  pool and a say in what we build next."
- **Department, $50/mo.** "A big shared workspace and early access to new features. At this
  tier you are substantially funding the free tier for hundreds of solo researchers."

All copy follows house voice: no "free forever," no "we will never charge," storage framed
as a thank-you for supporting the project, never as buying space at a markup.
