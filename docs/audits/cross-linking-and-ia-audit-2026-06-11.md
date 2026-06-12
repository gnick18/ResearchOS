# Cross-linking discoverability audit + SaaS IA research

Date: 2026-06-11. Two parallel investigations (internal route audit + external 10-company research), plus the recommended information architecture and fix plan. Triggered after the shared `AppFooter` was stripped to a brand-only line, which removed the in-app path to the public meta pages.

## TL;DR (the root cause)

Every major SaaS runs **two** footers: a rich **marketing footer** (the site map) on public pages, and **no marketing footer in-app** (brand/chrome only). ResearchOS had **one shared `AppFooter` doing both jobs**, so stripping the in-app footer to a brand line also stripped the marketing pages' site map. The fix is to **split them**: a rich `MarketingFooter` on public pages, the brand-only `AppFooter` in-app, plus an in-app About link cluster in the settings rail.

---

## Part 1: Internal cross-link audit (link-audit bot)

### Current nav surfaces
- **Top nav** (`AppShell.tsx` -> `NAV_ITEMS` in `lib/nav.ts`): Home, Workbench, GANTT, Methods, Sequences, Chemistry, Data Hub, Inventory, Purchases, Calendar, Links (several flag/role gated). Right cluster: BeakerSearch (Cmd-K), notifications, inbox, timers, companion, Help (? -> wiki), Trash, avatar menu.
- **Avatar menu** (`UserAvatarMenu.tsx`): My public profile (sharing-gated), Find researchers (sharing-gated), Settings, dark-mode toggle. No meta/trust links.
- **`AppFooter.tsx`**: stripped to brand line only. No nav links.
- **Settings rail footer** (`SettingsRailFooter.tsx`): the ONLY in-app hub for meta pages, Pricing, Open source, Transparency, Privacy, GitHub + donate. Renders only on `/settings`.
- **Wiki nav** (`lib/wiki/nav.ts`): deep sidebar for `/wiki/**`. Wiki trust/open-source pages are SEPARATE from the public `/open-source` and `/transparency` marketing pages.
- **Welcome/landing** (`WelcomePage.tsx`, `OAuthFirstLanding.tsx`): links `/demo`, `/pricing`, `/open-source`, `/transparency`, `/wiki/compliance/nih-data-management`.

### Reachability classification (highlights)
- **Well-linked**: all top-nav app routes (`/workbench`, `/gantt`, `/methods`, `/sequences`, `/chemistry`, `/datahub`, `/inventory`, `/purchases`, `/calendar`, `/links`), `/settings`, `/trash`, `/search` (palette), `/researchers` (gated), `/lab-overview`, `/demo`, `/wiki/**`.
- **Meta pages well-linked but on one thread**: `/pricing`, `/open-source`, `/transparency`, `/privacy` are reachable in-app ONLY from `SettingsRailFooter` (which renders only on `/settings`). With the site footer stripped, a logged-in user on any other page has no footer path to them.
- **HARD-TO-REACH / ORPHANED (actionable)**:
  - **`/thanks`** (sponsors + OSS thank-you wall): reachable only by typing `/sponsors` or `/thanks`. Not in the welcome page, settings rail, footer, or wiki, and `/open-source` does not link it. Effectively invisible. **Biggest finding.**
  - **`/profile`**: superseded by the in-app ProfileSettingsModal; already redirects to `/settings?section=profile`. Only a stale wiki text mention points at it.
  - **`/sponsors`**: alias that redirects to `/thanks`; nothing links to `/sponsors`.
  - Orphaned dev/test routes (expected, confirm prod-excluded): `/dev-gate`, `/dev-join`, `/dev-lab`, `/dev/account-setup`, `/dev/icons`, `/dev/annotate-demo`, `/sharing-setup-test`, `/chemistry-embed-check`.
  - `/maintenance`: orphaned by design (env-gated holding page).
- **Gap**: there is **no `/about` (company) page**.

### Dead links / duplicates
- **No dead links** to nonexistent routes. The `?` help icon falls back to `/wiki` so it never 404s.
- Intentional redirect aliases: `/sponsors`->`/thanks`, `/buisness`->`/business`, `/admin/business`->`/business`, `/experiments`->`/workbench`, `/results`->`/workbench`, `/pcr`->`/methods`, `/lab-inbox`->`/lab-overview`, `/ai`->BeakerSearch.
- Two distinct "open source" / "transparency" surfaces: public marketing `/open-source` + `/transparency` AND wiki `/wiki/trust/open-source` + `/wiki/trust/method-validation` (not duplicates; the wiki pages link out to the public ones).

---

## Part 2: 10-company SaaS IA research (saas-ia-research bot)

Companies studied: Linear, Vercel, Notion, Stripe, GitHub, Figma, Supabase, 1Password, Tailwind, Airtable, Slack.

