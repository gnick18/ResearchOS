# Toggleable Today page (mobile)

Status: spec for the orchestrator (mobile manager). Grant 2026-06-09. Captures
the structural decision to bring back a Today surface as an opt-in.

## Context

The early apple-polish-v2 mockup had a dedicated Today tab (a read-only "what is
on today" synced from the laptop). The app moved off a standalone Today page.
Grant is open to bringing it back as an OPT-IN, on for bench users who want a
glanceable today, off for those who want the app lean.

## Decision

A Settings toggle "Show Today" (default off). When on, a Today surface appears
showing the synced today snapshot (today's tasks + overdue), read-only. When off,
no Today surface and the app is unchanged.

## Why it is cheap

The data already syncs, `TodaySnapshotPublisher` (laptop) publishes it and the
phone reads it via `fetchSnapshot('today')` (the demo Notebook already renders a
today list). So this is a visibility toggle + a place to render the existing
snapshot, not new sync work. The toggle reuses the same pref-plus-conditional
pattern as the companion-button toggle (a device-local pref, mirror
alarm-prefs/mascot-prefs, gating the surface).

## Open structural questions for Grant (settle before build)

- Surface shape. Today as its own TAB in the tab bar (appears when the toggle is
  on), or a section at the top of the Notebook tab, or a pull-down? A tab matches
  the old mockup; a section keeps the tab bar stable.
- Tab-bar interaction. If Today is a tab, the bar grows from 5 to 6 when enabled.
  Confirm that is acceptable, or cap the bar and make Today replace something.
- Content. Tasks + overdue only (as the mockup showed), or also today's
  experiments / timers? Recommend tasks + overdue for v1 (matches the snapshot).
- Read-only vs actionable. Recommend read-only glance for v1; tapping a task could
  later deep-link or route a capture to it.

## Reuse vs new

- Reuse: the today snapshot (already published + fetched), the toggle pref
  pattern (mascot-prefs/companion), the existing today-list rendering from the
  demo Notebook.
- New: the Settings toggle "Show Today", the Today surface placement (tab or
  section), and gating it on the pref.

## Labor split

- Cosmetics-session sliver (if the manager wants): the Settings toggle UI + its
  device-local pref (same as the companion-button toggle).
- Orchestrator: the Today surface placement (tab-bar change is structural) and
  wiring it to the today snapshot.

## Scope note

The toggle + pref is cosmetics-sized; the tab-bar / surface placement is a
structural change in the manager's domain. This doc is the design.
