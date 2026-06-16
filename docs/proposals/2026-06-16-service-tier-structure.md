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
- **Shared-folder workspaces** (work out of a folder synced on their own / institution cloud, costs us nothing, the free-lab path). This is async file sync, NOT live collab. The word "collab" / "collaboration" is reserved for the paid live relay feature, so free-tier copy never uses it.
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

A low-resource lab is already free (everyone makes free individual accounts and works out of a shared folder). Lab mode is optional paid quality-of-life: 30-day trial, then per-seat.

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
- **AI** is the separate token meter, unchanged (1.4x solo-lab, 2x dept), with the sign-up grant and packs. The model assumes only **20-40% of paid users actually buy AI** (default 30%); the rest never touch the metered product, so AI margin is scaled by that adoption rate.

## Why this is sustainable (the model says so)

Free users have no cloud produce feature, and the honest consequence (Grant 2026-06-16) is that **a free user does nothing that writes to us**: the local notebook is on their disk, shared-folder workspaces sync through their own cloud, receiving a share is sender-paid, reads have no R2 egress fee, and the public surfaces are cached. So the free-user recurring relay cost is **~$0**.

The only real free-user cost is the **one-time $0.25 AI sign-up grant**, which is a pure acquisition cost (Grant 2026-06-16): it is reported **separately as a one-time line** ("$0.25 x N free users x usage%"), never amortized into the monthly net. The grant only costs us inference if the account actually uses it, so it scales by a **free-grant usage rate** kept deliberately CONSERVATIVE/high (default **85%**, the 80-90% band) and SEPARATE from the 20-40% paid-AI adoption (trying a free gift is far more common than buying ongoing packs). So the recurring monthly free-user cost is **~$0**, versus ~$0.46/mo under the old GB model. So:

- A paying user carries **unlimited** free users on a recurring basis (free users cost ~$0/mo).
- **Recurring break-even is just the flat infra floor** (the free base adds no recurring cost); the only thing to "earn back" on the free base is the one-time $0.25/account.
- The seed tiers are net-positive at 50k users even at conservative conversion.

This makes the free base a fixed one-time acquisition cost plus a flat infra floor, not a per-user recurring drain. The model keeps a free-relay dial (default 0) only to stress-test "what if free users turn out chattier than expected" (which is the only thing that would make recurring break-even nonzero).

## Billing models under consideration (floated with Emile, 2026-06-16)

The tier structure above is *what* you pay for; this is *how* you're billed. Three models are on the table, not yet decided. Two facts shape all of them:

- **Show monthly, bill off an accrued ledger (Grant 2026-06-16).** We display a monthly price but keep a running ledger of what each account owes, collect a **card upfront**, and only run the card once the owed balance crosses a **~$5 minimum** (or immediately at cancellation, since the card is on file). That keeps Stripe's $0.30/charge from bleeding the revenue on tiny monthly charges (a $5 batch makes the fixed fee ~6% vs. a loss on a 20-cent charge). Applies to the POST-PAID models (A, B); C is prepaid and has no ledger. Optional safety: a once-a-year sweep so a sub-$5 balance never lingers forever (balances are pennies, so the float is negligible either way).
- **There is a MINIMUM/floor, and it is not usage.** A solo user's real cloud COGS is pennies (relay ~$0.01-0.08, storage pennies under local-first, AI only if used). The ~$5-6 is a **floor to make a paying customer worth processing** (clear the Stripe $0.30/charge + chip at the ~$260/mo flat overhead), so for most users it is mostly access + margin, not metered usage. Consequence: since usage << floor, a pure pay-per-use model and a flat access fee converge in practice.

**A) Post-paid usage + monthly minimum.** Free vs. paid, no paid tiers. Card on file at signup (SetupIntent + ToS mandate); usage billed, never pay for what you didn't use, with a settable monthly max. Collectible via the **accrued-ledger + $5 minimum** above (run the card only when the owed balance crosses ~$5) plus a **final invoice on cancellation** (auto-charge the card-on-file for the accrued balance when they cancel, which is how you collect from a month-3 churner). *Pro:* most honest, cheapest in a light month. *Con:* "billed per click" psychology; the floor means they usually pay it anyway; we carry receivable/collection + card-decline risk.

**B) Build-your-own commitment subscription.** The PI commits a $/mo amount based on expected usage, adjustable each month. *Pro:* most predictable revenue / lock-in (why ~99% of SaaS uses flat tiers). *Con:* onus on the PI to pick the right number; a lab over-pays when usage dips; month-adjustable undercuts the lock-in unless it is an annual commit.

**C) Prepaid "top-up" wallet (prepaid-phone style).** Load credit (e.g. $50); usage draws it down; top up when low; **no month, no commitment, no recurring bill**. *Pro:* zero bill-shock (only spend what you loaded), **zero receivable risk** (paid upfront, nothing to collect, no card-on-file-at-cancel needed), fee-efficient. *Con:* least predictable revenue; some dislike managing a balance. **Most consistent with what's built** — AI billing already works this way and storage is already prepaid blocks.

