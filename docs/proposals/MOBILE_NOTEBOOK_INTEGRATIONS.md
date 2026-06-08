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
- Experiment open -> suggest "Send to <experiment name>" as the primary
  action, with "Send to inbox instead" as the secondary.
- Nothing open -> send to the inbox (today's behaviour), no prompt.
- Always allow overriding to the inbox.

This is the smallest feature and the natural first milestone, since it only
adds a suggestion on top of the existing capture send.

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

Needs: timers become a synced entity through the relay (create / tick is local,
but create + done + dismiss events sync), plus the laptop-side timer UI + alarm.

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

## Remaining decisions for you

- A. Do you want the laptop to AUTO-SWITCH its visible tab when the phone
  exports to the non-active doc, or just append silently and show a toast? (I
  lean auto-switch, since you described it that way.)
- B. For capture routing, when an experiment is open, should "Send to <exp>" be
  the default with inbox as one tap away, or always ask? (I lean default-to-open
  with an easy inbox override.)
- C. Timer sync needs a laptop timer UI built from scratch. Is a small timers
  panel on the laptop in scope, or is the laptop side just the alarm (fires +
  dismiss) with creation staying phone-only for v1?
