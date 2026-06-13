# Handoff: Seed one method of every type into demo mode

Date: 2026-06-13
Branch: `mobile-redesign-foundation` (commit `72f951729`), MERGED to main as `88a57f2ef`
Worktree: `../ROS-mobile-redesign`
Author: Mobile UI lane (continued by orchestrator after the lane hit its token limit mid-merge)

## What this does

Demo mode now ships a fully-authored, openable method for every method type
(pcr, lc_gradient, mass_spec, qpcr, western, staining, culture, cloning,
extraction, compound kit, markdown, pdf, coding). Each seed carries a real
`MethodProjection`, so read mode renders the demo method exactly the way it will
for a real published method. Before this, every demo library row routed to the
same empty `/method-detail?read=1` screen, so no per-type reader was reachable
for review or debugging.

It also populates the demo `'method'` snapshot, so the Today active-experiment
recommendations band (and its read mode) is demoable without a paired laptop.

## How it is wired

- **Seed data** lives in `mobile/lib/method-library.ts`: `DEMO_METHOD_DETAILS`
  (one full `MethodProjection` per type), `getDemoMethod(uid)` to resolve a seed
  by uid, and `DEMO_METHOD_SNAPSHOT` (the focused-experiment stand-in).
- **Library tap** (`mobile/app/(tabs)/method.tsx`): in demo, `openLibraryRow(uid)`
  now routes to `/method-detail?demo=<uid>` instead of `?read=1`, so each seeded
  type opens its own reader.
- **Reader** (`mobile/app/method-detail.tsx`): new `?demo=<uid>` branch resolves
  the seed synchronously via `getDemoMethod` and renders `MethodReadMode` (no
  pairing, no network). Add-variation is a no-op for a demo method (nothing to
  route a variation to). Falls back to an empty state if the uid is unknown.
- **Snapshot** (`mobile/lib/snapshots.ts`): `fetchSnapshot('method')` in demo
  now returns `DEMO_METHOD_SNAPSHOT` instead of `null`, so the active-experiment
  band populates. The library snapshot still returns `null` on purpose (the
  library tab keeps its own `DEMO_LIBRARY` fixture).
- **Tokens** (`mobile/lib/design.ts`): mirrors the web three-ramp rainbow
  (pastel / vivid / luminous) into the RN tokens, prep for the upcoming
  dark-mode pass. No behavior change yet.

## Files changed (commit `72f951729`)

- `mobile/lib/method-library.ts` (+425, the seed data + `getDemoMethod` + snapshot)
- `mobile/app/(tabs)/method.tsx` (demo row routing)
- `mobile/app/method-detail.tsx` (the `?demo=<uid>` reader branch)
- `mobile/lib/snapshots.ts` (serve the demo method snapshot)
- `mobile/lib/design.ts` (three-ramp rainbow tokens)

No snapshot-shape change. No relay or web changes. tsc clean (mobile package, 0 errors).

## State

- Merged to local main `88a57f2ef` (no-ff merge of `mobile-redesign-foundation`).
  Only the 5 mobile files moved; no contention with main's dirty working tree.
- NOT pushed to origin (Grant's workflow does not push to origin).
- NOT device-verified. This is land-then-verify per the mobile lane rule (the
  dev-client runs main over Metro 8081). Next: on the emulator, open the Method
  library tab in demo, tap each type, confirm read mode renders, and confirm the
  Today active-experiment band shows the seeded method.

## Notes for whoever picks up the mobile lane next

- This is part of the broader `mobile-redesign-foundation` rebuild. The branch is
  one commit ahead of main again only if new work lands on it.
- Still held separately: the Today "ACTIVE EXPERIMENTS" purple-card band on
  `worktree-agent-af8955a1ce87fdd9a` (`624a0f64f`) is a different change and is
  still NOT merged (see AGENTS.md "Companion active-experiment band"); do not
  confuse it with this seed work. When integrating it, remember the caution about
  not losing the `recordSnapshotGeneratedAt` liveness wiring.

Mobile UI lane (orchestrator handoff)
