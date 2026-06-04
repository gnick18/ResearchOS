# Unified Share entry point (one button, lab + outside paths)

Status: proposal, build-ready. Author: HR. Date: 2026-06-04.
Scope: IA / consolidation layer over already-shipped sharing. No new
sharing mechanism, no payload-format change, no relay change.

## The problem (Grant, 2026-06-04)

Every shareable entity now shows TWO separate share affordances in its
header.

1. An INTERNAL lab-share control. This writes the live ACL inside a
   shared folder (`shared_with` entries with read / edit levels, the "*"
   whole-lab sentinel). Anyone in the folder who is granted access reads
   or edits the same live record.
2. A "Share outside this folder" / send-encrypted-copy control. This is
   the cross-boundary path. It seals a one-time snapshot, resolves the
   recipient by email through the identity directory, and relays opaque
   bytes. The recipient gets their own copy, not the live record.

To the user these are one intent ("share this"). Showing them as two
icons (often a share-node glyph next to a paper-plane glyph, or a
Private / Public pill next to a paper-plane) reads as clutter and
confusion. Beta feedback already flagged the surface as "too many
clicks / feels like AI".

The two mechanisms are both correct and both stay. What is wrong is the
ENTRY POINT. This proposal unifies the entry point into one Share button
that opens one dialog presenting both paths as an explained choice.

## The principle

One Share verb. One button. One dialog. Consistent across every
shareable entity.

The lab-vs-outside distinction is real and the user must understand it,
but it is a CHOICE INSIDE the surface, not two competing icons in the
header. The unified dialog explains the difference in one plain line per
path so the user picks deliberately, live-shared in your lab versus an
encrypted copy snapshot sent outside it.

Nothing about the two underlying mechanisms changes. The unified dialog
is a router. It owns layout and copy, then dispatches to the existing
ACL persistence (`sharingApi.shareX` via `ShareDialogAdapter`) or the
existing cross-boundary send (`SendOutsideDialog` family + the payload
builders) unchanged.

## What ships today (grounding)

INTERNAL lab sharing (the live ACL)

- `ShareDialog.tsx`, the writer. Renders the recipient list with
  per-row read / edit toggle, a "+ Share with the whole lab" shortcut
  (the "*" `WHOLE_LAB_SENTINEL`), and for projects an "Also share all
  tasks in this project" cascade checkbox. Takes a single
  `onSave(next, { cascadeToTasks? })` callback and does no persistence
  itself.
- `ShareDialogAdapter.tsx`, the persistence glue. Diffs the previous
  `shared_with` against the saved list and dispatches to
  `sharingApi.shareTask / shareMethod / shareProject` (per-recipient
  add / remove) or `sharingApi.shareNote / shareLink / shareGoal`
  (whole-array replacement), then runs the project-to-tasks cascade with
  partial-failure aggregation.
- `SharingChips.tsx`, the reader. A read-only chip row of who currently
  has access (owner chip, one chip per entry, "Whole lab" chip, a
  "private" hint when empty). Optionally renders a "Share..." button via
  `onShareClick`.

CROSS-BOUNDARY sending (the encrypted copy)

- `SendOutsideDialog.tsx` (note), `ExperimentSendOutsideDialog.tsx`
  (experiment), `MethodSendOutsideDialog.tsx` (method),
  `ProjectSendOutsideDialog.tsx` (project). Each is gated by
  `useSharingIdentity` with four states, `loading`, `none` (launches
  `SharingSetupWizard` inline), `needs-restore` (points at recovery),
  `ready` (the send form). The form takes one recipient email, looks the
  recipient up in the directory, and on a miss offers the
  invite-a-non-user path (`inviteShare` / `inviteRawShare`).
- Payload builders, one per type, `buildNoteBundleInput`
  (note-transfer.ts), `buildExperimentSendPayload`
  (experiment-transfer.ts), `buildMethodSendPayload` (method-transfer.ts,
  with `CompoundMethodNotSupportedError`), `buildProjectSendPayload`
  (project-transfer.ts, with `ProjectTooLargeError`). The note path
  uses `sendShare`; the experiment / method / project paths use the
  byte-agnostic `sendRawShare`.

Where the buttons live today

