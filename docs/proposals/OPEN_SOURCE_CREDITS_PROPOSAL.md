# Built on open source: credits and license-attribution proposal

Status: build-ready, fleshing out an existing partial implementation
Author: open-source credits manager
Date: 2026-06-04

## TL;DR

ResearchOS already ships most of a "Built on open source" system. A `/open-source`
page, a generator script, a `THIRD_PARTY_NOTICES` file, and an `ACKNOWLEDGEMENTS.md`
all exist on `main`. This proposal documents what is there, verifies the actual
license obligations against the real dependency tree, and closes the gaps that keep
the system from being trustworthy. The two gaps that matter are that the generator is
not enforced in the build, so the committed data has already drifted (it is missing
11 runtime dependencies), and that the copyleft members of the tree (one MPL-2.0
package and one dual MIT-or-GPL package) are not called out as needing any special
handling. Everything else is largely in good shape and just needs wiring and a refresh.

This doc doubles as the license-compliance plan, so the obligations below are stated
precisely and grounded in the licenses actually present.

## Goal

One in-app "Built on open source" acknowledgements page that does two jobs at once.

1. Thanks the open-source and scientific community Grant wants to credit, in plain
   warm language, naming the projects ResearchOS leans on most.
2. Satisfies the legal attribution obligations of every license in the shipped
   dependency tree, plus the vendored and ported source, so distributing ResearchOS
   stays compliant.

The page is the friendly face. A repo-level `THIRD_PARTY_NOTICES` file is the formal
inventory. Both are generated from the same source of truth so they cannot disagree.

## What already exists (verified on `main`)

- Route: `frontend/src/app/open-source/page.tsx` renders `OpenSourceCredits` with no
  AppShell and no data-folder gate, exactly like `/welcome`. It is excluded from the
  wiki-coverage map in `scripts/check-wiki-coverage.mjs` as an informational page.
- Body: `frontend/src/components/open-source/OpenSourceCredits.tsx`. Heartfelt intro,
  a "Recently added" featured pair (expr-eval-fork, the Biopython Tm port), curated
  highlights grouped by area, a "Code we recycle" vendored section, scientific
  references, and a collapsible full dependency list. It fetches
  `/open-source/credits.json` on mount. House style is respected (inline SVG icons,
  no emojis, the shared link styles).
- Generator: `scripts/build-open-source-credits.mjs`. Reads each runtime dependency's
  installed `node_modules/<pkg>/package.json` for the real version, license, and
  repository, with a pnpm-store fallback. Emits `credits.json` and `THIRD_PARTY_NOTICES`.
  Has a `--check` mode that re-derives and diffs (ignoring the volatile timestamp) and
  exits non-zero on drift. Curated highlight notes, vendored entries, and the three
  scientific references are hand-written constants in the script, transcribed from the
  vendored LICENSE files and from `src/lib/calculators/tm-nn.ts`.
- Outputs committed: `frontend/public/open-source/credits.json`, repo-root
  `THIRD_PARTY_NOTICES`, repo-root `ACKNOWLEDGEMENTS.md` (the warm human-readable
  mirror).
- Tests: `scripts/lib/__tests__/open-source-credits.test.mjs` exercises the script's
  pure helpers (repo-url normalization, license coercion, build shape).
- Footer link: `frontend/src/components/AppFooter.tsx` carries a subtle "Built on open
  source" link to `/open-source` (test id `app-footer-open-source`).
- npm scripts: `credits:build` and `credits:check` exist in `frontend/package.json`.
- Own license: `frontend/package.json` declares `AGPL-3.0-or-later`; the full AGPLv3
  text is at repo-root `LICENSE`.

So this is not a greenfield build. It is a finish-and-harden pass.

## Gaps this proposal closes

1. The generator is not wired into the build. `frontend/package.json` `prebuild` runs
   the wiki, demo, and AI-helper steps but never `credits:check` or `credits:build`.
   Nothing keeps the committed artifacts current.
2. Because of gap 1, the committed `credits.json` is already stale. It lists 36
   runtime dependencies while `package.json` declares 47. The 11 missing packages are
   `@aws-sdk/client-s3`, `@aws-sdk/s3-request-presigner`, `@neondatabase/serverless`,
   `@noble/ciphers`, `@noble/curves`, `@noble/hashes`, `@scure/bip39`,
   `@upstash/ratelimit`, `@upstash/redis`, `next-auth`, and `resend`. These were added
   to the project after credits were last generated. They are not attributed anywhere
   today, which is the exact drift the system was built to prevent.
