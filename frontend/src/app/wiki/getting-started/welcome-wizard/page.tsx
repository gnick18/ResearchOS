import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import Kbd from "@/components/wiki/Kbd";

export default function WelcomeWizardPage() {
  return (
    <WikiPage
      intro="BeakerBot's welcome tour is a short, guided walkthrough on your real account. It mixes a brief setup Q&A with an interactive tour that helps you create your first project, method, and experiment right in the live app. Plan on roughly five to ten minutes, depending on which features you opt into."
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
        local-first data folder. Anything BeakerBot helps you make (a sample
        project, a placeholder method, a first experiment) lands on disk just
        like a normal piece of work. At the end you get a checkbox grid where
        you decide what to keep and what to clean up.
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
          BeakerBot drives the pacing with a Next button. You can also click
          <strong> Skip this step</strong> on any individual step, or the
          persistent <strong>I&apos;ve got it from here</strong> link at the
          footer to jump to the final cleanup screen.
        </li>
        <li>
          Closing the tab mid-tour is safe. The next time you open the folder,
          BeakerBot offers <strong>Resume</strong>, <strong>Restart</strong>,
          or <strong>I&apos;m good, call it done</strong>.
        </li>
      </ul>

      <Callout variant="info" title="If you remember the old seven-step modal">
        ResearchOS used to ship a different welcome wizard: a seven-step modal
        that asked which use-case you fit into and toggled tabs from a static
        map. That version has been retired. BeakerBot&apos;s tour now walks you
        through your own account instead of front-loading taxonomy questions.
      </Callout>

      <h2>Who sees the tour</h2>
      <p>
        The tour auto-fires only when three conditions all hold:
      </p>
      <ul>
        <li>The folder has no <code>_user_metadata</code> entry, or the file is empty</li>
        <li>
          There is no <code>_onboarding.json</code> on disk for the active user,
          or the file has no <code>wizard_completed_at</code> and no{" "}
          <code>wizard_skipped_at</code> field
        </li>
        <li>
          The session is not in demo or wiki-capture mode (the dev flag{" "}
          <code>?wizard-preview=1</code> overrides this last rule)
        </li>
      </ul>
      <p>
        Existing users never see the tour automatically. If you signed in
        before BeakerBot existed, your sidecar migrates quietly to the new
        schema with no auto-fire, no banner, no nag.
      </p>
      <p>
        To run the tour after the fact, go to{" "}
        <strong>Settings &gt; Tips</strong> and click{" "}
        <strong>Re-run welcome tour</strong>. The page reloads and BeakerBot
        starts from the intro screen.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-settings-rerun-button.png"
        alt="The Tips section of Settings showing the Re-run welcome tour row with a sky-blue button on the right edge."
        caption="The Re-run welcome tour button on Settings. Clears completion state and reopens BeakerBot at the welcome screen."
      />

      <h2>Phase 1: setup questions</h2>
      <p>
        The first few minutes are a short Q&amp;A that BeakerBot uses to shape
        the rest of the tour. Every question is a radio pick, and every
        question has a sensible default if you click <strong>Skip this step</strong>.
      </p>

      <h3>Q1: solo or lab?</h3>
      <p>
        The first call is whether you are flying solo (one user, your own
        account) or running a multi-person lab (everyone points their
        ResearchOS at the same shared folder). The pick determines whether
        Phase 3 (the Lab Mode tour) ever fires.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-q1-account-type.png"
        alt="Q1 in the welcome tour showing two radio cards: Solo (selected) and Lab. BeakerBot stands in the upper-left in thinking pose."
        caption="Q1 picks your account flavor. You can flip it later in Settings."
      />

      <h3>Q1a / Q1b: lab storage details (lab only)</h3>
      <p>
        If you pick Lab in Q1, BeakerBot adds two short questions. Q1a asks
        where the lab data lives (local disk, Google Drive, OneDrive, Box, or
        figure it out later). Q1b is a single informational screen explaining
        that every lab member points their ResearchOS at the same shared
        folder and the storage provider handles sync. Q1b has no input,
        just context and a link to the shared-lab-accounts wiki section.
      </p>

      <h3>Q2 through Q5: feature picks</h3>
      <p>
        Four binary questions about ResearchOS features:
      </p>
      <ul>
        <li><strong>Q2:</strong> Will you track lab purchases? (Yes / No / Maybe later)</li>
        <li><strong>Q3:</strong> Want calendar feeds? (Yes / No / Maybe later)</li>
        <li><strong>Q4:</strong> Want a goal-tracking page? (Yes / No / Maybe later)</li>
        <li><strong>Q5:</strong> Want a Telegram bot for image inbox? (Yes / No / Maybe later)</li>
      </ul>
      <p>
        These four answers drive both which tabs appear in your sidebar and
        which Phase 2 conditional steps fire (more on each below).
      </p>

      <h3>Q6: AI Helper prompt size</h3>
      <p>
        ResearchOS can paste a system prompt into Claude, ChatGPT, or Gemini
        so the assistant understands ResearchOS terminology. The Full prompt
        is the default (most users have access to a big-context model and
        benefit from the full context). Medium and Minimal trim the prompt
        for smaller-context models. <strong>No</strong> or{" "}
        <strong>Maybe later</strong> skips the AI Helper tour entirely.
      </p>

      <h2>Phase 2: walkthrough on your real account</h2>
      <p>
        This is where the tour starts touching real data. BeakerBot guides you
        through nine universal steps (W1 to W9) that everyone sees, plus up to
        five conditional steps (W10 to W14) that only fire when the
        corresponding Q answer was <strong>yes</strong>. A{" "}
        <strong>no</strong> or <strong>maybe later</strong> on a Q skips the
        matching W step.
      </p>

      <h3>W1 through W9: the universal sequence</h3>
      <Steps>
        <Step>
          <strong>W1, Create a project.</strong> Pick a project name (default
          <em> My First Project</em>) and click Create. The project lands in
          your Workbench.
        </Step>
        <Step>
          <strong>W2, Add a method.</strong> Two choices in one step. Drop in
          BeakerBot&apos;s placeholder method to keep moving, or use the inline
          file picker / markdown picker to import a real method document you
          already have.
        </Step>
        <Step>
          <strong>W3, Create an experiment.</strong> A new experiment lands
          inside the project from W1.
        </Step>
        <Step>
          <strong>W4, Link the method to the experiment.</strong> BeakerBot
          walks you through the link UI so the experiment from W3 attaches to
          the method from W2.
        </Step>
        <Step>
          <strong>W5, Hybrid editor tour.</strong> BeakerBot live-types five
          markdown shortcut demos: bold (<Kbd>Cmd+B</Kbd>), italic (
          <Kbd>Cmd+I</Kbd>), a Python code block, a block quote, and a Heading
          2. You watch the keystrokes produce live markdown in a preview pane.
        </Step>
        <Step>
          <strong>W6, Personalize the look.</strong> A quick spin through the
          accent color picker, the animations toggle, and the theme. BeakerBot
          demos changing the accent live so you see the chrome shift.
        </Step>
        <Step>
          <strong>W7, Search tour.</strong> Opens the Search tab. BeakerBot
          live-types a query that matches the experiment from W3. The
          highlighted result lands in the list.
        </Step>
        <Step>
          <strong>W8, Notifications tour.</strong> BeakerBot fires a test
          notification. You see the badge land, open the panel, and dismiss
          the entry.
        </Step>
        <Step>
          <strong>W9, Where to find help.</strong> A pointer at the Wiki tab
          (the page you are reading right now). No tour of the wiki itself,
          just a sentence about where the rest of the docs live.
        </Step>
      </Steps>

      <Screenshot
        src="/wiki/screenshots/onboarding-w1-create-project.png"
        alt="The W1 step in BeakerBot's welcome tour. A speech bubble reads about every great experiment starting with a project, an input field offers the placeholder My First Project, and a sky-blue Create button sits to the right. BeakerBot points at the input in the upper-left."
        caption="W1 in motion. Type a name (or accept the default), click Create, and BeakerBot persists the project to your Workbench."
      />

      <Screenshot
        src="/wiki/screenshots/onboarding-w5-hybrid-editor-typing.png"
        alt="The W5 step showing the hybrid editor live-typing demo. A preview pane displays markdown source on the left with a rendered approximation on the right. The current demo is the bold shortcut, with BeakerBot's speech bubble narrating from the upper-left."
        caption="W5 live-types each shortcut at human-readable cadence. Click Next when the demo finishes (or click Skip the demo to jump ahead)."
      />

      <h3>W10 through W14: conditional walkthroughs</h3>
      <p>
        Each conditional step fires only when the matching Q answer was{" "}
        <strong>yes</strong>:
      </p>
      <ul>
        <li>
          <strong>W10, Purchases tour.</strong> Fires when Q2 = yes. BeakerBot
          drops a sample purchase request into the queue and walks you
          through approving plus receiving it.
        </li>
        <li>
          <strong>W11, Goals tour.</strong> Fires when Q4 = yes. BeakerBot
          creates a sample goal and demos linking it to the experiment from W3.
        </li>
        <li>
          <strong>W12, Telegram tour.</strong> Fires when Q5 = yes. Inline
          pairing flow plus a quick demo of sending an image from Telegram and
          watching it appear in your image inbox.
        </li>
        <li>
          <strong>W13, Calendar tour.</strong> Fires when Q3 = yes. Inline
          calendar-feed subscribe flow. The new feed appears in the Calendar
          tab when you click Next.
        </li>
        <li>
          <strong>W14, AI Helper tour.</strong> Fires when Q6 picked Full,
          Medium, or Minimal. BeakerBot grabs the chosen prompt, copies it to
          your clipboard, and explains where to paste it.
        </li>
      </ul>

      <h2>Phase 3: the Lab Mode tour (lab accounts only)</h2>
      <p>
        If Q1 was Lab, Phase 2 ends with a small prompt: tour Lab Mode now, or
        later? Picking <strong>later</strong> defers the tour to your first
        natural Lab Mode entry (next time you click the Lab Mode tab, a small
        modal asks again: now, snooze, or dismiss). Picking now drops you into
        an eleven-step lab walkthrough that takes about three minutes.
      </p>
      <p>
        The lab tour spawns a temporary fake user named <strong>BeakerBot</strong>{" "}
        (sky-blue avatar, tagged <code>is_tutorial: true</code> in the lab&apos;s
        user metadata). BeakerBot auto-shares two sample experiments with you,
        one with edit permission (green) and one view-only (red), so you can
        practice both share flavors.
      </p>
      <p>
        The eleven steps cover:
      </p>
      <ul>
        <li><strong>L1:</strong> What Lab Mode is (concept intro).</li>
        <li><strong>L2:</strong> Spawn the fake BeakerBot user and share a sample experiment.</li>
        <li><strong>L3:</strong> See BeakerBot&apos;s task appear in your Workbench and Gantt.</li>
        <li><strong>L4:</strong> Permission practice. Edit the green-permission task. Try (and fail) to delete the red view-only task.</li>
        <li><strong>L5:</strong> Share something back. You create an experiment and share it with BeakerBot.</li>
        <li><strong>L6:</strong> Revoke sharing. Walk through removing BeakerBot&apos;s access to the experiment from L5.</li>
        <li><strong>L7:</strong> Lab Gantt plus activity feed. See both your tasks and BeakerBot&apos;s on one timeline.</li>
        <li><strong>L8:</strong> Lab purchases (only if Q2 = yes). BeakerBot files a sample request as the fake user.</li>
        <li><strong>L9:</strong> Lab search. Search across the lab. BeakerBot&apos;s shared task shows up in the results.</li>
        <li><strong>L10:</strong> Lab Mode wrap.</li>
        <li><strong>L11:</strong> Decide what to do with the demo lab (clean up now, keep, or defer to Phase 4).</li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/onboarding-l4-permission-practice.png"
        alt="The L4 step showing two BeakerBot-shared tasks. The first task has a green Edit pill and an Edit name button. The second task has a red View-only lock indicator and a disabled Delete button. BeakerBot points at the red lock from the upper-left."
        caption="L4 in flight. The green-pill task is editable, the red-pill task is view-only. The disabled Delete button bounces if you try."
      />

      <h2>Phase 4: the cleanup grid</h2>
      <p>
        Every BeakerBot-created artifact lands here. The grid groups items by
        category (Project, Method, Experiment, Note edits, Settings changes,
        Purchase request, Goal, Telegram link, Telegram images, Calendar feed,
        Lab Mode teammate, Lab Mode demo tasks). Each row has a checkbox.
      </p>
      <p>
        Defaults follow the L24 rule: every row starts <strong>checked</strong>{" "}
        (keep), with two exceptions:
      </p>
      <ul>
        <li>
          Auto-prerequisite artifacts (created because you clicked Skip this
          step on a step a later step depended on) start unchecked and carry
          a small <em>(auto-created)</em> tag.
        </li>
        <li>
          Lab Mode artifacts inherit whatever you picked on L11.
        </li>
      </ul>
      <p>
        The amber strip at the top has a master <strong>Start fresh</strong>{" "}
        toggle that unchecks every row in one click (with a confirm
        sub-modal). Click <strong>Finish setup</strong> in the footer to
        commit your picks. BeakerBot deletes any unchecked items, writes{" "}
        <code>wizard_completed_at</code>, and drops you on the Workbench.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-phase4-cleanup-grid.png"
        alt="The Phase 4 cleanup grid showing categories with checkboxes per item, the amber Start fresh strip at the top, and a Finish setup button in the footer. BeakerBot cheers from the upper-left."
        caption="Phase 4 in action. Default is keep, master Start fresh wipes everything."
      />

      <h2>BeakerBot, the character</h2>
      <p>
        BeakerBot is the canonical ResearchOS mascot: a sky-blue chemistry
        beaker with pastel-rainbow liquid, dot eyes, and measurement-mark
        cheek dashes. The voice is funny and playful throughout (W1 opens
        with &quot;every great experiment starts with a project, or a snack,
        but mostly a project&quot;). The tour uses seven poses, chosen
        contextually:
      </p>
      <ul>
        <li><strong>Idle</strong>, the always-on baseline bob.</li>
        <li><strong>Waving</strong>, the welcome screen and the resume modal.</li>
        <li><strong>Thinking</strong>, head-tilt during Q1 to Q6.</li>
        <li><strong>Pointing</strong>, the universal W and L steps where BeakerBot directs your attention.</li>
        <li><strong>Typing</strong>, W5 and W7 where BeakerBot live-types into the UI.</li>
        <li><strong>Bouncing</strong>, a ~650ms burst on every step transition.</li>
        <li><strong>Cheering</strong>, Phase 4 cleanup celebrate moment.</li>
        <li><strong>Bow-wink</strong>, the farewell pose after you click Finish.</li>
      </ul>

      <h2>Behavior contracts</h2>

      <h3>I&apos;ve got it from here</h3>
      <p>
        A persistent link in the footer of every step. Click it, confirm in
        the sub-modal, and BeakerBot jumps to the Phase 4 cleanup grid. You
        still get to keep or discard everything, just without finishing the
        intervening steps. On Finish the run gets recorded as a skip rather
        than a completion (so re-running from Settings still works).
      </p>

      <h3>Skip this step (individual)</h3>
      <p>
        Each step (after the intro) has a <strong>Skip this step</strong>{" "}
        link. If a later step depends on the artifact this step creates (W3
        needs W1&apos;s project; W4 and W5 need W2&apos;s method or W3&apos;s
        experiment), BeakerBot silently creates a placeholder version with
        <code> cleanup_default: &quot;discard&quot;</code>. The Phase 4 grid
        tags those rows <em>(auto-created)</em> and starts them unchecked.
      </p>

      <h3>Mid-walkthrough close</h3>
      <p>
        Closing the tab partway through writes the current step plus every
        artifact created so far into{" "}
        <code>_onboarding.json.wizard_resume_state</code>. The next time you
        open ResearchOS with this folder, a small modal asks:
      </p>
      <ul>
        <li><strong>Resume</strong>, mount the tour at the saved step with every artifact intact.</li>
        <li><strong>Restart</strong>, reset to the intro (with a confirm sub-modal if any artifacts exist).</li>
        <li><strong>I&apos;m good, call it done</strong>, drop the resume state, set <code>wizard_skipped_at</code>, leave artifacts in place. Settings re-run still works.</li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/onboarding-resume-modal.png"
        alt="The Resume modal showing three stacked buttons: a sky-blue Resume button at the top, a Restart button, and an outlined I'm good, call it done button at the bottom. BeakerBot waves from the upper-left."
        caption="The Resume modal. Fires on next open when wizard_resume_state is non-null."
      />

      <h3>Re-running from Settings</h3>
      <p>
        Clicking <strong>Re-run welcome tour</strong> on the Settings page
        calls <code>clearWizardCompletion()</code>, which clears every
        completion-tracking field at once:{" "}
        <code>wizard_completed_at</code>, <code>wizard_skipped_at</code>,{" "}
        <code>wizard_resume_state</code>, <code>lab_tour_pending</code>,
        and <code>lab_tour_dismissed_at</code>. The next page load brings
        BeakerBot back at the intro.
      </p>

      <h2>How feature picks change which tabs you see</h2>
      <p>
        Your Q1 plus Q2 to Q5 answers determine the visible-tab set through
        two helpers in{" "}
        <code>frontend/src/lib/onboarding/feature-picks-tabs.ts</code>:
      </p>
      <ul>
        <li>
          <code>tabsForFeaturePicks()</code> maps your picks to a canonical
          list of tab hrefs.
        </li>
        <li>
          <code>deriveVisibleTabs()</code> composes that list with the
          <code> visibleTabs</code> array in <code>settings.json</code>.
        </li>
      </ul>
      <p>
        The rules:
      </p>
      <ul>
        <li>
          <strong>Always visible:</strong> Home, Workbench, Methods,
          Experiments, Gantt, Search.
        </li>
        <li>
          <strong>Lab Mode</strong> appears only when{" "}
          <code>account_type === &quot;lab&quot;</code>.
        </li>
        <li>
          <strong>Purchases</strong> appears only when{" "}
          <code>purchases === &quot;yes&quot;</code>.
        </li>
        <li>
          <strong>Calendar</strong> appears only when{" "}
          <code>calendar === &quot;yes&quot;</code>.
        </li>
        <li>
          <strong>Goals</strong> appears only when{" "}
          <code>goals === &quot;yes&quot;</code>.
        </li>
        <li>
          <strong>Telegram</strong> (the notifications / inbox surface)
          appears only when <code>telegram === &quot;yes&quot;</code>.
        </li>
      </ul>
      <p>
        Settings can manually <strong>hide</strong> a tab that the picks
        would otherwise show. Settings cannot <strong>unhide</strong> a tab
        that the picks excluded. To get a hidden tab back, re-run the tour
        and flip the matching Q answer.
      </p>

      <Callout variant="tip" title="Power-user shortcut: ?wizard-preview=1">
        Developers and demo-givers can append <code>?wizard-preview=1</code> to
        any URL to force-mount the tour against the current sidecar state. Use
        it together with <code>?wikiCapture=1</code> to drive the tour against
        the wiki fixture (the screenshots on this page are captured that
        way).
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          To re-run the tour or trim your visible tabs, see{" "}
          <Link href="/wiki/features/settings">Settings</Link>.
        </li>
        <li>
          For the Lab Mode tour&apos;s share / revoke / view-only mechanics,
          see <Link href="/wiki/features/lab-mode">Lab Mode</Link>.
        </li>
        <li>
          For a hands-on tour against seeded data (no real folder needed),
          see <Link href="/demo">/demo</Link>.
        </li>
        <li>
          For how projects work after BeakerBot leaves, see{" "}
          <Link href="/wiki/features/projects">Project Surface</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
