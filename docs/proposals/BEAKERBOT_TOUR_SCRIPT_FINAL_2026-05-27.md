# BeakerBot Tour Script (v4 Universal Walkthrough)

This file is a single-pass, editable transcript of every speech beat BeakerBot delivers in the v4 onboarding tour, listed in TOUR_STEP_ORDER from frontend/src/components/onboarding/v4/step-machine.ts.

## §0 Setup (modal-contained Q&A)

### welcome

```
Welcome to ResearchOS! Here is a quick overview before we set up your account.
```

Body copy (modal-contained intro paragraph):

```
ResearchOS keeps your experiments, lab notes, methods, and calendar in one local-first place. I'm BeakerBot, and I'm gonna get you set up in about ten minutes.

A few things to know going in. I'll ask you seven quick setup questions, then walk you through the pages worth knowing about, skipping ones you turned off. I won't cover every button, just enough that you can find the rest on your own.

Anything we build together during the tour gets cleaned up at the end. Only your first project stays.

Hit **Let's go** when you're ready, or **Skip walkthrough** to jump straight to your account.
```

### setup-q1

```
First up: are you setting this account up just for yourself, or for an entire lab?
```

### setup-q1c

```
One follow-up before we move on: are you the PI, or a lab member?
```

### setup-q2

```
Do you want to track lab purchases and reagent orders? You can enable the tracker now or leave it off to keep things simple.
```

### setup-q3

```
ResearchOS can overlay any public calendar such as personal ones from Outlook, Apple, Google, etc. Would you like a walkthrough on how to get that link working?
```

### setup-q4

```
You can set up high-level goals for projects, or even private goals for things outside the lab. They show up right on your Gantt chart to help you keep track of what you want to achieve and how much time is left. Want to turn this on?
```

### setup-q5

```
You can link a Telegram bot to send photos directly from your phone to your ResearchOS inbox. This makes it easy to quickly upload gel images or bench notes. Do you want to enable this integration?
```

### setup-q6

```
We can generate a custom system prompt for external AI tools like Claude, ChatGPT, or Gemini so they understand how your lab notebook is organized. Pick how much detail you want included.
```

### setup-q7

```
The Links tab is a dedicated space to save important bookmarks, like your lab calendar, freezer inventory, or manuscript drafts. Do you want this tab enabled?
```

### setup-wrapup

Descriptor speech:

```
Quick recap of what you picked, then we'll get you to the home page (or into the feature tour if you want it).
```

Body header copy:

```
You're all set. Here's what you picked, and what we'll have ready for you on the home page. You can change any of this later in Settings.
```

Footer caption:

```
The tour is tailored to the features you just turned on, with BeakerBot as your guide. You can re-run it any time from Settings.
```

## §6.1 Home + first project

### home-create-project

```
Projects are the top-level folders for all your work. Let's make your first one. Click the blue plus button up there to get started.
```

### home-create-project-fill

```
Give your project a name and pick a color. Don't worry, these choices can always be changed later.

The seven-day work week toggle controls whether weekends count for your schedule. Most labs leave it off so the Gantt chart skips Saturday and Sunday. Click Create Project when you're ready.
```

## §6.2 Project navigation

### project-overview-nav

```
Every experiment, method, and task you create gets attached to a project. The project page is where all of that comes back together in one view. Let's open the one you just made.
```

### project-overview-prose

```
The project page has four sections.

The **Overview** box at the top is yours to fill in: the hypothesis, the motivation, why this project exists. It's the anchor you come back to when you're deep in the weeds and need to remember the point.
```

### NEW: project-overview-rollup
*Route: /workbench/projects/<id>. Lands right after project-overview-prose. Spotlight shifts to the Results/Methods/Activity sections below the Overview textarea.*

- Voice: NARRATION
- Spotlight: projectOverviewRollupSections
- Completion: manual
- ExpectedRoute: /workbench/projects/<id>

