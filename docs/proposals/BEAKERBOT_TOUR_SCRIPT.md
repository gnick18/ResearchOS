# BeakerBot Tour Script (v4 Universal Walkthrough)

This file is a single-pass, editable transcript of every speech beat BeakerBot delivers in the v4 onboarding tour, listed in `TOUR_STEP_ORDER` from `frontend/src/components/onboarding/v4/step-machine.ts`. It exists so Grant can rewrite copy across the whole arc in one editor session rather than ping-ponging screenshots per step.

How to read this file:

- Phase headers (`## §X.Y ...`) mirror the structure of `ONBOARDING_V4_PROPOSAL.md` §6.
- Each step gets an H3 header with the step id. The italic line under the H3 is a quick context blurb (route, what the user just did, what BeakerBot is doing).
- The bullet line under that calls out: voice classification (NARRATION / BEAKERBOT_DEMO / USER_ACTION), the spotlight target key (if any), and the completion type.
- The fenced code block under each step IS THE SPEECH. That is the part Grant edits.

When you are done editing, save and hand the file back. The orchestrator manager will diff your speech blocks against the source step files and produce a single inverse-apply patch.

---

## §0 Setup (modal-contained Q&A)

These steps live inside the modal-setup shell (`SETUP_STEP_DESCRIPTORS` in `frontend/src/components/onboarding/v4/steps/setup/index.ts`). Each step renders an interactive picker/form; the `speech:` field on the descriptor is the BeakerBot bubble line that appears beside the modal header. The Q-step bodies (Q1AccountTypeStep through Q7LinksStep) are picker UI rather than additional BeakerBot dialogue, so only the descriptor speech is editable here.

### welcome

_Modal entry. BeakerBot is `waving`. Two-sentence elevator pitch in the modal body, plus the descriptor-level greeting._

- voice: NARRATION
- spotlight target: (modal, no in-product target)
- completion: manual (Next button in modal shell)

Descriptor speech:

```
Welcome! Two-sentence pitch coming right up, then we'll get you set up.
```

Body copy (modal-contained intro paragraph):

```
ResearchOS keeps your experiments, lab notes, methods, and calendar in one local-first place. I'm BeakerBot, and I'm gonna help you get set up in about ten minutes. Ready?

Hit **Let's go** when you're ready, or use **Skip walkthrough** to wrap up. Anything we made together that doesn't belong on your real account auto-cleans up; only your first project stays.
```

### setup-q1

_Modal Q1. Solo vs lab picker. BeakerBot is `thinking`._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker advances on selection)

```
Quick first call: are you flying solo, or is this for a whole lab?
```

### setup-q1c

_Lab-head follow-up (only fires when Q1 = lab). Asks if the user is the PI._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
One follow-up before we move on: are you the PI, or a lab member?
```

### setup-q2

_Purchases tracking opt-in._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
Some folks track every reagent. Some folks would rather forget. Your call.
```

### setup-q3

_Calendar (ICS feeds) opt-in._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
ResearchOS can overlay any public iCal (ICS) feed on your calendar. Want that on?
```

### setup-q4

_Goals tracking opt-in._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
Goal bars next to your Gantt so you can see plan-vs-reality. Want it on?
```

### setup-q5

_Telegram image inbox opt-in._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
Snap a gel photo on your phone, send it to the bot, the image lands in your inbox. Want it?
```

### setup-q6

_AI Helper prompt-size pick (full / medium / minimal / no / maybe)._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
I can copy you a prompt that turns Claude, ChatGPT, or Gemini into a schema-aware assistant. Pick a size.
```

### setup-q7

_Links tab opt-in._

- voice: NARRATION (modal Q&A)
- spotlight target: (modal)
- completion: manual (picker)

```
Want a page for VPN, calendar, freezer inventory, manuscript drafts? Toggle it on or off.
```

### setup-wrapup

_Confirmation beat. BeakerBot is `cheering`. Modal echoes back the user's Q1-Q7 picks and offers two CTAs (Tour vs Home). Body copy is dynamic per-user picks (account type, integrations, visible tabs). [DYNAMIC SPEECH] for the summary list._

- voice: NARRATION
- spotlight target: (modal)
- completion: manual (body CTAs handle advance)

Descriptor speech:

```
Quick recap of what you picked, then we'll get you to the home page (or into the feature tour if you want it).
```

Body header copy:

```
You're all set. Here's what you picked, and what we'll have ready for you on the home page. You can change any of this later in Settings.
```

Body CTAs:

```
Give me a tour of my features

Skip for now, take me to home

Back
```

Footer caption:

```
The tour is tailored to the features you just turned on, with BeakerBot as your guide. You can re-run it any time from Settings.
```

---

## §6.1 Home + first project

### home-create-project

_Route: `/`. The setup wrap-up just landed the user on Home. BeakerBot points at the `+ New Project` button._

- voice: USER_ACTION
- spotlight target: `homeNewProject`
- completion: event (`tour:home-create-modal-opened`)

```
Let's make your first project. Click the blue plus button up there to get started.
```

### home-create-project-fill

_Route: `/`. The create-project modal just mounted. BeakerBot narrates the three inputs (name, color, seven-day toggle)._

- voice: USER_ACTION
- spotlight target: `homeProjectCreateForm`
- completion: event (`tour:project-created`)

```
Give your project a name and pick a color. Don't worry, these choices can always be changed later on.

Tags are optional and let you group projects later.

The seven-day work week toggle controls whether weekends count for scheduling. Most labs leave it off so the Gantt skips Sat and Sun. Turn it on if your work spans weekends. Click Create Project when you're ready.
```

---

## §6.2 Project navigation

### project-overview-nav

_Route: `/` (about to push into `/workbench/projects/<id>`). BeakerBot's cursor glides to the new project card and clicks it._

- voice: BEAKERBOT_DEMO
- spotlight target: (none, cursor click on card)
- completion: manual ("Got it, next")

```
I'm taking us into your project.
```

### project-overview-prose

_Route: `/workbench/projects/<id>`. BeakerBot's cursor types a placeholder hypothesis into the Overview textarea._

- voice: BEAKERBOT_DEMO
- spotlight target: `projectOverviewTextarea`
- completion: manual ("Got it, next")

```
This is your project's overview page. Treat it as your north star. When you're three weeks deep in tasks and methods, come back here to remember what you're actually trying to answer. I'll type a placeholder hypothesis to show what fits here. Your real goal goes here when you're ready.
```

### project-overview-context

_Route: `/workbench/projects/<id>`. Narration over the sticky project topbar (name, tags, action icons, status)._

- voice: NARRATION
- spotlight target: `projectOverviewTopbar`
- completion: manual ("Got it, next")

```
This is your project's topbar. As you tag this project and set dates or status, they'll appear here as a quick-glance summary so you can see the shape of the work without scrolling.
```

### project-overview-exit

_Transition beat. Cursor glides to the Home nav tab, controller pushes browser back to `/`. [DYNAMIC SPEECH] gates on `window.location.pathname`._

