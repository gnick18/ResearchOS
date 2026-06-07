# Product-Barcode Lookup APIs for Lab Inventory (best-effort auto-fill)

Research for `plans/INVENTORY_DESIGN.md` §15. Question: when a user scans an unknown
manufacturer barcode (UPC / EAN / GTIN), which online service (if any) should we call,
browser-direct, to best-effort auto-fill product name + vendor, never blocking, always
falling through to manual entry?

Date: 2026-06-07. Researcher: inventory research sub-bot.

## Bottom line

The honest finding is that this lookup is **low-value for lab reagents and should ship as a
stubbed, manual-first seam**, because lab reagents from NEB / Sigma-Aldrich / Thermo Fisher
overwhelmingly do **not** carry standard retail UPC/EAN/GTIN barcodes in the consumer
databases. They are identified by **proprietary vendor catalog numbers** (and CAS numbers for
chemicals), and established chemical-inventory tools (ChemInventory) bind a **lab-assigned
internal barcode** to each container rather than reading a manufacturer code. So even a perfect
retail barcode API will miss most things a researcher scans. If we still want the bonus path
for the occasional retail-coded item (kit boxes, gloves, consumables, off-the-shelf supplies),
**Go-UPC is the only candidate with positive evidence of browser-direct (CORS) use** — its own
docs publish a client-side JavaScript example — but its key is exposed in that model and its
free tier is tiny (150 lookups/month). My recommendation is to **build the seam behind a flag,
default-off, wired to Go-UPC browser-direct, and treat manual entry + bind-on-scan as the
primary path**, not the fallback.

## Comparison table

| Service | Free tier | API key needed | Key browser-safe? | CORS posture (confidence) | Lab-reagent coverage | Notes |
|---|---|---|---|---|---|---|
| **Go-UPC** | Trial ~150 lookups/month, 2 req/s | Yes | **No** (key in URL, exposed) | **Likely YES** — official client-side JS example (med-high) | Poor (Google-Shopping taxonomy, retail) | Lowest paid $74.95/mo / 5k calls |
| **UPCitemdb** | Trial: 100 combined req/day, 6 req/min, **no signup, no key** | No (trial); Yes (paid) | n/a trial / no (paid) | **Unverified** (no CORS docs) | Poor (retail) | Easiest to try; trial keyless. 429 on burst |
| **Barcode Lookup** | One free *test* account only | Yes (key as URL param) | No (URL param, exposed) | **Unverified** | Poor (retail/UPC/EAN/ISBN) | Paid from **$99/mo** |
| **EAN-Search** | Limited free web search; API needs account | Yes | Unknown | **Unverified** | Poor (retail "everyday products") | 1.2B EAN, retail-oriented |
| **GS1 (Verified by GS1 / Data Hub)** | Free *web* lookup; API = paid Data Hub subscription | Yes (subscription) | No (enterprise auth) | **Unverified / assume no** | The GTIN authority, but API gated | Returns brand+description; no free public API |
| **Open Food Facts** | Free, no key (just User-Agent) | No | n/a | Partial/uneven (historic CORS gaps) | **None — FOOD only** | Dismissed for lab use |
| **Nutritionix** | **No free tier anymore** | Yes (app id+key) | No | **No CORS** (server-only per docs) | **None — FOOD only** | Dismissed for lab use |

## Per-service detail

### Go-UPC — recommended candidate if we ship the seam
- **Free tier:** free trial plan ~**150 requests/month**, max **2 requests/second**; request a
  trial key via a form. Paid: **Developer $74.95/mo (5,000 calls/mo)**, Startup $245/mo
  (45,000), Enterprise $795/mo (450,000). [go-upc.com/plans]
- **API key:** required. Two methods, `key=` URL param or `Authorization: Bearer <key>` header;
  header recommended for production. [go-upc.com/docs]
