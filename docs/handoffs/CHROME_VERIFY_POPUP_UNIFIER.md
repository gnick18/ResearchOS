# Chrome verify — Popup Unifier lane (handoff takeover, 2026-06-14)

Covers commits `dd55600dd` (.ros-kbd keycaps + Focus shortcut hint) and
`318dec9d8` (ProjectDetailPopup → CalmPopupShell). Run on a real Chrome via the
extension; hover/tooltip + visual checks need real pointer events.

Sign in, open a folder with at least one project that has a note, an experiment
task, results, and methods.

## 1. Keycap chips (.ros-kbd)
- Open any markdown editor that shows the shortcuts sidebar (a note or
  experiment Lab Notes in focus mode).
- PASS: the shortcut chips (e.g. the Bold/Italic keys and the syntax chips)
  read as little RAISED keycaps — a crisp 1px bottom edge + soft drop shadow,
  not flat boxes. Check both light and dark (chips recolor to bluish-white edge
  in dark, not invisible black).

## 2. Focus button shortcut hint (editor popups)
- Open a NOTE popup. Hover the Focus (⤢) glyph in the header action cluster.
  PASS: tooltip reads `Focus (⌘⇧F)` on Mac / `Focus (Ctrl+Shift+F)` elsewhere.
  Click it / press the shortcut — popup grows to fullscreen; tooltip now reads
  `Exit focus (⌘⇧F)`.
- Open an EXPERIMENT task popup (Lab Notes / Results tabs). Same Focus tooltip
  with the shortcut.
- Open a SIMPLE (checklist) task popup. PASS: Focus glyph tooltip is just
  `Focus` with NO shortcut suffix (no editor binding there — intentional).

## 3. ProjectDetailPopup on CalmPopupShell
- Open a project (click a project card).
- PASS home view:
  - Slim accent band along the top edge in the PROJECT COLOR.
  - Title = project name; below it the Archived / "Shared by {owner}" badges
    (only if applicable).
  - Right action cluster: the three-dot kebab + the shell Close (X). No old
    absolute-positioned close X.
  - Body sections (status glance, funding chip, tags, recent activity,
    doorways) render as before.
- Open the kebab: Edit / Archive / Delete. Click Archive -> the archive confirm
  dialog appears over the popup and works (Cancel + Archive). Same for Delete.
  (Confirm dialogs are intentionally unstyled in this pass.)
- Click a doorway (Results or Methods). PASS sub-view:
  - Header title becomes the view name (e.g. "Results"); no badges, no kebab.
  - In-body "Back to project" BackBar present and returns to home.
  - Close (X) and Escape still close the whole popup.
- Edit project (kebab -> Edit), Share, and Deposit dialogs still open/function.

## Report
Note any PASS/FAIL per section. Screenshots of (a) a keycap chip close-up,
(b) the Focus tooltip, (c) the project home header + accent band, (d) a project
sub-view header.
