# Handoff: Class-nav UI + folder picker + account-centric identity proposal (2026-06-20)

Owner: orchestrator / Class-Mode + multi-folder lanes. House voice, no em-dashes,
no emojis, no mid-sentence colons. This was a long session spanning three lanes,
all browser-driven verification with Grant.

## TL;DR

Three lanes moved this session. (1) The Class-Mode student-facing UX is BUILT,
browser-verified both roles, and LANDED on main. (2) The multi-folder top-bar
picker is built + gated + handed to DEBUG to land. (3) Grant asked a deeper
identity-model question (folders tied to people, not the OAuth account), which
turned into a build-ready design proposal with his decisions locked. The
identity-model BUILD is the queued next lane.

## Lane 1, Class Mode student UX (LANDED on main, fb61e6ce5)

Browser-verified on a flag-on dev server, both roles (alice = class student,
prof = class instructor). All checks green.

- Assignments placement (A + C). Replaced a permanent full-width "Your assignments"
  block (Grant flagged it as messy) with a workbench Assignments TAB (leads the tab
  row, mortarboard glyph + count badge, exempt from the class-template tab forcing)
  PLUS a global top-nav Assignments entry opening a right-side slide-over
  (StudentAssignmentsDrawer) from any page. Both render ClassAssignmentsPanel.
  CRUCIAL placement note, the panel must mount on /workbench NOT /lab-overview
  (the latter hard-bounces non-lab_head to "/", so students never see it).
- Check-6 hydrate fix. ClassAssignmentsPanel reads the student tasks on mount and
  hydrates each assignment row from its existing notebook, so the Submitted state
  PERSISTS across reload and a fresh notebook shows an actionable Submit.
- Slim student nav. A class student sees only a coursework-relevant top-nav
  (CLASS_STUDENT_NAV_DEFAULT = workbench, methods, sequences, chemistry, datahub,
  figures, calendar; figures lands in More). Instructor toggles extras per class via
  the class dashboard "Screens students see" picker (CLASS_STUDENT_NAV_CHOICES,
  publishes ClassDashboard.nav, default encoded ABSENT). Hiding is nav-visibility
  only, never a route gate (verified, /gantt loads by URL). resolveClassStudentNav +
  filterClassStudentNav + useClassDashboard.studentNav.
- Hide High Level Goals in any class folder on the Gantt (sidebar + "+ Goal" button
  via additive Toolbar showGoalButton + goal markers + modal). Lab goals have no
  classroom meaning.
- Grant decisions, figures = visible-in-More default, phylo = instructor-opt-in,
  goals = hidden in class mode.

## Lane 2, multi-folder top-bar picker (feat/topbar-folder-picker, handed to DEBUG)

Built by a sub-agent in an isolated worktree, independently re-gated (tsc 0, 8
selector tests). Main + 2 commits, behind 0, a clean ff. Behind MULTI_FOLDER (dark).

- Up to 3 PINNED folder chips in the top bar (kind glyph + color + nickname via the
  existing folderKindIcon/folderKindBadge), one-click switchFolder; overflow >3 uses
  the existing FolderSwitcher dropdown; a Settings "Pinned folders" pin-picker capped
  at 3 (enforced in the store setRememberedFolderPinned). Additive `pinned?` on
  RememberedFolderMeta. The "Class / My work" view-lens toggle is left distinct.
- VERIFY state, the Settings pin-picker is browser-verified; the multi-folder
  mechanics (plural chips, switching, overflow, 3-cap) are test-covered but were not
  browser-walked because connecting 4 folders is a human-only native-FSA step that
  could not be driven. The per-kind glyph shows Solo for picked FIXTURE folders, that
  is correct-by-design (folderKindIcon reads the CACHED labRole, which only a
  provisioned class/lab sets, not a plain picked folder), not a bug.
- Grant chose to LAND it as the pure UI layer; it inherits whatever switch semantics
  the identity-model build lands.

## Lane 3, account-centric folder identity (PROPOSAL, build-ready, NOT built)

