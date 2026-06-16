# Service-tier structure (Path A) — first cut

Status: first stab for Grant to react to, 2026-06-16. Supersedes the GB-gradation ladder. Pairs with [the Path-A pivot handoff](../handoffs/2026-06-15-pricing-path-a-cloud-services-pivot.md), the dept governance tier (`2026-06-15-dept-inst-governance-tier.md`), and the live model at `/dev/pricing-finalize`.

House style: no em-dashes, no emojis, no mid-sentence colons.

## The principle (locked)

ResearchOS is a local-first cloud-SERVICES company, not a storage-by-GB vendor. The billing meter only ever counted live-collab CRDT bytes (a local user is ~0 GB), and selling our-cloud-GB contradicts both the dept Model-B pitch (your data on your own institution cloud) and the local-first identity. So:

- **Paid tiers buy SERVICES the relay uniquely enables** (send, live co-edit, phone capture, push, governance), not gigabytes.
- **Storage is a-la-carte at ~1.15x cost** (covers Stripe + R2 + buffer), never a profit center. That at-cost stance is itself the trust-flip: we have zero incentive to lock you into our cloud.
- **AI keeps its own token meter** (1.4x solo-lab, 2x dept).
- **Per-object opt-in is sacred** (a 10 GB mass-spec run stays local and visible, never auto-pushed; never an all-or-nothing cloud mode).
- **Free users get no cloud produce feature**, so the free base is cheap, which is what makes the model sustainable at realistic conversion.

## The four audiences

Institution is punted for beta (the Commons does not scale to a whole institution). Beta = **Free / Solo / Lab / Dept**.

### Free ($0) — the network audience (consume + be present)

The cheap RECEIVE/PRESENCE side that makes paid worth buying. Free users are the audience that gives the paid send/collaborate features their value.

- Unlimited **local notebook** (the product, forever, on your disk).
- **Shared-folder async collaboration** (their own / institution cloud, costs us nothing, the free-lab path).
- **Network profile + directory presence** (discoverable, opt-out).
- **Receive cross-boundary shares** (snapshot lands local; the SENDER bears the relay cost).
- **In-app receipt notifications** (not phone push).
- **Accept folder / lab invites** (be a member, contribute through the shared folder).
- **All public surfaces** (open library / Commons assets, wiki, calculators, demo).
- AI: the one-time sign-up grant, then pay-as-you-go packs (available to anyone).
- NOT included: send through our relay, real-time relay collab, phone capture, push, backup.

### Solo (one paid tier) — produce + lead, for one person

Recommend a single paid solo tier (Grant leaned "Free / Plus, one paid cloud tier" rather than four). Unlocks the full produce side for an individual:

- Send cross-boundary shares, real-time relay collaboration, phone capture (companion pairing/sync), push.
- AI metered at 1.4x (plus optional packs).
- Optional a-la-carte backup storage.
- **Seed price: $6/mo** (billed 6/12-month).
- Optional second "Solo Pro" only if power users need bigger relay/AI allowances. Left out of the first cut for simplicity.

### Lab (per active seat) — optional QoL on top of free individuals

A low-resource lab is already free (everyone makes free individual accounts and collaborates through a shared folder). Lab mode is optional paid quality-of-life: 30-day trial, then per-seat.

- Per member: all Solo services.
- Plus lab-level: central management dashboard, shared lab library, pooled AI/relay budgets, member management, lab-wide relay collab.
- **Seed price: $5 / active member / mo** (billed 6/12-month). A 6-person lab is ~$30/mo.
- Trial expiry = graceful downgrade to the free local/shared-folder mode, never a lockout.

### Dept (per seat at lab parity + per-lab governance fee) — the governance product

Sells governance, not charity. Storage at parity with a standalone lab (no surcharge); the flat per-lab fee is the margin and funds the free tier.

- Everything Lab gives each member, plus the governance layer: Department Commons (governed structured shared protocols/databases/plasmid repo), storage compliance (Model B, provider-agnostic), per-lab budget controls, central admin dashboard, SSO/lifecycle, data continuity.
- **Seed: $5/seat (lab parity) + $16/lab/mo governance fee.** A 10-lab dept at 6 members each is 60 x $5 + 10 x $16 = $460/mo.

## Where storage and AI sit

- **Storage** is a-la-carte for anyone who wants us to hold a backup (e.g. a grad student with no institutional cloud), at ~$0.06/GB retail (1.15x blended cost). It is a convenience line, never a tier axis and never in the service margin.
- **AI** is the separate token meter, unchanged (1.4x solo-lab, 2x dept), with the sign-up grant and packs.

## Why this is sustainable (the model says so)

Because free users have no cloud produce feature, a free user costs us only a thin relay footprint (receiving sender-paid snapshots + directory presence), about **$0.08/mo** at the seed assumptions, versus ~$0.46/mo under the old GB model. So:

- One paying user carries on the order of **60+ free users** (was ~11).
- **Break-even conversion lands under 3%** (was ~15% at a 1M free write cap), which is realistic for freemium.
- The seed tiers are net-positive at 50k users at 5% conversion in the projection.

The #1 beta unknown is unchanged in spirit but smaller in magnitude: the real relay footprint of a free user (here assumed tiny because produce features are gated).

## The model + dashboard

- Pure math: `frontend/src/lib/pricing/service-model.ts` (tested, `__tests__/service-model.test.ts`, 16 cases). Reuses the Stripe cadence helpers from `modeling.ts` and the cost constants from `assumptions.ts`.
- Dashboard: the rebuilt `FinalizeTab` in `PriceModelingModal.tsx`, live at `/dev/pricing-finalize`. Left column = locked context + free-tier definition + the editable service-tier table (price, relay footprint, governance fee) + dept economics. Right rail = the profit-vs-expense-at-scale chart with conversion + Solo/Lab/Dept mix knobs, net-at-scale cards, and the break-even-conversion headline.
- The legacy GB per-subscriber + sustainability tabs stay in the operator console for reference; they are not the go-forward surface.

## Open decisions for Grant

1. **Solo: one paid tier or two?** First cut is one ($6). A "Solo Pro" only earns its place if there is a real power-user allowance split.
2. **Lab/Dept pricing unit: per-seat or banded by headcount?** First cut is per-seat ($5). Bands (1-5 / 6-15 / 16+) read simpler on a pricing page but are coarser.
3. **Exact seed numbers** ($6 solo, $5 seat, $16 governance fee, the relay footprints). These are placeholders to tune in the dashboard.
4. **Does Solo include any a-la-carte backup allowance, or is all storage purely metered on top?**

Once these settle, the numbers go into `plans.ts` + `assumptions.ts`, the master bible gets written, and the dev page is deleted.
