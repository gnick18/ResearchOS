# Handoff — 2026-06-18 (BeakerBot speech, lab dry-run, Emile live test prep)

Session by the BeakerAI lane. Everything below is on `origin/main` (verified 0/0 vs
origin at write time). House voice. No em-dashes, no emojis, no mid-sentence colons.

## TL;DR

A polish-and-prep session. The entry/login experience got a living, talking
BeakerBot; folder switching + logout came out of the deep settings burial; the
lab-head copilot Phase 1 tools shipped; the whole lab mirror was verified locally
end-to-end via the dev harness; and Emile's data was extracted into its own folder
and uploaded to OneDrive by Grant. The one thing that fundamentally needs two
people, the Emile live test, is now fully de-risked and ready to run.

## What landed (all on origin/main)

- `8006bcba9` living entry beaker + permanent folder control + easy logout.
- `e2e82099a` dedicated `logout` glyph (door + arrow) in the icon registry, on the Settings Log out button.
- `2cd38491d` talking entry beaker (greetings + real-fact dialog system).
- `1edc00d90` generic 404 for the top-level `[labSlug]` catch-all (retired routes like `/welcome` no longer show the misleading "lab page" 404).
- `a6fc8173d` real work-stat facts feeding the talking beaker.
- `522298364` tighten the work-stat date accuracy ("started N experiments" honest to start_date; check-in date fallback to note-entry timestamps).
- `5933feb13` lab-head copilot Phase 1 (lab_pulse, find_across_lab, lab_throughput) + `9e190d315` its test-import stub.
- `1b9bad95a` sparser, side-placed, typing speech bubble.
- `2095f8604` `/welcome` offers to log out and see the welcome screen.
- `c427e99a1` linger the splash so the greeting bubble can be read.

## Verified vs needs Grant's eyes

VERIFIED LIVE (by the agent on :3000):
- Permanent folder control beside More + Settings Disconnect/Log out + the logout glyph.
- Generic `/welcome` 404 and the new `/welcome` log-out prompt.
- Dept copilot live on `/department` (dept_roster_glance + dept_plan_explainer fired with real data, narrated as facts).
- The full lab mirror pipeline (see dry-run below).

NEEDS GRANT'S EYES (transient or auth-gated, agent could not screenshot):
- The alive beaker (blink / cursor-gaze / wander) on entry + wizard.
- The talking beaker bubble on the landing + "Welcome back" sign-in (open `localhost:3000` in incognito to reach the logged-out landing). Confirm the type-in, the side placement, and that short lines no longer stack ("Hi there." on one line, fixed via `width: max-content`).
- The lengthened splash showing the name greeting / a real fact.

## The talking beaker (state + how it works)

- Library: `frontend/src/lib/beakerbot/entry-lines.ts` (Tier A pre-connect greetings, trimmed to a tight non-redundant set; Tier B post-connect name + real facts).
- Stats cache: `frontend/src/lib/beakerbot/user-stats-cache.ts` (per-user localStorage, key `ros:beakerbot-stats:<user>`). Written once per session from `AppShell` (streak sidecar) + `frontend/src/lib/beakerbot/compute-user-stats.ts` (experiments, experimentsLast6Months, projects, notes, wordsLastWeek, checkinsThisMonth). CACHE TIMING: written during a session, READ on the NEXT launch's splash, so facts appear from the second load onward, not the first.
- Component: `frontend/src/components/beakerbot/BeakerSpeech.tsx`. Types in (38ms/char), `width: max-content` capped at 18rem, sparse rhythm (type -> hold -> 7-13s silence), `side` prop ("below" | "left" | "right") points the notch at the beaker.
- Mounted on `OAuthFirstLanding` + `WelcomeBackSignIn` (side right) and `VariantSplitStage` splash (side left). The splash was lengthened (`HOLD` 1.2s -> 3s) so the bubble shows there.
- RULE: tool owns every number, the model only narrates, never fabricate.

## Lab-head copilot Phase 1 (built, gating decision recorded)

