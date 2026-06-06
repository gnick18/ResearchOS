# Runbook: create the $4.95/mo storage price in Stripe

Goal: add a new recurring monthly price of **$4.95 USD** to the existing "Cloud
Storage" product, in both Test and Live mode, leaving tax behavior to inherit
the account default. Then hand the new Test price ID to the dev and hold the Live
one for go-live. This replaces the $1.00 placeholder.

Context (so a browser agent has what it needs):
- Stripe account: ResearchOS LLC.
- Product name: **Cloud Storage** (id `prod_UeObvL1fZrwFlN`).
- Existing placeholder prices (to retire): Test `price_1Tf5oRAkGXkhlCuNfkWsSHfe`,
  Live `price_1Tf6PcPKbbOKkcGaMdgSkrvt`, both $1.00/mo.
- Final price: $4.95 USD, recurring, monthly.
- Tax behavior: leave it on the **default / unspecified** so it inherits the
  account "Automatic" setting. Do NOT pick inclusive or exclusive on the price.

## Do this twice, once in Test mode and once in Live mode

The mode toggle is in the top of the Stripe dashboard. Do the full sequence in
**Test mode** first, then flip to **Live mode** and repeat. The two prices are
separate objects with separate IDs.

1. Go to **Product catalog** in the left nav, then open the **Cloud Storage**
   product.
2. In the product's Pricing section, click **Add another price** (or **+ Add
   price**).
3. Set the price:
   - Pricing model: **Standard pricing** (a flat recurring amount).
   - Price: **4.95**, currency **USD**.
   - Billing period: **Monthly** (recurring).
   - Leave **tax behavior** at its default. If a tax-behavior selector appears,
     leave it unset / "inherit account setting". Do not choose inclusive or
     exclusive.
4. Save / **Add price**.
5. Open the new price and **copy its ID** (starts with `price_`). Label which
   mode it is from (Test vs Live).
6. Optional but tidy: on the old **$1.00** price, use the price's menu to
   **Archive** it, so nothing accidentally uses it. Do not delete the product.

## After both are created

- Give the dev (this session) the **Test** price ID. The dev updates
  `STRIPE_STORAGE_PRICE_ID` in `frontend/.env.local` so dev runs on $4.95.
- **Hold the Live price ID** for go-live. At launch it goes into the Vercel
  Production environment variables alongside the live keys, not into any dev env.

## Do NOT do (guardrails)

- Do **not** change the product's tax category (it is correctly "Software as a
  service (SaaS) - business use").
- Do **not** set the price's tax behavior to inclusive or exclusive. Leave it
  inheriting the account "Automatic" setting.
- Do **not** add a tax registration or click "Start collecting tax". That stays
  on hold until the WI DOR sales-tax determination lands.
- Do **not** delete the Cloud Storage product or its existing price, just add the
  new price (and optionally archive the old one).
