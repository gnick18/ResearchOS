# LLC business tracker, an operator-only admin tab

Status: draft for Grant, 2026-06-05. Author: sharing infra.

## What it is

A private business tab on `/admin` that keeps the ResearchOS LLC's operational
and financial facts in one place, so the recurring overhead of running the
entity (deadlines, money in and out, tax reserve) does not live in Grant's head
or in scattered spreadsheets. It reuses the existing `/admin` access gate and
sits next to the infrastructure-capacity panel, which already measures the Neon,
R2, and Resend usage that becomes the expense side of the books.

This is an internal founder tool. It is not customer facing and never appears to
labs.

## What it explicitly is NOT

Naming these up front so the tool never creates a false sense of coverage.

- It is NOT the legal registered agent. Wisconsin requires a registered agent
  with a physical in-state street address (no PO box) to receive service of
  process and state mail. Software cannot fill that role. Grant can be his own
  agent for free using a Wisconsin address. The tracker only reminds and
  organizes.
- It is NOT a tax preparer or a substitute for an accountant. It holds a reserve
  and surfaces deadlines, but an accountant should set the reserve percentage
  and handle the actual filings, at least for the first year.
- It is NOT a bookkeeping system of record for an audit. It is a founder's
  dashboard. If the LLC ever needs real books, that is QuickBooks or an
  accountant, and this tool feeds them rather than replaces them.

## What it tracks

### Entity facts

A small singleton record. LLC legal name, state (Wisconsin), formation date,
EIN, registered agent name and address, and the business bank account label (not
the number). Static, edited rarely, the reference card for everything else.

### Deadline strip

The next few obligations with countdowns, so nothing lapses into administrative
dissolution or a late penalty.

- Wisconsin LLC annual report. Filed with the Department of Financial
  Institutions (DFI). For a domestic LLC the deadline is the last day of the
  calendar quarter containing the formation anniversary (March 31, June 30,
  September 30, or December 31), and the fee is $25 online ($40 by mail, which
  includes a $15 paper surcharge). The tracker computes the next instance from
  the formation date. Verify the current fee and rule on the DFI site each year.
- Federal quarterly estimated taxes. The usual due dates are roughly April 15,
  June 15, September 15, and January 15 of the following year. A single-member
  LLC is a pass-through, so estimates are paid on Grant's personal return. An
  accountant should confirm whether estimates are even required and at what
  amount.
- Any one-off dates Grant adds (an accountant appointment, a renewal).

### Money in

Income by month. Two sources to start, storage payments (once that ships) and
voluntary donations. Manual entry at first, with a hook to auto-record storage
payments later when the payment rail exists (see paid-storage-sustainability.md).

### Money out

Expenses by month. The infra bills (Neon, R2, Upstash, Resend, Vercel, domain)
plus anything Grant adds (accountant fees, the annual-report fee). The infra
bills can be auto-estimated, the capacity panel already measures the usage, so
the same numbers times the published unit prices ($0.35/GB-month Neon storage,
$0.015/GB-month R2, and so on) give a live running estimate without manual entry.
Mark these as estimates, the provider invoice is the truth.

### Tax reserve and safe-to-draw

The piece that does the daily work. From net income (money in minus money out),
hold back a configurable reserve percentage for taxes, and show a single
"safe to draw" number, the amount Grant can move to his personal account without
touching the tax money. A running reserve balance tracks what is set aside versus
what the next estimate will need. The reserve percentage is a setting an
accountant fills in, not a number this doc invents.

## Data model

Operator-only tables on Neon, gated behind the admin check, never touched by any
user-facing route.

- `business_entity`, a singleton config row (or a single JSON document) for the
  entity facts and the reserve percentage.
- `business_ledger`, append-only entries: date, direction (in or out),
  category, amount in cents, a note, and a source (manual, infra-estimate,
  storage-payment). Everything else (monthly totals, net, reserve, safe-to-draw,
  next deadlines) is derived from this plus the entity config, the same pattern
  the transparency report uses, one source of truth, computed views on top.

Financial records are more sensitive than the aggregate metrics already on
`/admin`. Two options, decide in build: keep them in the same Neon database
behind the admin gate (simplest, consistent), or isolate them in their own
schema or store. For v1 the admin gate is sufficient since the data is the
founder's own, not user data.

## Access control

Reuse the existing `isAdminEmail` gate (ADMIN_EMAILS) that already protects
`/admin`, or split out a stricter BUSINESS_ADMINS allowlist if the business tab
should be visible to fewer people than the metrics tab. "Certain designated
people" maps cleanly onto an allowlist either way. The API route returns 404 to
anyone not on it, exactly like the metrics route does today.

## Build phases

1. v1. Entity facts, the deadline strip (Wisconsin annual report computed from
   the formation date, plus the federal quarterly dates), manual money-in and
   money-out entry, the tax-reserve and safe-to-draw calculation. All the value,
   no integrations.
2. v2. Auto-estimate the infra expenses from the capacity panel's usage numbers,
   so the money-out side mostly fills itself.
3. v3. When storage billing ships, auto-record storage payments into the ledger
   so money-in fills itself too.

## Open questions for Grant

- Reserve percentage to start with (placeholder until the accountant sets it)?
- Same admin allowlist as the metrics tab, or a stricter one for the financial
  data?
- Should the deadline strip be able to email or notify you ahead of a due date,
  or is the dashboard view enough?

## Caveats I am not qualified to close

I am not a lawyer or an accountant. Confirm with both before relying on this for
anything filed. Specifically, the registered-agent arrangement, whether quarterly
estimates are required and how much, the reserve percentage, and any UW
institutional or conflict-of-interest implications of running a revenue LLC
alongside a fellowship-funded, university-affiliated project.

## Sources

- [Wisconsin DFI annual report instructions](https://dfi.wi.gov/Documents/BusinessServices/BusinessEntities/Forms/CORP5i.pdf)
- [Wisconsin DFI business entity fees](https://dfi.wi.gov/Pages/BusinessServices/BusinessEntities/Fees.aspx)
- [Wisconsin LLC annual report 2026 guide](https://www.llcuniversity.com/wisconsin-llc/annual-report/)
- [Neon pricing](https://neon.com/pricing)