3. Copyleft members of the tree are listed but never flagged as special. `ical.js` is
   MPL-2.0 (weak, file-level copyleft) and `jszip` is dual `MIT OR GPL-3.0-or-later`.
   Neither forces anything painful on us, but the reasoning should be written down so a
   future dependency bump does not quietly cross a line.
4. The page never surfaces the license summary it already computes (`licenseCounts`),
   so a reader cannot see the license mix at a glance.

## Page design

Where it lives. The `/open-source` route, standalone, no AppShell, no data-folder
gate, mirroring `/welcome`. Anyone with the URL can read it, signed in or not.

How it is linked. The AppFooter "Built on open source" link is the primary entry. We
should also add it to the public About or marketing footer so the page is reachable
before a folder is connected, which matters for the LabArchives trust-flip framing
where openness is a selling point.

Structure, top to bottom.

1. Heartfelt intro. Gratitude first, concept first. Thanks the OSS community and the
   scientists whose published methods the calculators reproduce, and ties it to why
   ResearchOS is itself free and open. This copy already exists and reads well.
2. Recently added. A small featured pair for the newest or most notable attributions,
   currently expr-eval-fork and the Biopython Tm port.
3. What powers each part of the app. Curated highlights grouped by area (writing
   surface, sequence and cloning, calculators, charts and files and state, the
   framework). Each row shows the package, our one-line "what it does for us" note,
   the real version, and a license pill. Versions and licenses are injected from the
   generated data, never hand-typed.
4. Code we recycle. The vendored and ported source that is not an npm package, with
   the upstream copyright and license shown exactly as the authors wrote it. Currently
   SeqViz (MIT), TeselaGen tg-oss bio-parsers (MIT), and the Biopython Tm port (BSD).
5. Scientific references. The three citations behind the primer Tm, transcribed
   verbatim from the source file.
6. License mix (new, small). A one-line summary rendered from `licenseCounts`, for
   example "Built on 47 packages: 41 MIT, 2 Apache-2.0, 1 BSD-3-Clause, 1 MPL-2.0, 1
   dual MIT or GPL." This is informational and updates itself.
7. Every dependency we ship. The full alphabetical list in a collapsible block, each
   with version, license pill, and source link. Already implemented.
8. Footer note. Where the same data lives in the repo (`THIRD_PARTY_NOTICES`,
   `ACKNOWLEDGEMENTS.md`), plus the generation date.

The page must keep working when `credits.json` cannot be fetched. The current code
shows an amber fallback pointing at the repo files. Keep that.

## Auto-generation

Approach: a hand-rolled license-checker, not a dependency. The existing
`scripts/build-open-source-credits.mjs` is the right design and should stay. It uses
only Node's `fs`, reads each runtime dependency from `package.json`, resolves the real
`version`, `license`, and `repository` from that package's own installed
`package.json` (with a pnpm-store fallback for the shared-worktree case), and fails
loudly if a declared dependency is not installed. That is the license-checker pattern
(the same idea as `license-checker` or `license-checker-rspack`) without taking on a
new dependency, which is the correct call for a project that is itself making a point
about its dependency hygiene.

What it emits, from one run.

- `frontend/public/open-source/credits.json`: the data the page consumes. Full
  dependency list plus the curated sections.
- repo-root `THIRD_PARTY_NOTICES`: the formal per-package inventory with name, version,
  license, and source URL, plus the vendored and ported source with preserved
  copyright, plus the scientific references.

Curated facts that cannot be derived from `package.json` (the "what it does for us"
notes, the vendored copyright lines, the citations) live as constants in the script
and are transcribed verbatim from the source they credit. This is the right boundary.
Auto-derive the machine facts, hand-write the human gratitude, never guess either.

Keeping it current. This is the load-bearing change. Wire the generator into the build
so drift cannot ship.

- Add `node ../scripts/build-open-source-credits.mjs --check` to the `frontend`
  `prebuild` chain, alongside the existing wiki and AI-helper checks. A stale or
  missing artifact then fails the build, exactly as `check-ai-helper` does today.
- Commit the generated artifacts (they already are), so the data is reviewable in PRs
  and readable from the repo without an install.
- Optionally add a lightweight CI step or a pre-push reminder that runs
  `credits:build` and surfaces a diff, mirroring the existing `ai-helper:refresh`
  pattern. Not strictly required once `--check` is in `prebuild`, but it makes the fix
  one command (`pnpm --filter frontend credits:build`) instead of a guess.

