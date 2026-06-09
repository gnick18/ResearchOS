# Phase 3: laptop timers panel + cross-device timer sync (build plan)

Status: mockup APPROVED 2026-06-09 (Grant, "timer looks great").
Mockup: docs/mockups/2026-06-09-laptop-timers-panel.html
This is the build plan for the net-new laptop half. The phone timers + alarm
already shipped (mobile/lib/timers.ts, mobile/app/(tabs)/timers.tsx, LabAlarm,
AlarmSettingsCard). House style applies (no em-dashes, no emojis, no mid-sentence
colons; Icon not inline svg; BeakerBot only mascot).

## Transport (reuse existing lanes, NO relay redeploy)

Both directions ride lanes that already exist and are type/name generic, so the
relay needs no new tables and no deploy.

- Phone -> laptop: the command channel (POST /capture/command, GET
  /capture/commands/poll, POST /capture/commands/ack). New sealed command type
  `{ type: 'timer', op: 'create' | 'dismiss', timerId, label?, endsAt? }`,
  sealed to the user X25519 key, applied + acked by poll.ts. Same lane the
  route-capture / append-line / append-note-text commands already use.
- Laptop -> phone: the snapshot publish (POST /capture/snapshot/publish, GET
  /capture/snapshot/get?name=). New snapshot name `"timers"` alongside
  today / inventory / notebooks. Payload, sealed per device:
  `{ running: TimerWire[], dismissed: string[] }`.

FLAG (data shapes, additive): the new `timer` command type and the new `"timers"`
snapshot name are new wire shapes on the relay lanes. Both are additive and need
no relay code change (the lanes are generic), but they are new contracts.

## Sync model (peer-mirror, dismiss-by-id, done-is-local)

- Every timer carries an absolute `endsAt` (epoch ms) and a globally-unique
  `timerId` prefixed by origin (`lap_` / `phn_`).
- "done" NEVER syncs. Both devices flip a timer to done locally the instant
  `now >= endsAt`, so they fire together with zero network. Only CREATE and
  DISMISS travel.
- Laptop owns laptop-created timers and publishes them in the `"timers"` snapshot
  `running[]`, plus a `dismissed[]` tombstone list (ids it dismissed, either
  origin).
- Phone owns phone-created timers (AsyncStorage, already shipped) and posts
  create / dismiss commands.
- Merge:
  - Phone view = own running timers + snapshot.running (deduped by id) minus
    snapshot.dismissed.
  - Laptop view = own running timers + phone-created timers learned via create
    commands, minus anything dismissed.
- Unified dismiss: dismissing any card emits a dismiss in the correct direction
  (phone dismiss -> command to laptop; laptop dismiss -> tombstone in the next
  snapshot). Idempotent by timerId, so a double-tap or a flaky retry never
  double-fires or leaves a ghost ringing.

## Persistence

Laptop timers live in a small store persisted to localStorage (the absolute
`endsAt` survives a refresh). NOT the data folder and NOT collab. Timers are
ephemeral, per-device bench tools, so syncing them into the folder or the CRDT
would be wrong. The phone keeps its existing AsyncStorage store.

## Alarm (laptop)

- Visual ALWAYS plays (the BeakerBot eureka overlay), the guaranteed channel.
- Sound (Chime) is gated on the per-device setting (default on) AND the browser
  autoplay policy. GOTCHA: browsers block audio until the page has had a user
  gesture. In practice anyone using the app has already clicked, so it plays, but
  a freshly-loaded untouched tab can be silent until first interaction. Mitigation:
  prime the audio element on the first user gesture; never depend on sound alone.
- Unified dismiss clears the alarm on both devices.

## Per-device settings

Laptop alarm mode, "Sound and visual (Chime)" (default) or "Visual only", stored
in user-settings like the companion prefs. The phone keeps its own sound /
vibration settings. Default everywhere is the full Chime experience.

FLAG (data shape): new user-setting `laptopAlarmMode: 'sound-visual' |
'visual-only'` (default `'sound-visual'`).

## Chunks (each its own commit, tsc-gated)

1. Laptop timer store + persistence (localStorage, endsAt reconcile + 1s tick,
   create / cancel / clear-finished). No UI, no sync. LOCAL ONLY, no data-shape.
2. Timers popup + header clock button + running-count badge (mirrors the
   companion hub popup pattern). Presets + HH:MM:SS create, running list, cancel,
   finished. LOCAL ONLY, no data-shape.
3. Outbound sync: laptop publishes the `"timers"` snapshot (joins the
   TodaySnapshotPublisher cadence, gated by the auto-publish kill switch). FLAG.
4. Inbound sync: poll.ts handles `{type:'timer'}` commands; the phone fetches the
   `"timers"` snapshot + merges. FLAG (mobile + laptop).
5. Alarm overlay (web LabAlarm) + Chime audio (primed on gesture) + unified
   dismiss wiring.
6. Per-device laptop alarm setting (user-settings + panel footer + Settings).
   FLAG (the new setting).

Chunks 1-2 are pure local code with no data-shape implications, so they can be
built immediately. Chunks 3-6 touch the flagged wire shapes and wait for sign-off.
