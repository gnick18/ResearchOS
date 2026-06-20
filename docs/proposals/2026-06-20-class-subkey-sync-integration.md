# Design: making lab sync and pull subkey-aware for the private student notebook (2026-06-20)

Owner: orchestrator / Class-Mode lane. Read with `project_class_mode_cross_folder`
(the running state) and the prior handoff
`docs/handoffs/2026-06-19-class-mode-cross-folder-stage3-handoff.md`. House voice,
no em-dashes, no emojis, no mid-sentence colons.

## Why this doc exists

The per-student subkey crypto core and a dedicated, tested write path
(`class-private-notebook.ts`) are already merged and proven on real keys. What is
NOT done, and what the live-wiring lane deliberately FENCED rather than gamble, is
wiring those building blocks into the two SHARED paths that every lab uses, lab
sync (push) and lab view pull (read). Touching those wrong would break sync for
every lab, not just classes, so we want the integration designed and signed off
before any code lands there.

This doc proposes the minimal, contained change to each shared path, calls out the
one real security tradeoff (retaining the viewer x25519 private key in the live
session), and lists the decisions that need Grant's call.

## The problem in one paragraph

A private student notebook must not be readable by a classmate who holds the class
team key. Today the generic push (`syncLabWorkToMirror`, `lab-sync.ts:218-250`)
seals EVERY enumerated record under the team key and puts it to the relay, and the
generic pull (`pullLabView`, `lab-read.ts:235-242`) decrypts every record under the
team key. So a notebook that rides the generic path is classmate-readable, no
matter what the UI labels it. The fix is to route the private notebook through the
already-built `writePrivateNotebookRecord` (subkey seal) on the way out, and through
`resolvePulledClassRecord` (subkey peel) on the way back, WITHOUT disturbing the
team-key path for every other record.

## The contained building blocks (already merged, do not rebuild)

- `writePrivateNotebookRecord(...)` in `class-private-notebook.ts:194`, the dedicated
  subkey write path (double-seal, never touches `lab-sync.ts`).
- `recoverExistingSubkey(...)` `class-private-notebook.ts:119`, one subkey per
  student per class.
- `resolvePulledClassRecord(plaintext, viewer, teamKey)` `class-private-notebook.ts:82`,
  the backward-compatible read resolver (subkeyed record peels the inner layer, every
  other record passes through byte-identical).

## Integration point 1, the WRITE side (push)

### Where
`enumerateLabWork` (`lab-work-enumerate.ts:301`) returns every owned record flat;
`syncLabWorkToMirror` (`lab-sync.ts:193`) loops them and team-key-puts each at
`lab-sync.ts:218-250`. The orchestrator is `runLabSyncForSession`
(`lab-sync-runner.ts:148`), which holds `owner`, `labId`, `labKey`, and the ed25519
signing keypair from the session.

### Proposed change
1. PARTITION at the call site, before the push loop. A record is a private class
   notebook iff it is a `task` carrying an `assignment_id` AND its class visibility
   is private (the `visibilityDefault`/`shared_with` seed from CT-5 already encodes
   this at create time). Split `params.records` into `teamRecords` and
   `privateNotebooks` once, before `lab-sync.ts:218`.
2. The team-key loop (`lab-sync.ts:218-250`) runs UNCHANGED over `teamRecords`. This
   is the key safety property, the existing path is byte-identical for every
   non-notebook record.
3. Each `privateNotebook` is pushed via `writePrivateNotebookRecord` instead, which
   subkey-seals it. EXCLUSIVITY INVARIANT, a private notebook must appear in exactly
   one list, never both, or it would leak under the team key in parallel with the
   subkey copy. The partition predicate is the single source of truth and must be
   total.

### What must be threaded in (the cost)
`writePrivateNotebookRecord` needs the student `LabMember`, the head `LabMember`, and
the student's x25519 PRIVATE key (to recover or mint the subkey). The runner has the
roster (via `getLabRemote(labId).record.members`, already fetched on the pull side)
and can resolve the head + the student member from it. The missing piece is the
x25519 private key, see Integration point 3 (the crux).

## Integration point 2, the READ side (pull)

### Where
`pullLabView` (`lab-read.ts:190-307`) calls `getLabRecord` which team-decrypts, then
returns raw plaintext at `lab-read.ts:235-242`. `materializeLabView`
(`lab-view-materialize.ts:126-225`) writes that plaintext to disk verbatim and
assumes it is already final. The orchestrator is `runLabViewPullForSession`
(`lab-view-pull-runner.ts:146`), which passes `labKey` + signing keys into
`pullLabView` at `lab-view-pull-runner.ts:189-196` but NOT an x25519 private key.

### Proposed change
Slot `resolvePulledClassRecord` immediately after the team-key decrypt at
`lab-read.ts:235-242`, before the tombstone/`shared_with` parse. For a subkeyed
private record it peels the inner subkey layer (the viewer must be the student or the
head, else it throws and that record is simply not materialized for that viewer,
which is the correct privacy outcome). For every other record it returns the bytes
unchanged, so `materializeLabView` is untouched. This requires threading the viewer's
x25519 private key from the runner into `pullLabView` params.

A classmate who is not a subkey recipient will have `resolvePulledClassRecord` throw
on that one record. The pull loop must treat that as skip-this-record, not abort, so
one private notebook the viewer cannot read never breaks the rest of their pull.

## Integration point 3, the crux: retaining the x25519 private key in the session