- `NoteDetailPopup.tsx`, a coarse `is_shared` boolean toggle (the
  "Private" / "Shared with lab" pill, line ~1339) PLUS a "Share outside
  this folder" outlined button (line ~1394) that opens
  `SendOutsideDialog`. `SharingChips` renders above as read-only with no
  `onShareClick`. Note here is the odd one out, its lab control is the
  coarse `is_shared` whole-lab toggle, not the full per-recipient
  `ShareDialog` the other three use. The note ACL (`shared_with`,
  `sharingApi.shareNote`) already exists; the popup simply never wired
  the rich dialog.
- `TaskDetailPopup.tsx` (experiment), a `TaskShareOutsideButton`
  paper-plane (line ~1289) PLUS a "Share task" share-node icon (line
  ~1377) opening `ShareDialogAdapter` (record type `task`).
- `ViewMethodModal` in `app/methods/page.tsx`, a Private / Public ACL
  pill (line ~1724) opening `ShareDialogAdapter` (record type `method`)
  PLUS a `MethodShareOutsideButton` paper-plane (line ~1400) opening
  `MethodSendOutsideDialog`.
- `ProjectRoute.tsx` (project header), a "Share project" share-node
  icon (line ~673) opening `ShareDialogAdapter` (record type `project`)
  PLUS a "Share outside this folder" paper-plane (line ~691) opening
  `ProjectSendOutsideDialog`.

## The unified Share dialog

One component, `UnifiedShareDialog`. One Share button per entity opens
it. Inside, two clearly labelled sections presented as tabs.

- Tab 1, "In your lab". This is the existing `ShareDialog` body
  verbatim, the live ACL. People in this folder, per-recipient read /
  edit, the whole-lab shortcut, and (projects only) the cascade
  checkbox. Persistence routes through the existing
  `ShareDialogAdapter` logic unchanged.
- Tab 2, "Outside your lab". This is the existing send flow, the
  encrypted-copy snapshot. Enter an email. A registered recipient
  receives a sealed copy via the existing cross-boundary send. An
  unregistered recipient drops into the existing invite path. The
  identity gate (`useSharingIdentity`) and the
  `loading / none / needs-restore / ready` states are reused exactly,
  the "Outside your lab" tab launches the `SharingSetupWizard` when the
  identity is not set up.

One-line explainer copy per tab (final copy is an open question for
Grant, this is the intent).

- In your lab, "Live access for people in this folder. They see your
  edits as you make them."
- Outside your lab, "Send a sealed copy to anyone by email. They get a
  snapshot, your later edits stay on your version."

ASCII mockup

```
+--------------------------------------------------------------+
|  Share "Plasmid prep v3"                                [ X ] |
+--------------------------------------------------------------+
|  [ In your lab ]   [ Outside your lab ]                       |   <- tabs
|  ----------------                                            |
|  Live access for people in this folder. They see your        |
|  edits as you make them.                                      |
|                                                              |
|  Currently shared with                                       |
|   (o) you  (owner)                                           |
|   (o) @maria        Can edit  (click to toggle)   [Remove]   |
|   (*) Whole lab     read       Currently includes (3): ...   |
|                                                              |
|  [ + Share with the whole lab ]                              |
|                                                              |
|  Add someone   [ Pick a user... v ] [ Edit v ] [ Add ]       |
|                                                              |
|  [ ] Also share all tasks in this project   (projects only)  |
|                                                              |
|                                       [ Cancel ]  [ Save ]   |
+--------------------------------------------------------------+

   ... user clicks "Outside your lab" ...

+--------------------------------------------------------------+
|  Share "Plasmid prep v3"                                [ X ] |
+--------------------------------------------------------------+
|  [ In your lab ]   [ Outside your lab ]                       |
|                    --------------------                      |
|  Send a sealed copy to anyone by email. They get a snapshot, |
|  your later edits stay on your version.                       |
|                                                              |
|  Sending this method                                        |
|   Plasmid prep v3                                            |
|                                                              |
|  Recipient email  [ them@university.edu          ]           |
|                                                              |
|                                       [ Cancel ]  [ Send ]   |
+--------------------------------------------------------------+
```

The header (title, record name, close) is shared chrome owned by
`UnifiedShareDialog`. Each tab's body is the existing component's body,
moved under the tab with no behavior change.

## Type-awareness (one dialog, four types)

