# BeakerBot AI assistant, design proposal

Status: design in progress (2026-06-10). An optional, paid, site-wide AI assistant for ResearchOS. Companion research is `docs/research/ai-assistant/00-hosting-and-compliance.md`. Interface concept sketch is `docs/mockups/ai-assistant-interface-concept.html`.

House voice throughout, no em-dashes, no emojis, no mid-sentence colons, concept-first, state the why.

## 1. What it is

A site-wide assistant, BeakerBot, that helps researchers use ResearchOS and do their work inside it. It is not a chat box bolted onto the corner. It is an LLM plus a tool layer over the app's existing functions plus an authored system prompt, so it operates the software rather than just talking. The "modes" below are tool-set and permission presets of one engine, not separate products.

The defining principle, the LLM ORCHESTRATES, it never computes the truth. The validated stats engine computes statistics, the sequence engine computes Tm and digests and translations, the calculator engine evaluates formulas. The assistant decides which tool to call, fills in arguments, and writes the prose around the result. It cannot fabricate a number, because it is not allowed to do the math.

## 2. Modes

- **Question mode** (read-only, "how do I do X here"). Tools = read the wiki, see the data structure, navigate, and spotlight UI. It cannot write data, because it has no write tool. Grounded in the existing public wiki, so it touches no sensitive data, the privacy story is trivial, the token cost is tiny, and a small cheap model handles it. This is the first ship and the wedge. It can also be free.
- **Coworker mode** (read and write, agentic). Draft and flesh out notes, summarize results, build formulas in the calculator builder, run a Data Hub analysis (the planner is one tool), and drive the sequence page (primer design, annotation, cloning). More tokens and a stronger model for multi-step tool use, so it phases after question mode.

## 3. Navigation and the reused tour substrate

Question mode's "show me how" capability reuses the killed onboarding tour's machinery. The repo already holds 311 `data-tour-target=` anchors, the spotlight and overlay renderer (off via the `V4_TOUR_KILLED` flag), and BeakerBot's `SpeechBubble`. So navigate-and-highlight is a rewiring job, swap the hardcoded tour script for an LLM driver that picks which target to spotlight and what BeakerBot says. The AI version is the good tour, reactive and on demand, instead of the rigid forced walkthrough that got killed. When the deferred tour-code deletion happens, preserve the anchors, the renderer, and the speech bubble. This may be the simpler-onboarding rework.

## 4. Safeguards (first-class)

Strongest to softest:

1. **Capability walls.** Question mode has no write tools in its toolset. It cannot invoke what it was never handed, which is stronger than a prompt that can be misclicked.
2. **Propose-then-approve on every write.** The AI shows the actual diff, BeakerBot says what it wants to do, the user approves or rejects a real reviewable change.
3. **Version-control backstop.** Every approved write is a Loro or CRDT diff with one-click undo. Approve before and revert after, never a one-way door. This is where the ResearchOS architecture makes "AI writes to your data" non-scary.
4. **Engine guardrail.** It cannot fabricate the number to write in the first place.

Tier the asking by reversibility so safeguards do not become nagging. Reversible and in the user's own folder (notes, formulas, analyses) gets light approval plus an optional "allow for this session" allow-list. Irreversible or outward-facing (share to a user, Zenodo deposit, email, delete) gets a hard stop every time, never batched, never allow-listed. Plus a "what can BeakerBot touch" settings panel (the user enables tools per capability, a cautious PI can run pure read-only question mode), an audit log of every AI action, and the outer boundary that the AI only ever touches the user's own data folder. This is essentially the Claude Code permission model.

## 5. Knowledge and voice (no fine-tuning)

You do not retrain to make it better at biology. The base open models already know molecular biology, biochemistry, and physics at textbook depth, and a custom fine-tune breaks the cheap serverless economics and is a maintenance burden. Instead:

- **Voice and rigor** (no em-dashes, scientific tone) via the **system prompt**. Free, instant, editable.
- **Accuracy** via **tools and the user's own data**. This is the real win, reasoning about their experiment beats reciting a textbook.
- **Citations and specific facts** via **RAG**, shortlisted and conditional, not default-on. The assistant retrieves only when a question needs grounding (mostly question mode), pulling small chunks from the wiki plus openly-licensed sources (OpenStax, open-access papers), never copyrighted textbooks. Implemented as just another tool (`searchDocs`) the model calls when it decides it needs to look something up, so token cost stays proportional to value.

