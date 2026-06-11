# Cross-Boundary Sharing, Cost and Sustainability Report

> **SUPERSEDED for the funding model, current model is solidarity pricing** (individuals/labs
> cost recovery, dept/inst sustain the free tiers above bare cost via automated plan builders);
> canonical: docs/branding/BILLING_FACTS.md. The relay cost research and the LLC-vehicle
> findings here remain useful; treat any flat "cost-recovery / never profit" funding framing
> as historical.

Companion to CROSS_BOUNDARY_SHARING_PROPOSAL.md. Built from five focused research passes (2026-06-03), sources cited throughout. Purpose, decide how the relay is funded and through what vehicle, based on real numbers.

---

## Bottom line up front

The relay backend is so cheap that cost is not a real constraint at any scale ResearchOS will plausibly reach, and free academic credits can cover it outright for years. That removes the main reason to charge users. The recommended model is **free for everyone, funded by free credits plus voluntary donations routed through a UW Foundation gift account, with bring-your-own-storage as the escape valve for heavy labs.** No per-user payments, no payment processor in Grant's name, no business entity, and the locked "free for every lab" positioning stays intact.

---

## 1. The cost model

The relay does zero computation. It stores an encrypted blob, holds it up to 30 days, hands it to the recipient, and deletes it. So the only meaningful cost is object storage, and on Cloudflare R2 egress is free, which removes the usual scaling cost entirely.

Assumptions, shown as a typical case and a deliberately heavy case so the upper bound is honest.

| Assumption | Typical | Heavy |
|---|---|---|
| Share of users who actively send/receive across labs | 30% | 50% |
| Bundles received per active user per month | 10 | 20 |
| Average bundle size (with image/PDF attachments) | 5 MB | 15 MB |
| Resident storage (worst case, all held a full 30 days) | 1 month of inflow | 1 month of inflow |

R2 storage is 0.015 USD per GB-month, egress is free, and the first 10 GB of storage is free. Estimated relay storage cost per month, worst case (nothing picked up early, so everything sits the full TTL).

| Users | Monthly inflow (typical) | R2 storage cost (typical) | R2 storage cost (heavy) |
|---|---|---|---|
| 50 | 0.75 GB | 0 USD (free tier) | 0 USD (free tier) |
| 250 | 3.75 GB | 0 USD (free tier) | ~0.50 USD |
| 1,000 | 15 GB | ~0.08 USD | ~2.10 USD |
| 5,000 | 75 GB | ~1.00 USD | ~11.10 USD |

The other backend pieces.
- **Directory and mailbox index (Neon Postgres).** Tiny relational data (emails, keys, bundle rows). The free tier covers it well past 5,000 users. Roughly 0 to 0.50 USD per month.
- **Relay API (Vercel Functions).** A few function calls per share. Stays inside the Hobby free tier (1 million invocations) at every scale above. ~0 USD.
- **Transactional email (Resend).** Now only signup verification codes, since the in-app email-invite delivery was cut. Volume is low, one code per new account, so the free tier (3,000 per month, 100 per day) comfortably covers well past 1,000 users. Effectively 0 USD, with the 20 USD Resend Pro tier relevant only at a large signup spike.
- **Frontend hosting (Vercel).** The existing app, separate from this work. Hobby free or Pro at 20 USD per month, and very likely covered by the Vercel OSS credit below.

**Total realistic backend cost.** Effectively 0 USD per month up to a few hundred users. Around 0 to 20 USD per month at 1,000 users (the 20 being email if volume is high). Around 1 to 35 USD per month at 5,000 users worst case. For an academic tool, this never becomes a meaningful number.

---

## 2. Free credits that cover even that

- **Cloudflare R2 plus Workers free tier.** No application. 10 GB storage, 1 million Class A and 10 million Class B operations per month, free egress forever. Covers the entire relay backend at zero cost into the low thousands of users. This alone is the floor.
- **Vercel Open Source Program.** Roughly 3,600 USD in credits over 12 months, the Spring 2026 cohort is accepting applications right now, ResearchOS already runs on Vercel, and AGPL is not disqualifying. Covers the frontend hosting outright for a year. Time-sensitive, apply this week.
- **AWS Cloud Credits for Research.** Up to 5,000 USD for an enrolled PhD student, open-source development is an accepted use case, roughly 90 to 120 day review. A single award covers more than a decade of the heaviest relay scenario above.
- **Google Cloud Research Credits.** Up to 1,000 USD for PhD students, straightforward to stack alongside AWS.
- **GitHub Student Developer Pack.** 200 USD DigitalOcean credit plus more, free to claim with enrollment.

Conclusion, free credits plus permanent free tiers can plausibly cover the entire backend for the first several years with cash to spare. The cost-recovery rationale for charging users essentially evaporates.

---

## 3. Why a paid inbox is not worth it

The original idea was a small cost-recovery fee per inbox. The research kills it on two grounds.

- **The fee would be dominated by payment overhead, not storage.** A real inbox costs single-digit cents per year to store. But Stripe's floor is 0.50 USD per charge and its all-in rate is about 3.6 percent plus 0.30 USD, and PayPal's micropayments rate (4.99 percent plus 0.09) only applies to one-time charges, not subscriptions. The smallest economically defensible price is about 5 USD per year, at which fees still eat roughly 10 percent. So we would be charging 5 USD to recover pennies, which is not "exactly what it costs," it is a fee shaped entirely by the processor.
- **Abuse, the other rationale, is handled without payment.** Authenticated upload, a per-inbox quota, the 30-day TTL, and an abuse-report endpoint already bound abuse and cost. Payment is not needed as the gate. Firefox Send died from anonymous uploads and no abuse path, not from being free.

