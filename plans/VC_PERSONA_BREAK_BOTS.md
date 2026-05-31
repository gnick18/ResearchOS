# Version-control persona break-bots (5 personas)

Adapted from the v4-tour persona set (feedback_walkthrough_persona_break_bots) to the version-control feature: the Notes version-history viewer (Phase 1) + Restore + 24h undo (Phase 2, now RESTORE_ENABLED=true). Each persona drives the LIVE app as a fake user and reports friction + bugs worst-first. They complement the unit/spec verification with a real-user lens.

## Shared setup (every persona)
- Run from an ISOLATED COW-clone worktree off current main (cp -c -R the main checkout node_modules into the worktree; do NOT symlink, it breaks Turbopack dev; do NOT npm install). Each persona uses a DISTINCT dev-server port (persona N -> 341N) so they do not collide; do NOT blanket-kill other 30xx/34xx servers (other personas are running) - manage only your own port.
- Preview MCP preamble: fix the worktree .claude/launch.json to a direct launcher on your port (bash -c "cd <worktree>/frontend && exec npm run dev -- -p 341N"); preview_start; preview_resize to 1440x900; sanity-check the live bundle has the version-history button (preview_eval). Navigate to http://localhost:341N/demo (the INTERACTIVE demo: auto-loads the fixture and PINS the session to `alex`, a POSTDOC / lab MEMBER - NOT the PI; no folder picker; notes are EDITABLE + writes persist in-memory for the session). Roster ground truth: `mira` (Dr. Mira Castellanos) is the demo PI, `alex` is a postdoc, `morgan` is a grad student. So the /demo path tests the MEMBER-restoring-own-note flow, not the PI path. Do NOT use ?wikiCapture=1 - that is the read-only SCREENSHOT fixture (no editor mounts, notes uneditable), which cannot generate history. NEVER touch real data.
- TOOLING LIMITATION (known): Preview real-clicks do NOT reach the React handlers INSIDE the note editor body, and there is no way to inject editor text via real typing. To exercise content edits, drive the production code paths via React props / the notesApi (still the real save + history paths), and SAY SO in the report (distinguish "tested via real clicks" from "tested via props"). The genuinely-untestable-in-fixture bits (real pointer testing inside the editor; the PI-unlock cross-owner restore, since /demo pins a member) must be flagged for Grant's manual pilot, not asserted as PASS.
- Generate your own history: in /demo, CREATE A NEW NOTE (the demo is interactive), then make 4-6 distinct edits with a save between each (the history engine accumulates in-session). THEN open the version-history sidebar (the clock/counter-arrow button in the note popup header). If even the demo will not mount an editable note editor or accept saves, STOP and report that as the blocker (do not assume a VC bug).
- Report worst-first with severity: P0 (data loss / crash / wedge), P1 (wrong behavior / broken affordance), P2 (friction / confusing copy). Cite what you clicked + what happened vs expected. Max ~400 words. Clean up (kill your server, close MCP tabs). Read-only on code (do NOT edit app code; you are testing, not fixing).

## The VC walk-path (what to exercise, all personas)
1. Make several saved edits to one note, then open version history. Confirm the timeline lists versions newest-first, grouped by day then session; the live HEAD row is labeled current.
2. Select an older version: the diff renders in-place in the document column, per-editor tinted; the document goes read-only while history is open. Toggle compare "vs previous" / "vs current".
3. Restore: "Restore this version" (sidebar footer) -> confirm -> a new "Restored..." version appears at top, the note content matches the restored version, NOTHING is deleted, and the sidebar exits to show the live restored note with "Undo restore" in the header.
4. Undo: "Undo restore" (header, within 24h) -> the note returns to pre-restore, an "undo-revert" row appears. Then EDIT the note after a restore and try undo again -> the edits-since confirm should fire.
5. Empty state: open version history on a note with no edits yet -> graceful "no earlier versions" state.

## The 5 personas (the lens each applies on top of the walk-path)

### 1. Literal reader
Reads every label, tooltip, and confirm-copy literally; does exactly what the UI says, never improvises. Surfaces: confusing or mismatched copy (does "Restore this version" / "Undo restore" / the confirm text say what actually happens?), mislabeled buttons, tooltips that do not match behavior, the empty-state wording, the compaction "earlier versions summarized" copy, any speech/label describing UI that is not there.

### 2. Curious off-rails explorer
Does the walk-path AND pokes everything: expands/collapses every day + session group, clicks every version rapidly, opens the compare toggle mid-diff, tries to edit the doc while history is open (it should be read-only), opens history on a shared note, closes + reopens the sidebar, clicks Restore then immediately Restore a different version. Surfaces: state bugs, the sidebar+editor interaction, restore-while-previewing, read-only-gate gaps, focus-trap issues, double-restore races.

### 3. Distracted / interrupted user
Starts a restore then navigates away mid-flow; double-clicks Restore + Undo; edits the note then tries Undo (the edits-since guard); waits/idles; closes the popup mid-undo; restores, edits, restores again. Surfaces: the undo edits-since path, restore/undo race conditions, the 24h window behavior, half-completed restore states, the popup-close-mid-operation case.

### 4. Domain-aware skeptical user
Savvy on Google Docs / Notion / Benchling version history. Compares the promise to delivery: is it really Google-Docs-like? Reads the diffs critically (are the changes accurate? is the per-editor tinting right? does "nothing is deleted" actually hold across a restore?). Tries to break the timeline integrity: restore an old version, restore again, undo, restore, and check the version list stays coherent + the content is always right. Surfaces: overclaims, diff inaccuracy, tinting errors, broken "nothing deleted" promise, timeline incoherence, honesty of the compaction summary.

### 5. Restart / re-run user (stress + cross-owner gate)
Restores and undoes many times in a row; makes many rapid saves (push toward compaction if reachable); checks the timeline stays coherent + the undo window behaves after repeated restores. THEN the cross-owner gate: in /demo you are `alex`, a MEMBER (not the PI), so open + try to restore a DIFFERENT user's note (morgan's) - confirm Restore is HIDDEN or disabled-with-unlock-tooltip for a non-owner member. The actual PI-unlock-routes-correctly path needs the PI (`mira`) signed in, which /demo does NOT provide (it pins alex) and ?wikiCapture=1&fixtureUser=mira is read-only - so FLAG the PI-restore path for Grant's manual pilot rather than asserting PASS. Surfaces: repeated-restore integrity, undo-window-after-many-restores, the cross-owner gate (hidden vs disabled) for a member, compaction-boundary weirdness.

## Triage
HR collects all 5 reports, dedupes, and queues fix chips worst-first; P0/P1 get fixed before any wider VC rollout (Phase 3 all-surfaces). The personas are read-only; they find, HR fixes.
