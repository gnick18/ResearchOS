# Mobile <-> Lab Notebook integrations

Status: proposal, awaiting sign-off. Owner: tip manager. Date: 2026-06-08.

This is the "make the phone a real companion to the laptop" initiative. Three
features that all rest on one new capability: the phone knowing what is open on
the laptop, and being able to write to it. Everything is local-first and goes
through the existing E2E-encrypted pairing relay (reuse device keys).

## The shared foundation: a focus-context + command channel

Today the capture relay is basically one-way: the phone drops a capture, the
laptop polls its inbox. To do any of the below we need two more lanes:

1. Focus context (laptop -> phone). The laptop publishes a small heartbeat of
   "what is pulled up right now": e.g. `{ kind: 'experiment', id, name,
   activeTab: 'lab-notes' | 'results', projectId }`, or `{ kind: 'none' }`.
   The phone reads the latest context when it is about to send something.
2. Commands (phone -> laptop). The phone sends a targeted instruction the
   laptop applies locally: append this line to the open doc, switch to this
   tab, route this capture to this experiment, silence this timer.

Both lanes ride the relay we already have. The laptop app (frontend) is the
only thing with write access to the data folder, so it always does the actual
write. The phone never writes files; it asks the laptop to.

Note: a similar "detect what is pulled up and suggest sending there" already
existed once (and Telegram did it). Step 0 of build is auditing that old code
in frontend/ + relay/ so we reuse it rather than reinvent.

## Audit findings (prior art, 2026-06-08)

Read-only sweep of frontend/, relay/, mobile/. What exists vs what is new:

Reusable as-is:
- Capture relay (relay/src/worker.ts, CaptureInbox DO, lines ~1260-1961):
  per-user DO keyed by identity pubkey, Ed25519 device pairing, signed
  upload/inbox/ack. Canonical signed strings in worker.ts + frontend
  src/lib/mobile-relay/client.ts. Mature, production-ready.
- Lab Notes / Results docs: `users/<owner>/results/task-<id>/notes.md` and
  `results.md`, backed by Loro CRDT. frontend/src/lib/loro/task-doc.ts gives
  getTaskContentText / setTaskContentText (append = read + insert at end).
  This is exactly the "append a line" primitive Feature 2 needs.
- SendToTaskPicker.tsx still exists: the manual "pick a task + Notes/Results"
  router. Reuse as the override/fallback UI.
- activeTask in the global store (frontend/src/lib/store.ts: {id, owner, name})
  is still set when an experiment popup opens. activeNote too.
- Presence pattern: frontend/src/lib/loro/use-purchase-presence.ts (10s
  refresh, 30s TTL EphemeralStore) is a reusable heartbeat shape.

Partial / needs lifting:
- The "what is pulled up" auto-suggest was REMOVED with Telegram (2026-06-08).
  The state to rebuild it (activeTask) survives; the suggestion logic is gone.
- The active editor tab (Notes vs Results) is LOCAL react state in
  TaskDetailPopup (`lastEditorTab`), not in the store. Lift it to the store so
  it can be published.

Net-new:
- A focus-context lane (laptop -> phone) and a command lane (phone -> laptop)
  on the capture relay DO. Captures currently carry NO destination field;
  routing is decided laptop-side by content-type. We add destination + commands.
- Laptop has NO timer/alarm at all. Feature 3 is a net-new laptop counterpart.
- No device last-seen / online status. Add a heartbeat for "is the laptop up".

Design consequence: the phone is NOT a Loro collab peer, it speaks to the
capture relay. So the context + command lanes belong in the capture relay DO
(new signed endpoints + two small tables), NOT the collab DO. Timer ticks stay
local on each device; only create / done / dismiss events sync.

## Feature 1: context-aware capture routing (the Telegram behaviour)

When the phone sends a photo / note / scan, it checks the focus context:
- Experiment open -> ask "Lab notes or Results?", the user picks; the laptop
  auto-switches to that tab and places the item there (per locked decision B).
  "Send to inbox instead" is always one tap away.