- voice: BEAKERBOT_DEMO (transition)
- spotlight target: `homeNavTab`
- completion: manual ("Got it, next")

```
[DYNAMIC] Off-home variant:
Nice. Let me take us back home so I can show you how the canvas works.

[DYNAMIC] Already-home variant:
Nice. Let me show you how the canvas works.
```

---

## §6.2b Home widgets

### home-widgets-canvas-intro

_Route: `/`. Narration + spotlight on the whole widget canvas. Pre-seeded with Upcoming tasks + Today's events tiles._

- voice: NARRATION
- spotlight target: `homeWidgetCanvas`
- completion: manual ("Got it, next")

```
This is your Home canvas. Right now you've got two starter widgets: Upcoming tasks and Today's events. The canvas can host plenty more, and you can add or remove them as you go. If you share this folder with lab members later, each person tailors their own view, so what you see here is yours to shape.
```

### home-widgets-tile-anatomy

_Route: `/`. Cursor clicks the Today's-events tile, popup opens, user reads, cursor closes popup._

- voice: BEAKERBOT_DEMO
- spotlight target: `home-widget-tile-calendar-events-today`
- completion: manual ("Got it, next")

```
Each tile shows you a snapshot. The numbers and the top few rows give you the gist at a glance. Click the tile to expand it into a full popup, where you get filters, search, and the same actions you'd find on the dedicated page.
```

### home-widgets-add

_Route: `/`. Cursor clicks +Add widget, catalog opens, cursor picks `lab-activity-by-type`, tile lands on canvas, catalog closes._

- voice: BEAKERBOT_DEMO
- spotlight target: `homeWidgetAddButton`
- completion: manual ("Got it, next", gated until demo-done event)

```
Add as many or as few widgets as you want. Some labs run lean with a couple tiles, others pack in everything they track. I'll open the catalog and add one so you can see how it lands on the canvas.
```

### home-widgets-reorder

_Route: `/`. Canvas is in edit mode (from the previous +Add click). Cursor drags tile 1 down to position 3._

- voice: BEAKERBOT_DEMO
- spotlight target: `home-widget-drag-handle`
- completion: manual ("Got it, next")

```
Drag any tile to reorder it. Put the widgets you check every morning at the top, and the slower-moving ones below. If you share this folder with lab members later, your layout stays yours and theirs stays theirs. I'll grab one and drop it lower so you can see how it settles.
```

### home-widgets-exit

_Route: `/`. onEnter exits canvas edit mode. Cursor glides up toward the bell to telegraph §6.3._

- voice: BEAKERBOT_DEMO (transition)
- spotlight target: `notificationsBell`
- completion: manual ("Got it, next")

```
That's the canvas. You can come back any time, swap widgets in and out, and rearrange the order. Up next, notifications.
```

---

## §6.3 Notifications

### notifications-bell

_Route: `/`. onEnter fires a test notification. User clicks the bell themselves._

- voice: USER_ACTION
- spotlight target: `notificationsBell`
- completion: event (`tour:notifications-popup-opened`)

```
Quick universal: notifications. I just fired a test one, see the bell badge? Click the bell to open your inbox.
```

### notifications-silence

_Route: `/`. Notification popup is open. User clicks the row's Mark-read OR the header Mark-all-read._

- voice: USER_ACTION
- spotlight target: `notificationSilence`
- completion: event (`tour:notification-silenced`)

```
Nice. To silence the bell badge, click either the row or the Mark read button. This will make the bell stop bugging you.
```

### notifications-delete

_Route: `/`. User clicks the X on the test notification row._

- voice: USER_ACTION
- spotlight target: `notificationDelete`
- completion: event (`tour:notification-deleted`)

```
And to clear it from your inbox entirely, click the X. Try it on this one.
```

---

## §6.4 Methods phase

### methods-category-prompt

_Route: `/methods`. BeakerBot is `thinking`. Speech-bubble carries an interactive picker (Genetics / Microscopy / Cell biology / ... / Other). [DYNAMIC SPEECH]: pick lands as a localStorage key the demo step reads back._

- voice: NARRATION (interactive picker inside the bubble)
- spotlight target: (none; bubble owns the UI)
- completion: manual (each picker button calls noteManualAdvance)

```
Methods are the lab techniques and protocols you use to run experiments. Let's add a method category for the kinds of techniques you actually run. What's a common type of technique you do in the lab?
```

Picker options:

```
[the canonical option list lives in METHODS_CATEGORY_PICKER_OPTIONS, plus "Other (type your own)"]
```

### methods-category-open

_Route: `/methods`. User-action: click `+ New Category`. Page-locked with allow-list._

- voice: USER_ACTION
- spotlight target: `methodsNewCategoryButton`
- completion: event (`tour:methods-category-modal-opened`)

```
First, click **+ New Category** up here to open the form. I'll take it from there.
```

Wrong-click flash speech (shows when user clicks anywhere else under the page-lock):

```
Oops, that's not the right thing.

Click **+ New Category** up at the top of the Methods page so we can set up your first category.
```

### methods-category

_Route: `/methods`. Modal is open. Cursor types the user's picked category label and clicks Create Empty. [DYNAMIC SPEECH] interpolates the picked label._

- voice: BEAKERBOT_DEMO
- spotlight target: `methodsCategoryNameInput`
- completion: manual ("Got it, next")

```
[DYNAMIC] Example with pick = "Genetics":
Great, let's set up Genetics as your first category. Watch.
```

### methods-open-picker

_Route: `/methods`. Cursor clicks +New Method to mount the type picker. Page-locked while picker opens._

- voice: BEAKERBOT_DEMO
- spotlight target: `methodsNewMethodButton`
- completion: manual ("Got it, next")

```
Now let me show you the kinds of methods you can build. I'm clicking New Method to open the picker.
```

### methods-type-tour

_Route: `/methods`. Picker is mounted. Cursor clicks the PCR tile so the builder mounts. User pokes around at their own pace._

- voice: BEAKERBOT_DEMO + USER_ACTION (explore-at-your-pace)
- spotlight target: `methodsTypePcrTile`
- completion: manual ("Got it, next")

```
Most method types are interactive builders, not text forms. PCR is a thermal cycle builder; LC Gradient draws a live chart; Compound bundles multiple methods together so a common combo attaches in one shot.

I'll open the PCR builder now. Click around to get a feel for it, then hit Got it, next when you're ready to see the LC Gradient one. The wiki has the full reference whenever you want details.
```

### methods-lc-demo

_Route: `/methods`. Cursor clicks the LC Gradient tile. User pokes around the live chart at their own pace._

- voice: BEAKERBOT_DEMO + USER_ACTION
- spotlight target: `methodsTypeLcGradientTile`
- completion: manual ("Got it, next")

```
And here's the LC Gradient editor. Play around, the chart updates live as you change steps in the table. Click Got it, next when you're ready to keep going.
```

### methods-create

_Route: `/methods`. Cursor picks Standard Markdown, types a comedic protocol name, and types the method body._

