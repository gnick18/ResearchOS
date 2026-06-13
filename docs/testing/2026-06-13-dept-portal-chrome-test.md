# Claude-in-Chrome test: Department portal (contained demo)

Self-contained prompt for a Chrome-connected Claude session. Exercises the whole
department admin portal against fixture data, no account, no Neon, no Stripe.
Billing is simulated, so nothing is charged.

## Setup (once)

1. In `frontend/.env.local`, set the dept tier flag on (it is a build-time
   NEXT_PUBLIC var, so set it before starting the dev server):
   ```
   NEXT_PUBLIC_DEPT_TIER_ENABLED=1
   ```
2. Start the dev server (`pnpm dev` in `frontend`, or use the running :3000 if it
   was started with the flag set). The flag must have been set BEFORE the server
   started.
3. In Chrome, go to `http://localhost:3000/demo/department`. The demo fixture
   installs and redirects to `/department` with the demo banner showing.

If `/department` bounces you to the home page, the flag was not set before the
server started. Restart the server with the env var set.

## What to verify (paste this to the Chrome agent)

You are testing the department admin portal in demo mode. Go to
`http://localhost:3000/demo/department` and confirm each of the following, taking
a snapshot after each interaction. Report PASS or FAIL per item with what you saw.

1. The page header reads "Department of Microbiology". The lab-head roster lists
   Okafor Lab, Zhang Lab, Reyes Lab as Active and Singh Lab as Invited.
2. The plan builder shows Active labs seeded to 3 and a Pooled storage value, with
   a derived monthly rate below it.
3. The three payment options appear: "Emailed invoice", "Auto-charge bank",
   "Auto-charge card". Selecting a bank option shows a "Save $X/mo" note and the
   headline price is LOWER than when "Auto-charge card" is selected. Confirm card
   is the higher (list) price and bank is the discount.
4. Tick "Billed outside the US". The card list price rises; the bank-transfer
   price stays about the same. Untick it.
5. Under "Usage by lab", click a lab row. It expands to per-account rows with
   storage and sync counts. The dept total at the top matches roughly the sum.
6. The "Usage over time" chart renders several months of bars.
7. Select "Emailed invoice", enter a PO number, click "Activate billing". A
   message like "Plan active (demo)" appears and the status flips to active. No
   redirect to Stripe, no error. Nothing is charged (this is simulated).
8. Switch to "Auto-charge card", click "Update plan". It updates to active in
   demo without leaving the page.
9. In the "Invite a lab head" card, click "Create invite link". A link appears and
   the Copy button works.
10. Read the console. Report any errors (warnings are fine).

PASS overall = items 1 to 9 behave as described and item 10 shows no errors.
```
```

## Notes

- This is the contained demo, so all data is fixtures from
  `frontend/src/lib/dept/demo-fixtures.ts`. The numbers are deterministic.
- Real billing (a Stripe test-key round-trip) is intentionally NOT exercised here;
  it cannot be driven by a synthetic agent (no OAuth) and is verified separately.
- The institution portal has its own test, `2026-06-13-inst-portal-chrome-test.md`.
