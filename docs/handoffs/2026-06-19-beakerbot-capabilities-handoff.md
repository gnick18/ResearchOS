# BeakerBot capabilities + lab-head copilot, handoff

Date 2026-06-19. Lane: BeakerBot AI + the PI (lab-head) copilot + a Claude Design design-system package. All work is on `origin/main` unless noted. House style throughout, no em-dashes, no emojis, no mid-sentence colons.

## TL;DR

Five threads. The PI copilot is COMPLETE (18 tools, zero deferred) and live-verified. Three new BeakerBot capabilities landed or got specced, network sharing (built), inline settings (built, one open bug), and an auto-plan offer (specced, decisions locked, not built). A design-system package is built and ready to push into Claude Design. One unrelated blocker (the demo-lab-network lane broke the Turbopack build on main) was hit and FIXED this session (`81c6d2a64`).

## 1. Lab-head PI copilot, COMPLETE at 18 tools

Was 14 deferred-at-3. Now all six categories ship, zero deferred. The three previously-blocked tools were unblocked by realizing the hybrid lab mirror ALREADY syncs each member's full DataHubDocContent (columns, rows, analyses-with-resultCache, plots) decrypted to the PI, so they were thin adapters, not a delegated-compute build.

Shipped:
- Deposit data layer (`0c930689b`), persistent `Deposit` record type (`lib/types.ts` + `depositsApi`), written on hand-off by `DepositDialog`/`ProjectDepositDialog`, synced to the mirror as recordType "deposit".
- `dmsp_compliance` (`589122787`), the deposit ledger + DOI/version completeness + a coarse output-vs-deposit gap.
- Edit-the-DOI-later UI (`115e338c7`, `components/deposit/ExistingDepositsPanel.tsx`), a "Your deposits" panel at the top of both deposit dialogs with an inline-editable DOI.
- `reproduce_member_result` (`c7ae6d790`), reruns each saved AnalysisSpec on the member's synced table via the pure `runAnalysis`, diffs vs the stored resultCache within a tolerance, reports match/mismatch/stale/uncomputable.
- `lab_plots` (read) + `lab_figure` (action) + a cross-member FigureSource `lab_member_plots` (`dc021c3a7`), members' plots become placeable panels in the PI figure builder (rendered live via the pure `renderPlot`), and `lab_figure` composes chosen plots into a PI-owned figure page. `list()` returns empty for non-heads.

The 18 tools, 3 oversight + 3 mentorship + 3 grants (incl dmsp_compliance) + 3 operations + 6 quality/synthesis (incl reproduce_member_result, lab_plots, lab_figure). All in `lib/ai/tools/lab-head.ts` + `lib/ai/tools/lab-figure.ts`.

Verification:
- `lib/lab/__tests__/lab-head-copilot-e2e.test.ts`, seeds two synthetic members, round-trips through the lab mirror with REAL lab-key crypto (in-memory relay double, ciphertext only), drives 13 read tools against the PI read-back, asserts real numbers. reproduce_member_result hits a genuine MATCH.
- LIVE-VERIFIED on /lab-overview, lab_pulse returned the seeded member's real counts (3 experiments, 10 new records, 2 stalled, per-member breakdown), reproduce_member_result reran the t-test and reported a match.
- `/dev-lab` gained "E. Seed member work" + "F. Make me a lab head" buttons, sharing the fixture module `lib/lab/dev/synthetic-member-seed.ts` with the e2e test, so the copilot is testable WITHOUT a 2nd browser. Flow, Create lab, 1. Login, A. invite, B. simulate accept, C. finalize, E. seed, F. make lab head, reload, open /lab-overview.

GOTCHAS:
- The copilot mounts only for `account_type === "lab_head"` and uses the LAB_HEAD tool scope on /lab-overview (`LabHeadCopilotMount` calls setToolScope). The general BeakerBot tools (settings, network) are NOT in scope there, test those on a normal page like /workbench.
- "F. Make me a lab head" must set BOTH `account_type` AND `lab_id`, the copilot resolves the lab from `readUserSettings().lab_id` (`lab-scoped-read.ts:89`), fixed this session.
- Live-relay stale-state, if a /dev-lab run fails with "no sealed copy" or a 409, the relay holds an old lab. Bump LAB_ID or clear `relay/.wrangler/state`.
- NONE of the 18 tools is live-verified against a REAL second person yet, all rides the Emile 2-person test, but the logic is now proven via the e2e + the synthetic-member live drive.

## 2. Design-system package for Claude Design