### Common patterns
1. **Marketing footer = the "everything map,"** grouped into 4-7 named columns. Reliable spine: **Product/Features · Resources/Developers · Company · Legal**. Density scales with enterprise focus (Stripe/Vercel dense; Linear/Notion/Supabase tight).
2. **Legal lives in ONE place**, never scattered: its own "Legal" column (Linear, GitHub, Slack, 1Password) or a thin bottom utility row (Airtable, Vercel folds into Company). Privacy + Terms always together.
3. **Trust/Security and Status split by audience**: a marketing Security/Trust page sells to buyers; a Status page is operational on its own subdomain. Enterprise sellers graduate to a full Trust Center portal.
4. **Pricing is dual-homed and one-directional**: marketing `/pricing` sells and CTAs into the app; plan management lives in-app under Settings -> Billing (Linear, Notion, Vercel, Supabase, Airtable, Slack).
5. **The in-app product has NO marketing footer, universally.** In-app users reach meta pages via a Settings surface (billing/account), a Help/Docs link, and legal-only-when-needed (signup/billing fine print).
6. **Top nav is short and stable: 4-6 items** (Product · Solutions? · Resources · Pricing · Docs/Enterprise + auth CTAs). Company/About/Legal demoted to the footer.

### Best practices for ResearchOS
- Footer = the site map; top nav = the pitch. Don't crowd nav with About/Privacy.
- Legal gets its own footer column or thin bottom row.
- **Transparency is our Security/Trust page** (science validation + AGPLv3 + local-first IS the trust pitch); it deserves a named footer slot AND a nav slot.
- Status page only when we run cloud services (metered storage / collab relay); skip for now.
- In-app: no marketing footer (brand-only is correct); route via Settings rail + Help.

---

## Part 3: Recommended IA + fix plan

### (a) Marketing footer (new `MarketingFooter`, 4 columns + thin legal row)
- **Product**: Features / Workbench, Pricing, Live demo, Docs/Wiki
- **Open & Trustworthy** (our differentiator column): Transparency, Open source (AGPLv3) & credits, Security & data ownership (local-first), Sponsors & thanks
- **Company**: About, Contact, GitHub
- **Resources**: Docs/Wiki, Help, Community
- **Thin bottom row**: brand line (kept) on the left; Privacy · Terms · License (AGPLv3) on the right
- Voice: minimal, state-the-why, no em-dashes / emojis / mid-sentence colons. Keep to 4 columns; resist enterprise density.
- Used on: welcome, pricing, transparency, open-source, thanks, privacy.

### (b) Marketing top nav (5 items + CTA)
Product · Pricing · Transparency · Docs · About + buttons [Open app] [Try the demo]. Transparency earns a nav slot (most credibility-moving page for institutions).

### (c) Per-page placement
| Page | Top nav | Footer | In-app |
|---|---|---|---|
| Pricing/billing | yes | yes (Product) | Settings -> Billing (manage) |
| About/company | no | yes (Company) | no |
| Privacy + Terms + License | no | yes (bottom row) | signup + billing |
| Transparency | yes | yes (Open & Trustworthy) | Help / About panel |
| Open-source credits | no | yes (Open & Trustworthy) | About panel |
| Sponsors/thanks | no | yes (Open & Trustworthy) | no |
| Docs/wiki | yes | yes | Help menu |
| Live demo | yes (CTA) | yes (Product) | no |

### (d) In-app surfacing
- Keep the brand-only in-app footer.
- Settings left rail: an **About ResearchOS** cluster (version + links out to Open source & credits, Transparency, License AGPLv3, Privacy, Terms, Thanks) so legal/trust pages are reachable in-app without chroming every screen.
- A persistent Help affordance (the ? -> wiki) plus a Contact / send-feedback link.

### (e) Orphan fixes
- `/thanks`: add to the marketing footer (Open & Trustworthy) and cross-link from `/open-source`.
- `/profile`: already redirects to `/settings?section=profile`; fix the stale wiki text mention.
- Confirm dev/test routes are excluded from production builds.
- Consider creating a proper `/about` company page (currently missing; all 10 companies have one).

---

Sources: linear.app, vercel.com, notion.com, stripe.com, github.com, figma.com, supabase.com, 1password.com, tailwindcss.com, airtable.com, slack.com, plus trust-center best-practice writeups (secureframe, drata, scytale). Internal: `lib/nav.ts`, `lib/wiki/nav.ts`, `AppShell.tsx`, `UserAvatarMenu.tsx`, `AppFooter.tsx`, `SettingsRailFooter.tsx`, `WelcomePage.tsx`, `OAuthFirstLanding.tsx`, full `app/**/page.tsx` route enumeration.