The immediate action item is to run `credits:build` once now to pick up the 11 missing
dependencies, commit the refreshed `credits.json` and `THIRD_PARTY_NOTICES`, then add
the `--check` to `prebuild` so it stays honest. That work is code and is out of scope
for this docs-only proposal; it should be a follow-up chip.

## Repo-level compliance

- `THIRD_PARTY_NOTICES` at the repo root is the single formal inventory and already
  exists. It must list every shipped runtime dependency with its license, which it
  will once regenerated against the current tree.
- `ACKNOWLEDGEMENTS.md` is the warm, human-readable mirror and already exists. Keep it
  generated from the same source so it cannot drift from the notices file. (Today it
  is hand-maintained prose that mirrors the script constants. The cleanest end state is
  to have the script emit the grouped-by-license section of `ACKNOWLEDGEMENTS.md` too,
  so all three outputs share one generator run.)
- Apache-2.0 NOTICE aggregation. Apache-2.0 requires redistributing any `NOTICE` file
  that an Apache-licensed dependency ships. The two Apache-2.0 deps in the tree are
  `@vercel/speed-insights` and `idb-keyval`. Verified against the installed packages,
  neither ships a `NOTICE` file, so there is nothing to aggregate today. The compliance
  rule to write down is that if a future Apache dependency does ship a `NOTICE`, its
  contents must be reproduced in our `THIRD_PARTY_NOTICES` (an "Apache NOTICE
  aggregation" subsection). The generator should be taught to detect a `NOTICE` file in
  each Apache dependency and fail the build if it finds one that is not yet aggregated.
- Vendored and ported source. The full upstream LICENSE text must be retained beside
  the code. This is already done for SeqViz and tg-oss
  (`frontend/src/vendor/seqviz/LICENSE`, `frontend/src/vendor/bio-parsers/LICENSE`) and
  the Biopython attribution lives in the header of
  `frontend/src/lib/calculators/tm-nn.ts`. Confirm each vendored dir keeps its
  unmodified LICENSE and that the Tm port header names the Biopython license and the
  three papers verbatim.

## Specific attribution debt and the exact obligation

Licenses actually present in the shipped runtime tree, with what each requires a
distributor to include. Counts reflect the tree after regeneration.

- MIT (the large majority, including all of CodeMirror and Lezer, React, Next.js,
  recharts, marked, the unified/remark/rehype stack, turndown, zustand,
  @tanstack/react-query, date-fns, @react-pdf/renderer, react-konva, konva,
  frappe-gantt, expr-eval-fork, @vercel/analytics, and the newly-added @noble/*,
  @scure/bip39, @upstash/*, @neondatabase/serverless, next-auth, resend). Obligation:
  retain the copyright notice and the MIT permission text in distributions. Our
  `THIRD_PARTY_NOTICES` listing each package with its license, plus the linked source
  carrying the full text, satisfies this.
- Apache-2.0 (`@vercel/speed-insights`, `idb-keyval`). Obligation: retain copyright,
  license, and any `NOTICE` file; state significant changes if you modify and
  redistribute the source. We do not modify them, and neither ships a `NOTICE`, so
  listing them with the Apache-2.0 license in the notices file is sufficient today. The
  NOTICE-detection rule above guards the future case.
- BSD-3-Clause (`diff`). Obligation: retain the copyright notice and the three-clause
  license text, and observe the no-endorsement clause (do not use the authors' names to
  promote ResearchOS). Listing it in the notices file with its source meets the
  attribution duty; the no-endorsement clause is a behavioral constraint we simply
  follow.
- MPL-2.0 (`ical.js`). Weak, file-level copyleft. Obligation: keep the MPL notice and
  attributions on the covered files, and make the source of those covered files (and
  any modifications to them) available under MPL-2.0. We consume `ical.js` unmodified
  as an npm dependency and do not redistribute its source as part of our own files, so
  combining it into our larger work is explicitly permitted by MPL Section 3.3 and our
  own AGPL code is unaffected. The compliance note: if we ever fork or edit `ical.js`
  source directly, those modified files must stay under MPL-2.0 with their source
  offered. Listing it with its license and source link in the notices file is the
  attribution we owe now.
- jszip, dual `MIT OR GPL-3.0-or-later`. A dual license lets the recipient choose
  either license. We elect MIT for jszip and treat it as MIT (retain copyright and the
  MIT text). Document the election explicitly in `THIRD_PARTY_NOTICES` so there is no
  ambiguity and so the GPL option is never accidentally read as a copyleft obligation on
  our tree.

Vendored and ported source obligations.

- SeqViz (MIT) and TeselaGen tg-oss bio-parsers (MIT): retain the upstream copyright
  and MIT text beside the vendored code. Done via the vendored LICENSE files.
- Biopython Tm port (Biopython License, a BSD-style permissive license): retain the
  Biopython copyright and license notice with the ported code. Done via the
  `tm-nn.ts` header. Because it is a port (a derivative), the header must clearly state
  it is derived from Biopython's `Bio.SeqUtils.MeltingTemp.Tm_NN`, which it does.

No strong copyleft (GPL-only, LGPL, AGPL) was found in the runtime dependency tree.
The only GPL appearance is jszip's dual option, which we decline in favor of MIT. This
matters because ResearchOS itself is AGPLv3, but that is our own choice on our own
code, not an obligation inherited from a dependency.

## Community thank-you framing

Grant's intent is genuine thanks, not box-checking. The page leads with gratitude and
names projects warmly before it ever shows a license pill. Two framing rules to hold.

- Gratitude before legalese. The intro and the curated highlights come first; the full
  inventory is collapsed below. A reader should feel thanked before they feel audited.
- Credit the people and the science, not just the packages. The vendored section names
  the upstream authors (Lattice Automation, TeselaGen, the Biopython contributors), and
  the scientific references credit the researchers behind the calculators. Keep that.

The AGPLv3 own-license obligation already in play. ResearchOS is itself
`AGPL-3.0-or-later`. AGPLv3 Section 13 adds a network-use clause on top of GPLv3: if a
modified version is run as a network service that users interact with remotely, those
users must be offered the Corresponding Source of that running version at no charge.
ResearchOS is a client-side app over a folder, but it is deployed on the web, so the
clean way to satisfy Section 13 is a persistent, prominent "source" link in the footer
or the About page that points at the public repository. The "Built on open source"
footer link already lives next to where this belongs, so the same footer should carry
a clear link to the ResearchOS source. That closes our own-license loop in the same
place we close everyone else's.

## Phasing

- Phase 1 (now, code follow-up): run `credits:build` to clear the 11-package drift,
  commit the refreshed `credits.json` and `THIRD_PARTY_NOTICES`, and add
  `credits:check` to the `frontend` `prebuild` so drift can never ship again.
- Phase 2: small page additions, surface the `licenseCounts` summary line, and add the
  jszip MIT-election note and the MPL-2.0 reasoning to `THIRD_PARTY_NOTICES`.
- Phase 3: teach the generator to detect an Apache `NOTICE` file in any Apache
  dependency and fail until it is aggregated, and have the generator emit the
  grouped-by-license section of `ACKNOWLEDGEMENTS.md` so all three outputs come from
  one run.
- Phase 4: add a prominent source-repository link to the footer or About page to
  satisfy AGPLv3 Section 13, and add the `/open-source` link to the public marketing
  footer so it is reachable pre-onboarding.

## Open questions

- AGPLv3 source link placement. Footer everywhere, the About page, or both? Section 13
  wants it prominent for network users, so a persistent footer link is the safest read.
- Should `ACKNOWLEDGEMENTS.md` become fully generated (Phase 3), or stay hand-curated
  prose with only the license summary generated? Fully generated removes a drift
  surface but loses some of the warm hand-written phrasing.
- Should `devDependencies` ever be listed? They are not shipped to users, so no
  attribution is owed. Recommend leaving them out and saying so on the page, to keep
  the list honest about what actually ships.
- Do we want a CI job in addition to the `prebuild --check`, or is the build gate
  enough? For a single-maintainer project the build gate is likely sufficient.

## Sources

License obligations verified against the installed dependency tree and the following.

- [MPL 2.0 FAQ, Mozilla](https://www.mozilla.org/en-US/MPL/2.0/FAQ/)
- [Open Source Software Licenses 101: Mozilla Public License 2.0, FOSSA](https://fossa.com/blog/open-source-software-licenses-101-mozilla-public-license-2-0/)
- [GNU Affero General Public License v3.0, FSF](https://www.gnu.org/licenses/agpl-3.0.en.html)
- [Do I need to provide access to source code under the AGPLv3 license?, Opensource.com](https://opensource.com/article/17/1/providing-corresponding-source-agplv3-license)
