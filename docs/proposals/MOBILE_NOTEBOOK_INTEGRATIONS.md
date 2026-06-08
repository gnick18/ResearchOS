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

## Open questions for sign-off

1. Build order: the phasing above (capture routing first), or lead with the
   calculator export since that is the one you described most concretely?
2. Focus context granularity: is experiment + tab (lab-notes/results) enough for
   v1, or do we also want notes / methods / project-folder targets now?
3. Timer sync transport: piggyback on the capture relay poll, or a lighter
   real-time channel (the collab DO) for the tick/dismiss events?
