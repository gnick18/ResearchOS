# AI Helper — proposal

## Context

ResearchOS is local-first, no backend, no API budget for shipping a built-in chatbot. But every researcher who uses it already has at least one general-purpose chatbot account (Claude, ChatGPT, Gemini, often more than one). Grant's framing:

> What if we wrote out a very very detailed instructions document that could be fed into any users ai chatbot of choice. This instruction document once fed into the agent would make the agent a super helpful support line that knows every single in and out of the website. It can tell them where to link to navigate, give them tips on features, if it has access to their data folder it can even help write drafts of experiments or tasks as it would be trained on the EXACT structure of every item we offer users on our site.

The bet: a single hand-tuned prompt, pasted into the user's own account, turns whatever model they already pay for into a ResearchOS-fluent assistant — feature support, navigation help, schema-aware drafting of tasks/methods/experiments. Free for us, free for them, no data leaves their machine unless they themselves paste it into the chat.

The deliverable splits in three:

1. **AI_HELPER_PROMPT.md** — the actual paste-in document. Authored once, refreshed per release.
2. **In-app affordance** — Settings card with copy-to-clipboard + "Open in <provider>" buttons.
3. **Per-provider setup guides** — short wiki pages explaining paste-in-chat vs persistent-context (Claude Project / Custom GPT / Gem) for each major model.

This proposal is the gate before any of those ship. Mirrors the [RESULTS_PAGE_PROPOSAL.md](RESULTS_PAGE_PROPOSAL.md) / [LISTS_TAB_PROPOSAL.md](LISTS_TAB_PROPOSAL.md) / [ONBOARDING_TIPS_PROPOSAL.md](ONBOARDING_TIPS_PROPOSAL.md) pattern: thesis, design decisions, open questions, then implementation chips fire only after Grant green-lights.

## Inventory: what the prompt has to know

The doc is a teaching artifact. To be useful, it must encode:

**Architecture mental model**
- Local-first, no backend, FSA-backed. No data ever leaves the user's machine through ResearchOS itself. The two `/api/*` proxy routes (Telegram CDN, ICS feeds) are the ONLY network egress; both are CORS workarounds, not data uploads. ([AGENTS.md:19](AGENTS.md:19))
- Per-user folder layout under `users/<username>/`, plus `users/public/` for cross-user shared methods. ([AGENTS.md:75-104](AGENTS.md:75))
- Per-user ID namespaces (Grant's task 1 != Kritika's task 1). Composite `taskKey()` semantics. ([AGENTS.md:106](AGENTS.md:106))
- Cross-owner sharing model: tasks/projects/methods can be shared with `view`/`edit` permissions; receivers see them via `_shared_with_me.json` overlay. Cross-owner project hosting via `<projectId>-hosted.json` manifest. ([AGENTS.md:255](AGENTS.md:255))

**Complete entity schemas**
Pulled directly from [frontend/src/lib/types.ts](frontend/src/lib/types.ts). Every entity the app stores on disk:
- `Project` ([types.ts:134](frontend/src/lib/types.ts:134))
- `Task` + `SubTask` + `TaskMethodAttachment` ([types.ts:171](frontend/src/lib/types.ts:171), [:179](frontend/src/lib/types.ts:179), [:210](frontend/src/lib/types.ts:210))
- `Dependency` ([types.ts:353](frontend/src/lib/types.ts:353))
- `HighLevelGoal` + `SmartGoal` ([types.ts:389](frontend/src/lib/types.ts:389), [:395](frontend/src/lib/types.ts:395))
- `Method` ([types.ts:429](frontend/src/lib/types.ts:429)) + 5 structured method protocols:
  - `PCRProtocol` + `PCRStep` + `PCRCycle` + `PCRGradient` + `PCRIngredient` ([types.ts:470-521](frontend/src/lib/types.ts:470))
  - `LCGradientProtocol` + steps + column + ingredients ([types.ts:525-595](frontend/src/lib/types.ts:525))
  - `PlateProtocol` + `PlateRegionLabel` + `PlateWellAnnotation` ([types.ts:597-678](frontend/src/lib/types.ts:597))
  - `CellCultureSchedule` + planned/actual events ([types.ts:680-778](frontend/src/lib/types.ts:680))