`UnifiedShareDialog` takes one discriminated prop describing the entity,
then dispatches both halves correctly.

```
type ShareTarget =
  | { kind: "note";       note: Note;        owner: string }
  | { kind: "experiment"; task: Task;        owner: string }
  | { kind: "method";     method: Method;    owner: string }
  | { kind: "project";    project: Project;  owner: string };
```

- In-your-lab tab. Maps `kind` to the existing `ShareDialogRecordType`
  (`note` / `task` / `method` / `project`), passes the record's
  `shared_with` + owner into the existing adapter logic, and wires the
  caller's existing refetch into `onShared`. The project cascade
  checkbox renders only for `kind: "project"`, unchanged.
- Outside-your-lab tab. Maps `kind` to the right send component and
  payload builder, note -> `SendOutsideDialog` body
  (`buildNoteBundleInput`, `sendShare`), experiment ->
  `ExperimentSendOutsideDialog` body (`buildExperimentSendPayload`,
  `sendRawShare`), method -> `MethodSendOutsideDialog` body
  (`buildMethodSendPayload`, with the compound-method guard preserved),
  project -> `ProjectSendOutsideDialog` body
  (`buildProjectSendPayload`, with the too-large guard preserved).

No payload builder changes. No ACL persistence changes. The dialog only
chooses which already-shipped path to render and feeds it the entity it
already knows how to handle.

## Entity-header changes (two affordances collapse to one each)

Every header drops its two share controls and renders one Share button
that opens `UnifiedShareDialog`. Use one consistent Share glyph
site-wide (the existing share-node icon is the natural choice, it
already reads as "share" on task / project). Wrap it in `<Tooltip>`,
label "Share".

- `NoteDetailPopup.tsx`. Remove the "Share outside this folder" outlined
  button (line ~1394) and stop using the coarse `is_shared` pill (line
  ~1339) as the lab-share entry. Add one Share button. The In-your-lab
  tab now exposes the full note ACL (`shareNote`, per-recipient
  read / edit, whole-lab) via the existing adapter, which is an upgrade
  for notes since the popup currently only had the coarse toggle. The
  `is_shared` boolean keeps being written by the adapter's whole-lab
  path for back-compat, so no migration is needed. `SharingChips` stays
  as the read-only status row above.
- `TaskDetailPopup.tsx`. Remove `TaskShareOutsideButton` (line ~1289)
  and the standalone "Share task" icon (line ~1377). Add one Share
  button that opens `UnifiedShareDialog` with `kind: "experiment"`. The
  In-your-lab tab is exactly today's `ShareDialogAdapter` (record type
  `task`); the Outside tab is exactly today's
  `ExperimentSendOutsideDialog`. Export / deposit / history buttons are
  unrelated and stay.
- `ViewMethodModal` (`app/methods/page.tsx`). Remove the Private /
  Public ACL pill (line ~1724) and `MethodShareOutsideButton` (line
  ~1400). Add one Share button (`kind: "method"`). The Private / Public
  STATE the pill conveyed moves to `SharingChips` / a small status label
  next to the button so the user still sees whole-lab state at a glance;
  the WRITE action lives in the dialog's In-your-lab tab. Compound
  methods keep their "cannot be shared yet" notice inside the Outside
  tab.
- `ProjectRoute.tsx`. Remove the "Share project" icon (line ~673) and
  the "Share outside this folder" paper-plane (line ~691). Add one Share
  button (`kind: "project"`). In-your-lab tab carries the cascade
  checkbox; Outside tab is today's `ProjectSendOutsideDialog` with its
  too-large guard.

Net result, four headers, each with exactly one Share button, one
dialog, two explained paths.

## Edge cases