- voice: BEAKERBOT_DEMO
- spotlight target: `methodsCreateForm`
- completion: manual ("Got it, next")

```
Time to make a method. I'm picking Standard Markdown and typing in something obviously-not-real lab work, so you can see how the editor flows.
```

The typed name + body live in `FUNNY_METHOD_NAME` / `FUNNY_METHOD_BODY` (the comedic Coffee Brewing Protocol). The speech itself does not change with those constants, but it references "obviously-not-real lab work" so any rewrite of the protocol content should preserve that vibe.

---

## §6.5 Workbench experiment creation

### workbench-create-experiment-open

_Route: `/workbench`. User-action: click `+ New Experiment` to open the form._

- voice: USER_ACTION
- spotlight target: `workbenchNewExperiment`
- completion: event (`tour:workbench-experiment-modal-opened`)

```
Click + New Experiment up here to open the form. I'll take it from there.
```

### workbench-create-experiment

_Route: `/workbench`. Modal is open. Cursor types "Demo Experiment One" and clicks Create Experiment._

- voice: BEAKERBOT_DEMO
- spotlight target: `workbenchExperimentNameInput`
- completion: manual ("Got it, next")

```
Now let me name the experiment. Watch.
```

---

## §6.6 Experiment detail + method attachment

### experiment-attach-method-open

_Route: `/workbench`. Cursor clicks the just-created experiment row to open the experiment popup._

- voice: BEAKERBOT_DEMO
- spotlight target: (none, cursor click on row)
- completion: manual ("Got it, next")

```
Now let me open the experiment we just made.
```

### experiment-attach-method-tab

_Route: `/workbench`. Experiment popup is mounted. Cursor clicks the Methods tab._

- voice: BEAKERBOT_DEMO
- spotlight target: `experimentMethodsTab`
- completion: manual ("Got it, next")

```
Methods tab. The handle on the experiment that links what method you ran.
```

### experiment-attach-method-attach

_Route: `/workbench`. Methods tab is active. Cursor clicks Attach Method, picker mounts, cursor picks the funny markdown method (most-recent)._

- voice: BEAKERBOT_DEMO
- spotlight target: `experimentAttachMethod`
- completion: manual ("Got it, next")

```
I'll pin our funny markdown method to this experiment so it's tracked.
```

### experiment-attach-method-notes

_Route: `/workbench`. Method is attached. Cursor types a variation note into the experiment's variation-notes field._

- voice: BEAKERBOT_DEMO
- spotlight target: `experimentVariationNotes`
- completion: manual ("Got it, next")

```
And a quick note on what makes this run different.

**Important:** when you edit a method from inside an experiment, you're editing this experiment's COPY. The original method stays untouched. So you can tweak per-experiment without worrying about overriding the master.
```

The cursor-typed variation note itself is `"This experiment uses 30 C instead of 25 C."` (in code as `VARIATION_NOTE`).

---

## §6.7 Hybrid editor

### hybrid-notes-vs-results

_Route: `/workbench` (experiment popup still open). Narration introducing Notes vs Results stores._

- voice: NARRATION
- spotlight target: experiment Notes tab (tightened spotlight)
- completion: manual ("Got it, next")

```
Before we touch the editor: this experiment has two places to write.

**Notes** is your working scratch. Half-formed thoughts, daily logs, what you tried, what failed.

**Results** is the published output. Final figures, conclusions you'd defend in a meeting.

Same editor, two separate stores. Notes content never leaks into Results. Workflow most people use: write daily in Notes, then copy the keepers into Results when the experiment is done.
```

### hybrid-markdown-intro

_Route: `/workbench`. Narration explaining that the editor speaks markdown._

- voice: NARRATION
- spotlight target: (editor)
- completion: manual ("Got it, next")

```
Now, the editor itself.

One thing to know: every text editor on this site uses **markdown**, a lightweight formatting standard.

Markdown formats text using simple symbols, like `**bold**` and `# header`. It's an open standard, the same one Slack, Discord, Notion, and GitHub use.
```

### hybrid-markdown-familiarity

_Route: `/workbench`. In-tour branch gate. User picks "Sure, show me an overview" (routes to HE-3) or "I'm good, skip ahead" (routes to HE-4)._

- voice: USER_ACTION (branch picker)
- spotlight target: (none, bubble carries branch buttons)
- completion: branch (lands on hybrid-markdown-overview or hybrid-editor-mechanic)

```
Quick check, have you used markdown before?

If yes, we'll skip the overview. If not, want a 30-second crash course?
```

### hybrid-markdown-overview

_Route: `/workbench`. Only fires on the "yes overview" branch. Crash-course paragraph + spotlight on the shortcut bar._

- voice: NARRATION
- spotlight target: `hybridEditorShortcutBar`
- completion: manual ("Got it, next")

```
Here's the deal: markdown looks like plain text with little symbols around it. Editors that understand markdown turn those symbols into formatting.

The basics: `**bold**`, `*italic*`, `_underline_`, and `# Heading` (more hashes = smaller). Lists work too, a hyphen at the start of a line makes a bullet. You'll see all of these in action in a moment.

You don't have to memorize anything. Every editor here has a shortcut bar on the left. Or you can type the symbols directly, they work too.
```

### hybrid-editor-mechanic

_Route: `/workbench`. Narration on the edit-vs-render mechanic of the hybrid editor._

- voice: NARRATION
- spotlight target: `hybridEditorTextarea`
- completion: manual ("Got it, next")

```
Two things to know about this editor.

**While you're editing a paragraph**, you'll see the raw markdown, the symbols and all.

**The moment you click out** of a paragraph, it renders. Bold becomes bold, headers become headers.

Each paragraph is its own block, separated by a blank line, edited independently. That's why you always know what's saved. No hidden formatting.
```

### hybrid-bold

_Route: `/workbench`. Cursor types a bold-wrapped sentence into the editor._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Watch me write a bold sentence. I'll wrap the words in two stars on each side.

_(small print)_ See how the stars disappear when I click out? That's the render landing.
```

Typed content:

```
**The pipettes are calibrated this morning.**
```

### hybrid-italic

_Route: `/workbench`. Cursor types an italic sentence._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Now an italic sentence, single stars.

_(small print)_ Same pattern as bold, the stars disappear when the render lands.
```

Typed content:

```
*Reagent A is the one expiring Friday.*
```

### hybrid-underline

_Route: `/workbench`. Cursor types an underlined sentence._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Underline uses single underscores.

_(small print)_ The underscores disappear on render, just like the stars did.
```

Typed content:

```
_Re-order before then._
```

### hybrid-h1

_Route: `/workbench`. Cursor types an H1._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Headers use one hash for H1, two for H2, three for H3. Bigger to smaller. Watch the H1 first.
```

Typed content:

```
# This experiment
```

### hybrid-h2

_Route: `/workbench`. Cursor types an H2._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Two hashes for H2, slightly smaller.
```

Typed content:

```
## Hypothesis
```

### hybrid-h3

_Route: `/workbench`. Cursor types an H3._

