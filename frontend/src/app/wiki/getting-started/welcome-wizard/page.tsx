import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import Kbd from "@/components/wiki/Kbd";

export default function WelcomeWizardPage() {
  return (
    <WikiPage
      intro="BeakerBot's welcome tour is a guided walkthrough on your real account. It opens with a short setup Q&A, then drops you into a live tour that helps you create your first project, method, and experiment right in the app. Plan on five to fifteen minutes, depending on which optional surfaces you opt into."
    >
      <Screenshot
        src="/wiki/screenshots/onboarding-welcome-step.png"
        alt="The opening screen of BeakerBot's welcome tour. A sky-blue beaker mascot waves on the left, a short two-sentence pitch sits to the right, and a Let's go button waits in the lower-right corner."
        caption="The opening screen. BeakerBot greets you, sets expectations, and waits for Let's go."
      />

      <h2>What the welcome tour actually is</h2>
      <p>
        When you create a brand-new ResearchOS user, BeakerBot pops up to show
        you around. The tour runs on your real account, against your real
        local-first data folder. Anything BeakerBot creates (a sample project,
        a placeholder method, a first experiment) lands on disk just like normal
        work. At the end BeakerBot plays a short goodbye animation and
        auto-cleans the demo artifacts in the background, leaving you with your
        first real project.
      </p>
      <p>
        Three things are true about every run:
      </p>
      <ul>
        <li>
          The tour is one continuous experience inside the app, not a separate
          demo sandbox. There is no fake fixture you discard on close.
        </li>
        <li>
          BeakerBot drives the pacing with a <strong>Got it, next</strong> or{" "}
          <strong>Next</strong> button on each step. You can also click{" "}
          <strong>Skip this step</strong> on any individual step, or the
          persistent <strong>I&apos;ve got it from here</strong> link in the
          footer to jump straight to the goodbye screen.
        </li>
        <li>
          Closing the tab mid-tour is safe. The next time you open the folder,
          BeakerBot offers <strong>Resume</strong>, <strong>Restart</strong>, or{" "}
          <strong>Discard</strong>.
        </li>
      </ul>

      <Callout variant="info" title="If you remember the old seven-step modal">
        ResearchOS used to ship a different welcome wizard: a seven-step modal
        that asked which use-case you fit into and toggled tabs from a static
        map. That version has been retired. BeakerBot&apos;s tour now walks you
        through your own account instead of front-loading taxonomy questions.
      </Callout>

      <Callout variant="info" title="This is not the 3-minute walkthrough on the picker">
        Quick disambiguation: the folder-picker screen (before you link a
        folder) shows a small <strong>Take the 3-minute walkthrough</strong>{" "}
        button next to BeakerBot in the upper-right. That is a separate, opt-
        in 4-beat modal that introduces ResearchOS at a high level (welcome,
        data security, folder choice, cloud provider). It runs <em>before</em>{" "}
        you commit to picking a folder, never writes to disk, and closes back
        to the picker. The longer tour described on this page is the in-product
        BeakerBot tour that auto-fires <em>after</em> you sign in to a fresh
        user account. See{" "}
        <Link href="/wiki/getting-started/connecting-your-folder">
          Connecting Your Folder
        </Link>{" "}
        for the picker-side walkthrough.
      </Callout>

      <h2>Who sees the tour</h2>
      <p>
        The tour auto-fires only when three conditions all hold:
      </p>
      <ul>
        <li>The folder has no <code>_user_metadata</code> entry, or the file is empty.</li>
        <li>
          There is no <code>_onboarding.json</code> on disk for the active user,
          or the file has no <code>wizard_completed_at</code> and no{" "}
          <code>wizard_skipped_at</code> field.
        </li>
        <li>
          The session is not in a completed or skipped state. The dev flag{" "}
          <code>?wizard-preview=1</code> overrides both completed and skipped
          states so the tour can be driven against fixture data.
        </li>
      </ul>
      <p>
        Existing users never see the tour automatically. If you signed in
        before BeakerBot existed, your sidecar migrates quietly to the new
        schema with no auto-fire, no banner, no nag.
      </p>
      <p>
        To run the tour after the fact, go to{" "}
        <strong>Settings &gt; Onboarding</strong> and click{" "}
        <strong>Re-run tour</strong>. BeakerBot re-mounts in place immediately
        (no page reload) starting from the welcome screen.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-settings-rerun-button.png"
        alt="The Onboarding section of Settings showing the Re-run tour row with a sky-blue Re-run tour button on the right edge."
        caption="The Re-run tour button in Settings. Clears completion state and re-mounts BeakerBot at the welcome screen without a page reload."
      />

      <h2>Phase 1: setup questions</h2>
      <p>
        The first few minutes are a short Q&amp;A that BeakerBot uses to shape
        the rest of the tour and which tabs appear in your sidebar. Every
        question is a radio pick with a sensible default if you click{" "}
        <strong>Skip this step</strong>.
      </p>

      <h3>Q1: solo or lab?</h3>
      <p>
        The first call is whether you are flying solo (one user, your own
        account) or running a multi-person lab (everyone points their
        ResearchOS at the same shared folder). The pick determines whether
        the PI follow-up question (Q1c, below) fires and whether the
        Lab Links surface is called &quot;Links&quot; or &quot;Lab Links&quot;.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-q1-account-type.png"
        alt="Q1 in the welcome tour showing two radio cards: Solo (selected) and Lab. BeakerBot stands in the upper-left in thinking pose."
        caption="Q1 picks your account flavor. You can revisit this in Settings."
      />

      <Callout variant="info" title="Q1 auto-skips when other users exist">
        When the lab folder already has other users in it (someone signed in
        before you), the wizard auto-skips Q1 and assumes Lab. The reasoning:
        if there is already a lab to join, you are joining a lab, not
        starting a solo workspace. Q1 still appears for the first user in a
        fresh folder so a single-person workflow stays a deliberate choice.
      </Callout>

      <h3>Q1c: are you the PI?</h3>
      <p>
        Conditional on Q1 = Lab. After picking Lab, BeakerBot follows up with
        a single binary question: are you the PI, or are you a member?
        Picking <strong>PI</strong> sets{" "}
        <code>account_type</code> to <code>&quot;lab_head&quot;</code> on this
        account; picking <strong>Member</strong> leaves it at the default. One
        person in the lab fills the PI slot. The picker badge in the
        login screen, the audit log, and the Lab Overview surface are all
        gated on the resulting <code>account_type</code>. See{" "}
        <Link href="/wiki/features/lab-head">PI</Link>.
      </p>

      <h3>Q2 through Q6: feature picks</h3>
      <p>
        Five questions about ResearchOS surfaces and preferences:
      </p>
      <ul>
        <li><strong>Q2:</strong> Will you track lab purchases? (Yes / No / Maybe later)</li>
        <li><strong>Q3:</strong> Want calendar feeds? (Yes / No / Maybe later)</li>
        <li><strong>Q4:</strong> Want a goal-tracking page? (Yes / No / Maybe later)</li>
        <li><strong>Q5:</strong> Want a Telegram bot for image inbox? (Yes / No / Maybe later)</li>
        <li>
          <strong>Q6:</strong> AI Helper prompt size. ResearchOS can paste a
          system prompt into Claude, ChatGPT, or Gemini so the assistant
          understands ResearchOS terminology. Full is the default. Medium and
          Minimal trim the prompt for smaller-context models.{" "}
          <strong>No</strong> or <strong>Maybe later</strong> skips the AI
          Helper tour cluster entirely.
        </li>
      </ul>
      <p>
        These answers drive both which tabs appear in your sidebar and which
        conditional walkthrough clusters fire in Phase 2.
      </p>

      <h3>Q7: Links / Lab Links</h3>
      <p>
        The final setup question asks whether you want a tab for saving
        bookmarks: VPN links, lab calendars, freezer inventory spreadsheets,
        manuscript drafts, and so on. Each card holds a URL plus a label so
        you can jump straight to the resource.
      </p>
      <p>
        The surface name is account-type-conditional: solo accounts see{" "}
        <strong>Links</strong>; lab accounts see <strong>Lab Links</strong>, a
        shared tab visible to everyone in the lab. Saying yes to Q7 adds the
        tab and fires the <code>links</code> conditional walkthrough later in
        Phase 2.
      </p>

      <h2>Phase 2: walkthrough on your real account</h2>
      <p>
        This is where the tour starts touching real data. BeakerBot guides you
        through a universal sequence covering the major surfaces (Home, Project,
        Workbench, Hybrid Editor, Gantt, Settings, Search, Wiki), followed by
        four conditional clusters that fire only when the corresponding Q answer
        was <strong>yes</strong>.
      </p>

      <h3>Universal sequence: major surface tour</h3>

      <h4>Home + first project</h4>
      <Steps>
        <Step>
          <strong>home-create-project.</strong> BeakerBot highlights the Create
          Project button. You click to open the form.
        </Step>
        <Step>
          <strong>home-create-project-fill.</strong> BeakerBot types a
          placeholder project name, demos the color and seven-day-week toggles,
          and clicks Create. The project lands in your Workbench.
        </Step>
      </Steps>

      <h4>Project overview</h4>
      <p>
        The project page is where every experiment, method, and task you
        attach to a project comes back together in one view. The Overview
        box at the top is yours to fill in (hypothesis, motivation, why
        this project exists); the Results, Methods, and Activity sections
        below fill themselves in automatically as you work. This cluster
        introduces both halves before handing the canvas back to you.
      </p>
      <Steps>
        <Step>
          <strong>project-overview-nav.</strong> Cursor clicks the new project
          card on Home and the controller navigates to the project route.
        </Step>
        <Step>
          <strong>project-overview-prose.</strong> BeakerBot introduces the
          four sections of the project page and explains the Overview box as
          the anchor you come back to when you are deep in the weeds.
          Narration only, manual advance.
        </Step>
        <Step>
          <strong>project-overview-rollup.</strong> Spotlight shifts to the
          Results, Methods, and Activity sections below the Overview
          textarea. BeakerBot explains that this page is a live roll-up of
          everything happening across the project: drop an image in any
          experiment&apos;s Results tab and it shows up here, attach a method
          to an experiment and it lands here too. You never curate this page
          by hand.
        </Step>
        <Step>
          <strong>project-overview-typing-demo.</strong> Cursor types a
          placeholder hypothesis into the Overview textarea so you can see
          how the live render lands.
        </Step>
        <Step>
          <strong>project-overview-context.</strong> BeakerBot points at the
          sticky project top-bar and narrates the metadata strip (name, tags,
          action icons) so you know where a project&apos;s shape lives at a
          glance. Pure narration, manual advance.
        </Step>
        <Step>
          <strong>project-overview-exit.</strong> Cursor glides to the Home nav
          tab and the controller navigates back to <code>/</code> so the next
          cluster fires from Home, not from inside the project page. The
          speech is dynamic: off-home users get a "let me take us back home"
          beat, already-home users get a straight "let me show you your
          dashboard" beat.
        </Step>
      </Steps>

      <h4>Home widgets</h4>
      <p>
        New accounts land on Home with two default widgets pre-pinned:
        Upcoming tasks and Today&apos;s events. This cluster teaches the
        canvas itself, that each tile is a snapshot that expands into a
        full popup, and that the layout is per-user.
      </p>
      <Steps>
        <Step>
          <strong>home-widgets-canvas-intro.</strong> Spotlight on the whole
          widget canvas while BeakerBot explains that Home is a per-user
          dashboard.
        </Step>
        <Step>
          <strong>home-widgets-tile-anatomy.</strong> Cursor clicks a tile,
          its popup opens, you read a beat, the cursor dismisses the popup.
        </Step>
        <Step>
          <strong>home-widgets-add.</strong> Cursor clicks &quot;+ Add
          widget&quot;, the catalog opens, and BeakerBot adds a new tile to
          the canvas.
        </Step>
        <Step>
          <strong>home-widgets-reorder.</strong> Cursor drags one tile to a
          different slot so you can see the layout shift live.
        </Step>
        <Step>
          <strong>home-widgets-exit.</strong> Cursor pulls toward the
          notifications bell, telegraphing the next section.
        </Step>
      </Steps>

      <h4>Notifications</h4>
      <p>
        Two surfaces live in the top bar: the bell (anything that needs
        your attention: reminders for upcoming work, updates from
        labmates, mentions on your writeups) and the inbox next to it
        (files sent in from outside the app, like Telegram photos or
        shared attachments). The notifications cluster frames both before
        walking through the bell mechanics.
      </p>
      <Steps>
        <Step>
          <strong>notifications-intro.</strong> Pure narration. BeakerBot
          frames the bell-and-inbox pair in the top bar so you know what
          each one collects before you click on either. Manual advance.
        </Step>
        <Step>
          <strong>notifications-bell.</strong> BeakerBot fires a test
          notification, then asks you to click the bell to open the inbox
          popup.
        </Step>
        <Step>
          <strong>notifications-silence.</strong> Click the row or the Mark
          read button to clear the badge without deleting the message.
        </Step>
        <Step>
          <strong>notifications-delete.</strong> Click the X to dismiss the
          row entirely. The inbox is now empty.
        </Step>
      </Steps>

      <h4>Methods deep-dive</h4>
      <p>
        Methods are your reusable protocol library: write a technique
        once here, then attach it to every experiment that uses it
        instead of rewriting steps each time. BeakerBot walks through
        category creation, then opens two purpose-built builders (PCR
        and LC Gradient) before showing the standard markdown method
        you will reach for most of the time.
      </p>
      <Steps>
        <Step>
          <strong>methods-category-prompt.</strong> BeakerBot asks what kind of
          technique you run (interactive picker, your answer shapes the
          demo&apos;s framing).
        </Step>
        <Step>
          <strong>methods-category-open.</strong> You click &quot;+ New
          Category&quot; to open the modal. Wrong clicks elsewhere on the
          page get a flash and a nudge back to the right button.
        </Step>
        <Step>
          <strong>methods-category.</strong> Cursor types the picked label and
          clicks Create Empty.
        </Step>
        <Step>
          <strong>methods-open-picker.</strong> Cursor clicks &quot;+ New
          Method&quot; so the method builder modal mounts before the next beat.
        </Step>
        <Step>
          <strong>methods-type-tour.</strong> Cursor opens the PCR thermal-cycle
          builder, makes two live edits (denaturation temp, annealing time),
          then invites you to poke around. Manual advance routes to the LC
          Gradient demo next.
        </Step>
        <Step>
          <strong>methods-lc-demo.</strong> Cursor opens the LC Gradient
          editor. The chart updates live as values change in the table,
          which is the whole point: a purpose-built UI beats a wall of
          markdown for any technique where the geometry of the recipe is
          itself the recipe.
        </Step>
        <Step>
          <strong>methods-create.</strong> BeakerBot creates a funny placeholder
          markdown method of its own as a demo artifact. Markdown is the
          fallback any time the technique does not have a purpose-built
          builder.
        </Step>
      </Steps>

      <h4>Workbench experiment creation</h4>
      <p>
        Methods are the recipe; the Workbench is where you actually run
        them. Every experiment gets its own entry with space for notes,
        results, attached protocols, and files. This is the page you
        spend most of your time on, so BeakerBot folds the page intro
        directly into the single create-experiment beat.
      </p>
      <Steps>
        <Step>
          <strong>workbench-create-experiment-open.</strong> Combined beat:
          BeakerBot frames the Workbench-as-bench-record, then asks you to
          click &quot;+ New Experiment.&quot; The form opens, you fill it in,
          and the experiment lands on the page. (The prior split
          BEAKERBOT_DEMO follow-up that auto-typed the experiment name is
          retired.)
        </Step>
      </Steps>

      <h4>Method attachment</h4>
      <Steps>
        <Step>
          <strong>experiment-attach-method-open.</strong> Cursor clicks the
          Workbench row to open the experiment popup.
        </Step>
        <Step>
          <strong>experiment-attach-method-tab.</strong> Cursor clicks the
          Methods tab inside the popup.
        </Step>
        <Step>
          <strong>experiment-attach-method-attach.</strong> Cursor clicks Attach
          and picks BeakerBot&apos;s placeholder method.
        </Step>
        <Step>
          <strong>experiment-attach-method-notes.</strong> Cursor types a
          variation note into the popup. BeakerBot narrates the mental model
          (methods are the protocol template; notes are the per-run delta).
        </Step>
      </Steps>

      <h4>Hybrid editor (13-step cluster)</h4>
      <p>
        The hybrid editor cluster walks you through the experiment note
        editor in thirteen beats. The arc starts with a framing pair
        (notes-vs-results split, then a one-beat scope note that the
        editor is the same one used everywhere in the app), then drops
        into the markdown deep-dive (HE-1 through HE-7) and the image
        and file attachment beats (HE-8 through HE-11):
      </p>
      <Steps>
        <Step><strong>HE-0 (hybrid-notes-vs-results).</strong> BeakerBot explains the notes/results split in the editor.</Step>
        <Step>
          <strong>hybrid-editor-scope.</strong> Pure narration that calls out
          that the editor you are about to learn is the same one used in
          project overviews, standalone notes, and method writeups. Establishes
          scope before the markdown deep-dive starts. Manual advance.
        </Step>
        <Step><strong>HE-1 (hybrid-markdown-intro).</strong> Introduces markdown support.</Step>
        <Step>
          <strong>HE-2 (hybrid-markdown-familiarity).</strong> Branch gate: BeakerBot asks
          whether you want a markdown overview or want to jump straight to the hands-on
          mechanic. Your pick routes either to HE-3 (overview) or directly to HE-4
          (mechanic). This choice is not persisted to your sidecar.
        </Step>
        <Step><strong>HE-3 (hybrid-markdown-overview).</strong> Conditional on the overview branch. General markdown primer. Skipped entirely if you picked Jump in.</Step>
        <Step><strong>HE-4 (hybrid-editor-mechanic).</strong> BeakerBot explains the source/preview split mechanic.</Step>
        <Step><strong>HE-5a (hybrid-bold).</strong> Cursor demos <Kbd>Cmd+B</Kbd> bold.</Step>
        <Step><strong>HE-5b (hybrid-italic).</strong> Cursor demos <Kbd>Cmd+I</Kbd> italic.</Step>
        <Step><strong>HE-5c (hybrid-underline).</strong> Cursor demos underline shortcut.</Step>
        <Step><strong>HE-6a (hybrid-h1).</strong> Cursor demos Heading 1.</Step>
        <Step><strong>HE-6b (hybrid-h2).</strong> Cursor demos Heading 2.</Step>
        <Step><strong>HE-6c (hybrid-h3).</strong> Cursor demos Heading 3.</Step>
        <Step><strong>HE-7 (hybrid-shortcuts).</strong> User-action: you try a shortcut yourself. Page lock active while the input is waiting.</Step>
        <Step><strong>HE-8 (hybrid-image-attach).</strong> User-action: you drag an image file from your computer into the editor. Page lock active while the input is waiting.</Step>
        <Step><strong>HE-9 (hybrid-image-drag-in).</strong> Cursor drags an image into the editor.</Step>
        <Step><strong>HE-10 (hybrid-image-resize).</strong> Cursor demos resizing the inserted image.</Step>
        <Step><strong>HE-11 (hybrid-file-attach).</strong> Terminal hybrid editor beat: file attachment demo.</Step>
      </Steps>

      <Screenshot
        src="/wiki/screenshots/onboarding-w5-hybrid-editor-typing.png"
        alt="A step in the hybrid editor cluster showing the live-typing demo. A preview pane displays markdown source with rendered output. BeakerBot's speech bubble narrates from the upper-left."
        caption="The hybrid editor cluster walks all twelve formatting beats. Click Got it, next when each demo finishes."
      />

      <h4>Workbench notes and lists (5 steps)</h4>
      <p>
        After the hybrid editor cluster, BeakerBot introduces the standalone
        Notes and Lists panels on the Workbench:
      </p>
      <Steps>
        <Step>
          <strong>workbench-notes-intro.</strong> BeakerBot distinguishes
          experiment-scoped notes (what you just used) from general notes that
          don&apos;t belong to any one experiment. Explains single notes vs.
          running logs. Cursor clicks the Notes tab.
        </Step>
        <Step>
          <strong>workbench-notes-create.</strong> Cursor glides to &quot;+ New
          Note,&quot; clicks it, then programmatically spawns a demo conference-
          takeaway note with lab-recipe markdown (headings, bullets, bold) so
          you see the editor you just used in a free-standing note context.
        </Step>
        <Step>
          <strong>workbench-lists-intro.</strong> Cursor clicks the Lists tab.
          BeakerBot explains lists as checklist tasks without method or results
          sections: the lighter cousin of an experiment. Good for grocery runs,
          reagent restocks, daily to-dos.
        </Step>
        <Step>
          <strong>workbench-list-create-shell.</strong> Combined beat: cursor
          ensures the Lists tab is active, clicks &quot;+ New List Task,&quot;
          spawns the shell, expands the card, and types three items (coffee
          beans, filter papers, grinder) into the inline Add-item input. One
          continuous cursor script.
        </Step>
        <Step>
          <strong>workbench-list-mark-done.</strong> Cursor checks one sub-task
          checkbox, then clicks the parent task&apos;s mark-complete button.
          BeakerBot explains why marking the whole list complete matters: it
          drops out of the active Overdue/Doing/Upcoming buckets.
        </Step>
      </Steps>

      <h4>Gantt deep-dive</h4>
      <p>
        Six universal beats teach core Gantt mechanics. Lab accounts see an
        additional seven-beat share-feature cluster:
      </p>
      <Steps>
        <Step><strong>gantt-intro.</strong> BeakerBot explains what a Gantt chart is in this context.</Step>
        <Step><strong>gantt-existing-experiment.</strong> BeakerBot spotlights the experiment you already created on your Gantt timeline.</Step>
        <Step><strong>gantt-drag-drop.</strong> Cursor drags the experiment bar to reschedule it. BeakerBot narrates the date-shift.</Step>
        <Step><strong>gantt-deps-beakerbot.</strong> BeakerBot wires a fake experiment A as a dependency of your experiment.</Step>
        <Step><strong>gantt-deps-user.</strong> User-action: you wire fake experiment B as another dependency. Page lock active.</Step>
        <Step><strong>gantt-deps-cascade.</strong> BeakerBot moves the head dependency; the cascade shift fires across the downstream chain.</Step>
      </Steps>

      <p>
        <strong>Lab accounts only</strong> (gated on Q1 = lab): seven share-feature beats follow the universal arc:
      </p>
      <Steps>
        <Step><strong>gantt-share-intro.</strong> BeakerBot explains cross-lab experiment sharing: both people see the task on Gantt and task lists; only the creator can delete it; permissions are edit or read-only.</Step>
        <Step><strong>gantt-share-beakerbot-spawn.</strong> BeakerBot spawns a temporary second lab account (itself, tagged <code>is_tutorial: true</code>) and creates a &quot;Make some coffee together&quot; experiment.</Step>
        <Step><strong>gantt-share-beakerbot-shares.</strong> BeakerBot&apos;s account shares the coffee experiment with you. It appears on your Gantt.</Step>
        <Step><strong>gantt-share-user-explores.</strong> User-action: you open the shared experiment popup to explore it. Page lock active.</Step>
        <Step><strong>gantt-share-user-shares-back.</strong> User-action: you share one of your own experiments back with BeakerBot. Page lock active.</Step>
        <Step><strong>gantt-share-profile-switch.</strong> BeakerBot performs a real (or faked) profile switch to show the BeakerBot-account perspective.</Step>
        <Step><strong>gantt-share-user-sees-edit.</strong> User-action: open the shared experiment popup to read BeakerBot&apos;s variation note. Page lock active.</Step>
      </Steps>

      <p>
        <strong>Goals overview</strong> (gated on Q4 = yes): a single{" "}
        <code>gantt-goals-overview</code> step fires after the share cluster and
        explains the Goals overlay on the Gantt toolbar.
      </p>

      <h4>Settings deep-dive (13 steps)</h4>
      <p>
        Settings is the last stop on the universal arc. BeakerBot opens
        with a narration beat that establishes scope (everything about
        the account: appearance, visible tabs, integrations, the AI
        Helper prompt, and the re-run button), then walks two
        personalization beats on the Gantt toolbar, seven Settings-page
        narration beats, and a four-beat AI Helper cluster:
      </p>
      <Steps>
        <Step>
          <strong>settings-intro.</strong> Pure narration. BeakerBot frames
          the whole Settings phase: this is where everything about your
          account lives, and the tour will hit the sections worth knowing
          about so you can find the rest on your own. Manual advance.
        </Step>
        <Step><strong>personalization-animations.</strong> Animated on the Gantt toolbar: BeakerBot demos the animations toggle that fires when you finish an experiment.</Step>
        <Step><strong>personalization-color.</strong> BeakerBot demos the primary accent color picker and invites you to pick a secondary color at your own pace.</Step>
        <Step><strong>settings-tour-folder.</strong> Universal: explains that the connected lab folder is set; switching folders means signing out and picking a new one from the entry screen.</Step>
        <Step><strong>settings-tour-calendar.</strong> Conditional on Q3 = yes: calendar feeds are managed from the Calendar tab, not Settings (yet).</Step>
        <Step><strong>settings-tour-telegram.</strong> Conditional on Q5 = yes: Telegram wiring lives in this Settings section if you didn&apos;t link it during setup.</Step>
        <Step><strong>settings-tour-account-type-toggle.</strong> Conditional on Q1 = solo: explains how to pivot from solo to a lab account via the user picker (no dedicated Settings toggle yet).</Step>
        <Step><strong>settings-tour-visible-tabs.</strong> Universal: tabs you said no to are hidden; check the box here to turn one back on, or hide tabs you don&apos;t need.</Step>
        <Step><strong>settings-tour-streak.</strong> Universal: the streak counter is private and on by default; toggle it off here if you prefer not to be reminded.</Step>
        <Step><strong>settings-tour-rerun.</strong> Universal: BeakerBot points at the Re-run tour button and tells you the whole walkthrough can be replayed from here.</Step>
        <Step><strong>ai-helper-size-diff (conditional on Q6).</strong> First AI Helper beat. Explains the economic motivation behind size tradeoffs: external models charge by tokens, so the AI Helper sizes its system prompt to match how much you are willing to spend per chat.</Step>
        <Step><strong>ai-helper-size-options (conditional on Q6).</strong> Cursor cycles through the Full, Medium, and Minimal tabs in the AI Helper section so you see each one render in place. Full gives the model everything it could want; Minimal strips down to essentials; Medium sits in between.</Step>
        <Step><strong>ai-helper-use-case-paste (conditional on Q6).</strong> Paste-and-go use case walkthrough.</Step>
        <Step><strong>ai-helper-use-case-agentic (conditional on Q6).</strong> Agentic use-case walkthrough.</Step>
      </Steps>

      <h4>Search</h4>
      <p>
        <strong>search-demo.</strong> BeakerBot opens the Search tab and
        live-types a query that matches the experiment you created earlier.
        The highlighted result lands in the list.
      </p>

      <h4>Wiki pointer (4-beat cluster)</h4>
      <p>
        The final universal cluster introduces the <code>?</code> help icon in
        the top-right of the AppShell:
      </p>
      <Steps>
        <Step>
          <strong>wiki-pointer-intro.</strong> Speech-only. BeakerBot mentions
          that there is a wiki with detailed documentation of every page in the
          app. Manual advance.
        </Step>
        <Step>
          <strong>wiki-pointer-icon-spotlight.</strong> Spotlight on the{" "}
          <code>?</code> icon in the top bar. BeakerBot tells you what it does.
          Manual advance.
        </Step>
        <Step>
          <strong>wiki-pointer-click-demo.</strong> Cursor clicks the{" "}
          <code>?</code> icon; the app navigates to the matching wiki page for
          the current route. Manual advance.
        </Step>
        <Step>
          <strong>wiki-pointer-back-demo.</strong> On the wiki page, cursor
          clicks the <strong>Back to app</strong> button in the slim wiki top
          bar to navigate back. Manual advance. The tour controller survives
          the round trip because the wiki layout re-mounts the tour provider.
        </Step>
      </Steps>

      <h3>Conditional walkthroughs (Phase 2b)</h3>
      <p>
        Four conditional clusters fire after the wiki-pointer cluster. Each
        cluster gates on the matching Q answer being <strong>yes</strong>:
      </p>
      <ul>
        <li>
          <strong>Telegram</strong> (Q5 = yes). The <code>telegram</code> step
          covers the inline pairing flow and a quick demo of sending an image
          from Telegram and watching it appear in your image inbox.
        </li>
        <li>
          <strong>Purchases</strong> (Q2 = yes). An eight-step cluster in two
          phases. Phase 1 teaches on your empty page: intro, create-button
          click, form fill, autocomplete demo. Phase 2 warps into a read-only
          viewer over Alex&apos;s demo account to show the analytics surface,
          then navigates back.
        </li>
        <li>
          <strong>Calendar</strong> (Q3 = yes). The <code>calendar</code> step
          covers the inline calendar-feed subscribe flow. The new feed appears
          in the Calendar tab when you click Next.
        </li>
        <li>
          <strong>Links / Lab Links</strong> (Q7 = yes). The <code>links</code>{" "}
          step walks the bookmark tab: adding a card with a URL and label,
          understanding the difference between personal Links (solo) and shared
          Lab Links (lab).
        </li>
      </ul>

      <Callout variant="info" title="The retired Lab Mode tour cluster">
        Lab Mode has been retired in favor of the per-user{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        (PIs) and{" "}
        <Link href="/wiki/features/home">Home canvas</Link> (members); the
        PI cluster that runs in its place introduces the Lab
        Overview dashboard, the announcement surface, and the soft-write
        affordances. A single <code>lab-cleanup</code> step still runs at
        the end to wipe the BeakerBot fake user that was spawned during
        the Gantt share cluster. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the data-side retirement story.
      </Callout>

      <h2>Terminal step: tour-goodbye</h2>
      <p>
        The final step is <code>tour-goodbye</code>. BeakerBot says{" "}
        &quot;You&apos;re set! Here&apos;s to many great experiments ahead.&quot;
        and presents a single <strong>Let&apos;s go</strong> button.
      </p>
      <p>
        Clicking <strong>Let&apos;s go</strong> triggers the outro:
      </p>
      <ol>
        <li>A full-screen overlay mounts. BeakerBot cheers and confetti fires (~1.8 s).</li>
        <li>BeakerBot shifts to waving pose and translates off-screen (~1.8 s).</li>
        <li>The overlay fades out (~0.8 s). The route lands on <code>/</code>.</li>
        <li>Auto-cleanup runs silently in the background, removing demo artifacts and leaving your first real project intact.</li>
        <li>A small toast in the lower-right reads &quot;Tour complete. Find BeakerBot again in Settings &rarr; Onboarding.&quot; It auto-dismisses after 4 s.</li>
      </ol>
      <p>
        Clicking <strong>I&apos;ve got it from here</strong> at any earlier step
        skips the intervening steps and jumps directly to{" "}
        <code>tour-goodbye</code>.
      </p>

      <h2>BeakerBot, the character</h2>
      <p>
        BeakerBot is the canonical ResearchOS mascot: a sky-blue chemistry
        beaker with pastel-rainbow liquid, dot eyes, and measurement-mark cheek
        dashes. The voice is funny and playful throughout. The tour draws from
        nine or more poses, chosen contextually:
      </p>
      <ul>
        <li><strong>Idle</strong>, the always-on baseline bob.</li>
        <li><strong>Waving</strong>, the welcome screen and the resume modal.</li>
        <li><strong>Thinking</strong>, head-tilt during setup Q1 to Q7 and the PI prompt.</li>
        <li><strong>Pointing</strong>, universal walkthrough steps where BeakerBot directs your attention to a UI element at eye level.</li>
        <li><strong>Pointing-up</strong>, steps where BeakerBot directs attention to the top bar (the <code>?</code> wiki icon cluster).</li>
        <li><strong>Typing</strong>, steps where BeakerBot live-types into a form or field.</li>
        <li><strong>Typing-on-laptop</strong>, a one-hand typing variant used on notes and list creation beats.</li>
        <li><strong>Cheering</strong>, the tour-goodbye outro animation.</li>
        <li><strong>Bouncing</strong>, a ~650 ms burst on every step transition.</li>
      </ul>

      <h2>Behavior contracts</h2>

      <h3>I&apos;ve got it from here</h3>
      <p>
        A persistent link in the footer of every step. Click it, confirm in the
        sub-modal, and BeakerBot jumps to <code>tour-goodbye</code>. The run
        gets recorded as a skip rather than a completion, so re-running from
        Settings still works.
      </p>

      <h3>Skip this step (individual)</h3>
      <p>
        Each step (after the intro) has a <strong>Skip this step</strong> link.
        If a later step depends on the artifact this step creates, BeakerBot
        silently creates a placeholder version with{" "}
        <code>cleanup_default: &quot;discard&quot;</code>.
      </p>

      <h3>Mid-walkthrough close</h3>
      <p>
        Closing the tab partway through writes the current step plus every
        artifact created so far into{" "}
        <code>_onboarding.json.wizard_resume_state</code>. The next time you
        open ResearchOS with this folder, a small modal asks:
      </p>
      <ul>
        <li><strong>Resume</strong>, mount the tour at the saved step with every artifact and feature-pick intact.</li>
        <li><strong>Restart</strong>, wipe <code>wizard_resume_state</code> and <code>feature_picks</code> so Q1 through Q7 run fresh, start at welcome.</li>
        <li><strong>Discard</strong>, set <code>wizard_skipped_at</code>, clear resume state and feature picks. The tour exits. Settings re-run is the only path back.</li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/onboarding-resume-modal.png"
        alt="The Resume modal showing three buttons: a sky-blue Resume button on the right, a Restart button, and an outlined Discard button on the left. BeakerBot waves from the upper-left."
        caption="The Resume modal. Fires on next open when wizard_resume_state is non-null and the saved step is past welcome."
      />

      <h3>Re-running from Settings</h3>
      <p>
        Clicking <strong>Re-run tour</strong> in{" "}
        <strong>Settings &gt; Onboarding</strong> performs an inline{" "}
        <code>patchOnboarding</code> that clears{" "}
        <code>wizard_completed_at</code>, <code>wizard_skipped_at</code>,{" "}
        <code>wizard_resume_state</code>, <code>feature_picks</code>,{" "}
        <code>wizard_force_show</code>, <code>lab_tour_pending</code>, and{" "}
        <code>lab_tour_dismissed_at</code> in a single write. The controller
        then calls <code>tourController.start()</code> to re-mount the tour in
        place. No page reload.
      </p>

      <h2>How feature picks change which tabs you see</h2>
      <p>
        Your Q1 through Q7 answers determine the visible-tab set through two
        helpers in{" "}
        <code>frontend/src/lib/onboarding/feature-picks-tabs.ts</code>:
      </p>
      <ul>
        <li>
          <code>tabsForFeaturePicks()</code> maps your picks to a canonical list
          of tab hrefs.
        </li>
        <li>
          <code>deriveVisibleTabs()</code> composes that list with the{" "}
          <code>visibleTabs</code> array in <code>settings.json</code>.
        </li>
      </ul>
      <p>
        The rules:
      </p>
      <ul>
        <li><strong>Always visible:</strong> Home, Workbench, Methods, Experiments, Gantt, Search.</li>
        <li><strong>Lab Overview</strong> appears only when <code>account_type === &quot;lab_head&quot;</code> (the PI dashboard at <code>/lab-overview</code>).</li>
        <li><strong>Purchases</strong> appears only when <code>purchases === &quot;yes&quot;</code>.</li>
        <li><strong>Calendar</strong> appears only when <code>calendar === &quot;yes&quot;</code>.</li>
        <li><strong>Goals</strong> appears only when <code>goals === &quot;yes&quot;</code>.</li>
        <li><strong>Telegram</strong> (the notifications inbox surface) appears only when <code>telegram === &quot;yes&quot;</code>.</li>
        <li>
          <strong>Links / Lab Links</strong> appears only when{" "}
          <code>links === &quot;yes&quot;</code>. Solo accounts see the tab
          labeled <strong>Links</strong>; lab accounts see{" "}
          <strong>Lab Links</strong>.
        </li>
      </ul>
      <p>
        Settings can manually <strong>hide</strong> a tab that the picks would
        otherwise show. Settings cannot <strong>unhide</strong> a tab that the
        picks excluded. To get a hidden tab back, re-run the tour and flip the
        matching Q answer, or toggle it on directly in{" "}
        <strong>Settings &gt; Onboarding &gt; Visible tabs</strong>.
      </p>

      <Callout variant="tip" title="Power-user shortcut: ?wizard-preview=1">
        Developers and demo-givers can append <code>?wizard-preview=1</code> to
        any URL to force-mount the tour against the current sidecar state. The
        session also activates when the sticky sessionStorage key{" "}
        <code>researchos:v4-preview-active</code> is set to{" "}
        <code>&quot;1&quot;</code>, which persists the preview mode across
        in-app navigations that strip the query string. Use either path together
        with <code>?wikiCapture=1</code> to drive the tour against the wiki
        fixture for screenshot captures.
      </Callout>

      <h2>Dev affordances: the BeakerBot button</h2>
      <p>
        In development builds, a small BeakerBot button sits in the
        bottom-right floating cluster alongside the data-folder and switch-user
        controls. Clicking it opens a dropdown with three escape hatches for
        driving the tour without walking it from scratch. The whole control is
        gated on{" "}
        <code>process.env.NODE_ENV === &quot;development&quot;</code>, so
        production builds drop it as dead code.
      </p>
      <p>
        The three actions are:
      </p>
      <ul>
        <li>
          <strong>Mount at step.</strong> Pick any v4 step ID from the dropdown
          (every node in <code>TOUR_STEP_ORDER</code> — the full 91-step graph
          from <code>welcome</code> through <code>tour-goodbye</code>) and click{" "}
          <strong>Mount wizard at this step</strong>. The orchestrator writes a
          resume_state pointing at your pick, flips the force-show flag on the
          current user&apos;s sidecar, and reloads. The tour re-mounts at the
          chosen step with every prior artifact intact. Useful for QA on a
          specific step body or for staging a screenshot capture at an arbitrary
          point in the flow.
        </li>
        <li>
          <strong>Reset wizard state.</strong> Clears{" "}
          <code>wizard_completed_at</code>, <code>wizard_skipped_at</code>,{" "}
          <code>wizard_resume_state</code>, <code>wizard_force_show</code>, and{" "}
          <code>feature_picks</code> on the current user&apos;s sidecar, then
          reloads. The tour fires from the intro on next mount, identical to a
          brand-new user. Faster than deleting the JSON by hand when iterating
          on step bodies.
        </li>
        <li>
          <strong>Test-N sandbox.</strong> The third row,{" "}
          <strong>Show welcome wizard (creates Test user)</strong>, spawns a
          throwaway <code>Test-N</code> user (auto-incrementing N),
          force-shows the wizard on that user&apos;s sidecar, and swaps the
          active user. The sandbox user is real (it lives in{" "}
          <code>_user_metadata</code> and writes to disk), but it never touches
          the seen-once state on your primary account. Useful for capturing
          fresh-user screenshots or for stress-testing the wizard without
          disturbing the account you actually use.
        </li>
      </ul>
      <Callout variant="warning" title="Development builds only">
        The BeakerBot button never renders in production. It is also a no-op in
        demo and wiki-capture mode because the orchestrator is not mounted
        there. If you need to drive the tour in fixture mode, use the URL flag
        combo (<code>?wikiCapture=1&amp;wizard-preview=1</code>) instead.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          To re-run the tour or trim your visible tabs, see{" "}
          <Link href="/wiki/features/settings">Settings</Link>.
        </li>
        <li>
          For the Lab Overview dashboard that the PI cluster
          introduces, see{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>.
        </li>
        <li>
          For a hands-on tour against seeded data (no real folder needed), see{" "}
          <Link href="/demo">/demo</Link>.
        </li>
        <li>
          For how projects work after BeakerBot leaves, see{" "}
          <Link href="/wiki/features/projects">Project Surface</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
