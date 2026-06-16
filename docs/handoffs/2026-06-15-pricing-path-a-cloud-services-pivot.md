# Handoff: pricing Path-A pivot (product = cloud services, not GB storage) + free-tier definition (2026-06-15)

Billing / pricing-finalize lane, session 3 (this took over the throttled "Billing" chat again; the prior session hit the session limit mid-save, recovered here). Predecessor handoff: `docs/handoffs/2026-06-15-phone-pass-and-billing-go-live-copy.md`. The locked decisions live in memory `project_pricing_finalize_2026_06.md` (the canonical record); this handoff is the lane-facing summary.

Nothing new was committed this session. The work was a live strategy lock-in with Grant. All build from the prior session is already on local main (see §3). What changed is the **model direction**, captured to memory but **not yet reflected in code, AGENTS.md (now pointed), or the master bible**.

## 1. THE PIVOT — Path A: we are a local-first cloud-SERVICES company, not a storage-by-GB vendor

Trigger: the billing meter only counts live-collab CRDT bytes (`getOwnerUsage` = `SUM(bytes) FROM collab_doc_sizes`, 0 if collab is never set up), so a solo/local user shows ~0 GB. GB as a headline pricing axis is meaningless for the local-first majority, AND selling our-cloud-storage-by-GB directly contradicts the dept Model-B pitch ("your data on your own institution's cloud") and the local-first identity.

**Resolution (Grant, LOCKED):**
- We are **local-first, not cloud-pilled**. Our cloud is a thin **orchestration / relay** layer, not a storage vault.
- We **charge for the SERVICES the relay uniquely enables**: real-time collab, cross-boundary SEND, phone capture, push, governance/admin. These become **audience + scale SERVICE tiers**, not GB gradations.
- **Storage is à la carte at ~1.1–1.2× cost** (Stripe + R2 + fees pass-through). It is NOT a profit center.
- **Killer trust prop:** at-cost storage = zero incentive to lock you into our cloud. We profit by making collaboration great, not by holding your data hostage.
- **Per-object opt-in is SACRED.** A 10 GB mass-spec run stays local and visible in the notebook, never auto-pushed. Never an all-or-nothing "cloud mode."

**Consequence:** the Starter/Basic/Plus/Pro **GB-gradation ladder is REPLACED** by audience+scale service tiers — **Free (local) / Solo (cloud) / Lab / Dept** — plus à la carte storage plus the separate AI meter. The `FinalizeTab` GB-margin model needs a **rebuild around service-access pricing × adoption** (it currently still models the GB ladder).

## 2. THE FREE TIER — the network audience (Path-A freemium)

Free users get the cheap RECEIVE / PRESENCE side that makes PAID worth buying. Network-effects freemium, flipped right: free users aren't a tolerated cost, they are the audience that gives the paid send/collaborate features their value.

**FREE gets:**
- Unlimited **local notebook** (forever; the product, not the cloud pool).
- **Shared-folder workspaces** (async file sync on their own / institution's cloud — the free-lab path, costs us nothing, NOT live collab). Note: "collab" / "collaboration" / "co-edit" is reserved for the paid live relay feature; free-tier copy never calls this "collaboration."
- **Network profile + directory presence** (discoverable, opt-out) so paid users can find them.
- **Receive cross-boundary shares** — snapshot lands in their local notebook; the **SENDER bears the relay cost**, so receiving is nearly free to us.
- **In-app "you received X" receipt notifications** (NOT phone push — push stays paid).
- **Accept folder / lab invites** (be a member, contribute via the shared folder).
- **All public surfaces** — open library / Commons assets, wiki, calculators, demo.

**PAID = produce + lead:** SEND cross-boundary, real-time RELAY collab (live co-edit), phone capture, push, backup, governance.

**Key reconciliation (do not trip the locked lab decision):** "free has no collab" means **no real-time RELAY collab** (live co-editing). **Shared-folder workspaces stay FREE** — that preserves the earlier locked "free for low-resource labs" decision (a low-resource lab = free individual accounts working out of a shared folder on their own institutional cloud). Terminology rule: "collab" / "collaboration" / "co-edit" refers ONLY to the paid live relay feature, never to the free shared-folder workspace.

The one line that stays sustainable AND is a flywheel: **free = consume + be present** (receive, be findable, async-collab via shared folder); **paid = produce + lead** (send, live co-edit, phone, push, backup, governance). The thing we would NOT give free is **sending anything through our relay** — that is both the produce side and the cost side.

## 3. Build state (all on local main, already committed)

Despite the memory file's stale "uncommitted" note, the prior session's build landed:
- `eac3755ea` — pricing finalize tab + billing-cadence model in `frontend/src/lib/pricing/modeling.ts` (added `stripeMonthlyAmortized`, `cadenceChargesPerYear`, `BillingCadence`; cadence-aware `subscriberMargin`/`netMargin`; `orgPerLabRate()`).
- `71fa7ccce` — widened the finalize page + graph column.
- `c323e51ee` — dept storage at lab parity + flat governance fee (not a surcharge).
- `04644d95d` — labs become four paid tiers + 30-day trial, no permanent free lab tier.
- Dev scratch page **`frontend/src/app/dev/pricing-finalize/page.tsx`** mounts `FinalizeTab` ungated. **DELETE after lock-in**; not linked anywhere. Same `FinalizeTab` is also in `/admin` Modeling (`OperatorShell.tsx`).
- Tree clean for pricing files; the only dirty files are unrelated sibling-lane work (OAuthFirstLanding, LivingPopup).

NOTE: the `FinalizeTab` math still models the **old GB ladder**. Path-A says recut it into service tiers. That recut is the NEXT BUILD STEP and was NOT started — it is a real piece of work and Grant drives the numbers, so do not silently rebuild it; confirm scope first.

## 4. NEXT (in order)

1. **Recut the model + tiers** as Free / Solo / Lab / Dept **service** tiers (open question: how many tiers per audience, and what each gates). Rebuild `FinalizeTab` around service-access pricing × adoption rather than GB margin.
2. Grant drives `/dev/pricing-finalize` to settle exact numbers (entry-tier $, write allowances, sustain). The per-tier **write allowance remains the real margin lever** (writes are ~$0.45 of the ~$0.46/mo free-user cost; storage is ~$0.01). The free WRITE cap is the dial that moves break-even (drop it to ~0.2M and break-even falls to ~4% conversion, realistic).
3. Copy locked numbers into `lib/billing/plans.ts` + `lib/pricing/assumptions.ts` (the single sources of truth, never hardcode elsewhere), write the **master pricing bible** (Grant chose a new master doc that supersedes both `docs/branding/BILLING_FACTS.md` and `docs/reference/billing-copy-facts.md`), then **delete the dev page**.
4. **Reconcile copy at lock time:** `BILLING_FACTS.md` still says "Free tier is 5 GB, a real working tier" and lists "Lab Free/Plus/Pro" — reframe onto unlimited-local-notebook + cloud-sync-starts-small (free pool DECIDED = **0.5 GB**) + free-individual-accounts + optional-paid-lab-mode + the 30-day lab trial. Provisional Plus/Pro sticker prices stay unpublished until the bible.

## 5. Open thread Grant flagged

The lab-cloud "why pay" must be sharp (cross-boundary sharing, phone capture, backup, directory) or the 30-day lab trial won't convert. Same logic now generalizes to every paid service tier under Path-A: each tier's relay-enabled capability has to be visibly worth more than "free + shared folder."

Related memory: [[project-pricing-finalize-2026-06]], [[project-ai-billing-build]], [[feedback-pricing-decisions-locked]].