```
Below the Overview box, **Results**, **Methods**, and **Activity** fill themselves in automatically as you work. Drop an image in any experiment's Results tab and it shows up here. Attach a method to an experiment and it lands here too.

You never curate this page manually. It's a live roll-up of everything happening across the project.
```

### NEW: project-overview-typing-demo
*Route: /workbench/projects/<id>. Cursor types a placeholder hypothesis into the Overview textarea. This is the BEAKERBOT_DEMO that used to live at the end of the original project-overview-prose.*

- Voice: BEAKERBOT_DEMO
- Spotlight: projectOverviewTextarea
- Completion: manual
- ExpectedRoute: /workbench/projects/<id>

```
I'll type a placeholder hypothesis into the Overview box now so you can see how it feels.
```

### project-overview-context

```
This topbar stays with you across the project. As you add tags or update the status, they appear here so you can always see a quick summary without scrolling.
```

### project-overview-exit

```
[DYNAMIC] Off-home variant:
Great. Let me take us back home so we can look at your dashboard.

[DYNAMIC] Already-home variant:
Great. Let me show you how your Home dashboard works.
```

## §6.2b Home widgets

### home-widgets-canvas-intro

```
Home is the first page you land on every time you open ResearchOS. The point is to answer one question before you click anywhere else: what needs my attention today.

You build that answer out of widgets. We started you with two, Upcoming tasks and Today's events. I'll use these to show you how the canvas works, but there's a full catalog of widgets to pull from once you know the mechanic.
```

### home-widgets-tile-anatomy

```
Each tile gives you a high-level snapshot. If you click a tile, it expands into a full popup where you can search, filter, and take action without having to navigate to a new page.
```

### home-widgets-add

```
You can add as many widgets as you need from the catalog. I'll open it up and add one now so you can see how it drops onto your canvas.
```

### home-widgets-reorder

```
You can also drag any tile to reorder it. Keep your most important widgets at the top. If you eventually share this workspace with lab members, your layout stays yours and theirs stays theirs.
```

### home-widgets-exit

```
That covers the canvas. You can come back anytime to swap widgets in and out. If you want to try out different widgets with real data, the demo account is a great place to do that. Next, let's look at how ResearchOS keeps you updated.
```

## §6.3 Notifications

### NEW: notifications-intro
*Route: /. Slots in immediately before notifications-bell. Pure narration introducing the bell-and-inbox area in the top bar. No spotlight needed; this is just framing before the user clicks anything.*

- Voice: NARRATION
- Spotlight: none
- Completion: manual
- ExpectedRoute: /

```
Two things live in the top bar that you should know about.

The **bell** collects everything that needs your attention: reminders for upcoming tasks and experiments on your Gantt, updates from labmates on anything they shared with you, and any mentions or comments on your work.

The **inbox** next to it is where files land when something is sent to you from outside the app, like photos from Telegram or shared attachments.
```

### notifications-bell

```
I just fired a test notification so you can see how the bell works. Click it to open the popup.
```

### notifications-silence

```
To clear the notification badge without deleting the message, click either the row itself or the "Mark read" button. Try it now.
```

### notifications-delete

```
If you want to clear it from your inbox entirely, just click the X.
```

## §6.5 Workbench experiment creation

### workbench-create-experiment-open

```
The Workbench is where you log your day-to-day lab work. Every experiment you run gets its own entry, with space for notes, results, attached methods, and files.

Click **+ New Experiment** to make your first one.
```

### workbench-create-experiment [DROP]

```
I'll name the experiment for us.
```

## §6.6 Experiment detail

### experiment-attach-method-open

```
This is one experiment, opened up. Everything that belongs to a single run lives in here: the protocol you followed, your notes from the bench, the results, any files you generated. We'll walk through each piece.
```

### experiment-attach-method-tab

```
The **Methods** tab is where you'll pin the protocol you actually followed for this run. Six months from now, when you're trying to figure out why one experiment worked and another didn't, this is what tells you exactly what you did.

We'll come back here to actually attach a method later, after you've built one. For now just know it exists.
```

## §6.7 Hybrid editor

