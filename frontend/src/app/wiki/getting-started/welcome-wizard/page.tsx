import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function WelcomeWizardPage() {
  return (
    <WikiPage
      intro="BeakerBot's welcome tour was a guided walkthrough on your real account. It opened with a short setup Q&A, then dropped you into a live tour that helped you create your first project, method, and experiment right in the app. The tour has been retired (it asked for too much hand-holding and a few of the surfaces it walked drifted out from under it), so fresh accounts no longer launch it. This page documents how it worked and what replaced the pieces that still matter, like your visible tabs. A simpler awareness-first walkthrough will take its place."
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
        Three things are true about every run.
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
        ResearchOS used to ship a different welcome wizard, a seven-step modal
        that asked which use-case you fit into and toggled tabs from a static
        map. That version has been retired. BeakerBot&apos;s tour now walks you
        through your own account instead of front-loading taxonomy questions.
      </Callout>

      <Callout variant="info" title="This is not the 3-minute walkthrough on the connect screen">
        One quick thing to keep separate. The folder-connect screen (before you
        connect a folder) shows a small{" "}
        <strong>Take the 3-minute walkthrough</strong>{" "}
        button next to BeakerBot in the upper-right. That is a separate, opt-in
        4-beat modal that introduces ResearchOS at a high level (welcome, data
        security, folder choice, cloud provider). It runs <em>before</em>{" "}
        you commit to connecting a folder, never writes to disk, and closes back
        to the connect screen. The longer tour described on this page is the
        in-product BeakerBot tour that auto-fires <em>after</em> you sign in to
        a fresh user account. See{" "}
        <Link href="/wiki/getting-started/connecting-your-folder">
          Connecting Your Folder
        </Link>{" "}
        for the connect-screen walkthrough.
      </Callout>

      <h2>Who sees the tour</h2>
      <p>
        Nobody, by default. The auto-fire path is off, so a fresh account
        lands straight on the normal empty state with no tour, no banner, and
        no nag. The rest of this page describes how the tour behaved while it
        was live, kept for reference and for the parts that still ship (the
        setup questions used to seed your visible tabs).
      </p>

      <Callout variant="info" title="A new onboarding wizard is coming">
        A simpler, account-gated BeakerBot-guided first-run experience is being
        built behind the <code>NEXT_PUBLIC_ONBOARDING_WIZARD</code> flag (off by
        default). It replaces the full tour described on this page with a
        deterministic step machine and an LLM-powered skin, includes ephemeral
        demo seeding, a capped AI token meter, and branching by area of interest.
        When the flag is on, a fresh account triggers the new wizard instead of
        the retired tour. The flag is not live in production yet.
      </Callout>

      <h2>Phase 1, setup questions</h2>
      <p>
        The first few minutes are a short Q&amp;A that BeakerBot uses to shape
        the rest of the tour and which tabs appear in your sidebar. Every
        question is a radio pick with a sensible default if you click{" "}
        <strong>Skip this step</strong>.
      </p>

      <h3>Q1, solo or lab?</h3>
      <p>
        The first call is whether you are flying solo (one user, your own
        account) or running a multi-person lab (everyone points their
        ResearchOS at the same shared folder). The pick determines whether
        the PI follow-up question (Q1c, below) fires.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-q1-account-type.png"
        alt="Q1 in the welcome tour showing two radio cards: Solo (selected) and Lab. BeakerBot stands in the upper-left in thinking pose."
        caption="Q1 picks your account flavor. You can revisit this in Settings."
      />

      <Callout variant="info" title="Q1 auto-skips when other users exist">
        When the lab folder already has other users in it (someone signed in
        before you), the wizard auto-skips Q1 and assumes Lab. If there is
        already a lab to join, you are joining a lab, not
        starting a solo workspace. Q1 still appears for the first user in a
        fresh folder so a single-person workflow stays a deliberate choice.
      </Callout>

      <h3>Q1c, are you the PI?</h3>
      <p>
        Conditional on Q1 = Lab. After picking Lab, BeakerBot follows up with
        a single binary question. Are you the PI, or are you a member?
        Picking <strong>PI</strong> sets{" "}
        <code>account_type</code> to <code>&quot;lab_head&quot;</code> on this
        account. Picking <strong>Member</strong> leaves it at the default. One
        person in the lab fills the PI slot. The picker badge in the
        login screen, the audit log, and the Lab Overview surface are all
        gated on the resulting <code>account_type</code>. See{" "}
        <Link href="/wiki/features/lab-head">PI</Link>.
      </p>

      <h3>Q2 through Q6, feature picks</h3>
      <p>
        Four questions about ResearchOS surfaces and preferences. The
        numbering skips Q5, that slot was retired before launch.
      </p>
      <ul>
        <li><strong>Q2:</strong> Will you track lab purchases? (Yes / No / Maybe later)</li>
        <li><strong>Q3:</strong> Want calendar feeds? (Yes / No / Maybe later)</li>
        <li><strong>Q4:</strong> Want a goal-tracking page? (Yes / No / Maybe later)</li>
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

      <h3>Q7, Links</h3>
      <p>
        The final setup question asks whether you want a tab for saving
        bookmarks, things like VPN links, lab calendars, freezer inventory spreadsheets,
        manuscript drafts, and so on. Each card holds a URL plus a label so
        you can jump straight to the resource.
      </p>
      <p>
        The tab is labeled <strong>Links</strong> for every account type. On a
        lab account it is a shared tab visible to everyone in the lab. Saying
        yes to Q7 adds the tab and fires the <code>links</code> conditional
        walkthrough later in Phase 2.
      </p>

      <h2>Phase 2, walkthrough on your real account</h2>
      <p>
        This is where the tour starts touching real data. BeakerBot walks a
        universal sequence covering the major surfaces (Home, Project,
        Notifications, Workbench, the editor, Methods, Gantt, Settings, Search,
        and the wiki pointer), followed by four conditional clusters that fire
        only when the matching Q answer was <strong>yes</strong>. Search has
        since moved off the top nav into the Cmd-K palette, so the search beat
        below describes a surface you now reach with a keyboard shortcut rather
        than a tab.
      </p>
      <p>
        The walkthrough was deliberately trimmed. Most clusters are pitched at
        awareness now. BeakerBot explains what a surface is for and why you
        would seek it out, lands one or two live examples so the page is not
        empty, then moves on. The aim is to leave you knowing the feature
        exists and what it solves, not to drill every button. A handful of
        beats still hand you a real action (create a project, create an
        experiment, wire a Gantt dependency) so the muscle memory sticks.
      </p>

      <h3>Universal sequence, major surface tour</h3>

      <h4>Home and your first project</h4>
      <p>
        Projects are the top-level container that every experiment, method, and
        task hangs off, so the tour opens by making one. These two beats are
        hands-on. You click and type, because there is no better way to learn
        the create flow than to run it once.
      </p>
      <Steps>
        <Step>
          <strong>home-create-project.</strong> BeakerBot spotlights the New
          Project button on the dashboard toolbar and hands the click to you.
        </Step>
        <Step>
          <strong>home-create-project-fill.</strong> BeakerBot frames the name
          and accent-color fields, you fill them in, and the new project opens
          to its own page. The rest of the walkthrough runs on the project you
          just made.
        </Step>
      </Steps>

      <h4>Project overview</h4>
      <p>
        The project page is where every experiment, method, and task you
        attach to a project comes back together in one view. The Overview
        box at the top is yours to fill in (hypothesis, motivation, why
        this project exists). The Results, Methods, and Activity tabs next
        to it surface automatically once you have something to show, and
        stay hidden while a project is still empty. This single beat
        introduces the Overview box, then hands you off to notifications.
      </p>
      <Steps>
        <Step>
          <strong>project-overview-typing-demo.</strong> A single beat for the
          whole project page. BeakerBot orients you (every experiment, method,
          and task attaches to a project, and this page is where it comes back
          together), notes that the page fills in on its own as you add work,
          and points out that the Overview box up top is the part you write
          yourself. It types a short sample into the Overview field so you can
          see the live render land, then hands off to notifications.
        </Step>
      </Steps>

      <h4>Notifications</h4>
      <p>
        Two surfaces live in the top bar. The bell collects anything that
        needs your attention (reminders for upcoming work, updates from
        labmates, mentions on your writeups), and the inbox next to it
        collects files sent in from outside the app, like photos from a phone
        companion or shared attachments. This cluster was trimmed to two awareness beats.
        The old field-by-field demos for marking a row read and dismissing one
        were cut, since the inbox is self-explanatory once you know it exists.
      </p>
      <Steps>
        <Step>
          <strong>notifications-intro.</strong> The controller routes to your
          Workbench so this beat fires from a real page instead of from inside
          the project. BeakerBot spotlights the bell and frames the
          bell-and-inbox pair so you know what each one collects before you
          touch either. Manual advance.
        </Step>
        <Step>
          <strong>notifications-bell.</strong> BeakerBot fires a test
          notification, then asks you to click the bell to open the inbox. The
          fact that rows can be cleared or dismissed is folded into the speech,
          no separate demo.
        </Step>
      </Steps>

      <h4>Workbench experiment creation</h4>
      <p>
        Methods are the recipe, and the Workbench is where you actually run
        them.
        Every experiment gets its own entry with space for notes, results,
        attached protocols, and files. This is the page you spend most of your
        time on, so the create flow stays hands-on across two beats.
      </p>
      <Steps>
        <Step>
          <strong>workbench-create-experiment-open.</strong> BeakerBot frames
          the Workbench as your bench record, then asks you to click
          &quot;+ New Experiment&quot; to open the form.
        </Step>
        <Step>
          <strong>workbench-create-experiment-submit.</strong> BeakerBot
          spotlights the Create Experiment button and folds the name and
          project guidance into one speech. You fill the form and click Create
          Experiment yourself. The beat waits on the real save, so the
          experiment that lands here is the one the Gantt and method-attach
          beats reuse later.
        </Step>
      </Steps>

      <h4>Open the experiment, meet the Methods tab</h4>
      <p>
        The methods detour is set up with a single framing beat before the
        editor cluster, so you know where reusable protocols get pinned to a
        run before you go build one.
      </p>
      <Steps>
        <Step>
          <strong>experiment-attach-method-open.</strong> A single framing
          beat. BeakerBot opens the experiment popup and points out the Methods
          tab, where reusable protocols get pinned to a run. It does not attach
          anything yet. You build a method first and come back to it after the
          Methods detour below.
        </Step>
      </Steps>

      <h4>The editor (3 beats)</h4>
      <p>
        ResearchOS uses one editor everywhere, in project overviews, standalone
        notes, method writeups, and the experiment notes you are looking at
        now. It is inline-only. You just type and your markdown renders as you
        go, so there is no edit mode to toggle. The old markdown deep-dive
        (a primer plus cursor demos for bold, italics, headings, shortcuts, and
        image and file attachment) and the Focus Mode enter/exit demos were all
        cut once the editor became inline-only. Three awareness beats remain.
      </p>
      <Steps>
        <Step>
          <strong>hybrid-notes-vs-results.</strong> BeakerBot explains the
          notes-versus-results split inside the experiment so you know which
          part of the page is for narrating work and which is for the data.
        </Step>
        <Step>
          <strong>inline-editor.</strong> BeakerBot spotlights the live editor
          surface and teaches the one thing that matters. You type and your
          markdown renders as you go. A <code># </code> starts a heading,{" "}
          <code>**stars**</code> make text bold, and a <code>- </code> begins a
          list. A closing line points at Save checkpoint as the way to drop a
          version you can revert to, and notes that this same editor (plus its
          fullscreen and focus modes) shows up everywhere in the app. Manual
          advance.
        </Step>
        <Step>
          <strong>hybrid-save-concept.</strong> Narration. ResearchOS does not
          auto-save, every save is version-controlled, and leaving with unsaved
          changes warns you first.
        </Step>
      </Steps>

      <h4>Workbench notes and lists (2 beats)</h4>
      <p>
        After the editor, BeakerBot introduces the standalone Notes and Lists
        panels on the Workbench. The cluster was collapsed to two explanation
        beats. The tool is friendly enough that you only need to know what
        notes and lists are, so the three create demos were cut.
      </p>
      <Steps>
        <Step>
          <strong>workbench-notes-intro.</strong> BeakerBot clicks the Notes
          tab and distinguishes experiment-scoped notes from general notes that
          do not belong to any one experiment, and explains single notes versus
          running logs.
        </Step>
        <Step>
          <strong>workbench-lists-intro.</strong> BeakerBot clicks the Lists
          tab and explains a list as checklist tasks without method or results
          sections, the lighter cousin of an experiment. Good for grocery runs,
          reagent restocks, and daily to-dos.
        </Step>
      </Steps>

      <h4>Methods deep-dive (3 beats)</h4>
      <p>
        Methods are your reusable protocol library. Write a technique once
        here, then attach it to every experiment that uses it instead of
        rewriting the steps each time. The cluster was collapsed from five
        beats to three. BeakerBot asks what kind of technique you run, opens
        the New Method picker so you can see the catalog of purpose-built
        builders, then creates a plain markdown method as the fallback. The two
        builder demos that used to drive the PCR thermal-cycle editor and the
        LC gradient chart were cut. The picker still surfaces them for you to
        explore.
      </p>
      <Steps>
        <Step>
          <strong>methods-category-prompt.</strong> BeakerBot asks what kind of
          technique you run (interactive picker). Your pick is filed as the
          folder for your first method a moment later, so categories form
          from real work instead of an empty placeholder.
        </Step>
        <Step>
          <strong>methods-open-picker.</strong> The cursor opens the &quot;+ New
          Method&quot; picker so the catalog of purpose-built builders is
          visible, then stops. You explore the PCR thermal-cycle builder and
          the live LC gradient chart at your own pace. A purpose-built UI beats
          a wall of markdown for any technique where the geometry of the recipe
          is itself the recipe.
        </Step>
        <Step>
          <strong>methods-create.</strong> BeakerBot creates a funny placeholder
          markdown method of its own as a demo artifact. Markdown is the
          fallback any time the technique does not have a purpose-built
          builder.
        </Step>
      </Steps>

      <h4>Method attachment (2 beats)</h4>
      <p>
        Now that a method exists, the tour returns to the experiment to pin it.
        These two beats reopen the experiment popup on its Methods tab and
        teach the mental model. Methods are the protocol template, variation
        notes are the per-run delta.
      </p>
      <Steps>
        <Step>
          <strong>experiment-attach-method-attach.</strong> The beat reopens
          the experiment popup on its Methods tab, then the cursor clicks
          Attach and picks the method BeakerBot just built.
        </Step>
        <Step>
          <strong>experiment-attach-method-notes.</strong> BeakerBot
          spotlights the Variation Notes field and narrates the mental model.
          The method is the protocol template, and the notes are what changed
          for this one run. No typing demo, the spotlight plus explanation is
          enough.
        </Step>
      </Steps>

      <h4>Gantt deep-dive</h4>
      <p>
        Six universal beats teach core Gantt mechanics. Lab accounts see an
        additional six-beat share-feature cluster.
      </p>
      <Steps>
        <Step><strong>gantt-intro.</strong> BeakerBot explains what a Gantt chart is in this context.</Step>
        <Step><strong>gantt-existing-experiment.</strong> BeakerBot spotlights the experiment you already created on your Gantt timeline.</Step>
        <Step><strong>gantt-drag-drop.</strong> Cursor drags the experiment bar to reschedule it. BeakerBot narrates the date-shift.</Step>
        <Step><strong>gantt-deps-beakerbot.</strong> BeakerBot wires a fake experiment A as a dependency of your experiment.</Step>
        <Step><strong>gantt-deps-user.</strong> User-action. You wire fake experiment B as another dependency. Page lock active.</Step>
        <Step><strong>gantt-deps-cascade.</strong> BeakerBot moves the head dependency, and the cascade shift fires across the downstream chain.</Step>
      </Steps>

      <p>
        <strong>Lab accounts only</strong> (gated on Q1 = lab). Six share-feature beats follow the universal arc.
      </p>
      <Steps>
        <Step><strong>gantt-share-intro.</strong> BeakerBot explains cross-lab experiment sharing. Both people see the task on Gantt and task lists, only the creator can delete it, and permissions are edit or read-only.</Step>
        <Step><strong>gantt-share-beakerbot-spawn.</strong> BeakerBot spawns a temporary second lab account (itself, tagged <code>is_tutorial: true</code>), creates a &quot;Make some coffee together&quot; experiment, and shares it with you so it appears on your Gantt.</Step>
        <Step><strong>gantt-share-user-explores.</strong> User-action. You open the shared experiment popup to explore it. Page lock active.</Step>
        <Step><strong>gantt-share-user-shares-back.</strong> User-action. You share one of your own experiments back with BeakerBot (open it, click Share, pick a labmate, choose view or edit, and save). Page lock active.</Step>
        <Step><strong>gantt-share-profile-switch.</strong> BeakerBot performs a real (or faked) profile switch to show the BeakerBot-account perspective.</Step>
        <Step><strong>gantt-share-user-sees-edit.</strong> User-action. Open the shared experiment popup to read BeakerBot&apos;s variation note. Page lock active.</Step>
      </Steps>

      <p>
        <strong>Goals overview</strong> (gated on Q4 = yes). A single{" "}
        <code>gantt-goals-overview</code> step fires after the share cluster and
        explains the Goals overlay on the Gantt toolbar.
      </p>

      <h4>Settings deep-dive (12 steps)</h4>
      <p>
        Settings is the last stop on the universal arc. BeakerBot opens with a
        narration beat that establishes scope (everything about the account,
        from appearance and visible tabs to integrations, the AI Helper prompt,
        and the re-run button), then walks two personalization beats on the
        Gantt toolbar, five Settings-page narration beats, and a four-beat AI
        Helper cluster.
      </p>
      <Steps>
        <Step>
          <strong>settings-intro.</strong> Pure narration. BeakerBot frames the
          whole Settings phase. This is where everything about your account
          lives, and the tour will hit the sections worth knowing about so you
          can find the rest on your own. Manual advance.
        </Step>
        <Step><strong>personalization-animations.</strong> Animated on the Gantt toolbar. BeakerBot demos the animations toggle that fires when you finish an experiment.</Step>
        <Step><strong>personalization-color.</strong> BeakerBot demos the primary accent color picker and invites you to pick a secondary color at your own pace.</Step>
        <Step><strong>settings-tour-folder.</strong> Universal. Explains that the connected lab folder is set, and that switching folders means signing out and picking a new one from the entry screen.</Step>
        <Step><strong>settings-tour-account-type-toggle.</strong> Conditional on Q1 = solo. Explains how to pivot from solo to a lab account via the user picker (no dedicated Settings toggle yet).</Step>
        <Step><strong>settings-tour-visible-tabs.</strong> Universal. Tabs you said no to are hidden; check the box here to turn one back on, or hide tabs you don&apos;t need.</Step>
        <Step><strong>settings-tour-streak.</strong> Universal. The streak counter is private and on by default. Toggle it off here if you prefer not to be reminded.</Step>
        <Step><strong>settings-tour-rerun.</strong> Universal. BeakerBot points at the Re-run tour button and tells you the whole walkthrough can be replayed from here.</Step>
        <Step><strong>ai-helper-size-diff (conditional on Q6).</strong> First AI Helper beat. Explains the economic motivation behind size tradeoffs. External models charge by tokens, so the AI Helper sizes its system prompt to match how much you are willing to spend per chat.</Step>
        <Step><strong>ai-helper-size-options (conditional on Q6).</strong> Cursor cycles through the Full, Medium, and Minimal tabs in the AI Helper section so you see each one render in place. Full gives the model everything it could want, Minimal strips down to essentials, and Medium sits in between.</Step>
        <Step><strong>ai-helper-use-case-paste (conditional on Q6).</strong> Paste-and-go use case walkthrough.</Step>
        <Step><strong>ai-helper-use-case-agentic (conditional on Q6).</strong> Agentic use-case walkthrough.</Step>
      </Steps>
      <Callout variant="info" title="settings-tour-calendar is retired">
        An earlier build had a <code>settings-tour-calendar</code> beat here. It
        was retired because it told you to head over to the Calendar tab while
        the tour page-lock kept you on Settings, so it had nothing actionable to
        say. Calendar feeds are managed from the Calendar tab itself.
      </Callout>

      <h4>Search</h4>
      <p>
        <strong>search-demo.</strong> BeakerBot opens the Search tab and
        live-types a query that matches the experiment you created earlier.
        The highlighted result lands in the list.
      </p>

      <h4>Wiki pointer (2 beats)</h4>
      <p>
        The final universal cluster introduces the <code>?</code> help icon in
        the top-right of the AppShell. It was collapsed from four beats to two.
        The two cursor demos that navigated into the wiki and back were cut for
        a single icon, and the click-and-return behavior folded into the
        icon-spotlight speech as awareness.
      </p>
      <Steps>
        <Step>
          <strong>wiki-pointer-intro.</strong> Speech-only. BeakerBot mentions
          that there is a wiki with detailed documentation of every page in the
          app. Manual advance.
        </Step>
        <Step>
          <strong>wiki-pointer-icon-spotlight.</strong> Spotlight on the{" "}
          <code>?</code> icon in the top bar. BeakerBot tells you what it does
          and that clicking it jumps to the matching wiki page for the current
          route, then drops you back where you were. Manual advance.
        </Step>
      </Steps>

      <h3>Conditional walkthroughs (Phase 2b)</h3>
      <p>
        Four conditional clusters fire after the wiki-pointer cluster. Each
        cluster gates on the matching Q answer being <strong>yes</strong>.
      </p>
      <ul>
        <li>
          <strong>Purchases</strong> (Q2 = yes). An eight-step cluster in two
          phases. Phase 1 teaches on your empty page (intro, create-button
          click, form fill, autocomplete demo). Phase 2 warps into a read-only
          viewer over Alex&apos;s demo account to show the analytics surface,
          then navigates back.
        </li>
        <li>
          <strong>Calendar</strong> (Q3 = yes). The <code>calendar</code> step
          covers the inline calendar-feed subscribe flow. The new feed appears
          in the Calendar tab when you click Next.
        </li>
        <li>
          <strong>Links</strong> (Q7 = yes). The <code>links</code> step walks
          the bookmark tab, adding a card with a URL and label, and notes that
          on a lab account the tab is shared with everyone in the lab.
        </li>
      </ul>

      <Callout variant="info" title="The retired Lab Mode tour cluster">
        Lab Mode has been retired in favor of the per-user{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        (PIs) and{" "}
        <Link href="/wiki/features/home">Home canvas</Link> (members). The
        dedicated PI walkthrough cluster that once ran here was also retired
        ahead of a future rebuild, so there is no separate Lab Overview tour
        today. A single <code>lab-cleanup</code> step still runs at the end to
        wipe the BeakerBot fake user that was spawned during the Gantt share
        cluster. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the data-side retirement story.
      </Callout>

      <h2>Terminal step, tour-goodbye</h2>
      <p>
        The final step is <code>tour-goodbye</code>. BeakerBot says{" "}
        &quot;You&apos;re set! Here&apos;s to many great experiments ahead.&quot;
        and presents a single <strong>Let&apos;s go</strong> button.
      </p>
      <p>
        Clicking <strong>Let&apos;s go</strong> triggers the outro.
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
        BeakerBot is the canonical ResearchOS mascot, a sky-blue chemistry
        beaker with pastel-rainbow liquid, dot eyes, and measurement-mark cheek
        dashes. The voice is funny and playful throughout. The tour draws from
        nine or more poses, chosen contextually.
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
        open ResearchOS with this folder, a small modal gives you three
        options.
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
        <code>frontend/src/lib/onboarding/feature-picks-tabs.ts</code>.
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
        The rules work like this.
      </p>
      <ul>
        <li><strong>Always visible:</strong> Home, Workbench, Gantt, Methods, Sequences. Experiments live under Workbench rather than on their own tab, and Search now lives in the Cmd-K palette instead of the nav.</li>
        <li><strong>Lab Overview</strong> appears only when <code>account_type === &quot;lab_head&quot;</code> (the PI dashboard at <code>/lab-overview</code>).</li>
        <li><strong>Purchases</strong> appears only when <code>purchases === &quot;yes&quot;</code>.</li>
        <li><strong>Calendar</strong> appears only when <code>calendar === &quot;yes&quot;</code>.</li>
        <li><strong>Goals</strong> appears only when <code>goals === &quot;yes&quot;</code>.</li>
        <li>
          <strong>Links</strong> appears only when{" "}
          <code>links === &quot;yes&quot;</code>. The tab is labeled{" "}
          <strong>Links</strong> for every account type. On a lab account it is
          shared with everyone in the lab.
        </li>
      </ul>
      <p>
        Settings can manually <strong>hide</strong> a tab that the picks would
        otherwise show. Settings cannot <strong>unhide</strong> a tab that the
        picks excluded. To get a hidden tab back, re-run the tour and flip the
        matching Q answer, or toggle it on directly in{" "}
        <strong>Settings &gt; Tabs</strong>.
      </p>

      <Callout variant="tip" title="Power-user shortcut, ?wizard-preview=1">
        Developers and demo-givers can append <code>?wizard-preview=1</code> to
        any URL to force-mount the tour against the current sidecar state. The
        session also activates when the sticky sessionStorage key{" "}
        <code>researchos:v4-preview-active</code> is set to{" "}
        <code>&quot;1&quot;</code>, which persists the preview mode across
        in-app navigations that strip the query string. Use either path together
        with <code>?wikiCapture=1</code> to drive the tour against the wiki
        fixture for screenshot captures.
      </Callout>

      <h2>Dev affordances, the BeakerBot button</h2>
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
        There are three actions.
      </p>
      <ul>
        <li>
          <strong>Mount at step.</strong> Pick any v4 step ID from the dropdown
          (every node in <code>TOUR_STEP_ORDER</code>, the full step graph
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
