# Daily business-inbox routine (the receipt bot)

A scheduled run that reads the ResearchOS LLC business inbox, books receipts onto
the ledger, and drafts replies asking for any missing documentation. The goal is
that expenses land on the books the day they arrive, already tax-categorized, so
the year-end CSV is ready with no scramble.

This is the operating playbook the routine follows on every run. It is also the
prompt you (or a schedule) hand to a Claude Code session to do the work.

Pairs with [BUSINESS_INGEST.md](BUSINESS_INGEST.md) (the endpoint it posts to)
and [BILLING_FACTS.md](../branding/BILLING_FACTS.md). House voice everywhere it
writes on our behalf: no em-dashes, no emojis, no mid-sentence colons, state the
why.

## What it touches and what it never touches

- READS the business Gmail (researchos.llc@gmail.com).
- WRITES new rows to the ledger through `POST /api/business/ingest` only.
- DRAFTS Gmail replies. It NEVER sends email on its own. Drafts wait for a human
  to review and send, because an outbound email is an outward-facing action.
- It NEVER edits or deletes existing ledger rows, never touches the entity card,
  the cost breaker, gift pools, or any other panel. Booking is additive only.

## Safety rules (read first)

1. Never auto-send email. Replies are saved as drafts.
2. Only book a row when the email is clearly a receipt, invoice, or payment
   confirmation. When in doubt, skip it and list it in the digest as "unsure"
   rather than guess a charge onto the books.
3. Every booked row carries `source = gmail:<message-id>`. The endpoint is
   idempotent on `source`, so re-running the routine never double-logs. Do not
   invent a source, use the real Gmail message id.
4. The ledger is fully editable in the admin UI (inline tax-category dropdown +
   delete), so a wrong guess is cheap to fix. That is why auto-booking is safe.
   It is not why it can be sloppy.

## Each-run procedure

1. Search the business inbox for candidates since the last run. A good query is
   mail from the last 2 days plus anything still flagged unread, widened to catch
   forwards. Overlap is fine, idempotency handles it.
2. For each candidate, decide if it is a real expense (see inclusion rules).
3. For each real expense, extract the fields (see extraction) and POST it to the
   ingest endpoint with the message id as the source.
4. For any expense that arrived without a receipt or invoice document (a person
   saying "I paid for X" with nothing attached, or a charge with no itemized
   receipt), draft a reply requesting the document (see reply template). Do not
   send it.
5. Write the digest (see digest format) and leave it for the operator.

## Inclusion rules (what is a real expense)

Book it when the email is one of:

- A vendor payment or renewal confirmation (Anthropic/Claude, Cursor, OpenAI,
  Vercel, Cloudflare, Neon, a domain registrar, Apple/Google developer fees,
  Stripe fee notices).
- An invoice or receipt with a clear total and date.
- A reimbursement request or a forwarded charge from a collaborator that names a
  real business cost.

Skip it (and note it as skipped if it looked close) when it is:

- Marketing, newsletters, "your free trial", price-change announcements with no
  charge, or a quote/estimate that was not paid.
- A payout or income notice (those are Money in, handle separately, do not guess
  income onto the books automatically in v1).
- Anything where you cannot find a real amount actually charged.

## Field extraction

- `date`: the CHARGE or transaction date, not the date the email arrived. If only
  the email date is available, use it and flag the row in the digest.
- `direction`: "out" for expenses (the v1 default). Do not auto-book "in".
- `amountCents`: the amount actually charged, in integer cents. Strip currency
  symbols. If the charge is not USD, note it in the digest and skip booking until
  a human confirms the converted amount.
- `category`: a short human label (the vendor and what it was, e.g. "Anthropic /
  Claude Max").
- `taxCategory`: map from the vendor (see table). When unsure, leave it empty and
  flag it, the admin UI will show it amber for one-click fixing.
- `note`: anything useful for tax time (plan name, billing period, account).
- `source`: `gmail:<message-id>`, always.

## Vendor to tax-category map

Use the tax-category ids from
[tax-categories.ts](../../frontend/src/lib/business/tax-categories.ts).

| Vendor / kind | taxCategory id | Schedule C line |
| --- | --- | --- |
| Anthropic, OpenAI, Cursor, Kilo, other AI dev tools and SaaS subscriptions | `software` | Other expenses (27a) |
| Vercel, Cloudflare, Neon, AWS, hosting and infra | `hosting` | Other expenses (27a) |
| Domain registrar, state filing fees, business licenses, WI annual report | `fees_licenses` | Taxes and licenses (23) |
| Apple Developer, Google Play developer fee | `software` | Other expenses (27a) |
| Stripe processing fees, payment fees | `payment_fees` | Commissions and fees (10) |
| Legal, accounting, contractor services | `professional` | Legal and professional (17) |
| Ads, domain-for-marketing, promo | `advertising` | Advertising (8) |
| Hardware, equipment | `equipment` | Depreciation / Section 179 (13) |
| Office supplies, software not dev-related | `office` | Supplies / Office (22/18) |
| Anything that does not fit | leave empty, flag it | n/a |

## Missing-document reply (draft only, never send)

When an expense has no attached receipt or invoice, draft a short, plain reply in
house voice. Template:

> Subject: Re: <their subject>
>
> Hi <name>,
>
> Thanks for this. For the ResearchOS LLC records I need the receipt or invoice
> as a PDF or image, so I can file it for taxes. Could you send the document for
> the <amount> <what it was> charge when you get a chance? That is all I need.
>
> Thanks,
> Grant

Leave it as a draft. List every draft in the digest so the operator can review
and send in one pass.

## Digest format

End each run with a short summary left for the operator (a draft email to
gnickles@wisc.edu, or printed in the run output):

```
ResearchOS LLC inbox run, <date>
Booked: <N> expenses, $<total>
  - <date>  <vendor>  $<amount>  [<taxCategory or UNCATEGORIZED>]
Skipped: <N> (reason)
Flagged for review: <N>
  - <why: missing receipt / non-USD / date-from-email / no category>
Drafts waiting to send: <N>
```

## Setup and secrets

- The routine POSTs to the ingest endpoint, so it needs `BUSINESS_INGEST_SECRET`.
  For local runs against the dev server, set it in `frontend/.env.local` and post
  to `http://localhost:3000/api/business/ingest`. The endpoint is dark unless
  `SHARING_ENABLED` is on, which it is on the local dev tree.
- Reading Gmail needs an authenticated browser session (the Claude in Chrome
  extension signed in as researchos.llc@gmail.com). A headless cron will not have
  that session, so see the scheduling note below.

## Scheduling (decision pending)

How this fires is a setup choice, captured in the session, not yet wired:

- Manual for now: run it on demand by handing this playbook to a Claude session.
  Simplest, zero infrastructure, you trigger it when you think of it.
- Scheduled on your machine: a daily scheduled Claude task while your machine is
  on and the Chrome extension is signed in. Closest to the "every day" vision.
- Fully server-side: a Vercel cron with the Gmail API and stored OAuth tokens.
  True autonomy but the heaviest setup (Google API project, token refresh), worth
  it only once the manual version proves its worth.

Start manual, graduate to scheduled once it has earned trust.