### hybrid-notes-vs-results

```
Every experiment splits your writing into two separate places, on purpose.

**Notes** is the messy side. Daily logs, half-formed ideas, things that broke. Nobody else needs to read it.

**Results** is the clean side. Final figures, the conclusion you would actually defend in a lab meeting. This is what you point people to.

Same editor, but the two never bleed into each other. You can be sloppy in Notes without worrying about it showing up in Results.
```

### NEW: hybrid-editor-scope
*Route: /workbench. Slots in immediately after hybrid-notes-vs-results, before hybrid-markdown-intro. Pure narration setting up the rest of the editor phase.*

- Voice: NARRATION
- Spotlight: none
- Completion: manual
- ExpectedRoute: /workbench

```
About the editor itself: we're about to spend a few minutes on it. It's the same one used everywhere in ResearchOS, so once you know it here, you know it for project overviews, standalone notes, and method writeups too.

I'll cover markdown basics first, then how to drop in images and other files.
```

### hybrid-markdown-intro

```
Every editor in ResearchOS uses **markdown**: a lightweight way to format text by typing simple symbols around your words instead of clicking buttons.

If you have written anything in Slack, Notion, or GitHub, you have already used it. The next few steps cover the basics, bold, italic, underline, and headers. Already comfortable with markdown? The next step will let you skip ahead.
```

### hybrid-markdown-familiarity

```
Have you used markdown before? If not, do you want a 30-second crash course?
```

### hybrid-markdown-overview

```
Markdown lets you format text without clicking through menus. You just type simple symbols around your words.

For example, typing `**bold**` makes text bold, and `# Heading` creates a large header. You don't have to memorize anything right now. There's always a shortcut bar on the left you can click if you forget.
```

### hybrid-editor-mechanic

```
The key thing to know about this editor is how it handles formatting.

While you're actively typing inside a block of text, you'll see the raw symbols. The moment you click outside of that block, it renders cleanly into formatted text.
```

### hybrid-bold

```
Watch me write a bold sentence. I'll wrap the words in two stars on each side.

_(small print)_ Notice how the stars disappear when I click out? That's the render landing.
```

### hybrid-italic

```
Now an italic sentence, using single stars.

_(small print)_ Same pattern, the stars disappear when the render lands.
```

### hybrid-underline

```
Underline uses single underscores.

_(small print)_ The underscores disappear on render.
```

### hybrid-h1

```
Headers use hash symbols. One hash is the largest header.
```

### hybrid-h2

```
Two hashes create a slightly smaller header.
```

### hybrid-h3

```
Three hashes create an even smaller header.
```

### hybrid-shortcuts

```
Your turn. Standard keyboard shortcuts work here too.

Try pressing `Cmd+B` (or `Ctrl+B` on Windows) to type some bold text. You can also skip this step if shortcuts aren't your thing.
```

### hybrid-image-attach

- Voice: USER_ACTION
- Spotlight: hybridEditorImageStrip
- Completion: manual

```
You can attach images directly to any experiment so figures, gel photos, and bench shots live alongside the writeup.

Try it now: drag any image file from your computer into the editor.
```

### hybrid-image-drag-in

```
Once an image is attached, you can drag it directly into your notes so it renders exactly where you want it in your writeup.
```

### hybrid-image-resize

```
You can click any image to resize it directly from the pop-up menu.
```

### hybrid-file-attach

```
Non-image files (like PDFs or CSVs) attach the exact same way. Instead of rendering inline, they appear as a download chip, keeping the file safe alongside your notes.

ResearchOS can open PDFs and text files directly in the browser. Other formats will simply download to your computer.
```

## §6.7b Workbench Notes and Lists

### workbench-notes-intro

```
Not everything you write down belongs to a specific experiment. Conference takeaways, meeting notes, a paper you want to remember. The middle **Notes** tab in your Workbench is for that. Click it now.

