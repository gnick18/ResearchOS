import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function WelcomeWizardPage() {
  return (
    <WikiPage
      intro="The welcome wizard is a seven-step modal that runs once on your first sign-in. It picks the tabs you see, walks you through three optional integrations, and writes the result back to your settings."
    >
      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-1-welcome.png"
        alt="The first step of the welcome wizard: a beaker mascot on the left, a short paragraph on the right, a progress bar near the top, and a sky-blue Continue button on the lower right."
        caption="Step 1 of 7. The wizard appears on top of the home page the first time you sign in."
      />

      <h2>What the wizard is for</h2>
      <p>
        ResearchOS ships with ten tabs (Home, Workbench, Gantt, Methods, PCR,
        Purchases, Calendar, Search, Lab Links, and Settings). That is a lot to
        face on day one, and most people only need a subset. The welcome wizard
        asks two questions about how you work, then hides the tabs you probably
        will not use and offers to set up the three integrations that take the
        longest to discover on your own (Telegram for phone photos, a calendar
        feed, and the AI Helper system prompt).
      </p>
      <p>
        The wizard is the first thing a brand-new user sees, but it is also
        completely optional. You can skip the whole flow with the{" "}
        <strong>Skip setup</strong> link in the footer or by pressing{" "}
        <kbd className="inline-flex items-center justify-center min-w-[1.5em] px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-700 text-[11px] font-mono leading-none shadow-[inset_0_-1px_0_rgb(229_231_235)]">
          Esc
        </kbd>
        . Skipping leaves every tab visible (the safe default) and never
        re-fires unsolicited.
      </p>

      <Callout variant="info" title="Existing users never see this">
        If you already have a <code>settings.json</code>, an{" "}
        <code>_onboarding.json</code>, or a metadata entry on disk, the wizard
        treats you as an existing user and stays out of the way. Re-running it
        is a deliberate, one-click action on the Settings page (covered below).
      </Callout>

      <h2>The seven steps</h2>
      <p>
        Each step has a title in the header, a progress bar, and a footer with{" "}
        <strong>Back</strong>, <strong>Skip setup</strong>, and{" "}
        <strong>Continue</strong>. Tab and Shift+Tab cycle focus inside the
        modal, so a keyboard-only run through is as fast as a mouse one.
      </p>

      <table className="my-4 w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-3 font-semibold text-gray-800 w-16">
              Step
            </th>
            <th className="text-left py-2 pr-3 font-semibold text-gray-800 w-56">
              Title
            </th>
            <th className="text-left py-2 font-semibold text-gray-800">
              What you do
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-gray-100">
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">1</td>
            <td className="py-2 pr-3">Welcome to ResearchOS</td>
            <td className="py-2 text-gray-700">
              One paragraph framing the rest of the flow. Click Continue.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">2</td>
            <td className="py-2 pr-3">What brings you here?</td>
            <td className="py-2 text-gray-700">
              Pick one or more chips that describe your situation. Tap{" "}
              <strong>Other</strong> for a free-form note.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">3</td>
            <td className="py-2 pr-3">Tabs we&apos;ll show</td>
            <td className="py-2 text-gray-700">
              A checkbox grid pre-toggled from your step-2 picks. Adjust if you
              want.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">4</td>
            <td className="py-2 pr-3">Connect Telegram?</td>
            <td className="py-2 text-gray-700">
              Optional. Pair a Telegram bot for phone-photo intake, or defer.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">5</td>
            <td className="py-2 pr-3">Add a calendar?</td>
            <td className="py-2 text-gray-700">
              Optional. Paste an ICS URL to subscribe to a calendar feed.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">6</td>
            <td className="py-2 pr-3">AI Helper prompt?</td>
            <td className="py-2 text-gray-700">
              Optional. Copy a ready-made system prompt to paste into Claude,
              ChatGPT, or Gemini.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-mono text-gray-500">7</td>
            <td className="py-2 pr-3">You&apos;re all set</td>
            <td className="py-2 text-gray-700">
              A confirmation card echoes your three integration picks and
              offers a five-minute feature tour.
            </td>
          </tr>
        </tbody>
      </table>

      <h2>Step 2: the nine use-case chips</h2>
      <p>
        Step 2 is the only step that changes what the rest of the wizard looks
        like, so it is worth pausing on. Pick whichever chips fit. You can pick
        several. Solo researchers, staff scientists, and startup labs are
        first-class options alongside the academic ones.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-2-use-cases.png"
        alt="The use-case picker showing a 3-by-3 grid of chips with two of them highlighted in sky blue (PhD running experiments and Postdoc), plus the Other row collapsed at the bottom."
        caption="Pick one chip, several chips, or none. Empty is fine."
      />

      <table className="my-4 w-full text-sm border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-3 font-semibold text-gray-800 w-56">
              Chip
            </th>
            <th className="text-left py-2 font-semibold text-gray-800">
              Who it fits
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-gray-100">
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              PhD running experiments
            </td>
            <td className="py-2 text-gray-700">
              Running your own experiments toward a thesis.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">Lab manager</td>
            <td className="py-2 text-gray-700">
              Coordinating people, purchases, and schedules across a lab.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Teaching / instructor
            </td>
            <td className="py-2 text-gray-700">
              Running a teaching lab or course-linked research project.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Computational researcher
            </td>
            <td className="py-2 text-gray-700">
              Dry-lab work: data, code, modeling, no benchwork.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">Postdoc</td>
            <td className="py-2 text-gray-700">
              Driving your own project inside someone else&apos;s lab.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Solo researcher
            </td>
            <td className="py-2 text-gray-700">
              Head of your own small lab in industry, a startup, or independent.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Staff scientist / researcher
            </td>
            <td className="py-2 text-gray-700">
              Career bench scientist on a long-running program.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Undergrad researcher
            </td>
            <td className="py-2 text-gray-700">
              Shadowing or supporting someone else&apos;s project.
            </td>
          </tr>
          <tr>
            <td className="py-2 pr-3 font-medium text-gray-800">
              Just exploring
            </td>
            <td className="py-2 text-gray-700">
              Kicking the tires. Picks this chip and the wizard shows every tab.
            </td>
          </tr>
        </tbody>
      </table>

      <h3>The Other affordance</h3>
      <p>
        If none of the nine chips quite fit, tap <strong>Other</strong> at the
        bottom of the grid. A short text field appears where you can describe
        your role in your own words (e.g.,{" "}
        <em>running a clinical research coordinator role</em>). The text is
        saved separately from the chip picks, so it does not affect which tabs
        the wizard suggests. The wrap-up card on step 7 echoes it back so you
        know it landed.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-2-other-open.png"
        alt="The use-case picker with the Other row expanded into a text input field. The placeholder text reads 'e.g. running a clinical research coordinator role'."
        caption="The Other field accepts up to 200 characters of free-form text."
      />

      <h2>Step 3: tabs we&apos;ll show</h2>
      <p>
        Step 3 reads your step-2 picks and pre-toggles the tabs each picker
        usually wants. The Home tab is always on (it is the landing page after
        sign-in) and is greyed out so you cannot accidentally hide it.
        Everything else is a checkbox you can flip.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-3-tabs.png"
        alt="The tab-config grid showing ten tabs in two columns. Home is greyed with an 'always on' label. Workbench, Gantt, Methods, Purchases, Calendar, Search, and Lab Links are checked for a postdoc-style default."
        caption="Postdoc defaults: everything except Lab Mode is pre-checked. Lab Links is added because postdocs usually share with a group."
      />

      <p>
        The wizard&apos;s pre-toggle is the union of the static tab map for the
        chips you picked. For reference, the static map looks like this:
      </p>

      <table className="my-4 w-full text-xs border-collapse">
        <thead>
          <tr className="border-b border-gray-200">
            <th className="text-left py-2 pr-2 font-semibold text-gray-800">
              Pick
            </th>
            <th className="text-left py-2 pr-2 font-semibold text-gray-800">
              Tabs pre-toggled on
            </th>
          </tr>
        </thead>
        <tbody className="[&>tr]:border-b [&>tr]:border-gray-100">
          <tr>
            <td className="py-1.5 pr-2 font-medium">PhD running experiments</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Gantt, Methods, Purchases, Calendar, Search
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Lab manager</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Gantt, Methods, Purchases, Calendar, Search, Lab Links
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Teaching / instructor</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Methods, Calendar, Search
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Computational researcher</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Methods, Search
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Postdoc</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Gantt, Methods, Purchases, Calendar, Search, Lab Links
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Solo researcher</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Gantt, Methods, Purchases, Calendar, Search
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Staff scientist</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Gantt, Methods, Purchases, Calendar, Search, Lab Links
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Undergrad researcher</td>
            <td className="py-1.5 text-gray-700">
              Workbench, Calendar, Search
            </td>
          </tr>
          <tr>
            <td className="py-1.5 pr-2 font-medium">Just exploring</td>
            <td className="py-1.5 text-gray-700">
              Every tab (the show-me-everything escape hatch)
            </td>
          </tr>
        </tbody>
      </table>

      <Callout variant="tip" title="Multi-user folder override">
        If your folder already contains more than one user (you joined a shared
        lab folder), the wizard force-toggles <strong>Lab Links</strong> on
        regardless of which chip you picked. Sharing a folder is a strong signal
        you want a place to drop group bookmarks.
      </Callout>

      <p>
        Whatever you end up with on step 3 is what gets written to{" "}
        <code>settings.json</code>. You can change it again later at{" "}
        <strong>Settings &gt; Tabs</strong>.
      </p>

      <h2>Step 4: Connect Telegram?</h2>
      <p>
        Telegram is the integration most people miss without onboarding. The
        wizard offers a one-click pairing flow that runs inline (no new modal
        layer): tap <strong>Set it up now</strong>, scan the QR or paste the
        token shown on screen into the bot, and you are paired.{" "}
        <strong>Maybe later</strong> skips the step and remembers your
        deferral.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-4-telegram-cta.png"
        alt="Step 4 showing two stacked CTAs: a sky-blue 'Set it up now' button and a grey outlined 'Maybe later' button under a short pitch about phone-photo intake."
        caption="The default Step 4 view: two CTAs, decide and move on."
      />

      <h3>The computational-only auto-skip</h3>
      <p>
        If <strong>Computational researcher</strong> is the only chip you
        picked on step 2, step 4 shortcuts to a friendly amber notice instead
        of the pair flow. Dry-lab workflows rarely need a phone-photo inbox, so
        the wizard saves you the round trip. You can still pair Telegram later
        from <strong>Settings &gt; Telegram</strong>.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-4-telegram-autoskip.png"
        alt="Step 4 in auto-skip mode: an amber card explains 'We're skipping Telegram setup for now' with a short note and a Continue button bottom-right."
        caption="Computational-only researchers see this instead of the pair flow."
      />

      <h2>Step 5: Add a calendar?</h2>
      <p>
        Step 5 lets you wire up a read-only ICS feed (Google, Apple, Outlook,
        or any public iCal URL). Tap <strong>Add one now</strong> and a small
        form appears: paste a name and the URL, click <strong>Subscribe</strong>,
        and the feed lands in your Calendar tab. A one-second green check
        confirms success before the wizard auto-advances.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-5-calendar-form.png"
        alt="Step 5 showing a Name field, an ICS URL field with a placeholder Google calendar URL, a Cancel link, and a sky-blue Subscribe button."
        caption="The inline form. Validation is light: the URL needs an http/https/webcal scheme."
      />

      <p>
        Maybe later defers the step. You can manage feeds afterwards in{" "}
        <Link href="/wiki/integrations/calendar-feeds">Calendar Feeds</Link>.
      </p>

      <h2>Step 6: AI Helper prompt?</h2>
      <p>
        Step 6 is the fastest of the three integration steps. Tap{" "}
        <strong>Copy prompt now</strong> and the wizard puts a ready-made
        system prompt onto your clipboard. Paste it into the system
        instructions of Claude, ChatGPT, or Gemini and your AI assistant will
        understand ResearchOS terminology, schema, and drafting conventions.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-6-aihelper.png"
        alt="Step 6 with a heading 'Want a prompt for Claude, ChatGPT, or Gemini?', a short pitch, and two CTAs: 'Copy prompt now' and 'Maybe later'."
        caption="A single click delivers a multi-paragraph system prompt to your clipboard."
      />

      <p>
        If your browser blocks the clipboard write (insecure context, denied
        permission), the wizard falls back to a textarea with the prompt
        pre-selected so you can copy it manually.
      </p>

      <h2>Step 7: wrap-up</h2>
      <p>
        The last step is a confirmation card. It restates anything you typed
        into the Other field on step 2 and shows a check, an X, or an em-dash
        marker for each of the three integration decisions. Below that, a
        link offers a five-minute feature tour that opens the demo lab in a
        new tab. The footer&apos;s Continue button is renamed to{" "}
        <strong>Go to home</strong> and exits the wizard.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-wizard-step-7-wrapup.png"
        alt="The wrap-up card with a sky-blue check icon, 'You're all set.' heading, a setup-decisions list (Telegram: paired, Calendar: added a feed, AI Helper: copied prompt), a 'Take the 5-min feature tour' link, and a Go to home button at the footer."
        caption="The decision-echo block confirms what you set up. Skipped steps show a grey marker."
      />

      <Callout variant="info" title="Where these decisions are saved">
        Use cases, Other text, and the three integration decisions land in{" "}
        <code>users/&lt;you&gt;/_onboarding.json</code>. The tab list lands in{" "}
        <code>users/&lt;you&gt;/settings.json</code> (same file as{" "}
        <strong>Settings &gt; Tabs</strong>). Both are plain JSON inside your
        folder. Nothing about the wizard touches a server.
      </Callout>

      <h2>Skipping the wizard</h2>
      <p>
        Three things skip the wizard:
      </p>
      <ul>
        <li>
          The <strong>Skip setup</strong> link in the footer (any step).
        </li>
        <li>
          Pressing{" "}
          <kbd className="inline-flex items-center justify-center min-w-[1.5em] px-1.5 py-0.5 rounded border border-gray-300 bg-gray-50 text-gray-700 text-[11px] font-mono leading-none shadow-[inset_0_-1px_0_rgb(229_231_235)]">
            Esc
          </kbd>
          .
        </li>
        <li>
          Closing the tab partway through (the next sign-in will not re-fire it
          automatically, but you can rerun manually).
        </li>
      </ul>
      <p>
        A skipped wizard means every tab stays visible (the safe default), and
        a <code>wizard_skipped_at</code> timestamp is recorded so the wizard
        does not nag you again.
      </p>

      <h2>Running it again later</h2>
      <p>
        If you skipped, or you want to revisit your picks after a few weeks of
        use, head to <strong>Settings &gt; Tips</strong> and click the{" "}
        <strong>Re-run wizard</strong> button. The page refreshes, the wizard
        re-appears, and your previous step-3 tab toggles are preserved as the
        starting state.
      </p>

      <Screenshot
        src="/wiki/screenshots/onboarding-settings-rerun-button.png"
        alt="The Tips panel on Settings showing two rows: 'Show me the onboarding tips again' with a Replay tips button, and 'Re-run welcome wizard' with a Re-run wizard button on the right."
        caption="Settings, Tips section. Use the lower row to relaunch the wizard."
      />

      <Callout variant="tip" title="Power-user shortcut: ?wizard-preview=1">
        Developers and demo-givers can append <code>?wizard-preview=1</code> to
        any URL to force-mount the wizard against the current folder state.
        Picks made in preview mode are discarded on exit (a small amber banner
        in the modal header reminds you nothing is being written). This is the
        flag the screenshot capture script uses to grab the images on this
        page.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          Decide your tip cadence at{" "}
          <strong>Settings &gt; Tips &gt; How should I help?</strong>{" "}
          (three radio options: Walk me through it, Show me as I go, Stay
          quiet).
        </li>
        <li>
          If you skipped Telegram and want it back, see{" "}
          <Link href="/wiki/integrations/telegram">Telegram Bot</Link>.
        </li>
        <li>
          If you skipped the calendar feed, see{" "}
          <Link href="/wiki/integrations/calendar-feeds">Calendar Feeds</Link>.
        </li>
        <li>
          To trim or expand your visible tabs after the fact, see{" "}
          <Link href="/wiki/features/settings">Settings</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
