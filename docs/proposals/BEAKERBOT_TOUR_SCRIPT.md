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