Status: floated with Emile for a gut check; decision pending. C (or a hybrid: small fixed access sub + prepaid credits for the variable storage/AI layer) is the current lean because it removes the collection problem entirely.

## Fixed business costs (Grant 2026-06-16)

The monthly net now charges the real fixed LLC overhead, not a flat placeholder. It is the sum of:

- **Infra floor, sourced from the operator console** (`capacity-shared.ts`): Cloudflare Workers $5 + Vercel Pro $20 = $25/mo, plus the recurring annual fees (Apple Developer $99/yr, WI LLC annual report $25/yr, **both domains** research-os.app $9.99/yr + research-os.com ~$10.44/yr) amortized to ~$12/mo. About **$37/mo**, imported so it never drifts from what the console tracks. (The second domain was added to the shared source 2026-06-16, so the admin InfraCostPanel and this model both pick it up.)
- **Operating overhead** (editable in the dashboard, seeded realistic): a permanent **Claude Max (~$200/mo)** that co-runs the company with Grant (site maintenance, fixes, marketing) and is kept on at every stage, the **Tello LLC phone — pay-per-use, ~$15/yr** (not a monthly sub; Grant almost never uses the number), **tax software for DIY filing ~$40/yr** (Grant self-files, no paid accountant), misc software + monitoring (~$20/mo). About **$224/mo**.

So the seeded total fixed base is **~$260/mo** (versus the old $28 placeholder), charged every month regardless of user count. Yearly items (Apple, WI report, both domains, Tello, tax software) are amortized to a monthly run-rate. Google Play's $25 is one-time, so it is correctly excluded.

**Fee gaps resolved (Grant 2026-06-16):** registered agent = **$0** (Grant is his own agent), business insurance = **none carried**, accounting = **DIY tax software only** (no paid accountant). The one remaining number to confirm with a real invoice is the exact research-os.com renewal (seeded $10.44).

**Pricing decision (Grant 2026-06-16): prices STAY at the current low seeds.** The measured relay footprint is far below the old 0.5M/0.6M estimate (writes are batched CRDT deltas per backup alarm, not keystrokes), which frees ~$0.70-0.90/seat of phantom COGS. That gain is banked as **margin cushion / a lower break-even seat count**, NOT spent on a price cut: prices are already very low, and a sub-$1 cut at $5-6 sits below the conversion threshold while it would push break-even back out. The wiggle room stays in reserve, available later only for a cleaner round price point or a more generous free tier if ever wanted.

**Owner taxes (Grant 2026-06-16).** The LLC is a single-member pass-through, so operating profit flows to Grant's personal return. The model applies ONE editable **effective tax rate on profit** (default **32%**, researched) to positive profit only, surfacing a **take-home (after tax)** line beside the pre-tax net. Because tax applies to profit, it is **zero at or below break-even and does not move the break-even point** — it only shrinks take-home above it.

The 32% default is a researched blend for a WI solo LLC at lower-six-figure profit (IRS + WI DOR, verified 2026-06): **self-employment tax ~14.1%** of profit (15.3% on the 92.35% SE base, SS capped at the $176,100 wage base), **federal income tax ~13-15%** effective after the 20% QBI pass-through deduction and the half-SE deduction, and **WI income tax ~4-5%** on the 3.50-7.65% graduated brackets (no separate WI SE tax). Planning band ~30-38%; the rate climbs with profit, so dial it up for high-scale scenarios.

**Subscriptions stay flat; provider services step up at different moments.** One permanent Claude Max co-runs ops at any company size (it does not grow with users, Grant 2026-06-16), and accounting/tooling are flat too, so they sit in the flat base. What grows is provider USAGE crossing each service's free tier — and crucially, **each service crosses at a different user count**, so the cost curve is a set of step functions, not one slope. The model itemizes each scaling service (`ScalingService`: a per-active-user usage rate + ascending cost tiers) sourced from the admin InfraCostPanel (free ceiling + next paid step, checked 2026-06-06):

