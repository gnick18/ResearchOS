# Home Widgets walkthrough proposal

**Status:** Draft for Grant review, 2026-05-25.
**Author:** master bot, synthesizing the walkthrough-widgets researcher map (a4xx...) and Grant's voice-to-text request.
**Slots into:** ONBOARDING_V4_PROPOSAL.md (extends §6 universal walkthrough).

---

## 1. Why

The v4 walkthrough was authored before the Home widget canvas existed. Today the walkthrough teaches a user how to create a project, then drops them into Project Overview and never comes back to explain that Home itself is a customizable, widget-driven dashboard.

Grant's verbatim ask: after projects are explained, BeakerBot should introduce widgets, show that they expand into popups, and show that the canvas is per-user customizable in both content and order. The depth of care should match §6.2 (Project Overview) and the other production sections, not a bolt-on.

The lab-overview widget cluster was nuked from the tour on 2026-05-23 ahead of the Mira-substrate redesign (#186), so we are also down to **zero widget-targeted tour content** anywhere in the app right now. This proposal fills both gaps simultaneously: solo-user home widgets get a real tour, and the data-tour-target stamps it adds become the foundation the Mira-substrate Lab Head walkthrough (#187) can lean on.

---

## 2. Current state (after researcher map)

Walkthrough order today:

```
Phase 1 (modal): welcome → setup-q1..q7
Phase 2 (universal):
  §6.1 Home/Projects      home-create-project, home-create-project-fill
  §6.2 Project Overview   project-overview-nav, prose, context, exit
  §6.3 Notifications      notifications-bell, silence, delete
  §6.4..§6.12             methods, workbench, gantt, settings, wiki, etc.
Phase 2b (conditional):   telegram, purchases, calendar, links
Phase 2c (cleanup): lab-cleanup
Terminal: tour-goodbye
```

`§6.2 project-overview-exit` ends with BeakerBot saying "Nice. Now let me head back to the home page to show you notifications" and the cursor gliding to the Home nav tab. The user lands on Home with no widget explanation, then §6.3 immediately fires a test notification.

Target inventory on Home today: `home-new-project`, `home-project-create-form`, `home-project-name-input`, `home-project-weekend-toggle`, `home-project-create-submit`, `home-project-card-<id>`. **Nothing on the widget canvas.**

---

## 3. Proposed insertion: §6.2b Home widgets

Slot between `project-overview-exit` and `notifications-bell`. The "back to Home" transition already exists; we extend that beat by ~5 steps before handing off to notifications. Narrative flow:

> §6.2 ends: "Let me head back to home to show you something." → user lands on Home → §6.2b explains widgets → §6.3 fires "Quick universal: notifications. I just fired a test one, see the bell badge?"

Why this slot (vs. before §6.2):
- By this point the user has a real project in the system. Project-aware widgets (Today's events, Upcoming tasks, Recent activity) will have content to show, making the canvas feel alive rather than empty.
- It doesn't interrupt project creation; the user finishes that arc cleanly first.
- The §6.2-exit copy can be lightly rewritten to telegraph the widgets beat ("back to home so I can show you how the canvas works") rather than promising notifications directly.

---

## 4. Step-by-step spec (matching §6.2 depth)

### Step 1: `home-widgets-canvas-intro`
- **Cursor + spotlight**: cursor glides from the Home nav tab into the canvas area; spotlight ON entire canvas container.
- **Target**: `home-widget-canvas`
- **Copy** (target voice match: pedagogical paragraph, "north-star" cousin):
  > "This is your Home canvas. Everything you actually use day to day lives here as a widget: today's calendar events, what's due, recent activity, your projects, your purchases. Each lab member arranges their own canvas, so the version you're looking at is yours to shape."
- **Advance**: manual "Got it, next."

### Step 2: `home-widgets-tile-anatomy`
- **Cursor + spotlight**: cursor hovers a single widget tile; spotlight on one widget (e.g. Today's events or Upcoming tasks, whichever has content from the just-created project).
- **Target**: `home-widget-tile-<chosen-id>` (the demo picks the first widget with content)
- **Copy**:
  > "Each tile shows you a snapshot. The numbers and the top few rows are enough at a glance. Click the tile to expand it into a full popup, and you'll see the same content with filters, search, and the actions you'd expect on the dedicated page."
- **Demo**: cursor clicks the tile, popup opens, BeakerBot waits a beat, then the popup closes.
- **Advance**: manual.

### Step 3: `home-widgets-add`
- **Cursor + spotlight**: cursor glides to the "+ Add widget" affordance; spotlight ON.
- **Target**: `home-widget-add-button`
- **Copy**:
  > "Add as many or as few widgets as you want. Some labs run lean with just two or three tiles, others pack in everything. I'll open the catalog so you can see what's there."
- **Demo**: cursor clicks Add, catalog opens, BeakerBot scrolls/highlights a few entries, cursor selects one widget, the new tile appears on the canvas with a brief settle animation.
- **Targets needed**: `home-widget-catalog`, `home-widget-catalog-item-<type>`
- **Advance**: manual after the demo lands.

### Step 4: `home-widgets-reorder`
- **Cursor + spotlight**: cursor hovers a drag handle; spotlight on two tiles (the source + destination).
- **Target**: `home-widget-drag-handle` (on a chosen tile)
- **Copy**:
  > "Drag any tile by its handle to reorder. Put the widgets you check every morning at the top, and the slower-moving ones below. The layout is per-user, so your view doesn't change anyone else's."
- **Demo**: cursor grabs the handle, drags the tile up or down, releases, layout settles.
- **Advance**: manual.

### Step 5: `home-widgets-exit`
- **Cursor + spotlight**: cursor pulls back from the canvas; soft spotlight off.
- **Target**: none (transition beat)
- **Copy**:
  > "That's the canvas. You can come back any time, swap widgets in and out, and rearrange the order. Up next, notifications."
- **Demo**: cursor glides to the bell-badge area on the top nav (telegraphs §6.3 without firing it).
- **Advance**: manual "Got it, next" → fires §6.3 `notifications-bell`.

Total: **5 new steps**, matching §6.2's depth (4 steps + the dense prose-paragraph cadence). Section runtime estimate ~75 seconds at the established 300-500ms cursor glides + multi-sentence reads.

---

## 5. Product surface work this requires

Before any step can wire to the canvas, the home-page widget components need `data-tour-target` stamps. Inventory of what to add (researcher confirmed none exist today):

| Target id | Element | Where to stamp |
|---|---|---|
| `home-widget-canvas` | The grid container that holds all widget tiles | The canvas wrapper component |
| `home-widget-tile-<id>` | Each rendered widget instance | Prefix match in `targets.ts` |
| `home-widget-add-button` | The "+ Add widget" affordance | Wherever the add-trigger lives |
| `home-widget-catalog` | The catalog popup root | Popup component |
| `home-widget-catalog-item-<type>` | Each catalog entry | Prefix match in `targets.ts` |
| `home-widget-drag-handle` | The drag affordance on each tile | Per-widget header (or wherever drag is wired) |
| `home-widget-expand-button` | Tile click-to-expand affordance | If a dedicated button exists; otherwise the tile root absorbs the click |

`targets.ts` already supports `[data-tour-target^='prefix-']` (used today by `home-project-card-`), so the dynamic ids fit the established pattern.

---

## 6. Demo data + side-effect handling

The demo adds a widget and reorders the layout. The tour engine needs to leave the user's canvas in the state they would naturally have if they had done these actions themselves, OR cleanly revert. Two options:

**(A) Keep what BeakerBot did**: the added widget stays, the reorder stays. Pro: matches the "the user finishes v4 having done their first project on the real product" thesis (L1). Con: the demo's choices (which widget, which slot) might not match the user's preferences.

**(B) Revert on exit**: undo the add + reorder when §6.2b-exit fires. Pro: leaves the canvas in the user's pristine pre-tour state. Con: feels artificial; the user just watched something change and now it's gone.

**Recommendation: (A) with a soft signal**. The added widget stays; the reorder stays. Step 5 copy already says "You can come back any time, swap widgets in and out, and rearrange the order" — that's the permission slip to remove what BeakerBot added if they don't want it. This matches how §6.1 leaves the demo project in place.

---

## 7. Voice notes (for the implementer)

Three quoted §6.2 copy strings the researcher pulled as the voice anchor:

1. "This is your project's overview page. Treat it as your north star. When you're three weeks deep in tasks and methods, come back here to remember what you're actually trying to answer."
2. "Tags, dates, and status fields live alongside the overview so you can see your project's shape at a glance. As you fill them in, this strip becomes the quick-glance summary you'll come back to."
3. "Quick universal: notifications. I just fired a test one, see the bell badge?"

Pattern: pedagogical paragraph + casual conjunctions + second-person ("you", "your") + concrete metaphors. No interrogatives. Multi-sentence reads, not staccato. No em-dashes. No emojis.

The draft copy in §4 follows that pattern. Final copy can be polished in the implementation chip.

---

## 8. Build plan (when Grant greenlights)

Two chips, sequential (the second depends on the first's targets being live):

**Chip A: Product surface targets.** Stamp the 7 `data-tour-target` ids onto the home widget canvas + tile + add button + catalog + drag handle + expand affordance. Update `targets.ts` constants. Ensure prefix match works for `home-widget-tile-` and `home-widget-catalog-item-`. Light unit tests verifying the constants exist + match.

**Chip B: §6.2b step bodies + sequence wiring.** Add 5 new step bodies under `frontend/src/components/onboarding/v4/steps/walkthrough/HomeWidgetsBeats.tsx` (or split per-step in a `home-widgets/` subdir if that matches §6.2 convention). Register them in `step-registry.ts`. Insert them into `TOUR_STEP_ORDER` between `project-overview-exit` and `notifications-bell`. Lightly rewrite `project-overview-exit` copy to telegraph the widgets beat instead of promising notifications directly. Add step-machine tests covering the new sequence + the gated-skip behavior (the section should NOT gate out for any setup-q answer; widgets are universal).

Verifier dispatch after Chip B: standard 3-verifier loop per `feedback_post_redesign_verification_loop.md` (mechanics + spec-compliance + fresh-eyes friction).

---

## 9. Open questions for Grant

1. **Insertion confirmed (§6.2b, after Project Overview)?** Or prefer §6.1b (before Project Overview, all-Home content together)?
2. **Step count: 5 (proposed) or trim/extend?**
3. **Demo persistence: (A) keep what BeakerBot did, or (B) revert?** Recommendation: (A).
4. **Pre-seed the canvas with 1-2 default widgets before the tour starts, or start blank?** Recommendation: pre-seed 2 (one project-aware, one calendar-aware) so the canvas isn't empty when §6.2b-canvas-intro fires.

---

**End of proposal.** Awaiting Grant greenlight on questions 1-4, then dispatch Chip A.