- Solo user / entity not in a shared folder. The In-your-lab tab has no
  one to share with. Default to opening on the In-your-lab tab but show
  its empty state ("Only you can see this. Invite labmates to your
  folder to share live."), and keep the Outside tab fully usable.
  Optionally, when the lab roster is empty (no other active members),
  open the dialog on the Outside tab by default. Do not hide the lab tab
  outright, hiding it would make the surface inconsistent across users;
  an explained empty state is clearer.
- Entity already shared. Reflect current state on open. The In-your-lab
  tab shows existing recipients and levels (today's behavior). The
  button / chips show the current state (private / shared / whole lab)
  so the user sees it before opening. Re-sending outside always sends a
  fresh copy, unchanged.
- Permission levels. Per-recipient read / edit and the whole-lab
  read-only default are unchanged, they live in the In-your-lab tab
  exactly as in `ShareDialog` today.
- Identity not set up. The Outside tab renders the existing gate. On
  `none` it shows the explainer and a "Set up sharing" button that
  launches `SharingSetupWizard` inline, then refreshes into the send
  form, exactly as the send dialogs do now. On `needs-restore` it points
  at recovery. The In-your-lab tab never needs an identity, so a user
  with no identity can still manage lab ACLs and is only prompted to set
  up when they pick the Outside path.
- Read-only / shared-in viewers. Today each header hides its share
  controls for non-owners (`!readOnly`, `!task.is_shared_with_me`,
  `!project.is_shared_with_me`, `canModify`). Preserve those exact
  guards on the single Share button so a shared-in viewer still sees no
  Share button.
- `SharingChips` and badges. Unchanged. Chips stay the read-only status
  row. Where a header wants a one-click open, point the existing
  `onShareClick` at the new `UnifiedShareDialog` instead of the old
  dialog. The methods grid card whole-lab badge (the GlobeIcon on shared
  cards) is unrelated and stays.

## Build plan and phasing

Phase 0, no code. Confirm copy + the empty-lab default-tab decision with
Grant (open questions below).

Phase 1, build `UnifiedShareDialog` wrapping the existing dialogs.
Create the shell (shared header, two tabs, per-tab explainer line). Tab
1 renders the existing `ShareDialog` body through the existing
`ShareDialogAdapter` persistence. Tab 2 renders the four existing send
dialog bodies selected by `kind`. No header is touched yet, the new
dialog is fully testable in isolation behind a Storybook-style harness
or a unit test. Both underlying mechanisms are imported, not rewritten.

Phase 2, swap each entity header one at a time (separate commits, easy
to bisect and revert).
- 2a, `TaskDetailPopup` (experiment), the cleanest case, both halves are
  already the canonical dialogs.
- 2b, `ProjectRoute`, same shape plus the cascade checkbox.
- 2c, `ViewMethodModal`, moves Private / Public state to chips / a label.
- 2d, `NoteDetailPopup`, the biggest UX change, the coarse `is_shared`
  toggle is replaced by the full ACL tab. Verify the back-compat write
  of `is_shared` still fires via the adapter's whole-lab path.

Phase 3, verify and clean up. Run the post-redesign verifier loop
(mechanics + spec-compliance + fresh-eyes) since this touches four
shippable surfaces and a state-machine (the identity gate). Then prune.

What can be deleted once unified

- The standalone outside-send buttons in each header
  (`TaskShareOutsideButton`, `MethodShareOutsideButton`, the note +
  project inline send buttons and their `showSendOutside*` /
  `showSendOutsideDialog` state).
- The standalone in-header lab-share buttons / pills once their open
  paths route through `UnifiedShareDialog`.
- NOT deleted, the four `*SendOutsideDialog` BODIES, the payload
  builders, `ShareDialog`, `ShareDialogAdapter`, `SharingChips`,
  `useSharingIdentity`, the relay client. The unified dialog consumes
  all of them. This is a consolidation of entry points, not a teardown.
  If the send-dialog bodies are refactored into tab-content components,
  the outer modal chrome (the fixed overlay + close button) in each
  `*SendOutsideDialog` becomes the only deletable part, the form bodies
  move under the Outside tab.

## Open questions for Grant

1. Tab vs. two stacked sections. The mockup uses tabs. Two always-
   visible stacked sections (lab on top, outside below) is the
   alternative, more discoverable, taller dialog. Preference?
2. Default tab for a solo / empty-lab user. Open on In-your-lab with an
   empty state, or auto-open on Outside when the lab roster is empty?
3. Final one-line copy for each tab's explainer (the strings above are
   intent, not locked).
4. The Share glyph. Standardize on the existing share-node icon
   everywhere, or introduce a single new Share glyph for all four
   headers?
5. Notes get a real upgrade here (coarse `is_shared` toggle -> full
   per-recipient ACL tab). Is that in scope for this consolidation, or
   should notes keep the coarse whole-lab toggle inside the lab tab to
   avoid changing note behavior in the same change?
