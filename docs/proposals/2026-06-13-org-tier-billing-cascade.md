# Org-tier billing: the payer cascade + procurement invoice

Status: design. The pure resolution layer is BUILT (`frontend/src/lib/billing/payer.ts`, tested). The Stripe wiring described here is the last, gated step (Grant's Stripe products + the Wisconsin sales-tax decision, the same gate as lab go-live). Nothing here charges anyone until `BILLING_ENABLED` plus the tier flags are on.

Companion to the proposal of record, [2026-06-13-department-institution-tier.md](2026-06-13-department-institution-tier.md), and grounded in the existing [LAB_SHARED_BILLING_POOL.md](LAB_SHARED_BILLING_POOL.md), [PRICING_COST_MODEL.md](PRICING_COST_MODEL.md), and `docs/branding/BILLING_FACTS.md` (the canonical customer-copy source).

## The two questions billing answers

These are separate and must not be conflated.

1. Where does usage POOL. A lab member's storage and write-ops aggregate into one shared lab pool against the PI's single allowance; a solo user pools into themselves. This is `resolveBillingOwner` in `lab.ts` and it does not change. It is a lab-tier concept and stops at the lab.

2. Who PAYS the invoice. Once org tiers sit above the lab, a lab can be sponsored by a department and a department by an institution. The payer is the highest tier present in the chain. This is the new `resolveBillingChain` / `resolveBillingPayer` in `payer.ts`.

Keeping them separate means the dept/institution layers never touch usage aggregation (still a per-lab pool, so the PI's allowance math is unchanged); they only redirect who the bill is addressed to.

## The cascade

```
member  ->  lab (PI owner key)  ->  department (dept_id)  ->  institution (institution_id)
```

Each hop is an existing active-row lookup in Neon, no DO and no crypto:

- lab hop: `getSponsoringLab` (member -> PI owner key)
- dept hop: `getDeptForLabHead` (PI owner key -> dept_id)
- institution hop: `getInstitutionForDept` (dept_id -> institution_id)

`resolveBillingChain(ownerKey)` walks them in order and returns the pool owner, the lab/dept/institution each if present, and a single `payer: { tier, id }` set to the highest tier found. Departments and institutions are billing ENTITIES keyed by their generated id, not owner keys, so the payer is a `{tier, id}` pair, not a bare owner key.

Resolution rule, highest wins:

| Chain present | Payer |
| --- | --- |
| institution | `{ institution, institution_id }` |
| department (no institution) | `{ department, dept_id }` |
| lab only (member, no dept) | `{ lab, PI owner key }` |
| nothing (solo / PI with no dept) | `{ self, owner key }` |

FAIL-SAFE: any error collapses the whole chain to self. A directory hiccup then bills the account on its own (subject to a cap) rather than escaping enforcement or mis-routing an invoice to the wrong org. This mirrors `resolveBillingOwner`'s existing fail-to-self contract.

One active sponsor per level is already enforced by the schema (one active lab per member, one active dept per lab head, one active institution per dept), so the walk is unambiguous.

## What the resolved payer drives

- Enforcement target. The throttle and cap already key off the pool owner; the org tiers change only the invoice recipient, not the pool the usage counts against. (If a future model wants pooled allowances at the dept/institution level, that is a separate proposal; today the lab pool is the enforcement unit.)
- Invoice routing. The recurring charge is addressed to the payer entity, not the individual.
- Dashboards. The dept and institution usage dashboards already roll up by reading down the same chain (`/api/dept/usage`, `/api/institution/usage`); the payer cascade is the write-side mirror of that read-side rollup.

## Procurement invoice (the gated Stripe step)

Departments and institutions do NOT pick fixed named tiers. They BUILD a plan (active labs/depts and pooled storage) and the monthly rate DERIVES from cost recovery plus a per-active-child sustaining contribution. The math lives in `lib/dept/plan.ts` (`deriveDeptRate`) and `lib/institution/plan.ts` (`deriveInstitutionRate`), the single source shared by the builder UI and, here, the invoice. The illustrative constants in those files are placeholders until `pricing/assumptions.ts` lands.

Unlike individuals and labs (Stripe hosted checkout, card), an org pays procurement-style:

- A Stripe Customer per dept/institution entity (keyed by dept_id / institution_id, stored alongside the roster row), not per person.
- A recurring subscription whose price reflects the derived rate, re-derived each month from the live plan inputs so a plan change takes effect on the next cycle (adjustable any month, no lock-in, per BILLING_FACTS.md).
- Invoice collection method `send_invoice` with net terms (PO number on the invoice), ACH or card, rather than auto-charged checkout.
- Wisconsin sales-tax handling (Stripe Tax vs manual) is GATED on Grant's decision; SaaS taxability varies by buyer type and exemption status (many universities are exempt with a certificate on file).

Webhook handling reuses the existing `stripe.ts` client + webhook-secret verification. Subscription lifecycle events update the entity's billing status; a lapsed org invoice should degrade gracefully (the cost circuit breaker pauses cloud writes, local-first keeps working) rather than hard-locking, consistent with [[feature_cost_circuit_breaker]] and the no-soft-locks rule.

## Build order when the gate opens

1. `pricing/assumptions.ts`: replace the placeholder rate constants in both plan files.
2. Stripe Customer per org entity + persist the customer id on the roster row.
3. Recurring subscription from the derived rate, `send_invoice` collection, net terms.
4. Sales-tax wiring per Grant's WI decision.
5. Webhook -> entity billing status -> circuit-breaker integration.
6. Live test on Stripe test keys, then flip live keys in prod (the lab go-live gate).

Steps 1 and the cascade resolution (this commit) are the only pieces buildable before the gate; the rest waits on real Stripe products + the tax call.