Two flavors live here. **Single Notes** are one-offs: a meeting, a paper summary, a stray idea. **Running Logs** are for things that grow over time. One log per conference, one entry per talk, everything in one file instead of scattered across ten notes.
```

### workbench-notes-create

```
Here is an example of a single note for conference takeaways. It uses the exact same text editor you just learned.
```

### workbench-lists-intro

```
Last tab on the Workbench is **Lists**.

A list is a lightweight task with a checklist inside. Reach for one when the work is just "do these things and check them off": a reagent restock, errands before a deadline, items to bring to a conference.

No protocol, no results section. Just a name and a set of boxes to tick.
```

### workbench-list-create-shell

```
Quick example: a coffee restock list for the lab. A list just needs a name and the items you want to track. I'll add a few now.
```

### workbench-list-mark-done

```
You can check off individual items as you work. Once everything is done, mark the list itself complete. That drops it out of your active view so it stops competing for your attention.
```

## §6.7c Methods phase

### methods-category-prompt

```
You've seen where lab work gets logged. Now for where your protocols live.

**Methods** is your library of reusable techniques. Write a protocol once here, then attach it to every experiment that uses it instead of rewriting the steps each time. Most labs run the same handful of techniques over and over, so this ends up being one of the most-used pages in ResearchOS.

To keep the library navigable, methods get sorted into categories. Let's start one based on work you actually do. What's a common technique in your lab?
```

### methods-category-open

```
First, click **+ New Category** at the top of the page. I'll handle the rest.
```

Wrong-click flash speech:

```
Oops, that's not the right thing.

Click **+ New Category** at the top of the Methods page so we can set up your first category.
```

### methods-category

```
[DYNAMIC] Example with pick = "Genetics":
Great, let's set up Genetics as your first category. Watch.
```

### methods-open-picker

```
Now let me show you the different kinds of methods you can build. I'm clicking New Method to open the catalog.
```

### methods-type-tour

```
For a handful of common techniques, ResearchOS gives you a purpose-built editor instead of plain text. PCR gets a thermal cycle builder. LC Gradient draws a live chart as you edit. There are others in the catalog, but I'll show you these two so you get the feel.

Opening the PCR builder now. Take a look around, then click "Got it, next" to see the LC Gradient editor.
```

### methods-lc-demo

```
And here is the LC Gradient editor. The chart updates automatically as you change values in the table. Click "Got it, next" when you're ready to move on.
```

### methods-create

```
For general lab work, you'll usually use the Standard Markdown builder. I'll type in something obviously-not-real so you can see how the text editor flows.
```


## §6.7d Back to your experiment (method attachment)

### experiment-attach-method-attach

```
Back to your experiment. Now that you've got a method, let's pin it. I'll attach the markdown method you just built so this experiment has an exact record of the protocol followed.
```

### experiment-attach-method-notes

```
You can also add quick variation notes here if you changed anything specific for this run.

**Important:** when you edit a method from inside an experiment, you're only editing this experiment's COPY. Your original master protocol stays untouched, so you can tweak things per-experiment safely.
```

## §6.8 Gantt

### gantt-intro

```
Once you have more than a few experiments running, a list view stops being enough. You need to see what overlaps, what's blocking what, and what your week actually looks like.

That's what the Gantt chart is for. Every experiment, task, and purchase order with a date lives here on one timeline, so you can spot when you're overbooked or plan backward from a deadline.

We'll cover three things on this page: rescheduling work by dragging bars around, wiring up dependencies between tasks, and sharing experiments with your lab.
```

### gantt-existing-experiment

```
Anything with a date attached lands on the timeline automatically, including the experiment you just made.

The timeline isn't just a view, though. You can open, edit, reschedule, and manage anything right from here without having to bounce back to the Workbench. I'll click your experiment to show you.
```

### gantt-drag-drop

```
Need to push something to next week, or pull a deadline forward? Grab the bar and drop it where you want it. The dates update instantly, no popup, no form.
```

### gantt-deps-beakerbot

```
Dependencies ensure you don't schedule an experiment before you have the necessary prerequisites. I'm linking "Fake A" so it has to finish before your experiment can start.

