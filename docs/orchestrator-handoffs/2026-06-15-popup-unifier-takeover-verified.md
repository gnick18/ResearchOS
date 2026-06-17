# Handoff — Popup Unifier lane takeover (2026-06-15, late)

Token-out recovery. The "Popup Unifier" session ran out of tokens mid-run (one of
6 active lanes that all token-capped at once). This is the take-over agent's
close-out after verifying where it stopped. Session id of the dead lane:
`4e5e0dbf-e08a-4329-820a-99ef9592c910`.

## TL;DR state

Two threads were in flight. Both are now resolved or verified:

1. **INJEST social-layer coordination — CLOSED + re-verified on `origin/main`.**
2. **Popup-polish (this lane's core) — code correct, tsc clean, now serving
   correctly on :3000. Intentionally left UNCOMMITTED (batched, Grant's call).**

Everything substantive this lane authored is already on `origin/main` (the agent
cherry-picked 7 commits onto origin via a throwaway worktree to avoid clobbering
the other lanes' dirty work on the shared main tree). Confirmed all 7 present on
origin:
- `1ae8392fc` docs(agents+handoff): sanitizer multi-line-DOCTYPE fix + smart-search
- `63937bcaa` feat(social): /network wiki page + Phase B public institution scaffold
- `828d7e813` feat(directory): public institution-page endpoint (B2)
- `b61d37d67` feat(identity): on-demand mint at lab create/join (solo-deferred §8)
- `914a2e082` fix(identity): solo unlock-gate OAuth fix + solo-deferred keypair backbone
- `e9da44374` feat(directory): public researcher search endpoint for /network
- `3e707f61f` feat(dev): dev-mock email picker so two contexts are distinct accounts

## Thread 1 — INJEST (social layer), CLOSED

This lane did a security review of INJEST's fingerprint-send / directory surface.
Two findings; INJEST fixed both, pushed to `origin/main`, and Grant flipped the
prod flags (`SHARING_ENABLED` + `SOCIAL_LAYER_ENABLED` + `NEXT_PUBLIC_SOCIAL_LAYER`).
The dead agent ran out of tokens mid-confirmation of the pushed diff. Re-verified
here on `origin/main`:

- **Finding 1 (was ship-blocker) — FIXED.** `lookup-by-fingerprint/route.ts` is
  double-gated: `if (!isSharingEnabled() || !isSocialLayerEnabled()) return 404`.
  The fp-send surface stays dark unless the social flag is deliberately on.
- **Finding 2 — HIDE-ONLY (Grant's chosen model), correct.**
  `getBindingByFingerprint` (the delivery/lookup resolver) dropped its
  `unlisted = false` filter but keeps the `JOIN directory_profiles` +
  exact-match `WHERE i.fingerprint = ...`. So unlisting hides you from discovery
  (searchPublicProfiles / getInstitutionByDomain still filter unlisted) but a
  sender holding your exact fingerprint can still deliver. Exact-match, not
  enumeration; 404-on-absent shape preserved (no existence oracle).

Nothing left to do here. Optional follow-ups INJEST owns (not blocking): a
lock-intent comment on `getBindingByFingerprint`, and adding handle/username to
the public name-search.

## Thread 2 — Popup polish (the parked deliverable)

The dead agent's last visible message to Grant: the rail hue-band fix and the
`#131c30` surface pick were "in the code but not being served" because Turbopack
on :3000 had wedged (stopped compiling globals.css mid-session, served a stale
chunk). **That blocker is gone** — :3000 was restarted ~11:45pm and now serves
the fresh CSS. Verified by fetching the live served chunk off :3000:

- `#131c30` surface lift LIVE: dark root tokens are
  `--editor-room-top: #18233c; --editor-room-bot: #131c30; --background: #131c30;`
  (the calm popup now lifts off the near-black page instead of vanishing into it).
- Rail hue-band fix LIVE: `[data-theme="dark"] .ros-helper-rail { background: none; }`
  (the lighter wash Grant flagged is gone), and the rail seam/top/bot glows are
  now real dark shadows (`rgba(0,0,0,…)`), not the bluish "lit-from-within" glow.

Uncommitted files (intentionally — agent + Grant agreed to batch popup-polish and
NOT commit onto the dirty shared tree mid-review):
- `frontend/src/app/globals.css` — the two fixes above.
- `frontend/src/components/ui/LivingPopup.tsx` — ref-counted body-scroll-lock
  (replaces the per-popup save/restore that leaked `overflow:hidden` across
  stacked/sequential popups; releaser is idempotent against StrictMode double
  cleanup). tsc clean.
- `frontend/src/app/dev/popup-chrome/fixtures.ts` — populated list-task fixture
  for the harness (checklist half-done, tags, assignee) so the violet checklist
  shell + meta subline render with real content.

`npx tsc --noEmit` on frontend = 0 errors with these in the tree.

### To finish Thread 2

When Grant says the word, commit JUST these three files as an isolated commit so
it does not entangle the other lanes' dirty work on shared main, e.g.:

```
git add frontend/src/app/globals.css \
        frontend/src/components/ui/LivingPopup.tsx \
        frontend/src/app/dev/popup-chrome/fixtures.ts
git commit -m "fix(popup): dark calm-popup #131c30 lift + rail hue-band fix + ref-counted scroll lock"
```

Optional belt-and-suspenders: a real Chrome screenshot of `/dev/popup-chrome` in
dark mode (the CSS is token-verified, so this is confirmation, not discovery).

## Notes for whoever continues

- Shared main tree is dirty with ~6 lanes' worth of uncommitted work. Never do a
  blanket `git add -A`. Stage explicit paths only.
- :3000 is Grant's foreground dev server (terminal s000). Do not kill it. To
  preview in isolation you cannot run a 2nd `next dev` on the same `frontend`
  dir (`.next/dev/lock` conflict) — use a worktree or verify the served CSS
  chunk directly off :3000 like this takeover did.
- Older popup-unifier handoff (prior takeover, still valid checklist):
  `docs/handoffs/CHROME_VERIFY_POPUP_UNIFIER.md`. Audit backlog:
  `docs/proposals/2026-06-14-old-school-popup-audit.md`.