- Nothing open -> send to the inbox (today's behaviour), no prompt.

This is the smallest feature and the natural first milestone, since it adds the
Notes/Results pick + targeted routing on top of the existing capture send and
reuses SendToTaskPicker's existing choice UI.

## Feature 2: calculator -> notebook export

Every calculator gets an Export button. On tap:
- It builds the line: the full expression AND the value, e.g.
  `5 x 2 + 7 = 17` (not just `17`); molarity etc. export the formula + inputs +
  result, with units.
- It appends that as a new line at the end of the currently-open doc:
  - Experiment open on Lab Notes -> append to Lab Notes.
  - Experiment open on Results -> append to Results.
  - Experiment open but on some other tab, or ambiguous -> ask "Lab notes or
    Results?", then the laptop switches to that tab and appends.
  - Nothing open -> offer to send to the inbox instead.

Needs: the laptop "append a line to doc X at the new line" command, and the
"switch tab" command. The expression formatting is shared logic we already
have in the calculators.

## Feature 3: timer sync across devices

A timer set on either device exists on both:
- Start on phone -> appears + counts down on the laptop too (and vice versa).
- Fires on both when done (sound + animation per each device's settings).
- Silence on either silences both, seamlessly (unified dismiss event).

Per-device alarm settings (the phone half already shipped: sound choice +
sound/vibration toggles, animation always; default sound+vibration+animation):
- Laptop: option to never play sound, only show the visual; or sound + visual.
- Default everywhere: the full experience with the musical (Chime) sound.

Needs: timers become a synced entity through the relay (tick is local on each
device, but create / done / dismiss events sync), plus a full laptop-side timers
panel (create / list / cancel, two-way per locked decision C) and the laptop
alarm. No laptop timer exists today, so this is the most net-new of the three.

## Suggested phasing (each is its own sign-off + build)

- Phase 0: audit the old presence/Telegram code; design the relay context +
  command channel (data shapes, E2E envelope). Flag: new relay tables / message
  types.
- Phase 1: laptop publishes focus context; phone capture routing suggestion.
- Phase 2: calculator Export buttons + append-to-notebook + switch-tab command.
- Phase 3: timer cross-device sync + unified dismiss + laptop alarm + settings.

## Concrete shapes (informed by the audit)

Focus context the laptop publishes (signed PUT to the relay DO, ~10s heartbeat):
```
{ kind: 'experiment', taskId, owner, name, activeTab: 'notes' | 'results' | 'other', at }
| { kind: 'none', at }
```
Phone GETs the latest (device-key-signed) when composing a send/export.

Command the phone sends (signed POST, laptop poll applies + acks):
```
{ type: 'append-line', taskId, owner, tab: 'notes' | 'results', text }   // text = "5 x 2 + 7 = 17"
{ type: 'switch-tab', taskId, owner, tab }
{ type: 'route-capture', captureId, taskId, owner, tab }
{ type: 'timer', op: 'create'|'done'|'dismiss', timerId, label?, endsAt? }
```
Append uses task-doc.ts setTaskContentText (read + insert at end). Switch-tab
sets the (newly lifted) store tab state.

## Recommendations (resolving the open questions)

1. Build order: do the relay context + command lane (Phase 0) first since all
   three features need it, then lead with capture routing (smallest, reuses
   activeTask + SendToTaskPicker + the existing capture flow). Calc export is
   Phase 2 (adds the append-line command), timer sync Phase 3 (net-new laptop
   side). Recommend NOT leading with timer sync despite the wow, it is the most
   net-new.
2. Granularity: experiment + Notes/Results tab is enough for v1. activeNote
   exists too, so "send to the open note" is a cheap follow-on. Methods /
   project-folder targets are later.
3. Transport: relay-DO lanes (the phone is not a collab peer). Timer ticks are
   local; only create/done/dismiss sync. No need for the collab DO here.

## Design refinements, round 2 (2026-06-08)

### Security envelope (E2E, reuse the snapshot crypto)

Context and commands carry research content (experiment names, the appended
calculated line), so they are E2E SEALED, never plaintext to the relay. Reuse
sealToRecipient / openSealed (X25519 ECDH + HKDF-SHA256 + XChaCha20-Poly1305)
from frontend/src/lib/sharing/encryption.ts, exactly like the download/snapshot
path already does.

- Focus context (laptop -> phone): the laptop SEALS the context to each bound
  device's X25519 pubkey (already in the relay `devices` table). Phone unseals
  with its device X25519 private key (already on device). Relay sees only the
  sealed blob + the device id it is for.
- Commands (phone -> laptop): the phone SEALS the command to the USER's X25519
  pubkey. Prereq: the phone needs that pubkey. Add `userX25519` to the pairing
  grant (or the register response) so the phone learns it at pairing. Laptop
  unseals with the user X25519 private key.

So the relay stores only sealed blobs keyed by user + device, short TTL, deleted
on ack. Same trust model as captures/snapshots.

### Relay contract (new, mirrors the capture endpoints)

New canonical signed strings (the contract; keep byte-exact across all three):
```
researchos-context-publish\nu=..\ndevice=..\nts=..\nsha256=..   // USER-signed (laptop)
researchos-context-get\nu=..\ndevice=..\nts=..                  // DEVICE-signed (phone)
researchos-command-post\nu=..\ndevice=..\ncommandId=..\nts=..\nsha256=..  // DEVICE-signed (phone)
researchos-command-poll\nu=..\nts=..                            // USER-signed (laptop)
researchos-command-ack\nu=..\ncommandId=..\nts=..               // USER-signed (laptop)
```
Two new tables on the existing CaptureInbox DO (per-user):
```
context  (device_pubkey TEXT PRIMARY KEY, sealed BLOB, updated_at TEXT)  -- overwrite-latest per device
commands (command_id TEXT PRIMARY KEY, sealed BLOB, created_at TEXT)     -- FIFO, deleted on ack
```
Heartbeat: laptop publishes context ~every 10s while an experiment popup is
open, and once with kind:'none' when it closes. Phone polls commands on the same
loop it already polls captures.

### Append semantics (the one real gotcha)

The audit found setTaskContentText REPLACES the whole doc (delete 0..len +
insert), which would CLOBBER concurrent collab edits. Do NOT reuse it for
append. Add a targeted `appendTaskLine(doc, line)` that does
`content.insert(content.length, "\n" + line)` (a single CRDT insert at the end),
which is safe under live editing. The line is a PLAIN markdown line
`"<expr> = <value>"` with units (confirmed 2026-06-08, no label / timestamp /
bullet), e.g. `5 x 2 + 7 = 17` or `0.5 M NaCl in 50 mL (MW 58.44) = 1.46 g`,
built phone-side from the calculator state.

### Edge cases to handle

- Laptop offline / stale context: phone treats context older than ~20s as
  kind:'none' -> inbox / picker. No false "send to experiment".
- Target task not currently open: the laptop OPENS that experiment to the chosen
  tab and appends (confirmed 2026-06-08, "open it + switch + append"). Append
  itself writes the doc regardless of open state; the open+switch is the UX.
- Multiple laptops: v1 assumes one. Context is last-writer-wins per device; note
  multi-laptop disambiguation as a follow-up.
- Idempotency: commandId dedups; ack deletes; safe to retry. Timer dismiss is
  idempotent by timerId. Timers carry absolute endsAt (epoch ms) so each device
  computes remaining locally, clock skew is cosmetic.

## Locked decisions (2026-06-08)

- A. Auto-switch + append. When the phone exports to a doc that is not the
  visible tab, the laptop auto-switches to Lab Notes or Results and appends the
  line at the correct new-line position.
- B. Captures to an open experiment ASK Notes vs Results (let the user pick),
  then auto-switch the laptop to that tab and place the item there. When nothing
  is open, route to the inbox; inbox override always available. So captures and
  calc export share one "pick Notes/Results -> auto-switch -> place correctly"
  behavior.
- C. Full laptop timers panel. The laptop gets a real two-way timers panel
  (create / list / cancel), not just a fire-and-dismiss alarm.