- voice: BEAKERBOT_DEMO
- spotlight target: (editor)
- completion: manual

Speech bubble:

```
Three hashes for H3, the smallest header step.
```

Typed content:

```
### Notes
```

### hybrid-shortcuts

_Route: `/workbench`. User-action with allow-listed page-lock. User tries Cmd+B/I/U or skips._

- voice: USER_ACTION
- spotlight target: `hybridEditorTextarea`
- completion: manual ("Got it, next")

```
Your turn. Most Word shortcuts work here.

Try `Cmd+B` (Ctrl+B on Windows) to type some bold text. `Cmd+I` gives italic, `Cmd+U` gives underline. Try one, or skip if shortcuts aren't your thing, both fine.
```

### hybrid-image-attach

_Route: `/workbench`. Cursor enters from off-screen-right holding an image. The image lands in the editor's image strip._

- voice: BEAKERBOT_DEMO
- spotlight target: `hybridEditorImageStrip`
- completion: manual

```
Time for images. I'll attach my own image to your experiment so you can see how it works.

Watch, I'm bringing a file in from off-screen.
```

### hybrid-image-drag-in

_Route: `/workbench`. Cursor drags the attached image from the strip into the inline editor._

- voice: BEAKERBOT_DEMO
- spotlight target: `hybridEditorTextarea`
- completion: manual

```
An attached image can also be dropped inline into the notes, so it renders right where you want it in the writeup.

Same image, two places it can show: in the attachments panel, and inline.
```

### hybrid-image-resize

_Route: `/workbench`. Cursor clicks the inline image, popover opens, cursor picks 50%._

- voice: BEAKERBOT_DEMO
- spotlight target: `hybridEditorEmbeddedImage`
- completion: manual

```
Click an image to resize it. Pick 25%, 50%, 75%, or 100% from the menu that pops up.
```

### hybrid-file-attach

_Route: `/workbench`. Terminal hybrid beat. Cursor glides over the editor body; a non-image file lands as a download chip._

- voice: BEAKERBOT_DEMO
- spotlight target: `hybridEditorTextarea`
- completion: manual

```
Files (CSVs, PDFs, protocol docs) attach the same way as images. The editor renders images inline, but everything else becomes a download chip, so the next person can grab the file without losing the writeup around it.

ResearchOS can open **PDFs and text files** directly. Other formats just download to your computer.
```

---

## §6.7b Workbench Notes and Lists

### workbench-notes-intro

_Route: `/workbench`. Cursor clicks the Notes tab. Narration about standalone notes (single vs running log)._

- voice: BEAKERBOT_DEMO + NARRATION
- spotlight target: `workbenchNotesTab`
- completion: manual ("Got it, next")

```
Those notes lived inside one experiment. There's also a place for notes that DON'T belong to any one experiment.

The Workbench has three tabs across the top. We just spent time on the Experiments tab. This middle one is **Notes**, for general scratch that isn't tied to one experiment.

Two flavors. Single notes are one-off, like a quick takeaway from a conference talk. Running logs grow over time, one entry per session. A weekly Lab Head 1-on-1 is a perfect fit: one note titled "Student / Lab Head 1-on-1, Fall 2026", a new entry each week. One file to find later, not fifteen.
```

### workbench-notes-create

_Route: `/workbench`. Cursor glides to +New Note, fake-clicks it, then spawns a lab-recipe-style demo note (ASBMB conference takeaways)._

- voice: BEAKERBOT_DEMO
- spotlight target: `workbenchNewNoteButton`
- completion: manual ("Got it, next")

```
Single note example, conference takeaways. Same editor you just used, with headings, bold, and bullets ready to go.
```

The spawned note title + body live in `NOTE_TITLE` ("Notes from ASBMB 2026, Smith lab heat-shock talk") and `NOTE_BODY_LAB_RECIPE`. The body is markdown with `# Key claim`, `## Takeaways`, `## Follow-ups` and is shown in the panel below; edit there if you want a different demo note.

### workbench-lists-intro

_Route: `/workbench`. Cursor clicks the Lists tab._

- voice: BEAKERBOT_DEMO + NARRATION
- spotlight target: `workbenchListsTab`
- completion: manual ("Got it, next")

```
Last tab on the Workbench: **Lists**.

A list is a checklist task. No method, no results section, just items to tick off. The lighter cousin of an experiment.

Think: grocery runs, reagent restocks, daily to-dos.
```

### workbench-list-create-shell

_Route: `/workbench`. Cursor ensures Lists tab is active, clicks +New List Task, spawns a coffee-restock list shell, expands the card, types three items into the inline Add-item input._

- voice: BEAKERBOT_DEMO
- spotlight target: `workbenchNewListButton`
- completion: manual ("Got it, next")

```
Sticking with our coffee theme. I'll make a grocery list for the lab's coffee restock, then drop the items in.

Same shape as an experiment: a name, a date. Items live inside, check them off as you grab each one.
```

The list name + items live in code as `LIST_NAME` ("Coffee restock, grocery run") and `LIST_ITEM_BEANS` / `LIST_ITEM_FILTERS` / `LIST_ITEM_GRINDER`.

### workbench-list-mark-done

_Route: `/workbench`. Cursor checks one sub-task, then clicks the parent task's mark-complete button._

- voice: BEAKERBOT_DEMO
- spotlight target: `workbenchListItemCheckbox`
- completion: manual ("Got it, next")

```
Two moves worth knowing. You can check off individual items as you do them, useful mid-run.

And when every item is wrapped, mark the LIST itself complete. That drops it out of your active Overdue/Doing/Upcoming buckets so it stops competing for your attention with real work.
```

---

## §6.8 Gantt

### gantt-intro

_Route: `/gantt`. Pure narration introducing the timeline view._

- voice: NARRATION
- spotlight target: `ganttTimeline`
- completion: manual ("Got it, next")

```
This is a Gantt chart. If you've never used one before: it's a timeline view of everything you're working on, laid out by date.

On this page you'll see your experiments, tasks, and purchase orders side-by-side in time. It's where you check whether you're overbooked, work backward from a deadline, or just see what's happening this week.
```

### gantt-existing-experiment

_Route: `/gantt`. Cursor clicks the user's experiment bar to open the popup. Auto-dismisses popup ~2.8s later._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttBarUserExperiment`
- completion: manual ("Got it, next")

```
Here's the experiment you made earlier on the Workbench. It shows up here automatically because it's on the timeline now.

I'll click it to open the experiment popup. You can add notes from here too, not just from the Workbench.
```

### gantt-drag-drop

_Route: `/gantt`. Cursor drags the user's experiment bar to a different date._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttBarUserExperiment`
- completion: manual ("Got it, next")

```
Watch me drag this bar to reschedule it. You can drop a bar anywhere on the timeline to change its date.
```

### gantt-deps-beakerbot