- `PurchaseItem` + `FundingAccount` ([types.ts:793](frontend/src/lib/types.ts:793), [:846](frontend/src/lib/types.ts:846))
- `Event` + `CalendarFeed` + `ExternalEvent` ([types.ts:900](frontend/src/lib/types.ts:900), [:952](frontend/src/lib/types.ts:952), [:968](frontend/src/lib/types.ts:968))
- `LabLink` ([types.ts:995](frontend/src/lib/types.ts:995))
- `Note` + `NoteEntry` + `LabNote` ([types.ts:1096](frontend/src/lib/types.ts:1096), [:1068](frontend/src/lib/types.ts:1068), [:1138](frontend/src/lib/types.ts:1138))
- `SharedUser`, `SharedItemNotification`, `EventReminderNotification`, `ShiftAlertNotification` ([types.ts:3-91](frontend/src/lib/types.ts:3))

**Canonical examples per entity**
The fixture under [frontend/public/demo-data/users/](frontend/public/demo-data/users/) IS the schema-by-example. Two seeded users (alex, morgan), 4 projects, ~25 tasks, attached methods of every structured type, real-shaped purchase items, etc. The prompt embeds compact examples per entity, drawn from the fixture (never the user's real folder).

**Feature inventory per route**
Every top-level route the app ships, what it does, and the canonical workflow a user reaches it through:
- `/` (home), `/workbench`, `/calendar`, `/gantt`, `/methods`, `/purchases`, `/lab`, `/search`, `/links`, `/results` (redirect), `/experiments` (redirect), `/settings`, `/wiki/*`, `/demo`.

**Common workflows**
- Create a shared experiment (project → task → attach method → share with collaborator).
- Export a method as a reusable PCR/LC/Plate/Cell-culture protocol.
- Link tasks via dependencies + the cascade-shift mechanic.
- Run an experiment with method variations (snapshot semantics: per-task `pcr_gradient`/`lc_gradient`/etc. snapshots are independent of source).
- Pair Telegram, subscribe to a calendar feed, import an ELN ZIP from LabArchives.

**Behavior rules / limitations**
- Always ask before generating, prefer questions over assumptions when populating fields.
- Never invent fields not in the schema. Never reference real user data in examples.
- All paths are local; the model has no live access unless the user pastes content in.
- Date math is weekend-aware per project; durations include both endpoints.

**Wiki cross-references**
Every workflow points to the corresponding wiki page so the user can deepen if they want. The doc names the wiki section, the URL, and what the section covers.

## Doc structure outline (AI_HELPER_PROMPT.md)

Numbers are the order in the file; length budgets in tokens (rough — calibrated against tokens.openai-style ratios, ~4 chars/token for English).

| § | Section | Length budget | Source / how it's authored |
|---|---|---|---|
| 1 | **Identity preamble** — "You are ResearchOS Helper. Your job is..." Plain English, includes refusal posture ("if asked to invent fields not in the schema, decline + explain"). | 400 tok | Hand-written |
| 2 | **What ResearchOS is** — local-first thesis, FSA storage model, no-backend posture, what privacy guarantees that gives. | 500 tok | Distilled from [AGENTS.md:7-22](AGENTS.md:7) + [README.md](README.md) |
| 3 | **Mental model: how data is shaped** — per-user folders, per-user ID namespaces, sharing + hosting, the `_shared_with_me.json` overlay, the `<projectId>-hosted.json` manifest. | 700 tok | Distilled from [AGENTS.md:75-117](AGENTS.md:75) + [AGENTS.md:255](AGENTS.md:255) |
| 4 | **Entity schemas** — TypeScript-style interface dump for every entity, with field comments inline. The big section. | 5,000-7,000 tok | Generated/extracted from [frontend/src/lib/types.ts](frontend/src/lib/types.ts) verbatim, with field comments preserved and a 1-line plain-English gloss appended per interface |
| 5 | **Canonical examples** — one filled JSON example per entity, drawn from the fixture. Helps the model pattern-match shape. | 4,000-5,000 tok | Pulled from `frontend/public/demo-data/users/{alex,morgan}/...` with paths shown |
| 6 | **Feature inventory by route** — every page, one paragraph thesis + the data it foregrounds + the affordances it offers. | 3,000-4,000 tok | Hand-written, cross-referenced against [frontend/src/lib/nav.ts](frontend/src/lib/nav.ts) + the wiki tree at [frontend/src/lib/wiki/nav.ts](frontend/src/lib/wiki/nav.ts) |
| 7 | **Common workflows** — 8-10 bread-and-butter flows step by step, plus the relevant wiki link. Each is "user goal → click path → what got created on disk." | 3,000 tok | Hand-written |
| 8 | **Behavior rules + refusal posture** — drafting protocol (ask first, never fabricate fields), real-data privacy, "I don't have live folder access" boundary, how to format generated JSON. | 800 tok | Hand-written |
| 9 | **When the user wants you to draft a task/method** — concrete templates the model should follow, including which fields are required, which are sensible defaults, which to ASK about. | 1,500 tok | Hand-written |
| 10 | **Wiki references** — table mapping concepts to wiki URLs (`https://research-os-xi.vercel.app/wiki/...`). | 500 tok | Generated from [frontend/src/lib/wiki/nav.ts](frontend/src/lib/wiki/nav.ts) |
| 11 | **Versioning footer** — doc version + ResearchOS commit hash + date. | 50 tok | Auto-stamped at build/refresh time |

**Full version target: 19,000-23,000 tokens.** Comfortable headroom inside Claude Sonnet 4.6 (200k), Opus 4.7 (200k+1M), GPT-5 (~400k), Gemini 2.5 Pro (1M+). Tight on Haiku 4.5 (200k) but still fits with room to converse. Tight on Gemini Flash and Mistral small models (often 32k-128k).

**Lean version target: 8,000-10,000 tokens.** Drop §5 (canonical examples — model infers from §4 schemas), trim §6 to one sentence per route, trim §7 to 3-4 hero workflows. Schema section stays full because that's where the prompt earns its keep.

**Minimal version target: 3,000-4,000 tokens.** §1 + §2 + condensed §3 + the most-used 4 entity schemas (Project, Task, Method, PurchaseItem) + 2 hero workflows. For tiny windows or the user who just wants "a chatbot that knows the basics."

## Provider strategy

Three target providers in v1: Claude (anthropic.com), ChatGPT (chatgpt.com), Gemini (gemini.google.com). All three offer both an ephemeral paste path AND a persistent-context path; the in-app affordance recommends persistent.

| Provider | Paste in chat | Persistent context (recommended) | Notes |
|---|---|---|---|
| **Claude** | New chat, paste full prompt as the first message. Re-paste each new chat. | **Claude Project** with the prompt added as Project knowledge / instructions. New chats inside the Project inherit it. | Free tier: limited Projects. Pro/Team: unlimited. Best for the full 19k-23k version since 200k context comfortably accommodates it plus folder data the user pastes. |
| **ChatGPT** | New chat, paste full prompt. Re-paste each new chat. | **Custom GPT** with the prompt as the system message. Sharable URL. Or **Project** (chatgpt.com Projects) with the prompt as project-level instructions. | Free: Custom GPTs available to use, not to create. Plus/Pro: create + share. Custom GPT system message limit was 8k chars at one point — verify current cap before publishing instructions; lean version is the safer recommendation for Custom GPT, full version for Project-instructions. |
| **Gemini** | New chat, paste full prompt. Re-paste each new chat. | **Gem** with the prompt as instructions. Free tier supports Gems. | 1M context on 2.5 Pro; the full version fits with room. Flash variants are tighter (usually 1M on 2.5 Flash too, but smaller working memory). |

**Other providers acknowledged but not first-class in v1:** Mistral, DeepSeek, local Ollama instances, Cursor/Windsurf inline AI, GitHub Copilot Chat, Perplexity. The doc is provider-agnostic; the in-app affordance starts with three buttons + a generic copy-to-clipboard for everyone else.

**Per-provider deep-link strategy:** The in-app "Open in Claude" button copies the prompt + opens `https://claude.ai/new` in a new tab. ChatGPT: `https://chatgpt.com/`. Gemini: `https://gemini.google.com/app`. None of these support a query-param prefill for the system message today — the user pastes after the tab opens. Acceptable; a clipboard-copy + tab-open pair gives them everything they need in one click.

## Length-budget vs context-window reality check

Modern chatbots in 2026:

| Model | Context window | Full (19-23k) fits? | Lean (8-10k) fits? | Minimal (3-4k) fits? |
|---|---|---|---|---|
| Claude Opus 4.7 | 200k / 1M | Yes, plenty | Yes | Yes |
| Claude Sonnet 4.6 | 200k | Yes, ~10% used | Yes | Yes |
| Claude Haiku 4.5 | 200k | Yes, with room | Yes | Yes |
| GPT-5 | ~400k | Yes | Yes | Yes |
| GPT-5 mini | ~128k | Yes, ~15% | Yes | Yes |
| Gemini 2.5 Pro | 1M+ | Yes | Yes | Yes |
| Gemini 2.5 Flash | 1M | Yes | Yes | Yes |
| Local 7B/13B (Ollama) | 8k-32k typical | No | Often no | Yes |
| Cursor Custom Modes | varies | varies | likely yes | Yes |

**Recommendation:** ship all three sizes. The in-app affordance defaults to **lean** as the "Copy AI Helper prompt" primary, with a "Need the full version (best for drafting)?" secondary and a "Tiny version (small models)" tertiary.

Rationale: most users will start with the lean version (good fit everywhere, plenty of capability), graduate to full when they discover the model can draft an entire experiment from scratch given the schemas, and reach for minimal only when they're targeting a constrained model.

## In-app affordance

**Primary surface: Settings → "AI Helper" section.** Lands between `MaintenanceSection` and `TipsSection` at [frontend/src/app/settings/page.tsx:240](frontend/src/app/settings/page.tsx:240). Mirrors the existing section shell (`<SectionShell>`) for visual consistency.

Layout sketch:

```
┌─ AI Helper ──────────────────────────────────────────────────┐
│  Train your own AI chatbot to know ResearchOS inside out.    │
│  Paste this prompt into Claude, ChatGPT, or Gemini and the   │
│  chatbot becomes a schema-aware support assistant.           │
│                                                              │
│  Pick a size:  ( ● Lean  ○ Full  ○ Minimal )                 │
│                                                              │
│  [ Copy prompt to clipboard ]                                │
│                                                              │
│  Open in:  [ Claude ↗ ]  [ ChatGPT ↗ ]  [ Gemini ↗ ]         │
│                                                              │
│  Each "Open in" button copies the prompt and opens the       │
│  provider in a new tab. Paste it as your first message       │
│  (or in your Project / Custom GPT / Gem instructions for     │
│  a persistent helper).                                       │
│                                                              │
│  Last refreshed: 2026-05-15 · ResearchOS @ fb73fac7          │
│  [ Read setup guide → ]   [ View prompt source → ]           │
└──────────────────────────────────────────────────────────────┘
```

**Click contracts:**

- "Copy prompt to clipboard" → `navigator.clipboard.writeText(prompt)`, 4s confirmation toast ("Copied N tokens to clipboard").
- "Open in Claude/ChatGPT/Gemini" → copies + opens provider in new tab (`window.open(url, "_blank", "noopener")`).
- "Read setup guide →" → `/wiki/integrations/ai-helper`.
- "View prompt source →" → opens the raw `.md` from the served `public/` (or links to GitHub) so power users can audit before pasting.

**Where the prompt lives at runtime:** static files in `frontend/public/ai-helper/{full,lean,minimal}.md`. Loaded lazily on Settings mount via `fetch("/ai-helper/full.md")` so the Settings bundle stays small. No FSA needed.

**First-run discoverability:** The onboarding tip system already ships ~10 tips. Add an 11th — `ai-helper-prompt` — pointing at the Settings section. Coordinates with the (now-closed) tip manager's catalog at [frontend/src/lib/onboarding/tips.ts](frontend/src/lib/onboarding/tips.ts). Cheap, mirrors the existing pattern.

**Optional secondary surface (defer):** A small "Help" button in the AppShell cluster that opens a side-panel with the prompt + the same three provider buttons + a quick "Ask any AI about ResearchOS →" framing. More discoverable than Settings, more visual weight to commit. Defer to v2 — Settings card is enough for v1 if we wire the onboarding tip.

## Maintenance model

The doc decays with every shipped feature. Three approaches considered:

**Approach 1: Manual refresh per release.** Maintainer hand-edits `AI_HELPER_PROMPT.md` after each feature lands. Simple, reliable, but easy to miss. Estimated cost: 30-60 min per release.

**Approach 2: Full auto-generation.** Schemas extracted from `types.ts` via a build script; feature inventory generated from the wiki nav tree; workflows kept in a separate hand-curated file. Build script stitches them together at build time, writing `public/ai-helper/{full,lean,minimal}.md`. Higher up-front cost; near-zero per-release maintenance once it works. Risk: generated prose reads worse than hand-written.

**Approach 3 (recommended): Hybrid.** Schemas + canonical examples + wiki-nav tables auto-generated; identity preamble + mental model + workflows + behavior rules hand-written and edited per release. Build script stitches `partials/*.md` (hand-written) with generated sections into the three size variants. Incurs a one-time build script cost; per-release maintenance is "edit the partials, run `npm run ai-helper:build`."

**Build script sketch:**

```
scripts/build-ai-helper.mjs
  ├── reads frontend/src/lib/types.ts → emits §4 (schemas)
  ├── reads frontend/public/demo-data/users/{alex,morgan}/* → emits §5 (examples)
  ├── reads frontend/src/lib/wiki/nav.ts → emits §10 (wiki refs)
  ├── reads ai-helper/partials/{1-identity,2-architecture,3-mental-model,
  │     6-features,7-workflows,8-behavior,9-drafting}.md → §1-3, §6-9
  ├── stitches into public/ai-helper/full.md
  ├── derives public/ai-helper/lean.md (drop §5, trim §6/§7)
  └── derives public/ai-helper/minimal.md (top 4 schemas + 2 workflows)
```

Run the script as part of `prebuild` (same hook as `wiki:coverage`, [scripts/check-wiki-coverage.mjs](scripts/check-wiki-coverage.mjs)) so Vercel deploys + local builds stay in sync. Add `npm run ai-helper:check` as a CI gate that fails the build if schemas in `types.ts` changed since the last `ai-helper:build` run (compare hash of the schema section vs a checked-in `.ai-helper-checksum`). Forces refreshes to land with the schema change rather than drift.

**Versioning:** the footer (§11) carries the ResearchOS git commit hash + ISO date the prompt was built from. Users who paste an old prompt into a new ResearchOS install can self-audit. Major schema changes (rare) bump a `helper_version` integer the prompt instructs the model to mention if it's older than what the user's app expects. Defer the auto-mismatch detection — the footer is enough for v1.

## Privacy posture

The prompt is a public artifact (committed to the public repo, served from `frontend/public/`). Anything in it is essentially published forever, indexable by search engines.

**Hard rules baked into the build script:**

1. Examples come ONLY from `frontend/public/demo-data/users/`. The script greps for "alex" and "morgan" usernames in fixture files; rejects any example file whose owner field isn't one of those two. Fail the build if any other username slips in.
2. Schemas are source-only (no values, just type definitions). Cannot leak user data by definition.
3. Workflows reference the demo data by name (project "Engineer FakeYeast for biofuel") and never reference real research projects.
4. The prompt explicitly instructs the model: *"If a user pastes content from their data folder for you to operate on, treat it as private. Do not summarize, classify, or store it beyond the current conversation. Do not echo it back outside the response the user explicitly asked for."* Cannot enforce this server-side (the model ignores it as it pleases) but sets the right contract.

**Author guard rail:** the partials live in `ai-helper/partials/` and any change to them goes through the same review path as code (Grant approves). A pre-commit hook (or just a manual code-review checklist item) verifies no real folder paths sneak in. Cheap test: grep the partials for `gnickles`, `OneDrive-UW-Madison`, `FungalInteractionsLab`, `ResearchOS_PersonalStorage`, etc. — fail if any match.

**The fixture is also published.** Demo data has been an open artifact since `?wikiCapture=1` shipped. The AI Helper doc inherits that posture. New examples in the prompt should land in the fixture first if they're not already there, so the prompt and the published demo stay in lockstep.

## Security manager handoff

The security manager is in flight on a separate audit. The AI Helper doc has a real attack surface to think about, even though it never exposes user data directly:

**Threats worth a security review pass on the draft prompt:**

1. **Architecture-disclosure footgun.** The prompt teaches readers (any reader, not just users) the exact storage model: file paths, sidecar conventions, gitignore patterns, where Telegram tokens live, etc. Does this give an attacker a useful map of where to look on a compromised user's disk? Mitigation: the on-disk format is already public (`AGENTS.md` is in the repo); the prompt mostly mirrors what's already documented. But worth security manager's eyes on whether anything sensitive (e.g., `_telegram.json` token format) deserves a less-explicit treatment.

2. **Prompt-injection vectors.** A user pastes their notes content into the chatbot ("help me clean this up"). Notes content can contain markdown, links, even base64-encoded images. A malicious note (e.g., received via a shared task) could carry a prompt-injection payload that the chatbot then acts on. Mitigation: the prompt's behavior section instructs the model to treat pasted content as data, not instructions. Standard prompt-injection caveats apply.

3. **Drafting-mode footgun.** The model can draft entire JSON files for a Task/Method/etc. If a user copies+pastes that JSON into their data folder without reading it, the model could (accidentally or maliciously) include malicious JS in markdown bodies, references to attacker-controlled URLs, or trojan dependencies. Mitigation: the prompt instructs the model to never include external URLs in drafts, never include scripts in markdown, and to flag the user to "read this before saving" any time it produces a JSON blob. Worth security review.

4. **Cross-user impersonation.** The prompt teaches the schema for shared tasks + the `_shared_with_me.json` overlay. Could a malicious user craft a shared task with a payload that triggers something on the receiver's side? This is a ResearchOS app concern (covered by the security audit independently), not an AI Helper concern, but the doc does make the attack surface more legible to attackers. Acceptable trade-off; flag for review.

**Concrete handoff:** once the v1 draft of `AI_HELPER_PROMPT.md` lands, route it to the security manager for a single review pass focused on items 1-3 above. They get veto on specific phrasings; final-call on whether anything stays out of the prompt entirely (and if so, what the gap-filler is).

## Out of scope (v1)

- **BYO API key in-app integration.** Grant explicitly punted this to avoid "free software pays AI costs." A future v2 could add an opt-in "paste your own API key, ResearchOS calls Claude/OpenAI/Gemini directly with the prompt baked in" path. Not v1.
- **MCP server for ResearchOS.** A natural future direction: build a Model Context Protocol server that exposes the data folder as an MCP resource, so any MCP-aware client (Claude Desktop, ChatGPT, Cursor) can read it directly without paste. Heavyweight, requires MCP runtime investment, defer until the paste-prompt approach proves out.
- **Per-user customization of the prompt.** v1 ships the same prompt to every user. v2 could embed lab-specific context (the user's PI, their project list, their conventions) for a more bespoke helper. Defer.
- **In-app chat surface.** No floating chatbot in the corner. Settings + copy + paste into your own account is the v1 surface.
- **Live folder access for the chatbot.** The prompt instructs the model "you don't have live access — ask the user to paste folder contents." Bridging that gap (file-upload UI, paste-an-image-of-your-data, etc.) is v2 if it ever happens.

## Candidate theses considered

Three structural theses for what the AI Helper feature is and how it ships. Recommended thesis is **A**.

### Thesis A — Single hand-tuned prompt per size, copied + pasted (recommended)

**Pitch:** Author one master prompt at three size points (full / lean / minimal). Build script stitches hand-written partials with auto-generated schemas and examples. In-app Settings card lets the user copy + open any major provider in one click. Provider setup guides as wiki pages.

**Pros:**
- Zero ResearchOS-side AI cost forever.
- Works with every provider, every tier (free included).
- User has full control: can read the prompt before pasting, can edit it, can save it as a Project / Custom GPT / Gem for persistence.
- The prompt is also documentation — improves the project's discoverability for new contributors who can read it to learn the system.

**Cons:**
- Prompt drifts as features ship; requires maintenance discipline (mitigated by the hybrid build script + CI checksum gate).
- Quality varies by provider model + tier; no guarantee.
- User still has to paste folder contents into chat for drafting workflows; not as smooth as native folder access.

### Thesis B — Per-feature mini-prompts instead of one mega-doc

**Pitch:** Ship 5-10 narrowly scoped prompts ("ResearchOS PCR Helper," "ResearchOS Methods Helper," "ResearchOS Workflow Drafter"). User picks the one for the task at hand.

**Considered, rejected.** Higher discovery cost (which prompt do I use for X?), worse for general questions ("what does the Workbench page do?" — does that go to Workflow Drafter? PCR Helper?), more files to maintain. The single prompt is small enough at 19-23k tokens that splitting buys nothing real.

### Thesis C — MCP server now, prompt later

**Pitch:** Build the MCP server first; let MCP clients introspect the schema via the protocol; the prompt becomes a thin wrapper directing users to "install the MCP server."

**Considered, rejected for v1.** MCP adoption is still early and uneven across providers. ChatGPT and Gemini don't speak it natively yet (as of 2026-05). Forces users into Claude Desktop or Cursor to use the feature. Higher implementation cost (server + install path + per-client config). Worth considering for v2 once MCP is universally supported.

## Open questions for Grant

These are the design calls Grant should weigh in on before implementation chips fire. **Answers to these gate the chip burst.**

1. **Three size variants vs just one (lean)?** The proposal recommends shipping all three. Alternative: ship only lean, which fits everywhere comfortably. Gives up the "this model can draft entire experiments from scratch" power-user pitch but cuts maintenance to a single file. **Default I'll proceed with: ship all three.**

2. **First-run onboarding tip for AI Helper?** Adds an 11th tip to the orchestrator catalog ([frontend/src/lib/onboarding/tips.ts](frontend/src/lib/onboarding/tips.ts)) that surfaces the Settings card after a couple of route-dwell minutes. Cheap, follows the existing pattern. Alternative: don't surface it; let users discover it in Settings. **Default I'll proceed with: add the tip.**

3. **Build script vs hand-maintained?** Recommended hybrid (script for schemas/examples/wiki-refs, hand-written for prose) costs ~3-4 hours of script-writing up front. Alternative: hand-maintain the whole doc and accept ~1h per release. **Default I'll proceed with: hybrid build script.**

4. **Wiki page path?** Proposal lands a wiki page at `/wiki/integrations/ai-helper` (peer of telegram, calendar-feeds, labarchives). Alternative: `/wiki/features/ai-helper` (peer of home, gantt, methods). Integrations frame is more honest (the doc is the integration with the user's external chatbot account); Features frame is more discoverable. **Default I'll proceed with: `/wiki/integrations/ai-helper`.**

5. **Should the prompt include the security model in detail?** The Threats section above flags this. Specifically: do we list the exact location of `_telegram.json`, the gitignore pattern that protects it, and the fact that the file contains a bot token? The information is already in `AGENTS.md` (public repo) and the user's `.gitignore`, but encoding it in the AI Helper doc makes it more visible to anyone who reads the prompt. **Default I'll proceed with: include the architecture but treat token-containing sidecars as "stored locally with sensible defaults" without naming the file format. Defer to security manager review.**

6. **In-app affordance: Settings card only, or also a top-of-app "Help" button?** Settings card is the v1 minimum. The "Help" button in AppShell would be more discoverable but adds visual chrome. **Default I'll proceed with: Settings card only for v1; revisit "Help" button after we see usage.**

7. **Does the prompt include Lab-mode + LabArchives integration documentation?** Both are real ResearchOS features but more niche (multi-user lab folders + the LabArchives ELN import flow). Including them adds ~1k tokens to the full version. Excluding them leaves a real feature gap. **Default I'll proceed with: include both in full and lean; exclude from minimal.**

8. **Output format for drafted entities?** When the model is asked "draft a Task for me," should it output JSON ready to paste into the data folder, or a copy-pasteable form (field labels + values) that the user fills into the UI? JSON is faster for power users, scarier for newbies. **Default I'll proceed with: JSON output WITH a "fields to fill in the UI" cheatsheet alongside, plus a "always read this before saving" warning.**

If Grant has a clear preference on any of these, I'll fold it in before chip burst. If silent, I proceed with the defaults above.

## Deliverables + chip burst plan

Once this proposal is green-lit:

**Chip 1 — Build script + partials skeleton.** Land `scripts/build-ai-helper.mjs` + `ai-helper/partials/*.md` + `npm run ai-helper:build` + the CI checksum gate. Empty partials are fine; chip 2 fills them. Produces empty-shell `public/ai-helper/{full,lean,minimal}.md`. ~250 LOC.

**Chip 2 — Author the partials.** The actual writing pass. Identity preamble, architecture summary, mental model, feature inventory, workflows, behavior rules. ~6,000-8,000 tokens of prose across 7 partial files. Sized for a single dedicated chip session.

**Chip 3 — Settings affordance.** Add `<AIHelperSection>` to `app/settings/page.tsx`. Fetches the three sizes lazily, copy-to-clipboard, "open in provider" buttons, footer with version stamp. Uses existing `<SectionShell>`, `<Tooltip>`, no new primitives. ~150 LOC + ~50 LOC of toast plumbing if not already shared.

**Chip 4 — Onboarding tip.** Add the 11th tip to `tips.ts`, `setupAction.href = "/settings#ai-helper"`. Reuses existing tip infra. ~30 LOC.

**Chip 5 — Wiki handoff.** Master relays a wiki-page brief to the wiki manager covering: the integration page itself + per-provider setup subsections + screenshot list (Settings card, the three "Open in" tabs landing, an example chat exchange in each provider). I write the technical brief; wiki manager owns voice + screenshots + WIKI_NAV registration.

**Chip 6 — Security review.** Once chip 2 lands, route the draft prompt to the security manager for the threats-1-3 review pass. Their findings drive a chip 6.5 if anything material surfaces.

**Estimated total time-to-ship for v1:** 5-7 working sessions across the chip sequence above. Most expensive piece is chip 2 (the actual prose), which is a single dedicated session.

**Maintenance contract once landed:** every domain manager (methods-expansion, /purchases, etc.) flags AI Helper implications in their final report when their feature ships. AI Helper manager (this role) periodically refreshes partials based on those flags + runs `npm run ai-helper:build` to roll out. CI checksum gate forces re-builds when `types.ts` schemas change — caught at build-time, not in production.

---

— AI Helper manager