- **Key browser-safe?** **No.** Go-UPC's own client-side example puts the key in the request
  URL, so any browser-direct use exposes it to inspection. An app-level key baked into the
  client **will leak** and can be scraped/abused against our quota. [go-upc.com/docs/javascript-barcode-api-lookup]
- **CORS:** **Likely supported (medium-high confidence).** Go-UPC publishes a dedicated
  "JavaScript Example" page that explicitly says the snippet "is for the client-side scripting
  language, and meant to run in a web browser," using `fetch(url, opts)`. A vendor shipping a
  browser fetch example is strong (not definitive) evidence the endpoint returns
  `Access-Control-Allow-Origin`. **Still needs a live OPTIONS/fetch check from our origin to
  confirm.** [go-upc.com/docs/javascript-barcode-api-lookup]
- **Coverage:** broad retail; categories derived from Google Shopping taxonomy (example product
  is a cheese dip). **No scientific/lab coverage claim.** [go-upc.com/docs]
- **Reliability:** 2 req/s cap on trial; small monthly quota means it cannot be a hot path.

### UPCitemdb — easiest to try, keyless trial
- **Free tier (EXPLORER/trial):** **100 combined requests/day** (lookup+search), search subset
  capped (≈20–40/day), **burst 6 requests/minute**, 1 req/10s sustainable, **no signup and no
  API key**. Trial endpoint `https://api.upcitemdb.com/prod/trial/lookup`.
  [upcitemdb.com/wp/docs/.../plan, /api-rate-limits]
- **Paid:** DEV (20,000 lookups/day) and PRO (150,000 lookups/day) on
  `/prod/v1/...`, **require `user_key`+`key_type` headers**; prices not published in docs.
  Overage billed next cycle; **429** on burst with `X-RateLimit-Reset`.