Notice the arrow pointing from A to your experiment.
```

### gantt-deps-user

```
Now you wire the other side. Drop Fake B onto your experiment, then pick "start after" so B is forced to wait until your experiment finishes.

_(small print)_ (I'll keep you on rails. Clicks outside the right affordance will be ignored.)
```

Wrong-click flash:

```
Oops, that's not the right thing.

Drag Fake experiment B onto your experiment, then pick "start after" so B starts after your experiment finishes.
```

### gantt-deps-cascade

```
Once tasks are linked, moving one upstream task drags everything downstream with it. If Fake A slips by three days, your experiment and Fake B slip too. No manual rescheduling, no broken chains.
```

### gantt-share-intro

```
When two people are running an experiment together, both of you need to see it on your own timeline and both of you need to be able to add notes as the work happens. That's what sharing is for.

Share an experiment with anyone in your lab and it shows up on their Gantt chart alongside yours. You decide whether they can just read it or actually edit notes and dates.
```

### gantt-share-beakerbot-spawn

```
For this demo, I added a second account to your lab so I have someone to share with.

Watch the timeline. My "Make some coffee together" experiment will appear in a moment.
```

### gantt-share-beakerbot-shares

```
I just shared "Make some coffee together" with you. I gave you edit permission, so you can change dates and add notes.
```

### gantt-share-user-explores

```
This is your view of my shared experiment. Try adding a note or opening the results tab to see how the access works.

_(small print)_ When you're ready, click "Got it, next" and I'll take over.
```

Wrong-click flash:

```
Oops, please poke around inside the popup. The rest of the page is locked for now.
```

### gantt-share-user-shares-back

```
[DYNAMIC] Stage 1 (timeline):
Now share your chain back with me. Click the first task in your chain on the timeline.

[DYNAMIC] Stage 2 (popup):
Click the share button on the popup.

[DYNAMIC] Stage 3 (share dialog):
Pick me (beakerbot) and give me edit permission.

_(footer, all stages)_ (I'll keep you on rails. Clicks outside the right affordance will be ignored.)
```

### gantt-share-profile-switch

```
[DYNAMIC] Beat 1 (initial):
When you have your own labmates set up, you can switch between accounts from the user picker. I'll jump over to my account, add a note to the chain you just shared, and come right back so you can see it.

[DYNAMIC] Beat 2 (T+1200ms, switched):
I'm on my account now. Adding a note to your chain.

[DYNAMIC] Beat 3 (T+2600ms, typing - small print):
(Typing the note from BeakerBot's side...)

[DYNAMIC] Beat 4 (T+5400ms, switched back):
Switched back. Open the experiment to see the note I just added.
```

### gantt-share-user-sees-edit

```
Open Fake A on the timeline and check the notes tab. You should see the edit I just made.

_(small print)_ Take a look around when you're ready, then click "Got it, next".
```

### gantt-goals-overview

```
One last thing on the timeline: goals.

Goals visualize directly over the Gantt chart. You can keep them private to your account or share them so the whole lab can see what you're working towards.
```

## §6.9 Animation picker (on Settings page)

### NEW: settings-intro
*Route: /settings. Slots in immediately before personalization-animations. Pure narration introducing the Settings phase as a whole. Establishes scope before we walk through any specific section.*

- Voice: NARRATION
- Spotlight: none
- Completion: manual
- ExpectedRoute: /settings

```
Last stop: Settings. This is where everything about your account lives: how the app looks, which tabs are visible, your integrations, your AI Helper prompt, and the option to re-run this tour later.

We won't click through every section. We'll hit the ones worth knowing about so you can find the rest on your own.
```

### personalization-animations

```
First up: the animation picker. Finishing an experiment is one of the few moments in lab work that actually feels like a win, so ResearchOS marks it with a little animation. Pick the one you want.
```

## §6.10 Settings

### personalization-color

```
You already picked a color during setup. This toggle decides whether the top bar takes that color too or stays a clean white. Play with it, and click "Got it, next" when you're happy.
```

### settings-tour-folder

```
Your lab folder is set up. If you ever need to switch folders, sign out and pick a new one from the main entry screen.
```

### settings-tour-calendar

```
Calendar feeds aren't managed here in Settings. Head over to the actual Calendar tab when you're ready to paste in your link.
```

### settings-tour-telegram

```
Telegram lives here. If you didn't link it during setup, you can wire it up anytime by following the steps in this section.
```

### settings-tour-account-type-toggle

```
If you ever pivot from a solo account to a lab account, you'll do that from the user picker up top, not here in Settings.
```

### settings-tour-visible-tabs

```
If you hid any tabs during setup, you can always turn them back on using these checkboxes.
```

### settings-tour-streak

```
The streak counter is on by default. It's completely private to you. If you would rather not see it, you can toggle it off here.
```

### settings-tour-rerun

```
If you ever forget how something works, you can re-run this welcome tour right from this button.
```

### ai-helper-size-diff

```
External AI tools like Claude, ChatGPT, and Gemini charge by tokens. The more context you hand them about your lab notebook, the more each conversation costs you.

That's why the AI Helper exists: it generates a system prompt about how your notebook is structured, sized to fit how much you're willing to spend per chat.
```

### NEW: ai-helper-size-options
*Route: /settings. Slots in immediately after ai-helper-size-diff, before ai-helper-use-case-paste. Cursor cycles through the Full/Medium/Minimal tabs (this is the cursor action that was in the original ai-helper-size-diff step).*

- Voice: BEAKERBOT_DEMO
- Spotlight: settingsAiHelperSection
- Completion: manual
- ExpectedRoute: /settings

```
Three sizes to pick from. **Full** gives the model everything it could possibly want to know. **Minimal** strips it down to the essentials. **Medium** sits in between.

Higher detail means better answers but more tokens per prompt. Pick based on what your usage budget can handle.
```

### ai-helper-use-case-paste

```
The simplest way to use this: copy the prompt, paste it as the first message in a new chat with Claude, ChatGPT, or Gemini, then ask your question.

The model now has context on how your notebook is structured. You can ask things like "summarize this week's notes" or "what experiments use plasmid X" without explaining the layout every time.
```

### ai-helper-use-case-agentic

```
Agentic models with read access to your data folder can actually help write your notebook with you. They can draft entries and fill in notes like a collaborator who knows your entire project history.
```

## §6.11 Search

### search-demo

```
Search runs across everything in your account at once: experiments, methods, tasks, notes, results. So a year from now, when you vaguely remember running something with a particular reagent, you can find it without remembering which project it lived in.
```

## §6.12 Wiki pointer

### wiki-pointer-intro

```
We also have a built-in wiki with detailed documentation for every page in the app, covering everything from search behavior to Gantt dependencies.
```

### wiki-pointer-icon-spotlight

```
If you're ever confused on a page, just click the question-mark icon up in the top right.
```

### wiki-pointer-click-demo

```
Clicking it takes you directly to the wiki article explaining whatever you were just looking at.
```

### wiki-pointer-back-demo

```
When you're done reading, hit the back button up here to jump right back to your work.
```

## §6.13 Telegram (conditional)

### telegram

Branch picker (initial speech):

```
I see you wanted the Telegram integration. Do you have Telegram installed on your phone right now?
```

Branch A (yes-now), pre-pair:

```
Great. Pair the bot below, then send me any photo from Telegram. I'll file it straight into your inbox.
```

Branch A, paired but no photo yet:

```
Paired. Now send me a photo from Telegram. Anything works.

_(small print)_ Waiting for your photo to land...
```

Branch A, photo received (small print):

```
Got it. The photo is in your inbox. Drag it into your experiment's notes whenever you want.
```

Branch B (yes-later):

```
No problem, I'll let you set it up later in Settings.
```

Branch C (no-telegram, synthetic):

```
No problem. I'll drop a synthetic photo into your inbox to show you how the caption and metadata flow works.

_(small print, while dropping)_ Dropping the synthetic photo into your inbox...

_(small print, landed)_ Got it. The photo is in your inbox where you can drag it into any experiment's notes whenever you want.
```

## §6.14 Purchases (conditional)

### purchases-intro

```
The Purchases page tracks every order you place and groups it by funding source, category, and project as you go.

The reason it exists: when a grant report or budget question comes around, the numbers are already sorted. No digging through email threads or rebuilding a year of orders in a spreadsheet. Let's log one.
```

### purchases-create-button-click

```
Click the blue "+ New Purchase" button to get started.
```

Wrong-click flash:

```
Oops, that's not the right thing.

Click the blue "+ New Purchase" button to start your first order.
```

### purchases-form-fill

```
[DYNAMIC] Watching state:
I'll fill in a fake coffee bean order so you can see how it works.

Heads up on the last field: "Funding String" is just a label for where the money came from, like a grant number or gift fund. Group your purchases however your lab thinks about money.

_(small print)_ Item: "<PURCHASE_ITEM_NAME>" from <PURCHASE_VENDOR>, $<PURCHASE_PRICE> x <PURCHASE_QTY>, charged to "<FUNDING_STRING_NAME>".

[DYNAMIC] Done state:
Done. Your coffee order is logged and automatically categorized.
```

### purchases-autocomplete-demo

```
[DYNAMIC] Closed/open stage (prompt):
Every item you log gets remembered to make recurring purchases easy. Open a new purchase, type "coffee" into the item name, and watch what happens.

[DYNAMIC] Autofilled stage (done):
The vendor and price pull in automatically.
```

### purchases-demo-warp-prompt

```
The real point of this page is the analytics, but charts on an empty account don't show much. I can flip you over to a demo account ("Alex") that has a year of purchases across three projects, so the breakdowns and budget bars actually have shape to them. Want to take a look?
```

### purchases-demo-viewer

```
Here is Alex's account. Let's look at how the analytics come together.
```

### purchases-demo-charts

```
Each funding account gets its own card with a budget and progress bar, letting you see at a glance if something is over budget.

The breakdown chart groups your spending. You can flip the lens from Category to Project or Vendor to instantly see exactly where your money is going.
```

### purchases-back-to-real

```
Click below to return to your own page and finish the tour.
```

## §6.15 Calendar (conditional)

### calendar

```
Your day isn't just experiments. There are meetings, classes, office hours, appointments, things that aren't lab work but still eat your time. The Calendar tab gives those a home inside ResearchOS so you can see your full day in one place.

Link as many feeds as you want from Outlook, Apple, or Google. Events show up on the Calendar page and in the quick-view bar on the left, kept separate from your experiments and tasks but visible right alongside them.
```

## §6.14b Links (conditional)

### links

```
Beat 1 (everyone):
The Links tab is a home for the URLs you open ten times a week: the university VPN, the freezer inventory sheet, the shared drive. One place to keep them so you stop digging through bookmarks.

Beat 2 (lab accounts only):
Mark a link as public and your labmates see it on their Links page too. Useful for shared resources where you want everyone landing on the same version.
```

## §6.16 Cleanup and goodbye

### lab-cleanup

```
Cleaning up the fake teammate. BeakerBot retires gracefully.

_(small print, while cleaning)_ Removing BeakerBot and the demo experiments...

_(small print, done)_ Done. Your real Workbench is back to just yours.
```

### tour-goodbye

```
[DYNAMIC] Populated (built artifacts):
That's the tour. Your first project is ready to go, and everything else we built together gets swept out so you start with a clean account.

If you get stuck on any page, the question-mark icon in the top right pulls up the wiki article for whatever you're looking at. Good luck.

[DYNAMIC] Early-skip (no artifacts):
That's the tour. Nothing to clean up since you skipped ahead, so your account is ready whenever you're.

If you get stuck on any page, the question-mark icon in the top right pulls up the wiki article for whatever you're looking at. Good luck.
```