_Route: `/gantt`. onEnter spawns Fake A + Fake B and wires A -> user_experiment. Cursor drags Fake A onto user experiment as the visual narration._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttBarFakeA`
- completion: manual ("Got it, next")

```
Dependencies mean one task can't start until another one finishes. I'm linking "Fake A" so it has to finish before your experiment can start.

The arrow you'll see goes A -> your experiment.
```

### gantt-deps-user

_Route: `/gantt`. USER drags Fake B onto user experiment and picks "start after" from the dep-type picker. Page-locked. [DYNAMIC SPEECH] - stages shift the allow-list from bar -> picker._

- voice: USER_ACTION
- spotlight target: `ganttBarFakeB`
- completion: event (poll for user_exp -> fakeB FS dep)

```
Now you wire the other side: drop Fake B onto your experiment, then pick "start after", so B starts after your experiment finishes.

_(small print)_ (I'll keep you on rails. Clicks outside the right affordance will be ignored.)
```

Wrong-click flash (page-locked):

```
Oops, that's not the right thing.

Drag Fake experiment B onto your experiment, then pick "start after", so B starts after your experiment finishes.
```

### gantt-deps-cascade

_Route: `/gantt`. Cursor drags Fake A onto a later-date marker; tasksApi.move fires programmatically and the whole chain shifts._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttBarFakeA`
- completion: manual ("Got it, next")

```
Watch the whole chain follow: your experiment AND Fake B both slide right because A is upstream of them.

Move any task later in a chain, everything downstream reschedules with it.
```

### gantt-share-intro

_Route: `/gantt`. Lab-only. Narration introducing the experiment-sharing feature._

- voice: NARRATION
- spotlight target: (none)
- completion: manual ("Got it, next")

```
On any experiment you make, you can share it with anyone else in your lab.

Both people get access to add notes and results. Both see the experiment on their Gantt and task lists.

Only the creator can delete it. The other person can have either edit permission (change dates, add notes) or read-only.
```

### gantt-share-beakerbot-spawn

_Route: `/gantt`. Lab-only. onEnter spawns the BeakerBot lab user + coffee experiment. BeakerBot is `cheering`._

- voice: BEAKERBOT_DEMO
- spotlight target: (none)
- completion: manual ("Got it, next")

```
For this demo I added a second account to your lab (me, BeakerBot), so I have someone to share with. I'll clean up at the end.

Watch the timeline. My "Make some coffee together" experiment will appear in a moment.
```

### gantt-share-beakerbot-shares

_Route: `/gantt`. Lab-only. onEnter shares the coffee experiment with the user. Cursor clicks the shared bar to open the popup._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttBarSharedExperiment`
- completion: manual ("Got it, next")

```
I just shared "Make some coffee together" with you. See it on the timeline?

I gave you edit permission, so you can change dates and add notes.
```

### gantt-share-user-explores

_Route: `/gantt`. Lab-only. User-action: poke around the popup (Notes / Results tabs). Page-locked to the popup chrome._

- voice: USER_ACTION
- spotlight target: (popup interior)
- completion: manual ("Got it, next")

```
This is YOUR view of BeakerBot's experiment. You have edit permission, so try adding a note or opening the results tab.

_(small print)_ It's the same popup as your own experiments. When you're ready, click "Got it, next" and I'll take over.
```

Wrong-click flash:

```
Oops, please poke around inside the popup. The rest of the page is locked for now.
```

### gantt-share-user-shares-back

_Route: `/gantt`. Lab-only. User-action: share Fake A back with BeakerBot at edit permission. [DYNAMIC SPEECH] - speech swaps through 3 stages (timeline -> popup -> share dialog) as the user progresses._

- voice: USER_ACTION
- spotlight target: `ganttBarFakeA`
- completion: event (poll for fakeA shared_with BeakerBot edit)

```
[DYNAMIC] Stage 1 (timeline):
Now share YOUR chain back with me. Click the first task in your chain on the timeline.

[DYNAMIC] Stage 2 (popup):
Click the share button on the popup.

[DYNAMIC] Stage 3 (share dialog):
Pick me (beakerbot) and give me edit permission.

_(footer, all stages)_ (I'll keep you on rails. Clicks outside the right affordance will be ignored.)
```

Wrong-click flashes (per stage):

```
[Stage 1] Click the first task in your chain on the timeline.
[Stage 2] Click the share button on the popup.
[Stage 3] Pick me (beakerbot) and give me edit permission.
```

### gantt-share-profile-switch

_Route: `/gantt`. Lab-only. Visible-but-faked profile switch. A full-screen modal pretends to switch the user to BeakerBot's account, BeakerBot writes a real note to Fake A, then the modal closes. [DYNAMIC SPEECH] - four beats (beats 1-4) advance on a timed sequence._

- voice: BEAKERBOT_DEMO
- spotlight target: (modal owns the screen)
- completion: manual ("Got it, next" gated on NOTE_WRITE_DONE_EVENT)

```
[DYNAMIC] Beat 1 (initial):
In your lab you can switch between accounts from the user picker up top. I'll jump to BeakerBot's account, add a note from over there, then come back so you can see it appear on your side.

[DYNAMIC] Beat 2 (T+1200ms, switched):
I'm on my account now. Adding a note to your chain.

[DYNAMIC] Beat 3 (T+2600ms, typing - small print):
(Typing the note from BeakerBot's side...)

[DYNAMIC] Beat 4 (T+5400ms, switched back):
Switched back. Open the experiment to see the note I just added.
```

Modal copy (overlay above the page):

```
You're on BeakerBot's account now
BeakerBot can see your shared chain because you gave edit permission.

[during typing phase]
BeakerBot is adding a note to your shared chain...

[switching back]
Switching back to your account...
Almost back.
```

The actual note BeakerBot writes to Fake A is the constant `BEAKERBOT_NOTE_TEXT`:

```
BeakerBot was here. Adding a note from my side.
```

### gantt-share-user-sees-edit

_Route: `/gantt`. Lab-only. User-action: open Fake A's popup, click Notes tab, verify BeakerBot's note is there._

- voice: USER_ACTION
- spotlight target: (Notes tab on popup, or Fake A bar)
- completion: manual ("Got it, next")

```
Open Fake A on the timeline, then click the notes tab. You should see BeakerBot's edit.

_(small print)_ Take a look around when you're ready, then click "Got it, next".
```

Wrong-click flash:

```
Oops, open the popup and check the notes tab. The rest of the page is locked for now.
```

### gantt-goals-overview

_Route: `/gantt`. Conditional on `picks.goals === "yes"`. Cursor clicks the goals affordance, overlay surfaces._

- voice: BEAKERBOT_DEMO
- spotlight target: `ganttGoalsButton`
- completion: manual ("Got it, next")

```
One more thing about this page before we move on: goals.

Goals visualize over the Gantt. You can keep them personal (just you) or share with the lab (everyone sees them).

Personal goals are private to your account; lab-wide goals appear for every lab member.
```

---

## §6.9 Animation picker (on Settings page)

### personalization-animations

_Route: `/settings`. Note: lives in §6.9 historically; the actual surface moved onto Settings (Gantt toolbar declutter 2026-05-23). BeakerBot is `bouncing`. Cursor clicks the "celebration" animation tile._

- voice: BEAKERBOT_DEMO
- spotlight target: `settingsAnimationPicker`
- completion: manual ("Got it, next")

```
Quick personal touch, pick an animation theme that fires when you complete experiments.
```

---

## §6.10 Settings

### personalization-color

_Route: `/settings`. User-paced. Spotlight on the tint-header toggle; user can flip it, tweak colors, or just hit Got-it-next._

- voice: USER_ACTION
- spotlight target: `settingsColorTintToggle`
- completion: manual ("Got it, next")

```
You already picked your color when you set up your account. This toggle decides whether the top bar takes that color too, or stays a clean white.

Flip it on and off to see the chrome shift. If you want to change your color or add a gradient, the swatches above are still live. Click Got it, next when you are happy.
```

### settings-tour-folder

_Route: `/settings`. Narration on the connected lab folder._

- voice: NARRATION
- spotlight target: `settingsFolderSection`
- completion: manual ("Got it, next")

```
Your lab folder is set up. To switch folders later, sign out and pick a new one from the entry screen.
```

### settings-tour-calendar

_Route: `/settings`. Conditional on `picks.calendar === "yes"`. Narration on calendar feeds (which actually live on the Calendar tab, not Settings)._

- voice: NARRATION
- spotlight target: (none yet)
- completion: manual ("Got it, next")

```
Calendar feeds aren't managed from Settings yet, go to the Calendar tab to paste an .ics URL.
```

### settings-tour-telegram

_Route: `/settings`. Conditional on `picks.telegram === "yes"`. Narration on the Telegram section._

- voice: NARRATION
- spotlight target: `settingsTelegramSection`
- completion: manual ("Got it, next")

```
Telegram lives here. If you didn't link it during setup, you can wire it up anytime by following the steps in this section.
```

### settings-tour-account-type-toggle

_Route: `/settings`. Conditional on `picks.account_type === "solo"`. Narration on where the solo->lab pivot lives (the user picker, not Settings)._

- voice: NARRATION
- spotlight target: (none yet)
- completion: manual ("Got it, next")

```
If you ever pivot from solo to a lab account, the switch lives in the user picker up top, Settings doesn't carry it yet.
```

### settings-tour-visible-tabs

_Route: `/settings`. Narration on the tab-visibility section._

- voice: NARRATION
- spotlight target: `settingsTabsSection`
- completion: manual ("Got it, next")

```
Anything you said 'no' to during setup hid the tab. To turn it back on later, just check the box here. Same goes for hiding tabs you decide you don't need.
```

### settings-tour-streak

_Route: `/settings`. Narration on the streak counter._

- voice: NARRATION
- spotlight target: `settingsStreakSection`
- completion: manual ("Got it, next")

```
Streak counter is on by default. It's private to you in the app, nobody else sees it. If you'd rather not be reminded, toggle it off here.
```

### settings-tour-rerun

_Route: `/settings`. Narration on the re-run tour button._

- voice: NARRATION
- spotlight target: `settingsRerunSection`
- completion: manual ("Got it, next")

```
Re-run the welcome tour any time from this button. Useful if you forget how something works.
```

### ai-helper-size-diff

_Route: `/settings`. Conditional on `picks.ai_helper` in {full, medium, minimal}. BeakerBot is `thinking`. Cursor cycles through Full -> Medium -> Minimal tabs with 800ms pauses between._

- voice: BEAKERBOT_DEMO
- spotlight target: `settingsAiHelperSection`
- completion: manual ("Got it, next")

```
This is the AI Helper. Three prompt sizes: Full, Medium, Minimal. Big context for big models like Claude, ChatGPT, or Gemini.

I'll cycle through so you can see the size difference.
```

### ai-helper-use-case-paste

_Route: `/settings`. Conditional on `picks.ai_helper` in {full, medium, minimal}. Cursor clicks the Copy button on the currently-selected size (minimal, from the previous step)._

- voice: BEAKERBOT_DEMO
- spotlight target: `settingsAiHelperCopy`
- completion: manual ("Got it, next")

```
First use case: paste a prompt into your favorite AI chat (Claude, ChatGPT, Gemini). Now you've got a ResearchOS-fluent assistant you can ask questions to. "What experiments use plasmid X?" "Summarize this week's notes." That kind of thing.
```

### ai-helper-use-case-agentic

_Route: `/settings`. Conditional on `picks.ai_helper` in {full, medium, minimal}. Pure narration closing the AI Helper arc._

- voice: NARRATION
- spotlight target: (none)
- completion: manual ("Got it, next")

```
Second use case is more interesting. Agentic models with read access to your data folder can WRITE your lab notebook with you. Give them a prompt + folder access; they help draft entries, build methods, fill in experiment notes. Like having a research collaborator that knows your codebase.
```

---

## §6.11 Search

### search-demo

_Route: `/search`. BeakerBot is `typing-on-laptop`. Cursor types the first two words of the placeholder experiment name to demo partial matching._

- voice: BEAKERBOT_DEMO
- spotlight target: `searchInput`
- completion: manual ("Got it, next")

```
Quick one. Search across everything: experiments, methods, tasks, results.

Your account's pretty empty so the demo's small, try this again after you've got real experiments.
```

---

## §6.12 Wiki pointer

### wiki-pointer-intro

_Route: (whatever the user was on). Speech-only intro. BeakerBot is `pointing-up`._

- voice: NARRATION
- spotlight target: (none)
- completion: manual ("Got it, next")

```
Quick aside before we move on. There's a wiki with detailed documentation of every page in the app. Search behavior, list semantics, Gantt dependencies, it's all spelled out there.
```

### wiki-pointer-icon-spotlight

_Spotlight on the `?` icon in the topbar. No cursor click yet._

- voice: NARRATION
- spotlight target: `wikiNavTab`
- completion: manual ("Got it, next")

```
If you're on any page and curious or confused, click the question-mark icon up in the top right.
```

### wiki-pointer-click-demo

_Cursor clicks the `?` icon. Real navigation to `/wiki/...` for whatever route the user was on._

- voice: BEAKERBOT_DEMO
- spotlight target: `wikiNavTab`
- completion: manual ("Got it, next")

```
Watch. Clicking the question mark takes you to the wiki page about whatever you were just looking at.
```

### wiki-pointer-back-demo

_Route: `/wiki/...`. Cursor clicks the "Back to app" button on the WikiTopBar, navigation back to the user's prior route._

- voice: BEAKERBOT_DEMO
- spotlight target: `wikiBackToApp`
- completion: manual ("Got it, next")

```
When you're done exploring the wiki, hit the back button up here to jump straight back to where you started.
```

---

## §6.13 Telegram (conditional)

### telegram

_Route: (current). Conditional on `picks.telegram === "yes"`. BeakerBot is `thinking`. [DYNAMIC SPEECH] - branch picker with three branches (yes-now / yes-later / no-telegram). Each branch has its own speech body._

- voice: USER_ACTION (branch picker) -> BEAKERBOT_DEMO (synthetic branch only)
- spotlight target: (bubble carries the UI)
- completion: event (branch-specific)

Branch picker (initial speech):

```
I see you wanted the Telegram bot. Quick question first: do you have Telegram installed on your phone right now?
```

Branch picker options:

```
Yes, let's set it up now
Yes, but I'll set it up later
No Telegram on my phone
```

Branch A (yes-now), pre-pair:

```
Great. Pair the bot below, then send me any photo from Telegram. I'll file it straight into your inbox.
```

Branch A, paired but no photo yet:

```
Paired. Now send me a photo from Telegram, anything works. I'll catch it in your inbox.

_(small print)_ Waiting for your photo to land...
```

Branch A, photo received (small print):

```
Got it. The photo is in your inbox. Drag it into your experiment's notes whenever you want.
```

Branch B (yes-later):

```
No problem, I'll let you set it up later. Skipping for now.
```

Branch C (no-telegram, synthetic):

```
No problem, let me show you what it WOULD look like. I'll drop a synthetic photo into your inbox and walk you through the caption and metadata flow.

_(small print, while dropping)_ Dropping the synthetic photo into your inbox...

_(small print, landed)_ Got it. The photo (SVG fallback, PNG asset pending if applicable) is in your inbox where you can drag it into any experiment's notes whenever you want.
```

---

## §6.14 Purchases (conditional)

All eight purchases steps gate on `picks.purchases === "yes"`.

### purchases-intro

_Route: `/purchases`. Pure narration setting up the Purchases page._

- voice: NARRATION
- spotlight target: (none)
- completion: manual ("Got it, next")

```
This is your Purchases page. It summarizes every purchase order you've ever logged.

What's nice: every order rolls up automatically by funding source, by category, by project. No SUMIF wrangling, and the CSV export is grant-ready.

I'm going to show you how to make your first purchase order. (You can also make these straight from the Gantt chart, same form, different entry point.)
```

### purchases-create-button-click

_Route: `/purchases`. User-action with page-lock: click `+ New Purchase`._

- voice: USER_ACTION
- spotlight target: `purchasesNewButton`
- completion: event (modal mount)

```
Click the blue "+ New Purchase" button to get started.
```

Wrong-click flash:

```
Oops, that's not the right thing.

Click the blue "+ New Purchase" button to start your first order.
```

### purchases-form-fill

_Route: `/purchases`. Modal is open. BeakerBot is `typing-on-laptop`. Cursor fills name/vendor/price/qty/funding-string with the demo coffee order and submits. [DYNAMIC SPEECH] flips between "watching" and "done" once the create lands._

- voice: BEAKERBOT_DEMO
- spotlight target: `purchasesForm`
- completion: manual ("Got it, next")

[DYNAMIC] Watching state:

```
Alright, I'll fill in a fake coffee bean order so you can see the shape. Watch.

Heads up on the last field: "Funding String" is just a label for where the money came from. Grant number, gift fund, your Lab Head's discretionary line, anything. Group your purchases however your lab thinks about money.

_(small print)_ Item: "<PURCHASE_ITEM_NAME>" from <PURCHASE_VENDOR>, $<PURCHASE_PRICE> x <PURCHASE_QTY>, charged to "<FUNDING_STRING_NAME>".
```

[DYNAMIC] Done state:

```
Done. Your coffee order is on the Purchases tab, charged to <FUNDING_STRING_NAME>. Totals roll up by funding source, by category, and by project automatically.
```

### purchases-autocomplete-demo

_Route: `/purchases`. [DYNAMIC SPEECH] - three stages (closed / open / autofilled) drive the page-lock and the bubble copy. User opens a new purchase and types "coff" to trigger autocomplete._

- voice: USER_ACTION
- spotlight target: `purchasesNewButton`
- completion: manual ("Got it, next")

[DYNAMIC] Closed/open stage (prompt):

```
Here's a feature you'll love. Every item you log gets remembered.

Open a new purchase, start typing "coffee" in the item name, and watch what happens.
```

[DYNAMIC] Autofilled stage (done):

```
Boom. Vendor and price pulled in. Recurring purchases stop being annoying.
```

Wrong-click flashes:

```
[stage = closed] Oops, try the "+ New Purchase" button.
Click it, then start typing in the Item Name field.

[stage = open] Oops, the Item Name field is the target here.
Type "coff" and pick the suggestion that pops up.
```

### purchases-demo-warp-prompt

_Route: `/purchases`. BeakerBot is `cheering`. branchOn completion - clicking "Take me to the demo page" warps the user into a read-only viewer over Alex's demo account._

- voice: NARRATION
- spotlight target: (none)
- completion: branch ("Take me to the demo page" -> purchases-demo-viewer)

```
The really cool stuff on this page only kicks in once you've stacked up a bunch of purchases: analytics, breakdowns, charts.

Want me to flip you over to a demo account that's already full of purchases? I'll bring you right back.
```

### purchases-demo-viewer

_Route: `/purchases`. DemoPurchasesViewer overlay is mounted over Alex's demo data. Brief intro speech._

- voice: NARRATION
- spotlight target: `demoPurchasesViewer`
- completion: manual ("Got it, next")

```
This is Alex, a sample researcher from our demo lab. About a year of purchases across three projects, enough that the charts actually have shape.
```

### purchases-demo-charts

_Route: `/purchases`. Cursor glides to the spending dashboard, clicks the Category lens, pauses, then clicks Project lens._

- voice: BEAKERBOT_DEMO
- spotlight target: `demoSpendingDashboard`
- completion: manual ("Got it, next")

```
Scroll down. Each funding account gets its own card: budget, spent so far, and a progress bar. You see the red ones at a glance when something is over budget.

Then the breakdown chart. Right now it's grouped by category, biggest spend at the top. See how Miscellaneous tracks separately from your project-tied purchases?

Flip the lens to Project: each project sorted by spend, biggest at the top. Same for Vendor when you want to know which company you hand the most money to.
```

### purchases-back-to-real

_Route: `/purchases`. BeakerBot is `pointing-up`. Manual advance "Back to my page" - controller's onManualAdvance fires the viewer-close event on exit. Page-locked to the Back-to-my-page button._

- voice: NARRATION
- spotlight target: `demoPurchasesBackButton`
- completion: manual ("Back to my page")

```
Cool? Click below to get back to your own page and finish the tour.
```

Wrong-click flash:

```
Click the "Back to my page" button to wrap up.
```

---

## §6.15 Calendar (conditional)

### calendar

_Route: `/calendar`. Conditional on `picks.calendar === "yes"`. Pure narration about the Calendar page._

- voice: NARRATION
- spotlight target: `[data-tour-target='calendar-tab']`
- completion: manual ("Got it, next")

```
Calendar tab's optional. You can add events directly, or link external calendars (Outlook, Apple, Google iCloud) in read-only mode. ResearchOS shows your external events alongside your experiments and tasks. When you want, set it up in Settings.
```

---

## §6.14b Links (conditional)

Note: in TOUR_STEP_ORDER, `links` sits between calendar and lab-cleanup (after §6.15 Calendar and before §6.16 Lab cleanup). It is its own phase per the Lab Links manager brief; numbered §6.14b here for proximity to its neighbors.

### links

_Route: `/links`. Conditional on `picks.links === "yes"`. [DYNAMIC SPEECH] - lab accounts see beat 2 (public-toggle), solo accounts skip it._

- voice: NARRATION
- spotlight target: `[data-tour-target='lab-links-nav-tab']`
- completion: manual ("Got it, next")

Beat 1 (everyone):

```
Here's where you save bookmarks. Click + Add Link, type a URL, give it a label, save. Stuff like your university VPN, the lab calendar, the freezer inventory spreadsheet, your manuscript drafts.
```

Beat 2 (lab accounts only):

```
If you mark a card public, your teammates see it on their Links page. That's how labs ship shared resource pages.
```

---

## §6.16 Cleanup and goodbye

### lab-cleanup

_Conditional on `picks.account_type === "lab"`. BeakerBot is `thinking`. Tombstones the demo BeakerBot lab user that was spawned during §6.8 share cluster. Auto-advances after 1500ms._

- voice: NARRATION
- spotlight target: (none)
- completion: auto (1500ms)

```
Cleaning up the fake teammate. BeakerBot retires gracefully.

_(small print, while cleaning)_ Removing BeakerBot and the demo experiments...

_(small print, done)_ Done. Your real Workbench is back to just yours.
```

### tour-goodbye

_Terminal step. BeakerBot is `cheering`. [DYNAMIC SPEECH] - second sentence drops if the user skipped the tour early (no artifacts to clean up). The "Let's go" click triggers the outro overlay (cheering -> waving -> fade)._

- voice: NARRATION
- spotlight target: (none)
- completion: manual ("Let's go")

[DYNAMIC] Populated (built artifacts):

```
You're set! Here's to many great experiments ahead.

I'll tidy up the demo stuff we built together and leave you with your first project.

If you ever need a refresher, every page has its own wiki guide. Look for the help icon up top, next to the gear icon.

Good luck.
```

[DYNAMIC] Early-skip (no artifacts):

```
You're set! Here's to many great experiments ahead.

You skipped ahead, so there's nothing for me to clean up. Your account is ready to go whenever you are.

If you ever need a refresher, every page has its own wiki guide. Look for the help icon up top, next to the gear icon.

Good luck.
```

Outro overlay caption (cheering phase):

```
Here's to many great experiments ahead!
```

Outro overlay caption (waving phase):

```
See you around!
```

Post-route toast (4s after landing on `/`):

```
Tour complete. Find BeakerBot again in Settings -> Onboarding.
```

---

## How to edit this file

Six edit operations are supported. Each one is interpreted by the orchestrator manager when you hand the file back.

### 1. Refine copy (the common case)

Just rewrite the speech in the fenced code block under any step. Markdown bold (`**bold**`) and italic (`_italic_`) inside the speech are preserved. Paragraph breaks render as blank lines in the bubble.

### 2. Drop a step

Append `[DROP]` to the step's H3 heading:

```
### methods-old-step [DROP]
```

On apply: removed from TOUR_STEP_ORDER, removed from step-registry, body file deleted, tests updated.

### 3. Add a new step

Insert a new H3 block between two existing steps, anywhere in the doc. The position in the file IS the position in TOUR_STEP_ORDER on apply. Required metadata up front:

```
### NEW: <short-id-suggestion>
*context blurb describing where this lands and what just happened*

- Voice: NARRATION | BEAKERBOT_DEMO | USER_ACTION
- Spotlight: <data-tour-target-key> or none
- Completion: manual | event | auto | branch
- ExpectedRoute: / | /workbench | /methods | etc. (or omit)

` ` ` (fenced speech block)
Speech text goes here. Multiple paragraphs OK.
` ` `
```

On apply: I create the step body file, register it, slot it into the array at that position, add a minimal test. If you marked `BEAKERBOT_DEMO`, I'll come back to you with a short clickable question about what the cursor should DO (the cursor sequence can't be inferred from copy alone).

### 4. Reorder steps

Just move H3 blocks around in the file (cut and paste in your editor). The doc order becomes the new TOUR_STEP_ORDER on apply. You can move steps within a phase or across phases. If you move a step across a phase header, also put it under the right `## §...` H2 so the doc stays readable.

### 5. Change interaction class

Edit the `Voice:` line at the top of any existing step block.

| From → To | What I do on apply |
|---|---|
| `BEAKERBOT_DEMO` → `USER_ACTION` | Strip cursorScript, change pose to "pointing", spotlight the user's target, flip tests |
| `BEAKERBOT_DEMO` → `NARRATION` | Strip cursorScript, keep speech as-is, flip tests |
| `NARRATION` → `USER_ACTION` | Add expectedRoute / spotlight if needed, leave speech as the instruction copy |
| `USER_ACTION` → `BEAKERBOT_DEMO` | I'll surface a clickable question asking what the cursor should DO (selector + action sequence). Cursor scripts can't be inferred from copy. |
| `NARRATION` → `BEAKERBOT_DEMO` | Same as above |

### 6. Change spotlight / completion / route

Edit the `Spotlight:`, `Completion:`, or `ExpectedRoute:` metadata lines. Use the canonical TOUR_TARGETS key (grep `frontend/src/components/onboarding/v4/steps/walkthrough/lib/targets.ts` for the full list) or `none`. Completion takes `manual`, `event`, `auto`, `branch`.

### Things you should NOT change

- H2 phase headers (`## §6.1 Home + first project` etc.) — these are doc-level only, the inverse-apply doesn't use them
- H3 step IDs themselves (`### home-create-project`) — these are load-bearing identifiers
- The leading `[DYNAMIC] <label>:` tags inside dynamic-speech blocks — they're how I route each variant back to the right conditional branch in source

### [DYNAMIC] speech variants

Some step bodies pick speech at runtime based on state. The flagged steps in this doc are listed at top of the report. For each:

- Edit each labeled variant separately
- Keep the `[DYNAMIC] <label>:` prefix intact
- For Telegram, each branch (`yes-now`, `yes-later`, `no-telegram`) plus sub-states gets its own labeled block
- For `gantt-share-user-shares-back` and `gantt-share-profile-switch`, the stage/beat numbers map to React state values — keep labels intact

### Handing back

Save the file, drop me a line. I'll diff against the source step bodies and produce a single patch with all your changes applied. If you flipped any class to DEMO or marked NEW steps as DEMO, I'll come back with the cursor-sequence question first; everything else is mechanical.

---

_Generated by the tour-script sub-bot (orchestrator manager dispatch). Source: `frontend/src/components/onboarding/v4/step-machine.ts` TOUR_STEP_ORDER + every step body under `frontend/src/components/onboarding/v4/steps/walkthrough/` (and setup, lab, cleanup)._