- **API key:** none for trial; paid keys are header-only and meant to be **secret** ("keep your
  API key secret ... in the HTTP request HEADER"), so a paid key is **not** browser-safe.
  [devs.upcitemdb.com]
- **CORS:** **Unverified.** No CORS statement in docs. There is a nav reference to "Plan DEV for
  Web Browsing" we could not read; do not assert support. Needs a live check against the
  `/prod/trial` endpoint. [upcitemdb.com/wp/docs/.../api-rate-limits]
- **Coverage:** retail UPC/EAN. **No lab coverage.**

### Barcode Lookup (barcodelookup.com)
- **Free tier:** one free **test** account only (ToS forbids creating more than one without
  written consent). [barcodelookup.com/terms-and-conditions]
- **Paid:** from **$99/month**; up to 100 API calls/minute depending on subscription.
  [barcodelookup.com/api, RapidAPI listing]
- **API key:** required, passed as `key=` **URL parameter** -> would be **exposed** in any
  browser-direct call (not browser-safe). [secondary docs]
- **CORS:** **Unverified.** Official `/api-documentation` and `/api` pages return HTTP 403 to
  automated fetch, so I could not confirm CORS headers. A credible third-party note observes
  peer APIs (eandata) lack CORS and require a proxy, but that is not evidence about
  barcodelookup specifically. Mark CORS unverified.
- **Coverage:** UPC/EAN/ISBN retail database. **No lab coverage claim.**

### EAN-Search (ean-search.org)
- Surfaced as an alternative. ~**1.2 billion EANs**, retail "everyday products" + ISBN books.
  API requires an account/registration; free web search is rate-limited against bots. **Pricing,
  key-exposure, and CORS all unverified** from the pages I could read. Retail-oriented, **no lab
  coverage**. Mention only; not a primary candidate. [ean-search.org]

### GS1 — the GTIN authority, but no usable free public API
- GS1 is the issuing authority for GTIN/UPC/EAN. **GEPIR** (the old distributed company-info
  registry) was **replaced end-2023 by "Verified by GS1."** [Wikipedia: GEPIR; gepir.gs1.org]
- **Verified by GS1 / GS1 US Data Hub** does offer **APIs**, and a lookup returns rich data
  (GTIN, brand, product description, image, GPC, net content, country of sale) — but **API
  access requires a paid GS1 US Data Hub subscription / membership**; the free path is the
  **interactive web lookup**, not a public API. [gs1us.org/tools/gs1-company-database-gepir]
- **API key/auth:** subscription-gated, enterprise auth -> **not browser-safe**, and **CORS
  should be assumed unsupported** (enterprise B2B API). Not viable for an unauthenticated
  local-first browser app. **Verdict: not usable for our best-effort seam.**

## Food-only databases — explicitly dismissed

These are **not useful for lab reagents** and are listed only for completeness:

- **Open Food Facts** — free, open, **no API key** (just a descriptive User-Agent); lookup
  `https://world.openfoodfacts.org/api/v2/product/{barcode}.json`. **Database is FOOD only**
  (sister projects Open Beauty/Pet/Products Facts cover cosmetics/pet food, not lab reagents).
  CORS has had historic gaps (open GitHub issues from 2019 about missing
  `Access-Control-Allow-Origin` on some endpoints); current status uneven and undocumented.
  **Dismissed: zero reagent coverage.** [openfoodfacts.github.io/.../api]
- **Nutritionix** — **food/nutrition only**, requires an app id + key, and **the public free
  trial tier was discontinued** ("no longer able to maintain a public free-access tier"). Docs
  indicate **no CORS** (server-side calls required). **Dismissed: food only + no free tier + no
  CORS.** [developer.nutritionix.com; public-api.org/nutritionix]

## The GTIN-on-lab-reagents reality (the load-bearing finding)

- Lab reagents and chemicals from **Sigma-Aldrich / MilliporeSigma, NEB, Thermo Fisher** are
  identified primarily by **proprietary vendor catalog numbers** (and **CAS registry numbers**
  for chemicals), not by retail UPC/EAN/GTIN codes. Their catalogs are searched by catalog #,
  name, formula, CAS — not by a scannable consumer barcode. [sigmaaldrich.com catalog;
  thermofisher.com chemicals]
- Consumer barcode databases (UPCitemdb, Go-UPC, Barcode Lookup, EAN-Search) are built around
  **retail commerce** (Go-UPC literally uses the Google Shopping taxonomy). Their coverage of
  scientific reagents is **poor to nonexistent**.
- The standard practice in real chemical-inventory software confirms this: **ChemInventory does
  not read manufacturer barcodes** to identify reagents. It generates and assigns a **lab-owned
  internal barcode** to each physical container; users keep sheets of pre-printed barcodes and
  bind the next label to a container as it is entered. Manufacturer-barcode auto-fill is simply
  not part of the workflow. [cheminventory.net/support/barcodes-auditing/getting-started]
- Thermo Fisher's own "custom barcoding & labeling" service issues **internal codes** (Code 128
  / Code 39 / I2of5) for sample/container tracking — again confirming labs barcode *containers
  themselves* rather than relying on a manufacturer GTIN. [thermofisher.com custom-barcoding]

Conclusion: an online manufacturer-barcode lookup is a **rare bonus** for the subset of items
that happen to carry a retail code (kit boxes, gloves, off-the-shelf consumables), **not** a
reliable identifier for the reagents that matter most. The primary inventory path must be
**manual entry + bind a lab-assigned barcode to the item (bind-on-scan)**.

## Recommendation for ResearchOS

1. **Ship the lookup as a flag-gated, default-off, stubbed seam; make manual-first the
   primary.** The design's "never blocks, falls straight to manual entry" intent should be the
   *normal* outcome, not an edge case. Lead the UI with bind-on-scan (assign a lab barcode to a
   manually-entered item) the way ChemInventory does.