- `frontend/src/lib/ai/tools/lab-head.ts`: lab_pulse / find_across_lab / lab_throughput on the audited `readLabMembersWork` + `searchLabIndex` engine. Read-only, deterministic, never interprets.
- Mount: `frontend/src/components/lab/LabHeadCopilotMount.tsx` on `/lab-overview`, gated `AI_ASSISTANT_ENABLED && account_type === "lab_head"`.
- FLAG DECISION (Grant): intentionally NOT behind a lab-tier flag. There are no lab heads in prod yet, so the account_type gate means it mounts for nobody; Emile is the first PI (the deliberate first live-verify); other users get reset onto the new system. Do not add a flag.
- NOT live-verified (needs a real lab with synced member data). That is the Emile test.
- Full depth: memory `project_beakerbot_lab_head_utilities`.

## Lab-flow dry run (PASSED locally) and the Emile live test (READY)

Dry run via `/dev-lab` against a fresh local relay, end-to-end and PASSED:
create lab -> login -> enroll a synthetic member (invite -> accept -> finalize ->
login-binding, the 8a email-binding check held: correct email accepts, attacker
email rejects) -> head Sync pushed 10 records across all types -> PI read-back
pulled 11 (incl the index manifest), decrypted with real content. So the whole
mirror (create / enroll / sync / read-back, real crypto through the relay) works.

The dry run could NOT exercise the lab-head copilot with member work, because the
dev-lab member is synthetic (cannot author work) and the tools exclude the head's
own work. That is exactly what the Emile two-person test is for.

Emile live test, now ready:
- Emile's folder was extracted to `~/Desktop/Emile_ResearchOS` (only `users/Emile_GT`, single-user metadata, account_type clamped to member, no other users, `_trash` excluded) and Grant has uploaded it to OneDrive for Emile.
- What to verify: Emile (real member) authors + syncs work, Grant (PI) asks lab_pulse / find_across_lab / lab_throughput on `/lab-overview` and sees real per-member data; Emile sees the PI's audited reads in his "Your lab view" Settings panel.
- Prereqs (config, not code): `NEXT_PUBLIC_COLLAB_RELAY_URL` set on Vercel prod, REQUIRE_ACCOUNT on, the strict manual join sequence. Full preflight checklist: `docs/handoffs/2026-06-17-lab-live-test-preflight.md`.

## Gotchas learned this session (reusable)

- OneDrive Files-On-Demand hangs `cp`. A `cp -R` of a folder under
  `~/Library/CloudStorage/OneDrive-*` hangs forever on a cloud-only placeholder
  (st_blocks == 0). Diagnose with `find <dir> -type f -exec stat -f '%b %z %N' {} \;`
  (0 blocks = dataless). Either force-hydrate that file in OneDrive ("Always keep on
  this device") first, or `rsync -a --exclude=<that subtree>` around it.
- Extracting one user from a shared folder into a standalone solo folder: copy ONLY
  `users/<User>/`, write a single-user `users/_user_metadata.json` (that user as
  main_user, no others, strip `deleted_at`), copy `_global_counters.json` + `.gitignore`,
  and clamp `settings.json` `account_type` lab_head -> member. This mirrors the
  app's verified migrate-to-solo bundle (`lib/lab/migrate-to-solo-executor.ts`); a
  user bundle is exactly `users/<User>/`, never the shared top-level dirs.
- `/dev-lab` relay reset: stale relay state ("no sealed copy for username") means the
  old lab is sealed for old keys. Fix: kill `wrangler dev`, `rm -rf relay/.wrangler/state`,
  restart `cd relay && npx wrangler dev --port 8787 --local`, then Create lab fresh.

## What is left

- Grant: eyeball the alive + talking beaker (incognito) and the splash; tell the
  next session any placement/voice tweaks.
- The Emile two-person live test (also the lab-head copilot's first real run).
- Background backlog unchanged: lab-head Phase 2 (mentorship tools), the prod flag
  flips for the AI billing / dept tier when beta billing goes live.