### The gap
The session derives the team key once at unlock by opening the member's sealed
envelope with their x25519 private key (`openLabKeyCopy`, `lab-key.ts:211`), then
DROPS the x25519 private key. `LabSessionState` "live" (`lab-session.ts:92-105`)
carries only `labKey` + the ed25519 signing keypair. Both the write and read
integrations need that x25519 private key after unlock, so it must be retained.

### Proposed change (minimal)
Add `x25519PrivateKey: Uint8Array` to the LabSessionState "live" variant, populate it
through the `UNLOCK_DONE` action payload (`lab-session.ts:116-122`) from the
`openLabKey` effect (`lab-session.ts:271-276`), which already has it in hand. The
session identity (`getSessionIdentity().keys`, `session-key.ts:30`) ALSO already holds
the x25519 private key in memory post-unlock, so an alternative is to read it from
there at sync/pull time rather than widen the session state. Either way the key never
touches disk or the wire.

### The security tradeoff (this is a real one, Grant should weigh it)
Today the x25519 private key lives in memory only as long as the identity is unlocked
(`getSessionIdentity`), and the lab session itself does not hold a second reference.
Retaining it on the live lab-session state widens the in-memory exposure slightly,
one more object holds a reference for the life of the active lab session. It is still
memory-only, never serialized, never logged, and the identity already keeps the same
key in memory anyway, so the marginal risk is small. The conservative option is to
NOT widen the session state and instead read from `getSessionIdentity().keys` at the
two call sites, so we add no new long-lived reference. Recommendation below.

## Integration point 4, the identity-reset re-seal (related gap, can be a fast follow)

When a student resets identity, `readmitMember` (`lab-key.ts:592-636`) rotates the
team key and re-adds them under their NEW x25519 public key. Their EXISTING subkey
envelopes still seal to the OLD x25519 key, so the re-admitted student loses access to
their own prior private notebooks until each envelope is re-sealed. The head co-holds
every subkey, so re-sealing is always possible. Proposed hook,
`reSealSubkeyForStudent(...)` invoked after `addMember` returns inside `readmitMember`
(or as a head-side step in `readmitMemberRemote`), iterating the student's subkeyed
records, opening each envelope with the HEAD x25519 private key, re-sealing under the
student's NEW public key, and putting the updated record back. This does not gate the
v1 demo (a student resetting identity mid-class is rare), so it can be a fast follow
right after the sync/pull integration.

## Migration and backward compatibility

Pre-existing student notebooks already pushed under the team key are NOT
retroactively private (the feature did not exist when they were written, and nothing
in a class predates this). v1 seals only notebooks written AFTER the integration
lands. `resolvePulledClassRecord` is backward compatible by construction, so old
team-key notebooks keep reading exactly as today. No data migration, no rewrite pass.
Flag-gated behind `NEXT_PUBLIC_CLASS_MODE`, flag-off byte-identical.

## Regression surface (what a build lane must keep green)

Write/push: `lab-sync.test.ts`, `lab-sync-runner.test.ts`, `lab-work-enumerate.test.ts`,
`lab-sync-manifest-store.test.ts`, `lab-mirror-e2e.test.ts`. Read/pull:
`lab-read.test.ts`, `lab-view-pull-runner.test.ts`, `lab-view-materialize.test.ts`,
`lab-mirror-e2e.test.ts`. Identity reset: `readmit-member-remote.test.ts`,
`lab-key.test.ts`. Session: `lab-session.test.ts`, `lab-session-effects.test.ts`. New
adversarial tests must prove the end-to-end boundary, a classmate pulling a private
notebook over the real sync/pull path cannot decrypt it, while the student and head
can, and every non-notebook record round-trips byte-identical.

## Recommended approach

1. Read the x25519 private key from `getSessionIdentity().keys` at the two call sites
   rather than widening `LabSessionState`, so we add NO new long-lived key reference
   (the conservative security choice). If that proves awkward at the runner boundary,
   fall back to threading it on the live-session state, memory-only.
2. Ship the WRITE partition + the READ resolver slot as ONE lane, behind the flag,
   with an end-to-end adversarial test over the real sync/pull path as the gate.
3. The exclusivity invariant (a private notebook is pushed by exactly one path) gets
   its own explicit test, since a double-push would silently leak under the team key.
4. The identity-reset re-seal is a fast follow, not part of this lane.

## DECISIONS LOCKED (Grant, 2026-06-20)

1. Key retention, READ x25519 priv from `getSessionIdentity().keys` at the two call
   sites, add NO new long-lived reference on the session state (the conservative
   choice). Fall back to session-state threading only if the runner boundary makes
   the identity read genuinely awkward, and say so if you do.
2. v1 scope, seal only NEW notebooks. No migration, no rewrite of pre-existing
   team-key notebooks. `resolvePulledClassRecord` keeps them readable as today.
3. Identity-reset re-seal is a FAST FOLLOW, a separate small lane after this one,
   NOT folded in here.

## Open questions for Grant

1. Session key retention, the security tradeoff. Read x25519 priv from the identity
   at call time (no new long-lived reference, recommended), or retain it on the
   live-session state (simpler threading, one more in-memory reference)?
2. v1 scope, seal only new notebooks and leave pre-existing team-key notebooks as is
   (recommended, no migration), or also rewrite any already-written notebooks in an
   active class to subkey on first sync after the flag flips?
3. Identity-reset re-seal, fast follow after this lane (recommended), or fold into
   this lane so the demo is fully reset-safe from day one?