`frontend/design-system/` (`7cc8068bf`), a curated, token-driven system for the Claude Design `/design-sync` flow.
- `tokens.css`, the authoritative palette, type scale, radii, elevation, and the brand rainbow, extracted from `globals.css`. (A later edit added a self-hosted Geist `@import`.)
- 16 `@dsCard` preview cards under `components/<slug>/index.html`, brand + wordmark + BeakerBot mascot (real SVG), colors, type, elevation, radii, buttons, inputs, cards-surfaces, overlays, feedback, navigation, icon set, speech bubble, marketing backdrop, walkthrough beat.
- Format, each card is a standalone HTML doc whose first line is `<!-- @dsCard group="..." name="..." -->` and links `../../tokens.css`.

SYNC IS BLOCKED on auth, the `DesignSync` tool needs an interactive claude.ai `/login` to get design-system scopes, and a `CLAUDE_CODE_OAUTH_TOKEN` session cannot be expanded with them. TO SYNC, Grant either runs `/design-sync` from `frontend/design-system/` himself, OR runs `/login` in a session and the agent drives `DesignSync` (create project, finalize_plan, write_files). Once synced, the onboarding redesign happens ON the system so the output is on-brand. NOTE, the walkthrough-beat card shows a step-dot row the live modal does not currently render (a design-system depiction, arguably a hint the real modal should add it).

## 3. BeakerBot network integration (built)

Spec `docs/proposals/2026-06-19-beakerbot-network-integration.md`. Tools in `lib/ai/tools/network-tools.ts` (`56001f571`), 20 tests, tsc clean.
- `find_collaborators` (read), wraps `GET /api/directory/public-search`, returns opaque fingerprints + public profile fields, never raw emails.
- `share_with_researcher` (action, consent-gated), CANNOT send itself, on approval it checks the paid entitlement (`/api/collab/external-entitlement`, the `isProduceEntitled` signal) then navigates the user to the object's existing per-type Send dialog with `?shareWith=<recipient>`, so the audited dialog does the crypto. Recipient provenance is restricted to a find_collaborators fingerprint or a user-typed email, never fabricated.

FOLLOW-UP, no Send dialog reads the `shareWith` query param yet (0 consumers), so the recipient is NOT pre-filled, the user lands on the object pre-targeted but still picks the recipient. Wiring `SendOutsideDialog` + the per-type variants to read `shareWith` makes it truly one-step.

## 4. BeakerBot inline settings (built, one open bug)

Spec `docs/proposals/2026-06-19-beakerbot-inline-settings.md`. Built `c82e2cc6b`, fixes `a3b7f62d7`.
- `read_setting` (read) + `update_setting` (action) in `lib/ai/tools/settings-tools.ts`, a CLOSED-default tier classifier (`settingTier`, `isWritableSettingKey`, `settingDescriptor`, `validateSettingValue`), any key off the safe write-list is sensitive and returns a handoff card, NEVER a `patchUserSettings` call. Account type, lab membership, purchaseRouting, billing, security all refuse.
- A new additive `ros-setting:<key>` EmbedDescriptor (`lib/references.ts`) + `SettingControlWidget` (toggle / segmented select / handoff card), wired into `BeakerBotConversation.tsx` via `loneSettingEmbedFromChatParagraph`.

LIVE-VERIFY found 3 bugs, the value of driving it in the browser:
- FIXED, the system prompt never told BeakerBot to emit the setting embed, so it wrote text and the control never rendered. Added a catalog entry + behavioral instruction in `system-prompt.ts`.
- FIXED, the markdown sanitizer (`markdown/sanitize-schema.ts`) allowed only http/https/mailto/tel, so it stripped the inert `ros-setting:` href before the embed detector ran. Allowlisted `ros-setting` (an inert marker scheme, not a script/data vector). The bot deliberately used a separate scheme to avoid colliding with the object-embed `#ros=` parser, so allowlisting keeps that clean separation.
- OPEN, #3, the model guesses non-obvious keys (it tried `spellCheck`, the real key is `spellCheckInEditor`), and the closed-default classifier correctly treats the unknown key as sensitive and hands off. FIX, enumerate the safe keys + plain-language labels in the `read_setting`/`update_setting` tool description so the model uses exact keys.

