# Claude-in-Chrome rehearsal: Check-ins demo clip

Validates the new "Check-ins" demo-video clip end to end before recording. Unlike
the other clips this one needs NO data folder (the `/demo` route auto-installs the
fixture) and records as the lab head (Mira) via the demo `demoViewAs` override.

Preconditions (Grant):
- Dev app running at http://localhost:3000 (local main, has the seeded fixture +
  the `checkins` clip).
- No folder picker needed. The demo route installs the in-memory fixture itself.

What we need confirmed (the unverified bits):
- `demoViewAs=mira` actually lands you in Mira's (lab-head) check-ins view.
- The seeded data renders: the 3-level mentorship tree, Alex's populated IDP, the
  group task board with per-assignee bands, the presenter rotation, the templates.
- The clip's auto-driven cursor hits every beat without missing a target (the
  space-row beats target a label substring, which is the main selector risk).

---

You are rehearsing a demo-video clip in a local web app, with the mouse. Work in
the active Chrome tab. Go slowly and report what you see at each step.

PART 1: watch the auto-driven clip
1. Open a new tab to: http://localhost:3000/demo?record=1&demo=checkins&demoViewAs=mira
2. Wait for the app to load. A 5-second countdown appears, then a black arrow
   cursor drives the UI on its own. Do NOT touch the mouse during this. Just
   watch and take a screenshot near the end.
3. PASS CHECK. Report whether the cursor completed all six beats without getting
   stuck (it visibly: opens a Check-ins tab, opens a lab tree, opens an IDP,
   opens a group task board, opens a rotation, opens a template gallery). If it
   STALLED on any beat (cursor parks and nothing happens), note exactly which
   beat and what was on screen, that is a selector that needs fixing.
   Tip: you can press the backtick key (`) to replay the clip from the top.

PART 2: verify the data + selectors by hand (drive it yourself)
Reload to a non-record view so the dev chrome is visible:
4. Open: http://localhost:3000/demo?demoViewAs=mira  and wait for load.
5. Confirm you are MIRA: somewhere in the app chrome it should indicate the lab
   head / Mira (not Alex). If it says Alex, the demoViewAs override did not take,
   report that.
6. In the top navigation click "Workbench", then click the "Check-ins" tab.
7. RAIL CHECK. The left rail should group spaces by relationship. Confirm you see
   Mira's mentees (Alex and Morgan), a skip-level entry (Remy), and a group
   ("FakeYeast group meeting"). Screenshot the rail.
8. TREE CHECK. Click "View lab tree". Confirm the tree shows the hierarchy:
   Mira at the top mentoring Alex, Morgan, and Remy, with Alex in turn mentoring
   Remy (a 3-level shape). Screenshot it, then close the tree.
9. IDP CHECK. Open Alex's check-in (the rail row for Alex), then click the "IDP"
   tab. Confirm a populated individual development plan renders (a career stage
   like "Grad student", and filled sections such as self-assessment, goals, an
   action plan, and a mentor review). Screenshot it.
10. GROUP BOARD CHECK. Open "FakeYeast group meeting", then the "Task board" tab.
    Confirm there are tasks grouped by assignee (different members own different
    tasks), with the Everyone / Mine scope toggle. Screenshot it.
11. ROTATION CHECK. In the same group, click the "Rotation" tab. Confirm a
    presenter rotation shows (tracks like "Data presentation" and "Journal club"
    with an up-next / on-deck order). Screenshot it.
12. TEMPLATES CHECK. Click "Start a check-in". Confirm a template gallery appears
    with career-stage templates (undergrad / grad / postdoc / staff scientist /
    thesis committee). Screenshot it, then close the dialog (you do not need to
    create anything).

REPORT
- Did the auto clip (Part 1) complete all six beats, or stall? If it stalled, which
  beat and what was on screen.
- Did demoViewAs=mira land you as Mira (step 5)?
- For each data check (tree, IDP, board, rotation, templates) did the seeded
  content render as described? Call out anything empty, missing, or wrong.
- Any console errors, layout overlaps, or a space row that opened the wrong space.
Include the screenshots. If a step blocks you, describe exactly what is on screen.
