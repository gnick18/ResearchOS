# Paid AI assistant, hosting and compliance research

Deep-research synthesis (2026-06-10) on offering an optional, paid, browser-resident agentic AI assistant for ResearchOS. The assistant orchestrates the validated client-side stats engine, it never computes the numbers itself. The agent loop runs in the browser with tools over the local data folder, the model is a remote inference endpoint called per turn, only per-turn context leaves the device.

107 research agents, 25 sources fetched, 111 claims extracted, 25 adversarially verified (23 confirmed, 2 killed). Every claim below is cited to a primary or law-firm source and survived a 2-of-3 verification vote unless noted.

## The headline reframe

The "Chinese model makes NIH labs nervous" worry is mostly optics and institutional policy, not export-control law.

- Open, published model weights are explicitly excluded from US export control. ECCN 4E091 (Jan 2025 AI Diffusion framework) does not control published model parameters, and the BIS May 2025 statement targets the flow of US compute toward China-headquartered parties, not running Chinese open weights on US infrastructure for US academics. Open and published weights fall outside the controls regardless of origin. Sources: federalregister.gov AI Diffusion rule, bis.gov May 2025 statement, WilmerHale and Sidley analyses.
- The fundamental research exclusion (15 CFR 734.8(c)) keeps published fundamental-research results outside EAR and ITAR scope, but it does not authorize sending unpublished, in-progress data to a third-party AI endpoint. Pre-publication bench data is exactly the still-restricted category.

## The real binding constraint

Institutional data-governance, not export control, is what actually governs this. Universities restrict submitting Sensitive, Confidential, or identifiable research data to any unsupported third-party AI tool, regardless of which model it is. Georgia State prohibits submitting university-classified Sensitive or Confidential data, or anything that directly identifies an individual, to AI tools the university has not vetted. The pattern is corroborated by UW-Madison, UCSF, UC Irvine, Rutgers, UConn, and NAU. Exact data-classification tiers vary by institution. Source: technology.gsu.edu generative-AI guidance plus corroborating .edu offices.

Design consequence. Picking a Western model instead of a Chinese one does not solve the problem, because the problem is the data flow, not the model nationality. The same design answer holds for any model.

- Strictly opt-in, off by default.
- Send the minimum context, never bulk data or writes.
- Per-query consent about what leaves the device.
- Let each lab map the feature to its own university data-classification policy rather than asserting one.
- Offer a stronger-contract tier for labs whose data office requires it.

Model nationality shrinks to a trust-optics decision (Llama or Mistral still read easier than DeepSeek), no longer a legal blocker either way.

## Economics

Default zero-retention on open weights is real and confirmed.

- Fireworks does not log or store prompt or generation data for open models without explicit opt-in, data exists only in volatile memory for the request. Source: docs.fireworks.ai data_security, data_handling.
- DeepInfra keeps text-inference input in memory only and deletes on completion, and does not train on submitted data. Carve-outs to carry forward, it logs debug metadata (request ID, cost, sampling params), reserves the right to log a small portion of requests for debugging or security, its bulk and batch APIs do persist to encrypted disk temporarily, and third-party hosted models (Google, Anthropic) on its platform follow the receiving company policy rather than DeepInfra zero-retention. Source: deepinfra.com/docs/data.

Self-hosting only breaks even at high sustained volume. RunPod lists A100 SXM 80GB at $1.49/hr, A100 PCIe at $1.39/hr, H100 SXM at $3.29/hr, H100 PCIe at $2.89/hr. A single always-on A100 is about $1,073/month fixed, paid even at zero usage, and a full-size DeepSeek V3 or R1 needs multiple GPUs. For a bursty, optional add-on, pay-per-token serverless wins until throughput is large and steady. Source: runpod.io/pricing. Confirms the plan, serverless now, self-host-capable architecture always, own-the-GPUs only when scale justifies it.

Provider read for the default.

- Fireworks is the strong default. SOC 2 Type II and HIPAA compliant (validated by a third-party auditor, guided by Vanta), default zero-retention on open weights, OpenAI-compatible, tool-calling. Best compliance paper trail among the OSS hosts. Caveat, the specific BAA terms and whether HIPAA handling is gated to enterprise or dedicated deployments are not publicly documented, verify before sending PHI. Source: fireworks.ai blog, trust.fireworks.ai.
- DeepInfra is cheap with a zero-retention default, but read the carve-outs above.
- Avoid Together for the compliance story, its HIPAA and BAA claim was refuted 0 to 3 against its own SOC 2 blog.
- Premium tier for labs that demand a contract, Anthropic enterprise ZDR plus a HIPAA-ready BAA path, and OpenAI does not train on API data by default (effective March 1, 2023).

## Architecture correction

A pure browser-only design is not fully contract-compatible with the strongest providers.

- Anthropic ZDR organizations cannot use CORS, so browser-based apps must use a backend proxy. API keys must never be exposed in browser JavaScript. ZDR is a contractual arrangement via sales, not default-on, and policy-violation data can be retained up to about two years. Source: platform.claude.com api-and-data-retention.
- Stripe metered billing also needs a trusted server.

Therefore even the browser agent needs a thin token-minting proxy for key custody, CORS, and per-query metering. This slots into the relay-style infrastructure ResearchOS already runs for sharing. The bulk data still never touches it, only the per-turn context does, so the local-first guarantee holds with one small trusted hop for the key and the meter.

## Anthropic ZDR and HIPAA specifics

Under ZDR, Anthropic does not store API inputs or outputs at rest after the response, except as needed to comply with law or combat misuse, and it still retains User Safety classifier results. ZDR covers the Messages and Token Counting APIs and Claude Code for Enterprise. HIPAA-ready API access with a signed BAA is offered as an alternative to ZDR and does not cover Bedrock, Vertex AI, Claude Platform on AWS, Microsoft Foundry, or Claude Code. Source: platform.claude.com, privacy.claude.com.

## Open gaps to close before launch

- Concrete per-token pricing, retention defaults, hosting jurisdiction, tool-calling, and OpenAI-compatible endpoint status for Together, Groq, Cerebras, Baseten, and Novita. Only Fireworks and DeepInfra were firmly verified on retention, and no provider token pricing survived verification.
- The precise serverless-vs-self-host break-even token volume, factoring vLLM or SGLang throughput, model size, and utilization, and whether serverless GPU (Modal, RunPod serverless, Fly) changes the math for a bursty add-on.
- Competitive precedent. No verified findings on whether Benchling, LabArchives, GraphPad Prism, or Jupyter AI already ship paid AI assistants over lab data, or how they structure data-privacy contracts and billing.
- Documented prior art for a browser-only LLM agent that reads and writes local files via the File System Access API, and whether any provider sends permissive CORS headers for direct browser calls.

## Time-sensitivity

Export-control rules moved fast in 2025. The broad AI Diffusion country-tier chip framework was rescinded in May 2025, though the load-bearing open-weight carve-out (4E091 excludes published weights) and the FRE doctrine (NSDD-189, 15 CFR 734.8) are stable. Provenance-targeting legislation (No DeepSeek on Government Devices Act, federal-contractor bans, No Adversarial AI Act, the Hawley bill) is largely proposed and scoped to government and contractor devices and the China-hosted DeepSeek API. If any becomes law and broadens to academic use, the provenance posture could shift, re-check before launch. Vendor retention and training policies are self-attested, SOC 2 and ISO audits exist for Fireworks and DeepInfra but the line-by-line zero-retention claims are not independently audited.