Grant: "why are folders tied to people at all? shouldn't it be tied to the 3rd-party
login, and if a new login tried taking over the account it warns them before letting
them do this?" Audited + written up.

- Doc, docs/proposals/2026-06-20-account-centric-folder-identity.md.
- KEY FINDING, the target (one account = identity, constant across folders; folders =
  data stores) is ALREADY the locked 2026-06-15 redesign, with Phases A and B built
  behind MULTI_FOLDER (dark). The genuinely UNBUILT parts are the folder-ownership
  record, the foreign-account takeover warning, and the shared-file sweep + revert.
- Why switching swaps the person today, the active person is the per-folder currentUser
  string, re-derived by scanning users/ on every connect; switchFolder runs that same
  finishConnect discover-and-validate. The session keypair is already global.
- Grant decisions LOCKED, D1 EXCLUSIVE owner (owner fingerprint + email label);
  D2 WARN then allow rebind (real Cancel + deliberate take-over, no soft-lock);
  D6 shared files MOVE TO FOLDER TRASH (not hard-delete) tagged with the takeover
  event, plus a "Revert ownership" button that restores that exact trashed set AND
  hands ownership back to the previous_owner fingerprint, so takeover is reversible.
- Shared-file detector is concrete, records carrying received_from_fingerprint (sealed
  to the prior identity via sealToRecipient) are the "files you cannot view" set; the
  absence of that field is the exclusion guard that preserves own-authored content;
  intra-lab _shared_with_me references are out of scope.
- KEY RISK, rebind-on-takeover is data-safe ONLY while DEVICE_KEY_V2 at-rest
  encryption stays OFF; re-review the takeover flow before that flag ever flips.

QUEUED NEXT LANE, the identity-model BUILD off this proposal, folder-ownership record
(users/_folder_owner.json with previous_owner) + takeover warning modal + foreign-share
trash sweep + Revert ownership + account-centric switch semantics, all behind
MULTI_FOLDER.

## Standing gotchas this session (shared-checkout churn, the hard way)

- My commits got ORPHANED TWICE. A concurrent session switched the shared main
  checkout onto another branch (fix/sharing-identity-test-mock) UNDER me mid-session,
  so a commit landed on the wrong branch; and DEBUG's verify/integ rebases dropped a
  cherry-picked base from main. Recovered each time by cherry-picking into an isolated
  worktree. REINFORCED RULE, build every lane in an ISOLATED worktree off a known-good
  ref, gate, and hand the branch to DEBUG for the ff, never commit into the shared main
  checkout during a multi-session sweep.
- A sub-agent's self-reported "tsc 0" is not the merged-tree truth, always re-gate the
  branch independently before landing.

## Open follow-ups

- BeakerAI lane (chip task_264d09e5), surface experiment sub_tasks in the notebook view
  + materialize the template method for students. Uncommitted in the shared tree, theirs.
- Instructor toggle full publish->student E2E needs a real 2-folder relay setup (only
  the toggle UI render was verified).
- Folder-picker per-kind glyph needs a provisioned-labRole folder to show non-Solo.
- The identity-model build (the queued lane above).

## Key anchors

- Class nav, lib/lab/class-dashboard.ts (resolveClassStudentNav + CLASS_STUDENT_NAV_*),
  lib/lab/class-chrome.ts (filterClassStudentNav), components/AppShell.tsx,
  app/workbench/page.tsx, app/gantt/page.tsx, components/Toolbar.tsx.
- Folder picker, lib/file-system/topbar-folder-chips.ts, components/file-system/
  TopBarFolderChips.tsx + PinnedFoldersSection.tsx, indexeddb-store.ts (pinned).
- Identity proposal, docs/proposals/2026-06-20-account-centric-folder-identity.md +
  the locked 2026-06-15 redesign it builds on.
- Memory, project_class_mode_cross_folder, project_cloud_accounts_local_data,
  project_require_account_local_first, project_account_setup_revamp.