## 6. Hosting architecture

The agent loop runs in the browser with tools over the local folder. The model is a stateless remote inference endpoint called per turn, so only per-turn context leaves the device, never bulk data or writes. A **thin token-minting proxy** handles key custody, CORS, and per-query metering (a pure browser client cannot hold keys or use the strongest providers' contracts, and Stripe metering needs a server). The bulk data still never touches it, only the per-turn context does.

Proxy home, decided 2026-06-10, prototype locally first (a Next.js API route acts as the dev proxy, holding the key server-side from env), then a DEDICATED AI proxy in production (Grant's call, the better long-term architecture). The reasoning, the AI proxy is the billing checkpoint with real money flowing through it, so it deserves isolation from the sharing relay, different traffic shape (sustained + token-metered vs occasional ephemeral), smaller blast radius, and a clean auditable money path. The cost is tiny (a small serverless function). Because the client builds against a config-driven proxy URL, local-to-dedicated is just a config swap, so the destination is set without locking anything in now. Build against a provider-agnostic OpenAI-compatible base URL, so "serverless provider," "self-hosted GPU," and "the lab's own endpoint" are all config, not a rewrite.

Serverless per-token beats self-hosting until high sustained volume (an always-on A100 is about $1,073/month fixed). So serverless now, self-host-capable always, own-the-GPUs later if scale justifies it. Provider read from the research, Fireworks is the strong default (SOC 2 Type II plus HIPAA, default zero-retention on open weights, OpenAI-compatible), DeepInfra is cheap with carve-outs, avoid Together for the compliance story, and Anthropic enterprise ZDR plus a HIPAA BAA is the premium tier for labs that demand a contract.

## 7. Compliance posture

Open and published model weights are not export-controlled (ECCN 4E091 excludes published weights), so Chinese-origin open weights run on US infrastructure are legally clean for US academics. The real binding constraint is institutional data-governance, universities restrict sending unpublished, Sensitive, or Confidential data to any unsupported third-party AI, regardless of model. So the design answer is the same for any model, opt-in and off by default, send the minimum context, per-query consent about what leaves the device, let each lab map the feature to its own university policy, and offer a stronger-contract tier. Model nationality becomes a trust-optics decision, not a legal blocker.

## 8. Pricing

Transparent cost-plus with a modest, stated profit margin. Not zero-profit (a provider price hike would make that unsustainable), but modest, enough to keep the project and its maintainer safe and benefit a little. The markup covers three things, all shown on a public page, direct overhead (Stripe fee plus the proxy), a drift buffer for provider price hikes, and a modest margin. Because the base cost is tiny (about 2 to 3 cents per agentic task at roughly $0.75 per million tokens), even a 3x markup is pennies to the lab and still leaves real margin, so cheap-for-them and sustainable-for-us are not a trade-off.

- **Shared prepaid credit packs** at the lab or group level (the PI funds a pool, members draw from it), not subscriptions, matching the local-first no-lock-in ethos. Sell in roughly $20 to $25 packs, since Stripe's 2.9% plus 30 cents fee floor eats tiny top-ups.
- **A live credits meter** showing each task's real token count and remaining credit, the same number the pricing page explains.
- **A public transparency page**, sibling to the existing `/transparency` page, citing the provider's real per-token rate with a link, itemizing the markup with the why, and a "what does $1 buy" calculator. Facts live in `docs/branding/BILLING_FACTS.md`.

## 9. Interface

Fully ours to design, the model has no inherent look. The recommended default, one BeakerBot presence with several surfaces rather than a monolithic chat silo. See the concept sketch at `docs/mockups/ai-assistant-interface-concept.html`.

- A docked, summonable side panel for the conversation, carrying the Ask / Coworker mode toggle and the credit meter.
- Contextual entry points on objects ("ask BeakerBot about this note") that pre-scope the conversation, plus a floating summon button.
- The spotlight overlay for navigation answers.
- Inline approve-or-reject diffs, so writes land in the real editor, not in the chat.

The principle the layout serves, the work lands in the real app (a real note, a real graph, a real ResultsSheet), the panel is only where you talk to it. That is what makes it feel like ResearchOS grew an assistant rather than embedding a chatbot. The exact surfaces get locked the way the pricing did.

## 10. Model selection

Priority order set by Grant, performance first, political safety second, cost third.

The priority logic, the assistant orchestrates rather than doing frontier reasoning, so the capability that matters is reliable tool-calling and instruction-following, not raw benchmark IQ. So the best politically-safe US-origin open-weight model is effectively the best model for this job (it nails the second priority, the cleanest optics for an NIH-nervous lab, and is cheap).

LOCKED 2026-06-10, **OpenAI gpt-oss-120b** (`accounts/fireworks/models/gpt-oss-120b`) is the build-around default. We first locked Meta Llama, but live testing found Fireworks no longer serves ANY Llama on serverless (pay-per-token), Llama is dedicated-deployment-only now, which is the always-on GPU we avoid. The Fireworks serverless catalog (verified 2026-06-10) is DeepSeek-V4, Kimi, MiniMax, Qwen3.6, GLM 5.1, and OpenAI gpt-oss-120b / gpt-oss-20b. Among those, gpt-oss-120b fills the exact slot Llama was meant to, US-origin (OpenAI), open-weight, Apache 2.0 (a cleaner license than Llama's custom terms for the self-host story), strong, tool-calling, available now. It honors all three priorities without leaving Fireworks.

If Llama specifically is ever wanted, it stays reachable by swapping the PROVIDER (DeepInfra or Together serve Llama on serverless), a config-only base-URL + key change, since the proxy is provider-agnostic. Default host, Fireworks (US, default zero-retention on open weights, SOC 2 Type II plus HIPAA, OpenAI-compatible). The model is a config-swappable env value, so this is a default to build around, not an irreversible commitment, and a lab can self-host or bring its own endpoint.

## 11. Open gaps and next steps

- Lock the default model (section 10).
- Close the research gaps, concrete per-token pricing and retention for Together, Groq, Cerebras, Baseten, Novita, the exact serverless-vs-self-host break-even, and ELN competitor precedent (Benchling, LabArchives, GraphPad, Jupyter AI).
- Build order, question mode first (the free wedge, reusing the tour substrate), then coworker mode, then the paid billing wiring.
- Build the deterministic Data Hub planner regardless, it is the free local spine the assistant clips into (already in progress as the guided wizard slice).

## 12. Tool catalog (the roadmap)

Each tool is its own slice, the same shape as the foundation work. The LLM orchestrates, the backing engine computes the truth (the LLM never fabricates numbers or data). Writes go through propose-then-approve plus version-control undo, and the user-controlled autonomy setting (ask-before-doing vs auto) governs actions like clicking.

| Tool | Mode | What it does | Backing truth source | R/W | Status |
|---|---|---|---|---|---|
| get_my_tasks / get_my_projects | question | reads the user's tasks/projects for "what am I working on" | local-api readers | read | DONE (live) |
| read_page + smart spotlight | question | live-perception guide to ANY on-screen element, premium animation | live DOM / a11y tree | read (view) | in flight (replaces the manifest tools + the tour) |
| search_docs (RAG, triggered) | question | answers "how do I / what is" from the wiki + OpenStax, with citations | wiki + openly-licensed corpus | read | planned |
| read_my_notes / methods / results / sequences / inventory | question | reads the user's other data for "where/what" questions | local-api / Loro stores | read | planned |
| click_element | coworker | performs a UI click for the user | live DOM | write (action) | NEXT (autonomy-gated, ask/auto setting) |
| write_note / edit_note | coworker | drafts, fleshes out, summarizes into a note | notes store (Loro, VC-undo) | write | planned (propose-approve) |
| run_analysis (Data Hub) | coworker | NL -> proposed analysis plan -> runs it | validated stats engine + the planner | write | planned (planner already built) |
| make_graph / create_table (Data Hub) | coworker | builds a figure or table from data | plot-spec + column/xy table | write | planned |
| design_primer / annotate_sequence / plan_cloning | coworker | drives the sequence editor | sequence engine (Tm/digest/translate) | write | planned |
| build_calculator / run_calculator | coworker | makes or runs a lab calculator | calculator engine | write | planned |
| create_method / edit_method | coworker | authors a method | methods store | write | planned |
| share / export / Zenodo deposit | coworker | sends data outward | existing sharing/deposit | write (outward) | later (HARD-STOP confirm always, never auto) |

The autonomy setting governs the write/action tools: "ask before doing" (default, propose-then-confirm) vs "auto". Outward-facing tools (share/export/deposit) are a hard stop regardless of the setting.
