# BeakerBot AI pricing analysis

Written by the billing/marketing role, 2026-06-11, against `beakerbot-economics-for-billing.md`. Decision-ready recommendation plus the welcome and pricing copy drafts. All dollar figures are PROVISIONAL placeholders, the same posture as the storage numbers in `frontend/src/lib/pricing/assumptions.ts`, to be locked after instrumenting real tasks and after Grant signs off. House voice for all customer copy (no em-dashes, no mid-sentence colons, no emojis, state the why).

---

## 1. The cost facts (researched, not remembered)

**Fireworks gpt-oss-120b, live rates (2026-06-11):**
- Input: **$0.15 per million tokens**
- Output: **$0.60 per million tokens**
- Sources: [pricepertoken](https://pricepertoken.com/pricing-page/model/openai-gpt-oss-120b), [Fireworks pricing](https://fireworks.ai/pricing). Re-pull before launch, rates move.

These are very low because the model is open-weight and served serverless. Output is 4x input, and BeakerBot is input-heavy (the system prompt and tool definitions are resent every agent-loop turn), so both rates matter.

**Per-task cost model (PROVISIONAL, must be validated by instrumenting 5 to 10 real tasks).**
The brief gives a working assumption of tens of thousands of tokens per substantive task (the mockup shows "last task 31k tokens"). Modeling three task sizes with an input-heavy split (an agent loop resends context each turn):

| Task | Round-trips | ~Tokens | Split (in/out) | Our cost |
|---|---|---|---|---|
| Light (a question) | 1 to 2 | ~8k | 70 / 30 | **~$0.002** |
| Average (an analysis) | 3 to 4 | ~31k | 65 / 35 | **~$0.010** |
| Heavy (analysis + graph + note write) | 5 to 6 | ~45k | 60 / 40 | **~$0.015** |

**The headline number: a substantive BeakerBot task costs us about one cent.** That is the single most important fact for both the price and the copy. The browser-side agent loop (only answers cross to the model, never the user's files) plus the cheap open-weight model is why.

**Caveat that gates the final price:** the token-per-task distribution is a model, not a measurement. The brief is right that we must instrument real tasks before locking numbers. The shape of the recommendation does not change, but the exact trial size and credit-block sizing should be set from that data.

---

## 2. Market context (why metered credits is the right shape)

The 2026 consensus is clear and it matches the brief:
- **Per-seat is dying for AI.** Seat-based pricing fell from 21% to 15% of companies in a year, because one heavy user can cost more in compute than a seat brings in. ([MindStudio](https://www.mindstudio.ai/blog/saas-pricing-ai-agent-era), [Outrunly](https://outrunly.com/seat-based-pricing-is-dead-how-to-price-your-ai-saas-in-2026/))
- **Metered AI credits are the standard.** Hybrid models (a base plus metered AI credits) surged from 27% to 41%. "Buy a block of credits upfront, burn against usage" is the dominant pattern, and it is exactly what fits our prepaid, cost-recovery posture. ([getmonetizely](https://www.getmonetizely.com/blogs/the-2026-guide-to-saas-ai-and-agentic-pricing-models))
- **A second meter, not a new product.** SaaS vendors add AI as a separate meter alongside the base (HubSpot added AI credits to existing tiers). That is precisely how we should bolt the AI meter onto the existing storage model.

So the brief's direction (free local search, AI metered as cost-recovery) is not just defensible, it is the current best practice. We get to do the honest version of what everyone else is doing for margin.

---

## 3. Recommended model

### The split (one line)
**Local search is free forever. The AI is metered, because each AI task costs us real inference money and we pass it through near cost.**

### Two independent meters, one LLC
ResearchOS has exactly two paid meters, and they are fully independent:

1. **Cloud storage** (the existing solidarity-priced plans). For sync, sharing, collaboration.
2. **BeakerBot AI credits** (new). For the optional AI assistant.

A user can pay for neither (free local app plus free local search), one, or both. Someone can run AI without buying storage, or buy storage and never touch AI. Both are collected and paid by ResearchOS LLC through the same Stripe, no separate entity (the LLC is already set up, EIN obtained, see `project_llc_business_ops`). This is the "second meter" pattern, and keeping them independent is what makes the pricing honest and legible.

### The credit mechanics (why prepaid)
Stripe takes 2.9% + $0.30 per charge. A one-cent task cannot carry a $0.30 fee, so per-task charging is impossible. The answer, and the market standard, is **prepaid credit blocks**:

- The user buys a block (suggest **$10 / $25 / $50**), one Stripe charge, which amortizes the $0.30 fee (about 6% on a $10 block, about 4% on a $25 block). Each block tops up the token balance at the current rate.
- Each task debits its actual cost times a thin buffer from the balance.
- **Present the balance as tokens, not dollars (Grant 2026-06-11), the convention every AI tool uses.** A token count reads as generous ("980,000 tokens left") where the same value in dollars reads as stingy ("49 cents left"), and tokens are the familiar mental model. Keep the per-task readout ("last task 31k tokens") and add a one-line explainer ("a token is a small chunk of text, a typical question is a few thousand"). Behind the scenes we still account in dollars for Stripe and for our own cost, the token display is just the user-facing layer. The mockup's "$4.10 credit left" becomes a token balance.
- **Translate tokens into plain value, because not everyone knows how far a token goes (Grant 2026-06-11).** Near the balance, say roughly what it covers and that it depends on the size of the question, for example "about 20 to 25 full analyses or 100-plus quick questions." A bare token count is abstract, the translation is what makes it feel concrete and generous.

### The free trial (one-time, bounded, NOT a recurring monthly grant)
A recurring monthly free allowance is the wrong call here, and Grant flagged it correctly (2026-06-11). AI is a variable per-use cost, so a recurring per-user free amount is an UNBOUNDED liability that scales with adoption. At $2 to $3 per user per month, a few thousand free users is already thousands of dollars a month, every month, forever, and there is no per-seat subscription absorbing it. Storage can carry a free pool because it is cheap and capped at 5 GB per lab. AI cannot.

So the free part is a ONE-TIME trial, not a monthly grant:

- **A one-time free trial of about 25 cents of inference per user, presented as a round token grant (on the order of 500,000 tokens).** 25 cents still covers dozens of queries (roughly 20 to 25 substantive tasks, or 100-plus quick questions), enough to genuinely try BeakerBot before deciding to spend. Granted once on first use. This caps our free-AI exposure at about 25 cents per user, one time, a negligible fixed acquisition cost rather than a recurring subsidy. The exact token number is set from the measured input/output mix so realistic use lands near 25 cents (worst-case all-output stays close to it).
- **After the trial it is pay-as-you-go** (prepaid credits below). No ongoing free AI from ResearchOS by default.
- **Ongoing free AI is SPONSORED, not subsidized by us.** A lab, department, or institution can fund a shared AI credit pool for its members (like the storage pool, only the PI or admin pays). So a researcher at a funded institution can have AI covered, but the institution pays for it, not ResearchOS. This keeps the mission (accessible, an institution can make it free for its people) without putting an unbounded bill on us.

This also keeps the storage and AI free tiers cleanly different on purpose: storage has an ongoing free pool (cheap, capped), AI has a one-time trial then sponsorship-or-pay (variable, uncapped per use). Say the why if a user asks, the AI costs real money each time, so we let you try it free, then you only pay for what you use.

### The markup (cost-recovery plus a thin buffer)
- Effective rate of about **1.4x raw inference** on paid credits. The buffer covers Stripe on the block, the Vercel proxy invocation, and overhead, not profit. A one-cent task debits about 1.4 cents.
- At that rate a **$10 block buys roughly 700 average tasks**, a **$25 block roughly 1,800**. These are generous because the underlying cost is tiny, which is the whole trust story.
- State the reason in copy: open-weight model plus browser-side agent loop keeps our cost low, and we pass it through near cost.

### Department and institution AI pools (reuse the existing channel)
Departments and institutions get an AI pool alongside their storage plan, through the SAME self-serve plan builder and recurring-invoice-to-procurement channel already built for storage. AI is a second line on the same invoice, not a new payment path. Universities already buy site licenses for LabArchives and Benchling, so an institutional AI line is exactly what their procurement expects.

- **Priced at a sustaining rate above cost (Grant 2026-06-11), the same logic as the storage tiers.** Individuals and labs pay AI at cost-recovery, and departments and institutions pay a modest sustaining rate above bare AI cost, and that surplus keeps the free individual sign-up trial free and funds AI development. Institutions have budget, individuals do not, so the institutional pool is where AI joins the solidarity model, exactly as storage does.
- **The rate (the 2x multiplier is CONFIRMED by Grant 2026-06-11, the underlying bare-cost dollars stay provisional pending instrumentation).** Individuals and labs pay about **1.4x bare inference cost** (cost-recovery plus the thin Stripe/proxy buffer). Departments and institutions pay about **2x bare cost**, roughly **40 percent more per unit of AI than an individual**, and that ~0.6x gap is the sustaining surplus that pays for the free sign-up trials. Because inference is pennies, 2x a one-cent task is still about two cents, well within the modest range for AI (commonly marked up several-fold), so it is honest and not a profit center. Tunable like every number here, dial it toward 2.5x to 3x only if the free-trial subsidy or AI dev actually need it.
- **Express it as a percentage on metered usage, not a flat per-member fee.** Storage uses a flat per-active-lab sustaining contribution ($12/lab/month) because storage scales with labs and GB. AI scales with USAGE, so the institutional sustaining must be a markup on metered AI, otherwise a member who never touches AI would generate a fee. This is the one place the AI model intentionally differs from the storage model in shape, while keeping the same solidarity intent.
- **A shared token pool for the institution's members**, with the admin setting the cap. Members draw from the pool, the cost circuit breaker backstops runaway, and an institution can cover its researchers' AI without each one entering a card.
- **Mechanically it mirrors the storage pool** (only the admin pays, one shared allowance), so the wiring reuses the storage-pool and dept/inst-builder code rather than adding a new path. The plan builder gains an AI line next to the storage line.

### The guardrails (already partly built)
- The **cost circuit breaker** exists (`feature_cost_circuit_breaker`): if spend approaches budget, cloud AI pauses while free local search keeps working. No runaway bill reaches the user.
- Grant must still set **provider-side hard caps** (a Fireworks spend cap), the brief flags this and it is the real backstop.

### What stays unpublished (for now)
Mirror the Plus/Pro storage posture: publish the model and the one-time trial, but hold exact credit-block prices and the final per-task rate until real-task instrumentation lands. Label any number an estimate. Do not promise "never charge" for the AI.

---

## 4. Page-by-page copy drafts (house voice)

### Welcome / what-we-offer page (the AI section)
Replaces the generic AI section in the welcome redesign mockup. Leads with what it does, frames free search vs metered AI without scaring.

> **// search is free, the AI is yours**
> **Find anything instantly. Ask BeakerBot when you want more.**
>
> One search box does two things. **BeakerSearch** finds anything across your notes, experiments, methods, sequences, data, and orders, instantly, on your own machine, free and always on. When you want more, hand the same query to **BeakerBot**, the AI coworker that reasons over your work, runs a real analysis, makes a plot, and writes it up, always with your approval before it changes anything.
>
> Search is free because it runs on your device. BeakerBot is optional, with free tokens when you sign up (enough for dozens of questions), then metered near cost, because each AI task calls a hosted model that costs us real money. Your files never leave your machine either way, BeakerBot moves answers, not your data.

### Pricing page (the new AI section, separate from the storage plans)

> **The AI is metered, at cost**
>
> The app and local search are free. The only AI you pay for is BeakerBot, the assistant that reasons, analyzes, plots, and writes for you, because each of those tasks calls a hosted model that costs us real money to run.
>
> - **Free tokens when you sign up.** Every new account gets a one-time batch of tokens to try BeakerBot, no card needed. How far they stretch depends on what you ask. A quick question is cheap, a full analysis costs more, and the batch works out to roughly 20 to 25 full analyses or over 100 quick questions. Plenty to see what BeakerBot does before you spend anything.
> - **Then prepaid credits, near cost.** Buy a block, and each task draws down what it actually cost us to run, plus a thin buffer for processing. You always see your balance and what the last task cost.
> - **Or have your lab or institution cover it.** A lab, department, or institution can fund a shared pool, so members use BeakerBot without paying out of pocket.
> - **Why it is cheap.** We run an open-weight model and the agent loop runs in your browser, so only a small result ever crosses to the model, never your files. Low cost and your-data-stays-home are the same fact.
>
> (Final credit prices are held until a few weeks of real usage set them from data. During the beta the AI is free.)

### BILLING_FACTS.md
Add an "AI (BeakerBot)" section once numbers lock: the free-vs-metered split, the one-time trial, the prepaid-credit model, the cost-recovery framing and the why, and that it is a separate meter from storage on the same LLC. Keep `BILLING_FACTS.md` canonical (per `feedback_keep_billing_facts_current`).

---

## 5. Implementation notes (for whoever wires billing)

- **The meter**: a per-user AI usage meter (tokens or dollar-cost per task), debiting a credit balance, with the one-time trial credit applied first. The proxy at `frontend/src/app/api/ai/chat/route.ts` already centralizes every AI call, so that is the natural metering point (it sees input/output token counts in the provider response).
- **The balance + trial credit**: stored per user. The lab pool mirrors the storage pool wiring, and the department/institution AI pool reuses the dept/inst plan builder and the recurring-invoice-to-procurement channel, with an AI line beside the storage line (sustaining rate above cost, same as storage).
- **Stripe**: prepaid credit-block purchases (one-time charges), same Stripe account as storage. No new entity.
- **Config as placeholders**: put the rates, the trial credit, and the buffer in a tunable config like `assumptions.ts`, flagged provisional, so they are config-only to change.
- **Build now in test mode**, go-live is config once banking clears (the storage billing followed this exact path, `project_llc_business_ops`).
- **Provider cap**: set the Fireworks hard spend cap before go-live.

## 6. Open items before locking numbers
1. Instrument 5 to 10 real BeakerBot tasks for the true token-per-task distribution (the other chat is exercising BeakerBot live, that is the data source).
2. Grant confirms the trial token grant (about 25 cents worth) and the credit-block prices.
3. Re-pull Fireworks rates at lock time.
4. Update `BILLING_FACTS.md` and add the AI section to the live `/pricing` page and the welcome page.
