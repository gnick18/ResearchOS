# Handoff — social fp-send security-pass reconciliation (2026-06-16)

**Session:** handoff-recovery, picking up the interrupted **INJEST (social layer)** agent
(transcript `d5021d61-5af8-40bf-b0bd-b3457dc6ee8c`).

## What happened

The INJEST agent took the researcher network live in production and, as part of the
go-live, ran a security pass that produced two findings and shipped both, bundled
into **`034dd139f`** (now HEAD of `origin/main`, deployed to prod):

- **Finding 1** — double-gated the fp-send surface (`/api/directory/lookup-by-fingerprint`
  route + the `/api/relay/send` fingerprint branch) on `isSocialLayerEnabled()`,
  on top of the existing `isSharingEnabled()`.
- **Finding 2** — dropped `AND p.unlisted = false` from `getBindingByFingerprint`
  in `lib/sharing/directory/db.ts` ("hide-only" delivery: an unlisted user could
  still *receive* a fingerprint-send).

**Immediately after that commit shipped,** Popup Unifier relayed two messages carrying
**Grant's reversal of both findings**, then the user interrupted the session:

1. **F1 withdrawn.** "Grant confirms he turned the social flags ON intentionally and
   wants the fp-send surface live. So do NOT add a `SOCIAL_LAYER_ENABLED` gate to
   lookup-by-fingerprint or the /send fingerprint branch; the `isSharingEnabled`
   gating you have is what he wants."
2. **F2 reversed.** "Grant's call on Finding 2: it's INTENTIONAL, your design is
   correct — no change … `getBindingByFingerprint` requiring `unlisted=false` is
   exactly right: the fp-send is a discovery path, and private users aren't
   discoverable." (Model: a private/unlisted user is reachable ONLY by exact email
   via `getBindingByHash` (no listed check); listed users are the discoverable ones,
   reachable by name search + fingerprint-send.)

## What this session did

Reconciled to Grant's final model with a clean **`git revert 034dd139f`**:

- `lookup-by-fingerprint/route.ts` → gate back to `isSharingEnabled()`-only.
- `relay/send/route.ts` → fp branch no longer gated on `isSocialLayerEnabled()`.
- `db.ts` → `AND p.unlisted = false` restored in `getBindingByFingerprint`.

The three files are now **byte-identical to their pre-`034dd139f` state**
(`git diff 034dd139f^ -- <those files>` is empty).

- **Branch:** `social-fp-reconcile` — worktree `/Users/gnickles/Desktop/ROS-fp-reconcile`, off `origin/main`.
- **Commit:** `ce5b9688c` (`revert: withdraw fp-send social-gate (F1) + restore unlisted=false delivery (F2)`).
- **Verified:** `tsc --noEmit` → 0 errors; `vitest run src/lib/sharing/relay src/lib/sharing/directory` → 229 passed.

## NOT done — needs Grant's explicit go

**Not pushed, not redeployed.** Prod still runs `034dd139f` (the un-reversed state).
Held back deliberately because (a) it's live production security code and (b) the
reversal reached this session via a cross-session relay — the INJEST agent's own
push to main was classifier-blocked for exactly that reason.

Runtime impact of pushing the revert:
- **F1 revert** is behaviorally a no-op on the *current* deploy (`SOCIAL_LAYER_ENABLED="true"`
  so the extra gate passes anyway); it only removes a gate Grant didn't want.
- **F2 revert** *does* change behavior: unlisted users stop receiving fingerprint-sends,
  aligning delivery with discovery per Grant's confirmed model.

**Next step:** on Grant's authorization → push `social-fp-reconcile` and redeploy prod
from `origin/main` (env flags are already correct; this is code-only). Then verify
`/network`, the directory endpoints, and `lookup-by-fingerprint` still 200.

Memory `project_researcher_social_layer.md` updated to record the reversal.
