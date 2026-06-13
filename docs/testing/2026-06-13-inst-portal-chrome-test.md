# Claude-in-Chrome test: Institution portal (contained demo)

Self-contained prompt for a Chrome-connected Claude session. Exercises the whole
institution admin portal against fixture data, no account, no Neon, no Stripe.
Billing is simulated, so nothing is charged. One tier up from the department test.

## Setup (once)

1. In `frontend/.env.local`, set the institution tier flag on (build-time
   NEXT_PUBLIC var, set before starting the dev server):
   ```
   NEXT_PUBLIC_INSTITUTION_TIER_ENABLED=1
   ```
2. Start the dev server (`pnpm dev` in `frontend`). The flag must have been set
   BEFORE the server started.
3. In Chrome, go to `http://localhost:3000/demo/institution`. The demo fixture
   installs and redirects to `/institution` with the demo banner showing.

If `/institution` bounces home, the flag was not set before the server started.

## What to verify (paste this to the Chrome agent)

You are testing the institution admin portal in demo mode. Go to
`http://localhost:3000/demo/institution` and confirm each of the following, taking
a snapshot after each interaction. Report PASS or FAIL per item with what you saw.

1. The page header reads "State Lab University". The roster lists Microbiology,
   Chemistry, Biomedical Engineering as Active and Physics as Invited.
2. The plan builder is labelled in terms of TOTAL active labs across departments
   (not a flat per-department count). It is seeded to the total lab count (8) and
   shows a derived monthly rate. Confirm the sustaining contribution scales with
   labs, raising "Active labs (all depts)" raises the rate.
3. The three payment options appear (Emailed invoice, Auto-charge bank,
   Auto-charge card). A bank option shows a "Save $X/mo" note and a LOWER headline
   price than "Auto-charge card". Card is the list price, bank is the discount.
4. Tick "Billed outside the US". The card list price rises; bank stays about the
   same. Untick it.
5. Under "Usage by department", click a department row. It expands to its labs
   with storage and sync counts. The institution total matches roughly the sum.
6. The "Usage over time" chart renders several months of bars.
7. Select "Emailed invoice", enter a PO number, click "Activate billing". A
   "Plan active (demo)" message appears, status flips to active, no Stripe
   redirect, no error, nothing charged.
8. Switch to "Auto-charge bank", click "Update plan". Updates to active in demo.
9. In "Invite a department admin" (or the invite card), click "Create invite
   link". A link appears and Copy works.
10. Read the console. Report any errors (warnings are fine).

PASS overall = items 1 to 9 behave as described and item 10 shows no errors.
```
```

## Notes

- Contained demo, fixtures from `frontend/src/lib/institution/demo-fixtures.ts`.
- The key institution-specific check is item 2: the rate scales with total labs
  across departments (the size-adaptable sustaining model), not a flat per-dept
  fee. That was the model correction made this session.
- Real Stripe billing is not exercised here (no OAuth for a synthetic agent).