Confirmed live, the tool fires on settings asks (on /workbench, a default-tools page), the consent gate appears, value validation rejected the literal `DD/MM/YYYY` and the model self-corrected to the `DMY` enum, the write persisted (read-back confirmed). After the two fixes the model emits the embed, but the WIDGET RENDER is not yet visually confirmed because the next test was blocked by the build break (section 6) and the spell-check key miss (#3).

## 5. BeakerBot auto-plan-offer (specced, decisions LOCKED, NOT built)

Spec `docs/proposals/2026-06-19-beakerbot-auto-plan-offer.md`. The insight, plan mode is undiscovered, so multi-step asks run step-by-step and feel naggy. Keep step-by-step as the default for single asks, but have BeakerBot proactively OFFER a plan card for genuine multi-step work, then revert per-turn.

Two parts, (A) a prompt instruction on WHEN to call `propose_plan`, (B) a loop change in `gateToolCall` so an explicitly-approved offered-plan runs its non-destructive steps free for THAT turn even in step mode (today step mode ignores `planState.approved`). Destructive always hard-stops. Decisions LOCKED (`1218b8194`), offer at 2+ non-trivial actions, per-turn revert, a "review each step instead" card escape, count writes + previewable steps. READY TO BUILD, not built.

## 6. Build break (demo-lab-network), RESOLVED (`81c6d2a64`)

NOT this lane's code, but it broke the build for everyone so this lane fixed it. Commit `9813209bc` (demo-lab-network) had `src/lib/social/seed-demo-lab.ts` reading fixtures via `new URL("./fixtures/<dir>/", import.meta.url)`, a trailing-slash DIRECTORY url Turbopack cannot resolve as an asset ("Module not found"). `src/instrumentation.ts` imports seed-demo-lab, so the whole app failed to compile under Turbopack dev, blocking :3000 and all live verification. FIX (`81c6d2a64`), derive the module dir from `import.meta.url` at runtime + `path.join` the relative path (opaque to the bundler, so it compiles), the flag-gated seeder still reads the checked-in fixtures from disk. Verified, :3000 compiles and renders again. CAVEAT for the demo-lab-network lane, the old `new URL` form also asset-TRACED the files into the prod server output and the runtime-path form does not, so if the seeder ever runs in PROD they must verify the fixtures are bundled.

## 7. Git unstick + CI moved to pnpm (end of session)

Grant's local main was 2 behind origin and the pull was stuck because `next.config.ts` was dirty AND changed by an incoming commit. The 2 incoming commits were the demo-lab-network lane's proper fixture-tracing fix (Phase 3 REDO-v2, building on the lazy fix in section 6). Resolved by committing Grant's 31-file working-tree WIP as one commit (`60a7bfd9a`, the OpenNext/Cloudflare deploy wiring plus assorted WIP and regenerated content) then merging origin cleanly (`next.config.ts` auto-merged, Grant's OpenNext dev-init at the file end plus the incoming `outputFileTracingIncludes` in the config object, different regions). Pushed `b1a2d0064`, main 0/0.

That surfaced the CI being red: CI ran `npm ci` against a secondary `package-lock.json` (the project's real PM is pnpm), which drifted and, with the OpenNext dep, hit an ERESOLVE peer conflict (`@opennextjs/cloudflare` needs next >=16.2.6 or <16, project is on next 16.1.6) that npm rejects but pnpm only warns on. FIX (`0671060d2`), switched all three CI jobs to `pnpm install --frozen-lockfile` via `pnpm/action-setup@v4` + cache pnpm, and regenerated `pnpm-lock.yaml` (the migration had added `@opennextjs/cloudflare` to package.json without updating either lock). CI now installs the way devs actually do.

CAVEATS / follow-ups for this area:
- The OpenNext peer mismatch is real, `@opennextjs/cloudflare@1.19.11` does not officially support next 16.1.6 (it wants <16 or >=16.2.6). pnpm installs it with a warning; whether OpenNext behaves correctly on 16.1.6 at runtime is unverified. Grant owns that migration call (bump next, or pin a compatible OpenNext).
- `package-lock.json` is now an unused, drift-prone second lockfile. Consider deleting it so only `pnpm-lock.yaml` is maintained (out of scope this session; Vercel deploy config should be checked first).
- The 31-file WIP commit was a grab-bag landed at Grant's request to unblock the pull; it mixes the OpenNext migration with assorted edits and regenerated artifacts.

## Open queue (priority order is Grant's call)

1. Inline settings bug #3, enumerate the safe keys in the tool description, then finish the live widget-render verify (now unblocked, the build break is fixed).
2. Build auto-plan-offer Phase 1 (decisions locked).
3. Network `shareWith` pre-fill in the Send dialogs.
4. Push the design system to Claude Design (Grant `/login` or `/design-sync`), then redesign onboarding on it.

DONE since the first cut, the demo-lab-network build break (`81c6d2a64`, see section 6).

## Conventions reinforced this session

- Live-verify catches what unit tests cannot, the model->embed->widget glue and the tool-scope-per-page behavior. Three real bugs surfaced only by driving BeakerBot in the browser.
- Closed-default-sensitive is the right posture for any settings or capability write-list, an unknown key is sensitive, not silently allowed.
- A consent-gated action tool should prefer navigating to the existing audited UI over reimplementing the sensitive operation (share_with_researcher), it cannot send by itself.
- The chat-embed system upgrades a lone markdown link to a widget, but custom URL schemes must be allowlisted in the sanitizer or use the relative `#ros=` form, or the href is stripped before the detector runs.