| Service | Free tier | Per-user (seed) | Crosses at | Next step |
|---|---|---|---|---|
| Resend (OTP/invites/reminders) | 3,000 emails/mo | 2 emails | ~1.5k users | $20, then $90 at ~25k |
| Upstash Redis (rate limits + OTP) | 500k commands/mo | 40 commands | ~12.5k users | $10/mo |
| Vercel (edge requests above Pro's 10M) | 10M req/mo | 150 req | ~67k users | $20, then $60 |

Storage (R2 files + DO bytes) is à-la-carte pass-through and DO requests are already the per-write relay cost, so they are not double-counted; D1 and the Workers base are far off or already in the flat base. The per-user usage rates are editable seeds. So fixed costs step up at distinct moments: ~$296/mo base → +$20 at ~1.5k → +$10 more at ~12.5k → +$70 more (Resend $90 tier) at ~25k → ~$396/mo at 50k. `breakEvenUsers()` solves numerically because the expense has jumps; at the seed numbers the business breaks even around **~1.2k users** (just before Resend's first step), Conservative ~3.3k, Optimistic ~600. The chart's expense line shows the steps; the real ceilings live in the operator console.

## The model + dashboard

- Pure math: `frontend/src/lib/pricing/service-model.ts` (tested, `__tests__/service-model.test.ts`, 22 cases). Reuses the Stripe cadence helpers from `modeling.ts`, the cost constants from `assumptions.ts`, and the LOCKED AI rates from `billing/ai-config.ts`. AI margin is folded in on the paid side (1.4x individual/lab, 2x dept over our real $0.153/1M cost), and the one-time sign-up grant (~$0.25) is the free-side acquisition cost.
- Dashboard: the rebuilt `FinalizeTab` in `PriceModelingModal.tsx`, live at `/dev/pricing-finalize`. Left column = locked context (incl. the AI rates) + free-tier definition + the editable service-tier table (price, relay footprint, governance fee, per-tier AI margin) + dept economics. Right rail = streamlined scenario presets (Conservative/Base/Optimistic conversion + Solo/Lab/Dept-heavy mix), net-at-scale cards, the break-even-conversion headline, and three outcome plots: (1) **"When do we become profitable?"** -- a headline break-even-USER-count readout plus a revenue-vs-expense chart that auto-scales to the crossover, marks the break-even user count with a dashed line, and shades the profitable zone; (2) **break-even users by conversion scenario** (Conservative/Base/Optimistic side by side, with net at 50k); (3) a revenue-composition breakdown (subscriptions vs AI vs governance). `breakEvenUsers()` = fixed monthly cost / per-user net contribution.
- The legacy GB per-subscriber + sustainability tabs stay in the operator console for reference; they are not the go-forward surface.

## Open decisions for Grant

1. **Solo: one paid tier or two?** First cut is one ($6). A "Solo Pro" only earns its place if there is a real power-user allowance split.
2. **Lab/Dept pricing unit: per-seat or banded by headcount?** First cut is per-seat ($5). Bands (1-5 / 6-15 / 16+) read simpler on a pricing page but are coarser.
3. **Exact seed numbers** ($6 solo, $5 seat, $16 governance fee, the relay footprints). These are placeholders to tune in the dashboard.
4. **Does Solo include any a-la-carte backup allowance, or is all storage purely metered on top?**

Once these settle, the numbers go into `plans.ts` + `assumptions.ts`, the master bible gets written, and the dev page is deleted.

## Three pricing modes (Grant 2026-06-16) — Model A locked

Pricing model is **Model A (pay-for-what-you-use)**, LOCKED. Structure: a small base/floor + usage at a markup, AI metered at near-cost (1.4x/2x, ~3% of revenue), storage at-cost. The only knobs that vary between modes are the **base fee** and the **usage markup**; AI and storage are constant. Dept is the **Enterprise premium** lever (GitHub-Enterprise logic — depts are the only strong margin lever, gated on shipping governance/Commons/data-continuity). Floor is an additive base; 6-month billing off an accrued ledger with a ~$5 min charge + card-on-file (final-invoice-on-cancel).

Three modes were modeled and rendered into a review/share deck — `docs/proposals/2026-06-16-pricing-modes.html` (regenerate via `2026-06-16-pricing-modes.gen.py`), each with three plots (time-to-$5, break-even, revenue composition):

| Mode | Solo | Lab | Dept | Break-even (paying) | Net @ 50k | Net @ 100k |
|---|---|---|---|---|---|---|
| **Lean / benevolent** | $1 + 3x | $5 + 2.75x | $10/lab + 2.5x | ~180 | ~$3.6k/mo (~$43k/yr) | ~$90k/yr |
| **Fund-the-labs** | $3 + 5x | $12 + 4.5x | $25/lab + 4x | ~70 | ~$9.2k/mo (~$110k/yr) | ~$224k/yr |
| **Premium (academic)** | $6 + 8x | $25 + 7x | $50/lab + 6x | ~40 | ~$18k/mo (~$217k/yr) | ~$438k/yr |

Assumptions held constant: 5% conversion, 40/40/20 solo/lab/dept mix, ~6 seats/lab + 5 labs/dept, typical usage ~0.2M relay writes/seat/mo. Even Premium keeps a seat under ~$10/mo, a fraction of LabArchives alone ($27.50/user/mo). Philosophy in all three: better product, dramatically cheaper than the replaced tool stack, academics-first. **Open: Grant + Emile pick the mode (philosophy + ambition).** NEXT after pick: rebuild `service-model.ts` + dashboard around the chosen Model A params (mode-parameterized), then `plans.ts`/`assumptions.ts` + master bible.