The Stripe nonprofit rate does not apply regardless, since it requires an actual 501(c)(3) and 80 percent of volume being donations.

---

## 4. Money vehicles compared

If money does flow (donations, not fees), here is how the vehicles stack up.

| Vehicle | Personal entity needed | Handles payments for you | Tax-deductible donations | Unlocks nonprofit infra perks | Overhead | Speed |
|---|---|---|---|---|---|---|
| **UW Foundation gift account (Fund 233)** | No | Yes (donors give at supportuw.org) | Yes | No | Low, no indirect costs on unrestricted gifts | Weeks |
| **GitHub Sponsors (personal)** | No | Yes | No (taxable personal income) | No | Very low | 1 to 3 days |
| **Fiscal sponsorship (NumFOCUS)** | No | Yes | Yes | No | Low | Closed until ~July 2026 |
| **Open Source Collective** | No | Yes | No (501c6) | No | Low | ~2 weeks |
| **Own 501(c)(3)** | Yes | Yes | Yes | Yes (Stripe rate, Google, Microsoft, TechSoup) | ~400 USD setup, ~100 USD/yr, needs a 3-person board | 4 to 8 weeks |

Key findings that shape the choice.
- **The UW Foundation gift account is the cleanest path for donations.** Unrestricted gifts carry no indirect-cost skim, Grant handles no payment infrastructure, and donors can designate the project. Set up in weeks through the Divisional Business Office. Two constraints, a gift cannot be quid-pro-quo (so it funds a free tool, it cannot be "pay for inbox access"), and gift funds cannot be paid directly to Grant as salary (his pay runs through the fellowship payroll separately).
- **The university is the wrong vehicle for per-user fees.** Selling a subscription to the public means the heavy Revenue Producing Activity approval path, full-cost-plus-overhead pricing that kills the simplicity, and Unrelated Business Income Tax exposure that needs the UW Tax Office's blessing. This is another reason the donation model fits and the paid model does not.
- **Fiscal sponsorship is not the unlock it sounded like.** It gives tax-deductible donations, but it does NOT unlock the Stripe nonprofit rate, Google for Nonprofits, Microsoft Azure credits, or TechSoup. Only Grant's own 501(c)(3) unlocks those, and universities are explicitly excluded from those programs too.
- **The one caveat to watch on the UW path is IP framing.** Keep the language "supporting open-source software built by a UW researcher," never "funding the university's research-data service." The former keeps the project Grant's independent AGPL work, the latter starts to look like a departmental service or sponsored deliverable and can pull the IP toward the institution. Gifts plus credits, framed as support for a free tool, stay clear of this.

---

## 5. Recommended funding model

**Free for everyone, no per-user payments in v1.**

1. **Run the backend on free tiers and credits.** Cloudflare R2 plus Workers free tier as the floor, with the Vercel OSS credit for the frontend and an AWS or Google research credit as a multi-year cash buffer. Out-of-pocket cost is effectively zero for years.
2. **Accept voluntary donations through a UW Foundation gift account**, framed as support for a free open-source research tool, plus a GitHub Sponsors button for instant low-friction giving. Neither requires Grant to run payment infrastructure or form an entity.
3. **Offer bring-your-own-storage as the escape valve** for any power lab that outgrows the free pooled inbox. They point the relay at their own R2 or S3 bucket and pay their own provider directly, which keeps cost aligned and our exposure flat.
4. **Control abuse with authentication, quotas, and TTL**, not with payment. Authenticated upload, a per-inbox size cap, the 30-day expiry, and a visible abuse-report endpoint.
5. **Revisit a 501(c)(3) only if the project earns real traction** and wants the big infrastructure grants and institutional credibility. It costs about 400 USD and needs a 3-person board, so it is a "later, if warranted" move, not a v1 requirement.

This preserves the locked "free and open for every lab" positioning, keeps Grant out of business-entity and payment-processor overhead, and is genuinely sustainable on credits plus modest gifts.

---

## 6. Action items

Time-sensitive, worth doing this week regardless of the v1 build timeline.
- **Apply to the Vercel Open Source Program (Spring 2026 cohort, open now).** Roughly 3,600 USD, covers frontend hosting for a year. Grant's to submit, the orchestrator can draft the blurb.
- **Read the RISE fellowship award letter for an IP-assignment clause.** This, not taxes, is the single real risk flagged across the payment and UW research. If it assigns IP, that changes the whole ownership picture and should be clarified with the OVCR (coiprogram@research.wisc.edu) before any funding move.

Lower urgency.
- Open a GitHub Sponsors account (1 to 3 days, no entity) as the immediate donation channel.
- Talk to the Divisional Business Office about a Fund 233 gift account for the donation page.
- Apply for AWS Cloud Credits for Research (90 to 120 day lead time, so start early).

---

## 7. Decision (locked 2026-06-03)

Grant chose the free-and-donations model with no per-user payments in v1. The backend runs on free tiers and credits, donations flow through a UW Foundation gift account plus GitHub Sponsors, abuse is handled by authentication plus quota plus TTL plus an abuse endpoint, and bring-your-own-storage is a later-phase escape valve rather than a v1 feature. This reinforces the locked "free and open for every lab" positioning. No payment processor, no business entity, no paid tier.
