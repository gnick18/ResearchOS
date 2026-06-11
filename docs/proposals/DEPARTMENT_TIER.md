# Department-as-container (sponsorship hierarchy, design intent)

> **LIVE spec for the institutional channel of the SOLIDARITY model.** Departments and
> institutions are the SUSTAINING tier: they pay a modest rate ABOVE bare cost through an
> automated self-serve plan builder on `/pricing`, billed by an auto recurring Stripe
> invoice to procurement, and that surplus keeps ResearchOS free for individual
> researchers and funds the open-source development. (GitHub Sponsors cannot invoice a
> university, which is why this channel exists.) Canonical customer copy:
> `docs/branding/BILLING_FACTS.md`. The word "sponsorship" in this older doc means the
> institutional sustaining contribution, not GitHub Sponsors.

Status: DESIGN INTENT, not a build order. 2026-06-09. Author: billing manager,
from Grant's observation about who actually pays. Companion to
SPONSORSHIP_TIERS.md (kept separate so the branding agent owns that doc).
Related: LAB_SHARED_BILLING_POOL.md, project_sustainability_pricing_model.

House style: no em-dashes, no emojis, no mid-sentence colons.

## Why a department tier

The buying unit in this market is institutional. LabArchives (our main competitor)
is bought overwhelmingly by a department or a campus, not by individual PIs paying
out of pocket. A ladder aimed only at individual labs fishes in the smallest pond.
The DEPARTMENT is the right unit to design for. Whole-university is deliberately
OUT of scope (enterprise procurement, security reviews, multi-year contracts, a
different sales motion). Department is the sweet spot, big enough to be the real
payer, small enough to close with one champion.

## The reframe

In SPONSORSHIP_TIERS.md the top tier is just a bigger SINGLE-lab pool. The better
model is a department as a CONTAINER of labs, one payer above several lab pools.
That is one more level of the hierarchy, not another rung on the same ladder:

  department -> labs (PIs) -> members

## How it maps onto the as-built engine

The whole engine is already "resolve to the paying entity, the pool aggregates
downward." The department is the same trick one level up.

- Today: `resolveBillingOwner(member) = the member's PI`. One shared lab pool, the
  PI pays.
- Department extension: `resolveBillingOwner(PI) = the PI's department` when the PI
  is in one. Resolution becomes two-level: member -> PI -> (department or PI). The
  pool (getLabPoolUsage / getLabPoolWrites) sums across every lab in the
  department. The department admin adds approved lab heads with the SAME
  invite/approve pattern a PI uses to add members, just a `billing_dept_labs`
  table instead of `billing_lab_members`.

So this is an extension of machinery that exists, not a new system. The one thing
to decide up front: whether `resolveBillingOwner` is built one-level or two-level,
so the data model does not need a later rewrite. The current one-level
implementation (lab.ts) would become a loop or a two-hop resolve.

## The "covers ~N labs" framing

Once the real per-lab loaded cost is locked, "your department's support covers
roughly N labs of typical use" is arithmetic, and it is a far better line for a
department chair than a raw GB number. Present it as "about N labs," a soft
estimate, not a hard seat cap, so it stays in the support-with-thank-you lane and
not the seat-selling lane. Consistent with "members are always free, the payer is
one level up": members are free inside a lab, labs are the unit a department
sponsors, never seats.

## Two things this sharpens

1. It reinforces Stripe over GitHub Sponsors, hard. Departments pay by INVOICE /
   PO, not a maintainer's credit-card sponsorship page. GitHub Sponsors cannot
   invoice a university procurement office; Stripe Invoicing can. The institutional
   motion makes GitHub Sponsors a non-starter for this tier.
2. It is a land-and-expand wedge. A few labs adopt free -> the department sees half
   its labs using it -> the department sponsors -> more labs join under the pool.
   The department tier is the natural EXPANSION step on top of free individual-lab
   adoption, a real GTM story against the incumbent.

## Open decisions (for the Phase-2 build, not now)

- Flat department pool vs per-lab-included sizing.
- Whether one lab can hog the shared department pool (the "add approved heads"
  control plus the soft "~N labs" estimate mostly handles this socially; a per-lab
  soft cap inside the department pool is the harder-edged option).
- Department admin model (who in the department can add/remove approved lab heads).

## Sequencing

Phase 2, after the individual sponsorship + the Stripe flow are live and proven.
Captured now so the two-level hierarchy informs the data model from the start.
