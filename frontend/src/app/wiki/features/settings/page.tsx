import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SettingsFeaturePage() {
  return (
    <WikiPage
      title="Settings"
      intro="One long stack of panels, each one a small slice of how the app looks and behaves for you. The big ones are Profile and account, Professional mode, Tabs, LabArchives, AI Helper, Sidebar, View defaults, Appearance, Animation, Behavior, Streaks, History &amp; Trash, Data inventory, Data maintenance, Security, and Offline mode. Reach the page through the gear icon in the top-right of the header."
    >
      <Screenshot
        src="/wiki/screenshots/settings.png"
        alt="The Settings page showing its stack of panels, including Profile and account, Professional mode, Tabs, LabArchives, AI Helper, Sidebar, View defaults, Appearance, Animation, Behavior, Streaks, History &amp; Trash, Data inventory, Data maintenance, Security, and Offline mode."
      />

      <p>
        Each change saves the moment you toggle, type, or pick a new option. A
        small &ldquo;Saving&hellip;&rdquo; pill near the page title flips to a
        green &ldquo;Saved&rdquo; for about a second, then disappears. The path
        printed under the page title shows where your preferences are stored
        on disk (<code>users/&lt;you&gt;/settings.json</code>), which is handy
        if you ever need to hand-edit or copy them between labs.
      </p>

      <h2>Search settings</h2>
      <p>
        At the very top of the page, above every panel, a search bar filters
        the visible settings down to whatever matches your typed substring.
        Type <code>password</code> and the page collapses to the Security
        panel. Type <code>animation</code> and it narrows to the Animation
        section. The filter matches section headings and the body text inside
        each panel. Clear the bar to restore the full stack.
      </p>

      <h2>Personal vs Lab Mode tabs</h2>
      <p>
        PI accounts (<code>account_type === &quot;lab_head&quot;</code>)
        see a two-tab strip at the top of the page. <strong>Personal</strong>{" "}
        is the default (every panel documented below) and{" "}
        <strong>Lab Mode</strong> is the lab-wide configuration that only a PI
        can change. The
        Personal tab is identical to what every account sees. The Lab Mode tab
        holds the LabRoster (see{" "}
        <Link href="/wiki/getting-started/user-archiving">User archiving</Link>),
        the announcement defaults, and the PI password reset. Members do
        not see the tab strip at all because they never have access to the Lab
        Mode controls.
      </p>

      <h2>Data folder and Account</h2>
      <p>
        The first two cards handle the basics of where you are. The{" "}
        <strong>Data folder</strong> card shows the folder this app is currently
        reading and writing, with a <strong>Connect or switch folder</strong>{" "}
        button. Switching only re-points the app, it never moves or deletes
        files. The <strong>Account</strong> card shows who you&apos;re signed in
        as and a <strong>Switch user</strong> button that opens the same picker
        as the app login screen.
      </p>

      <h2>Profile and account</h2>
      <p>
        Near the top of the page, after the Data folder and Account cards, a
        small pointer card sends you to your{" "}
        <Link href="/profile">Profile page</Link>. Your display name, avatar
        color, ORCID, researcher profile, and your account and keys all live
        there now, so this card is just a doorway with a <strong>Go to your
        Profile</strong> button (it reads <strong>Set up on your Profile</strong>{" "}
        until sharing is set up).
      </p>

      <h2>Professional mode</h2>
      <p>
        One switch for a quieter workspace. Turning it on silences the three
        playful surfaces at once, the streak badge, the per-task animation, and
        BeakerBot. Turning it back off doesn&apos;t flip those back
        automatically, so you re-enable whichever ones you want from their own
        panels.
      </p>

      <h2>Tabs</h2>
      <p>
        A two-column grid of checkboxes for every tab in the header (Home,
        Workbench, GANTT, Methods, Purchases, Calendar, Search, Lab Links).
        Uncheck a tab to hide it from your header. Home is grayed out with
        an &ldquo;always on&rdquo; tag so you can&apos;t accidentally hide
        every tab at once.
      </p>
      <p>
        Below the grid, the <strong>Default landing tab</strong> dropdown
        picks where ResearchOS opens when you load the app. The dropdown only
        lists tabs you have visible (plus Home), so you can&apos;t land
        somewhere you&apos;ve hidden.
      </p>
      <Callout variant="info" title="Settings is always reachable">
        Settings doesn&apos;t appear in the tabs grid. It sits behind the gear
        icon in the header so it can never be hidden. Even if you uncheck
        every other tab, the gear icon and Home keep working.
      </Callout>

      <h2>LabArchives</h2>
      <p>
        A single option card for bulk-importing a LabArchives Offline Notebook
        ZIP into ResearchOS. The card has a title, a short description, and a
        small <code>?</code> button that expands an explainer about why the
        import exists (LabArchives is read-only inside ResearchOS, so the
        offline ZIP is the canonical hand-off). The <strong>Open import&hellip;</strong>{" "}
        button launches the import wizard, where each notebook page becomes a
        task and each folder becomes a project you can map onto your existing
        list. A small footer link, <em>How to export from LabArchives</em>,
        opens the matching wiki page.
      </p>
      <p>
        See the{" "}
        <Link href="/wiki/integrations/labarchives">LabArchives integration page</Link>{" "}
        for the full step-by-step walkthrough of the export and import flow.
      </p>

      <h2 id="ai-helper">AI Helper</h2>
      <p>
        Generates a schema-aware prompt you can paste into Claude, ChatGPT,
        Gemini, or Microsoft Copilot to turn it into a support assistant that
        understands your ResearchOS data model. The section has three parts, a
        size picker, a copy button, and one-click open-in buttons.
      </p>
      <p>
        The <strong>size picker</strong> is a three-option radio group.
      </p>
      <ul>
        <li>
          <strong>Lean</strong>, around 10k tokens. Fits in
          every major chat interface including free-tier context windows.
        </li>
        <li>
          <strong>Full (recommended)</strong>, around 22k tokens. Best for
          drafting on big-context models like Claude Sonnet, GPT-5, or Gemini
          2.5 Pro.
        </li>
        <li>
          <strong>Minimal</strong>, around 3k tokens. For tiny windows or
          local models.
        </li>
      </ul>
      <p>
        The <strong>Copy prompt to clipboard</strong> button copies the
        selected size&apos;s markdown. The <strong>Open in your AI</strong>{" "}
        row has four buttons (Claude, ChatGPT, Gemini, Copilot). Each one copies
        the prompt and opens that provider in a new tab so you can paste it as
        your first message.
      </p>
      <p>
        When the prompt served by the app is older than the running code, an{" "}
        <strong>amber stale-prompt callout</strong> appears with a{" "}
        <strong>Pull latest from research-os-xi.vercel.app</strong> trapdoor.
        Clicking it fetches the current manifest and prompt variant from the
        live deploy cross-origin and replaces what is shown locally. This
        callout is suppressed in demo and wiki-capture mode to keep screenshots
        deterministic.
      </p>
      <p>
        A freshness footer below the buttons shows the date the prompt was
        built and the ResearchOS commit it was generated from.
      </p>

      <h2>Sidebar</h2>
      <p>
        Two stacked toggles control the left sidebar that shows up on every
        page except Calendar (Calendar has its own dedicated sidebar). The{" "}
        <strong>Tasks</strong> toggle shows your due, overdue, and upcoming
        tasks for today. The <strong>Calendar events</strong> toggle adds
        today&apos;s and upcoming external calendar events from any{" "}
        <Link href="/wiki/integrations/calendar-feeds">ICS feeds</Link>{" "}
        you&apos;ve subscribed to.
      </p>
      <p>
        When the Calendar events toggle is on, a <strong>How much calendar to show</strong>{" "}
        dropdown becomes active. Options are Today only, or Today plus the next
        3, 7, 14, or 30 days. Switch the toggle off and the dropdown grays out.
      </p>
      <p>
        If you uncheck both toggles, an amber warning appears to tell you the
        sidebar will be empty on non-calendar pages.
      </p>

      <h2>View defaults</h2>
      <p>
        Four dropdowns and a toggle that set the starting view for the two
        biggest pages and the formatting used everywhere else. None of these
        lock you in. You can flip to a different range or view from inside
        each page for the current session, and reopening the app brings the
        default back.
      </p>
      <ul>
        <li>
          <strong>GANTT default range</strong>, 1 week, 2 weeks, 3 weeks, 1
          month, 3 months, 6 months, 1 year, or All.
        </li>
        <li>
          <strong>Calendar default view</strong>, Month, Week, or Day.
        </li>
        <li>
          <strong>Date format</strong>, MM/DD/YYYY (US), DD/MM/YYYY (EU), or
          YYYY-MM-DD (ISO).
        </li>
        <li>
          <strong>Time format</strong>, 12-hour (1:30 PM) or 24-hour (13:30).
        </li>
        <li>
          <strong>Show shared content by default</strong>, when on, GANTT and
          other views include tasks that other lab members have shared with you
          (not only your own tasks).
        </li>
      </ul>

      <h2>Animation</h2>
      <p>
        A grid of animation choices for the celebration that plays when you
        complete a task. Each tile shows an icon, a name, and a one-line
        flavor description. The selected tile gets a purple ring.
      </p>
      <p>
        The ten available themes, plus a <strong>None / off</strong> tile that
        skips the celebration entirely.
      </p>
      <ul>
        <li><strong>Celebration</strong>, confetti, unicorns, and rainbows.</li>
        <li><strong>Rock &amp; Roll</strong>, guitars, lightning, and skulls.</li>
        <li><strong>Space</strong>, rockets, planets, and aliens.</li>
        <li><strong>Underwater</strong>, fish, bubbles, and jellyfish.</li>
        <li><strong>Sports</strong>, balls, trophies, and medals.</li>
        <li><strong>Science</strong>, atoms, DNA, and beakers.</li>
        <li><strong>Plants</strong>, flowers, leaves, and seeds.</li>
        <li><strong>Animals</strong>, paw prints, birds, and butterflies.</li>
        <li><strong>Fungi</strong>, mushrooms, spores, and mycelium.</li>
        <li><strong>Scary</strong>, skulls, ghosts, and monsters.</li>
      </ul>
      <p>
        Pick the one that suits your vibe. Clicking a tile plays a quick live
        preview right there, and the change takes effect the next time you check
        off a task.
      </p>
      <p>
        Below the grid sits a separate <strong>BeakerBot animations</strong>{" "}
        toggle. This is a different control. It governs the BeakerBot streak and
        milestone celebrations that fire when you hit a streak goal. Leave it on
        for the full personality, or turn it off for a quieter experience. The
        per-task celebration you picked above keeps playing either way.
      </p>

      <h2>Behavior</h2>
      <p>
        A safety switch and an editor helper. <strong>Confirm destructive
        actions</strong>, when on, shows an &ldquo;Are you sure?&rdquo; prompt
        before you delete a task, project, or similar object. Switching it off
        skips the prompt for power-user use.
      </p>
      <p>
        <strong>Spell-check in the editor</strong> underlines likely
        misspellings as you write notes and offers click-to-fix suggestions. It
        is off by default because bench shorthand (gene names, reagents, your
        own abbreviations) reads as misspelled, so turn it on when you write
        longer prose and want the catch. The dictionary already knows common lab
        terms, and you can add any word it flags to your own dictionary.
      </p>

      <h2>Appearance</h2>
      <p>
        Three tiles, <strong>Light</strong>, <strong>Dark</strong>, and{" "}
        <strong>System</strong>, that set the app&apos;s theme. System follows
        your device&apos;s light/dark setting. This is a per-device display
        preference rather than a folder setting, so it lives on the machine
        you&apos;re using and doesn&apos;t travel between computers. The welcome
        page always stays light.
      </p>

      <h2 id="streaks">Streaks</h2>
      <p>
        Tracks how many workdays in a row you have saved something in
        ResearchOS. Streak data is stored in a per-user sidecar and is visible
        only to you, so no one else in the lab sees your count.
      </p>
      <p>
        The section has a single <strong>Enable streak tracking</strong> toggle
        (sky-blue when on). Disabling the toggle pauses tracking but preserves
        your existing state so you can re-enable later without losing your
        history.
      </p>
      <p>
        When streaks are enabled, a <strong>stat trio</strong> appears below
        the toggle.
      </p>
      <ul>
        <li><strong>Current streak</strong>, the number of consecutive workdays with at least one save.</li>
        <li><strong>Personal best</strong>, your all-time longest streak. Preserved even after a reset.</li>
        <li><strong>Started on</strong>, the date the current run began.</li>
      </ul>
      <p>
        The <strong>Reset streak</strong> button (red) zeros the current count
        and started-on date. A confirmation modal shows your current count and
        asks whether you also want to <em>clear celebrations seen</em> (so
        milestone animations can re-fire). Personal best is always preserved
        regardless of what you check. Click <strong>Cancel</strong> in the
        modal to back out.
      </p>
      <p>
        Below the reset button is a <strong>PTO</strong> subsection for
        configuring planned days off so the streak counter skips them.
      </p>

      <h2>History &amp; Trash</h2>
      <p>
        Deleting a record doesn&apos;t erase it right away. It goes to the
        trash and stays recoverable for a window you set here. The{" "}
        <strong>Cleanup window</strong> radio picks how long (a fixed number of
        days, or never auto-purge), and an <strong>Open trash</strong> link
        takes you to the <Link href="/trash">trash page</Link> to restore items
        to where they came from or delete them for good ahead of the window.
      </p>

      <h2>Data inventory</h2>
      <p>
        A read-only transparency surface that proves your data stays on your
        computer. Everything here is view-only.
      </p>
      <p>
        <strong>Files on disk</strong> is a scrollable list of every file path
        the app has written to your connected folder, grouped by top-level
        directory. A <strong>Refresh</strong> button re-scans on demand. The
        file count and group count appear above the list.
      </p>
      <p>
        <strong>Browser IndexedDB keys</strong> lists four known keys the app
        keeps in your browser.
      </p>
      <ul>
        <li>
          <code>research-os-fsa / handles / research-os-directory-handle</code>{" "}
          is an opaque File System Access handle (the browser&apos;s proof of
          folder permission). It does not contain the path string.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-directory-handle-meta</code>{" "}
          holds the folder name and grant timestamp.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-current-user</code>{" "}
          holds the username string of the currently signed-in user.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-main-user</code>{" "}
          holds the primary account when a PI is signed in.
        </li>
      </ul>
      <p>
        <strong>External calls</strong> is a disclosure paragraph listing the
        destinations your browser contacts when using ResearchOS. There are
        three. (a){" "}
        <code>/api/calendar-feed</code> on this app&apos;s origin,
        which fetches ICS calendars on your behalf. (b){" "}
        <code>va.vercel-scripts.com</code> / <code>vitals.vercel-insights.com</code>{" "}
        for anonymous page-view pings via Vercel Web Analytics plus anonymous
        Core Web Vitals via Vercel Speed Insights. (c){" "}
        <code>research-os-xi.vercel.app</code>, only when you click{" "}
        <strong>Pull latest</strong> in the AI Helper section to fetch a newer
        prompt. Enabling Offline mode (below) blocks (a) and (b).
      </p>

      <h2>Data maintenance</h2>
      <p>
        Two rows. The first is the <strong>Import experiment</strong> button for
        bringing an experiment another ResearchOS user exported (a{" "}
        <code>-raw.zip</code> bundle) into your workspace. You get to match its
        project and methods against your own before anything is written.
      </p>
      <p>
        The second is a <strong>Format upgrades</strong> status row. As
        ResearchOS evolves, the shape of some on-disk files changes. Those
        upgrades now run automatically in the background the moment you connect
        a folder, with nothing to lose (anything removed goes to a recoverable
        trash). The row tells you how many checks have run, and a single{" "}
        <strong>Re-run all checks</strong> button replays the whole set for
        support or power-user cases. You almost never need it, since the
        automatic pass keeps your folder current on its own.
      </p>
      <Callout variant="info" title="No more repair buttons">
        Earlier versions had a long list of one-off repair buttons here. Those
        are gone. The same idempotent checks now run on their own at connect
        time, so a folder synced from a lab-mate who hasn&apos;t opened the
        latest build gets tidied up automatically the next time you open it.
      </Callout>

      <h2>Onboarding</h2>
      <p>
        The guided BeakerBot walkthrough that used to live here has been
        retired, so there is no tour to re-run. If a leftover-demo-data recovery
        banner ever shows up (from an older tour run), it will offer to clean up
        any demo items it finds.
      </p>

      <h2>Security</h2>
      <p>
        A single panel for managing the password gate on this account. The
        line of text in the panel shows whether the password is currently{" "}
        <strong>set</strong> (green) or <strong>not set</strong> (gray). The{" "}
        <strong>Set password</strong> or <strong>Change password</strong>{" "}
        button opens the same Account password popup that the lock icon on
        the user-picker uses.
      </p>
      <p>
        In the popup you can set a new password (minimum 4 characters), change
        an existing one (current password required), or remove the password
        entirely. Your password wraps this account&apos;s keys with Argon2id, a
        deliberately slow, memory-hard function, before anything is written to
        disk. Setting a password also gives you a one-time recovery code to save
        in case you forget it.
      </p>
      <Callout variant="warning" title="What a password protects, and what it doesn't">
        The password gate stops a lab member from accidentally signing into
        the wrong account through the app UI and editing someone else&apos;s
        notes. It does <strong>not</strong> encrypt your files. Anyone with
        access to the shared folder (OneDrive, Dropbox, iCloud) can still read
        your raw markdown and image files directly.
      </Callout>
      <Callout variant="info" title="Forgot your password?">
        Since ResearchOS has no server, there&apos;s no &ldquo;reset
        link&rdquo; email. On the sign-in screen, click your account and choose{" "}
        <strong>Use your recovery code</strong> instead of the password, then
        enter the one-time code you saved when you set it. If you also lost the
        recovery code, a lab admin can reset you from their own account. The
        Account password popup&apos;s &ldquo;Forgot your password?&rdquo; link
        walks through the same steps inside the app.
      </Callout>

      <h2>Offline mode</h2>
      <p>
        A single toggle, <strong>Block calls to our server</strong>, that
        disables the proxy route the app uses for external data fetching,{" "}
        <code>/api/calendar-feed</code> (ICS calendar sync). Enabling
        this makes the app make no outbound calls to its own server. An amber
        notice appears while the toggle is on, confirming which features are
        paused.
      </p>

      <Callout variant="info" title="Settings are per-user, per-folder">
        Every user&apos;s preferences are stored at{" "}
        <code>users/&lt;you&gt;/settings.json</code> inside the connected data
        folder. Switching users in the picker loads that user&apos;s settings.
        Switching to a different folder gives you a clean slate of defaults
        until you tweak it.
      </Callout>
    </WikiPage>
  );
}
