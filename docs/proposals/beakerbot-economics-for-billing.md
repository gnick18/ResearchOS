# BeakerBot economics brief, for the billing/marketing bot

Purpose: a handoff so the billing/marketing role can price the AI assistant and draft it into the welcome and billing pages. Written by HR, 2026-06-11. House voice for any customer copy you derive from this, no em-dashes, no emojis, no mid-sentence colons, state the WHY (researchers read unexplained claims as a scam).

Canonical billing copy still lives in docs/branding/BILLING_FACTS.md, update it when pricing lands. Never promise "never charge", the sustainability model allows metered cost-recovery (see [[project_sustainability_pricing_model]], [[project_llc_business_ops]]).

## 1. What the product is (for the welcome/marketing framing)

Two things share one search box (BeakerSearch):
- BeakerSearch, instant search across all the user's work (notes, experiments, methods, sequences, Data Hub tables, projects, purchases, molecules). Runs ON the user's device against their local folder. No LLM, no server call, no cost. This is the FREE tier and it is always on.
- BeakerBot, the AI assistant. The user can hand a query to BeakerBot from the same bar. BeakerBot reasons, perceives the page, can take actions, runs real statistics, makes graphs, and writes into notes (always with the user's approval on writes). This is the PAID tier, it calls a hosted language model, so it "uses credit".

The billing split is exactly that line: local search is free forever, the AI calls cost money to run, so the AI is metered. Frame it as cost-recovery, not profit. The platform is free and local-first; we charge for the AI only because each AI task costs us real money in inference, and we pass that through close to cost.

## 2. Why our costs are low (a real trust + margin point)

The architecture keeps cost and data exposure small, and this is worth saying to customers:
- The agent loop runs IN THE BROWSER. Only the conversation and small tool results travel to the model, never the user's bulk data, never their files. We move answers, not data.
- Search is on-device and free. The model is only invoked when the user explicitly asks BeakerBot.
- When BeakerBot looks something up, only a compact result (a few names and numbers) crosses to the model, not the artifact bodies.

So the privacy story (your data stays on your machine) and the cost story (we only pay for the AI moments you choose) are the same story.

## 3. Provider and model (the facts to price against)

- Provider: Fireworks AI (OpenAI-compatible inference). Endpoint api.fireworks.ai/inference/v1. Swappable via env AI_PROXY_BASE_URL.
- Model: gpt-oss-120b, OpenAI's open-weight 120B model, served by Fireworks. The locked default (design doc docs/proposals/ai-assistant.md section 10). Swappable via env AI_MODEL.
- Why this model: it is open-weight (politically neutral, which matters for NIH-funded labs nervous about China-origin weights), strong at textbook science, and cheap to run serverless. Being open-weight also means we can SELF-HOST it later to cut per-token cost further if volume justifies it. That self-host option is the long-run margin lever.
- How it is called: a thin server proxy at /api/ai/chat holds the key (AI_API_KEY, server-only, never shipped to the browser) and forwards only known fields. We are not locked to Fireworks, the base URL and model are env-swappable, so you can price alternatives (other Fireworks models, a self-host, another OpenAI-compatible host) without code changes.

## 4. What actually drives cost (so you can model unit economics)

BeakerBot is an AGENT LOOP, not a single prompt. One user task can be several model round-trips:
- Each turn sends the running conversation plus the tool definitions, and the model may call a tool, which sends another turn with the tool result, and so on until it answers. A task that runs an analysis and writes a note might be 3 to 6 round-trips.
- So a single task consumes meaningfully more tokens than a one-shot chat. The design mockups show a per-task readout like "last task 31k tokens", treat tens of thousands of tokens per substantive task as the working assumption, and validate it by instrumenting a few real tasks.
- Output tokens typically cost more than input tokens. The system prompt and tool definitions are resent each turn (input), so input token volume is also non-trivial.

What you need to research and decide:
1. Current Fireworks per-token rates for gpt-oss-120b (input and output separately). Pull the live pricing, do not trust a remembered number.
2. Tokens per typical task, instrument 5 to 10 real BeakerBot tasks (a question, an analysis, a graph, a note write) to get a real distribution, not a guess.
3. Unit cost per task = (input tokens x input rate) + (output tokens x output rate), averaged over that distribution.
4. The credit-to-dollars mapping and a free monthly allowance (a generous allowance likely covers casual users, mirroring the metered-storage approach in [[project_llc_business_ops]]).
5. Markup. Per the sustainability model this is cost-recovery plus a thin buffer for proxy/overhead, not a profit center. State that reason in the copy.

## 5. Billing model direction (already implied by the UI)

- The AI is metered with a visible credit balance and per-task token cost (the mockup shows "$4.10 credit left" and "last task 31k tokens"). Users see what a task cost.
- This rides the same LLC cost-recovery framing as metered cloud storage (the LLC collects and pays the provider, see [[project_llc_business_ops]], EIN obtained, Mercury account in flight). No separate entity needed.
- A cost circuit breaker already exists (runaway-bill guard, [[feature_cost_circuit_breaker]]), if spend exceeds budget it pauses cloud AI while local search keeps working. Grant must still set provider-side hard caps.
- Not live yet. Billing wiring is buildable in test mode now, go-live is config once banking clears.

## 6. Page-by-page asks (what to draft)

- Welcome / onboarding page: introduce BeakerSearch (free instant search) and BeakerBot (the AI coworker). Lead with what it DOES (find, analyze, plot, write up), and that search is free and local. Mention the AI is optional and metered, briefly, without scaring.
- Billing / pricing page: the free local-first core, then the AI as metered cost-recovery. State the WHY (each AI task costs real inference money, we pass it through near cost, open-weight model keeps it cheap and your data never leaves your machine). Include the free allowance and how credits map to dollars once you set them.

## 7. Pointers
- Full AI design + hosting/compliance research: docs/proposals/ai-assistant.md (sections 10 model, 12 tools, 13 one front door).
- The unified search GUI (v2, approved): docs/proposals/beakersearch-v2-build.md and docs/mockups/beakersearch-unified-redesign.html.
- Proxy + model config: frontend/src/app/api/ai/chat/route.ts (DEFAULT_MODEL, DEFAULT_BASE_URL, AI_API_KEY, AI_MODEL, AI_PROXY_BASE_URL).
- Sustainability + LLC + metered framing: the memory files project_sustainability_pricing_model, project_llc_business_ops, project_ai_assistant.
- Canonical customer billing copy to update: docs/branding/BILLING_FACTS.md.

## 8. Image processing economics (vision support, 2026-06-13)

BeakerBot can now accept images (a screenshot, a photo, a figure the user made elsewhere). Image turns route to a vision model (Llama 3.2 11B Vision on Fireworks) via the router in /api/ai/chat; text and tool turns stay on the text model. These are working ESTIMATES to validate by instrumentation, not measured medians yet (see "validate" below).

The one new fact: how many tokens an image costs.
- A 512px image is about 1,610 tokens on Llama 3.2 Vision (source below). A larger screenshot or figure uses more, scaling with resolution and the tile count (up to about 4 tiles on the 11B), so call it roughly 1,600 tokens for a small image and up to about 6,000 for a large high-resolution one. A reasonable working figure for a typical resized screenshot or figure is 2,000 to 3,000 tokens.
- The image is a SMALL marginal add on a turn. The bulk of a BeakerBot turn is the agentic overhead (the system prompt plus the tool definitions, plus any tool round-trips). So adding an image to a question costs about the same as asking the question, plus roughly 2,000 tokens for the picture. Looking at an image is cheap; the reasoning around it is the cost, same as text.

Anchored to the gift (750,000 tokens = about 25 cents at the placeholder rate), the same way the hard and simple question counts are framed:
- A hard agentic task (run an analysis, write a note, several round-trips) is about 29,000 tokens, so about 25 to 26 per 25 cents.
- A simple text question (one round-trip) is a few thousand tokens, so hundreds per 25 cents.
- A simple image question ("what is in this screenshot", one round-trip plus about 2,000 image tokens) is a few thousand tokens, so ESTIMATED at well over 100 per 25 cents.
- An involved image task ("here is my graph and the data behind it, suggest ways to improve the aesthetics", a few round-trips plus the image plus the data) lands near a hard task, so ESTIMATED at a couple dozen per 25 cents.

So the customer-facing line extends cleanly: 25 cents is about 26 full analyses, OR hundreds of quick questions, OR roughly a hundred-plus image questions, OR a couple dozen involved figure-improvement sessions. The picture itself adds only about 2,000 tokens, so an image question costs about what a text question does.

Why this matters for pricing: the router only invokes the vision model on turns that actually carry an image, and the image is a small token add, so adding vision support does not materially change the per-task economics or the gift coverage. Vision pricing on Fireworks is the same per-token rate as the text model.

VALIDATE before this goes into customer copy: the live status line now captures real per-turn token usage (prompt plus completion). Once the image UI ships (behind NEXT_PUBLIC_BEAKERBOT_VISION), instrument 5 to 10 real image calls (a what-is-in-this-screenshot, an improve-my-figure with data) and read the actual token totals, then replace the estimates above with measured medians and update docs/branding/BILLING_FACTS.md. Do not put the estimated counts into customer copy until measured.

Source for the per-image token figure: a 512x512 image is about 1,610 tokens on Llama 3.2 Vision (https://medium.com/data-science/chat-with-your-images-using-multimodal-llms-60af003e8bfa), with the count scaling by resolution and tile count per the Llama 3.2 vision model card (https://www.llama.com/docs/model-cards-and-prompt-formats/llama3_2/).