2. **If/when we wire the bonus lookup, use Go-UPC, browser-direct.** It is the only candidate
   with positive evidence of intended client-side/browser use (its published JS fetch example),
   which is exactly our local-first, no-backend constraint. Treat its CORS support as
   **likely-but-unverified** until a live `fetch` from our origin confirms
   `Access-Control-Allow-Origin`.
3. **Key handling caveat (important):** Go-UPC's browser model **exposes the API key**. An
   app-level key baked into the client **will leak**. Given the tiny free quota (150/mo) and
   $74.95/mo entry plan, a leaked shared key is a real abuse/quota risk. Options, in order:
   (a) ship the seam **without** a bundled key and let advanced users paste their own Go-UPC
   trial key in settings (keeps us at zero cost and zero abuse surface); (b) only if usage
   justifies it, add a **thin Vercel proxy** (like `/api/calendar-feed`) holding a server-side
   key — but this reintroduces backend coupling we are trying to avoid, so do it last.
4. **Fallback option if a keyless try is wanted:** UPCitemdb's trial endpoint is **keyless**
   (no signup, no leak), 100/day, but its CORS posture is **unverified** — a quick live OPTIONS
   check would settle whether it can be called browser-direct without a proxy. If it can, the
   keyless trial is attractive for a zero-config bonus path despite the low daily cap.
5. **Do not pursue GS1, Open Food Facts, or Nutritionix.** GS1's API is paywalled/enterprise
   and not browser-safe; the food DBs have zero reagent coverage.

### Open items the orchestrator should note
- **CORS is unverified for every candidate except the indirect Go-UPC JS-example signal.** No
  vendor documents `Access-Control-Allow-Origin`. Before committing to browser-direct, run a
  one-line live check (a `fetch` from a ResearchOS origin, or an `OPTIONS` with `curl -H
  "Origin: https://researchos..."` inspecting response headers) against Go-UPC first, then
  UPCitemdb's `/prod/trial` endpoint.
- **Barcode Lookup official API pages return 403 to automated fetch**, so its pricing tiers and
  CORS could not be confirmed beyond the "$99/mo start" and "key as URL param" secondary
  sources.

## Sources

- Go-UPC plans/pricing: https://go-upc.com/plans
- Go-UPC API docs (auth): https://go-upc.com/docs
- Go-UPC client-side JavaScript example: https://go-upc.com/docs/javascript-barcode-api-lookup
- UPCitemdb plan comparison: https://www.upcitemdb.com/wp/docs/main/development/plan/
- UPCitemdb rate limits: https://www.upcitemdb.com/wp/docs/main/development/api-rate-limits/
- UPCitemdb developer/auth: https://devs.upcitemdb.com/
- Barcode Lookup API: https://www.barcodelookup.com/api
- Barcode Lookup terms: https://www.barcodelookup.com/terms-and-conditions
- Barcode Lookup on RapidAPI: https://rapidapi.com/barcodelookup/api/barcode-lookup/details
- EAN-Search: https://www.ean-search.org/
- GS1 US company database (GEPIR/Verified by GS1): https://www.gs1us.org/tools/gs1-company-database-gepir
- Verified by GS1: https://gepir.gs1.org/
- GEPIR replacement history: https://en.wikipedia.org/wiki/GEPIR
- Open Food Facts API: https://openfoodfacts.github.io/openfoodfacts-server/api/
- Open Food Facts historic CORS issue: https://github.com/openfoodfacts/openfoodfacts-server/issues/1977
- Nutritionix API: https://developer.nutritionix.com/
- Nutritionix (no free tier / CORS): https://public-api.org/api/844/nutritionix
- ChemInventory barcodes (lab-assigned, not manufacturer): https://www.cheminventory.net/support/barcodes-auditing/getting-started/
- Thermo Fisher custom barcoding/labeling: https://www.thermofisher.com/us/en/home/life-science/sample-storage-management/custom-barcoding-labeling.html
- Sigma-Aldrich catalog (catalog #/CAS search): https://www.sigmaaldrich.com/US/en
