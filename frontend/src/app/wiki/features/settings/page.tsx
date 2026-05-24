import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SettingsFeaturePage() {
  return (
    <WikiPage
      title="Settings"
      intro="Fourteen panels stacked top to bottom: Profile, Tabs, LabArchives, AI Helper, Sidebar, View defaults, Animation, Notifications &amp; behavior, Streaks, Data inventory, Data maintenance, Onboarding, Security, and Offline mode. Reach the page through the gear icon in the top-right of the header."
    >
      <Screenshot
        src="/wiki/screenshots/settings.png"
        alt="The Settings page showing its stack of panels: Profile, Tabs, LabArchives, AI Helper, Sidebar, View defaults, Animation, Notifications &amp; behavior, Streaks, Data inventory, Data maintenance, Onboarding, Security, and Offline mode."
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
        panel; type <code>animation</code> and it narrows to the Animation
        section. The filter matches section headings and the body text inside
        each panel, so a query like <code>telegram</code> surfaces both the
        Notifications row and the Data inventory Telegram-cache control.
        Clear the bar to restore the full stack.
      </p>

      <h2>Personal vs Lab Mode tabs</h2>
      <p>
        Lab Head accounts (<code>account_type === &quot;lab_head&quot;</code>)
        see a two-tab strip at the top of the page: <strong>Personal</strong>{" "}
        (the default, every panel documented below) and <strong>Lab Mode</strong>{" "}
        (the lab-wide configuration that only a Lab Head can change). The
        Personal tab is identical to what every account sees. The Lab Mode tab
        holds the LabRoster (see{" "}
        <Link href="/wiki/getting-started/user-archiving">User archiving</Link>),
        the announcement defaults, and the Lab Head password reset. Members do
        not see the tab strip at all because they never have access to the Lab
        Mode controls.
      </p>

      <h2>Profile</h2>
      <p>
        The top panel sets how the rest of the app addresses you. A large
        avatar bubble on the left previews the gradient that&apos;ll appear in
        comments, lab views, and the user-picker. The <strong>Display name</strong>{" "}
        field overrides your folder name (leave it blank to fall back to the
        folder name).
      </p>
      <p>
        The <strong>Primary color</strong> row is a fixed 10-color palette.
        Clicking a swatch updates the avatar preview instantly and refreshes
        every avatar bubble across the app on the next paint. A swatch is
        grayed out when another lab member already holds that color as a solid
        (direction-insensitive: blue-to-green and green-to-blue count as the
        same combination, so the collision system blocks whichever pair was
        claimed first).
      </p>
      <p>
        Below the primary row sits an <strong>Optional second color for
        gradient</strong> row. Pick any swatch that is not your primary and is
        not already taken by a lab-mate to create a two-stop gradient. The
        avatar preview updates immediately. A <strong>Clear secondary</strong>{" "}
        button appears next to the row label whenever a secondary is active;
        clicking it returns your avatar to a solid color (blocked if the solid
        form of your primary is already taken). The tooltip on any grayed-out
        swatch shows which lab member holds that combination.
      </p>
      <p>
        The <strong>Tint header with my color</strong> toggle controls one
        thing: whether the top header bar uses your gradient or stays plain
        white. Your avatar bubbles keep your color either way.
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
        Generates a schema-aware prompt you can paste into Claude, ChatGPT, or
        Gemini to turn it into a support assistant that understands your
        ResearchOS data model. The section has three parts: a size picker, a
        copy button, and one-click open-in buttons.
      </p>
      <p>
        The <strong>size picker</strong> is a three-option radio group:
      </p>
      <ul>
        <li>
          <strong>Lean (recommended)</strong>, around 10k tokens. Fits in
          every major chat interface including free-tier context windows.
        </li>
        <li>
          <strong>Full</strong>, around 22k tokens. Best for drafting on
          big-context models like Claude Sonnet, GPT-4o, or Gemini 2.5 Pro.
        </li>
        <li>
          <strong>Minimal</strong>, around 3k tokens. For tiny windows or
          local models.
        </li>
      </ul>
      <p>
        The <strong>Copy prompt to clipboard</strong> button copies the
        selected size&apos;s markdown. The <strong>Open in your AI</strong>{" "}
        row has three buttons (Claude, ChatGPT, Gemini): each one copies the
        prompt and opens the provider in a new tab so you can paste it as your
        first message.
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
        If you uncheck both toggles, an amber warning appears: the sidebar
        will be empty on non-calendar pages.
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
        complete a task. Each tile shows an emoji icon, a name, and a one-line
        flavor description. The selected tile gets a purple ring.
      </p>
      <p>
        The eleven available themes are:
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
        <li><strong>BeakerBot</strong>, random BeakerBot scenes: ladders, skateboards, and more.</li>
      </ul>
      <p>
        Pick the one that suits your vibe. The change takes effect the next
        time you check off a task.
      </p>

      <h2>Notifications &amp; behavior</h2>
      <p>
        Five master switches for messaging and safety prompts.
      </p>
      <ul>
        <li>
          <strong>Telegram notifications</strong>, when off, the app stops
          polling your Telegram bot for inbound photos and updates. Pairing
          and unpairing the bot itself happens elsewhere (see{" "}
          <Link href="/wiki/integrations/telegram">Telegram integration</Link>{" "}
          for the connect flow).
        </li>
        <li>
          <strong>Auto-reconnect Telegram bot</strong>, when on, your bot
          token is saved in an encrypted file (<code>_telegram-encrypted.json</code>)
          inside your folder, encrypted with your account password. If the
          pairing file is ever lost (OneDrive deletion, iCloud sync hiccup),
          ResearchOS can restore from the backup automatically. Enabling this
          toggle opens an inline password-entry form: type your account
          password and click <strong>Save encrypted backup</strong>. Canceling
          closes the form without changing the setting. Flipping the toggle off
          deletes the encrypted sidecar immediately.
        </li>
        <li>
          <strong>Lock encrypted backup access</strong>, a button that appears
          only when your account password is currently cached in memory (from
          the enable flow above). Clicking it clears the in-memory cache so
          the next auto-reconnect attempt will prompt for the password again.
          The button hides itself when the cache is already empty.
        </li>
        <li>
          <strong>Confirm destructive actions</strong>, when on, the app shows
          an &ldquo;Are you sure?&rdquo; prompt before you delete a task,
          project, or similar object. Switching it off skips the prompt for
          power-user use.
        </li>
        <li>
          <strong>Hide my goals from lab view</strong>, when on, the Lab
          Head will not see your goals on their{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
          dashboard. The flag is also mirrored to the shared{" "}
          <code>_user_metadata.json</code> file so the dashboard reader picks
          it up immediately.
        </li>
      </ul>

      <h2 id="streaks">Streaks</h2>
      <p>
        Tracks how many workdays in a row you have saved something in
        ResearchOS. Streak data is stored in a per-user sidecar and is visible
        only to you; no one else in the lab sees your count.
      </p>
      <p>
        The section has a single <strong>Enable streak tracking</strong> toggle
        (sky-blue when on). Disabling the toggle pauses tracking but preserves
        your existing state so you can re-enable later without losing your
        history.
      </p>
      <p>
        When streaks are enabled, a <strong>stat trio</strong> appears below
        the toggle:
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

      <h2>Data inventory</h2>
      <p>
        A read-only transparency surface that proves your data stays on your
        computer. Nothing here takes any action beyond the Telegram-cache Forget
        button; everything else is view-only.
      </p>
      <p>
        <strong>Files on disk</strong>: a scrollable list of every file path
        the app has written to your connected folder, grouped by top-level
        directory. A <strong>Refresh</strong> button re-scans on demand. The
        file count and group count appear above the list.
      </p>
      <p>
        <strong>Browser IndexedDB keys</strong>: five known keys the app keeps
        in your browser:
      </p>
      <ul>
        <li>
          <code>research-os-fsa / handles / research-os-directory-handle</code>:
          an opaque File System Access handle (the browser&apos;s proof of
          folder permission). Does not contain the path string.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-directory-handle-meta</code>:
          folder name and grant timestamp.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-current-user</code>:
          the username string of the currently signed-in user.
        </li>
        <li>
          <code>keyval-store / keyval / research-os-main-user</code>:
          the primary account when a Lab Head is signed in.
        </li>
        <li>
          <code>research-os-telegram-token-cache / tokens / &#123;folderName, username&#125;</code>:
          a recovery cache for your Telegram bot credentials, keyed per folder
          and user so a lab-mate sharing the folder cannot see your token. A{" "}
          <strong>Forget</strong> button (red) wipes every cached entry for the
          current folder.
        </li>
      </ul>
      <p>
        <strong>Telegram bot backup</strong>: a status badge showing whether
        the encrypted backup file (<code>users/&lt;you&gt;/_telegram-encrypted.json</code>)
        is present, with a &ldquo;last saved&rdquo; timestamp when it is. A{" "}
        <strong>Manage</strong> button scrolls to the Auto-reconnect row in
        Notifications &amp; behavior.
      </p>
      <p>
        <strong>External calls</strong>: a disclosure paragraph listing the
        four destinations your browser contacts when using ResearchOS: (a){" "}
        <code>api.telegram.org</code> directly, if you have paired a Telegram
        bot; (b) <code>/api/calendar-feed</code> on this app&apos;s origin,
        which fetches ICS calendars on your behalf; (c){" "}
        <code>/api/telegram-file</code> on this app&apos;s origin, which
        proxies Telegram CDN file downloads; and (d){" "}
        <code>va.vercel-scripts.com</code> / <code>vitals.vercel-insights.com</code>{" "}
        for anonymous page-view pings via Vercel Web Analytics. Enabling
        Offline mode (below) blocks destinations (b), (c), and (d). Direct{" "}
        Telegram polling continues regardless.
      </p>

      <h2>Data maintenance</h2>
      <p>
        Seven rows that each kick off a one-shot cleanup pass over your on-disk
        data. The first row is an import button for bringing experiments in
        from another ResearchOS user. The next four rows are repair buttons
        that normalize older task and method files. The sixth row reconciles
        cross-owner project sharing. The seventh row cleans up orphaned
        LabArchives credentials. The app already understands the older shapes
        on read, so the repair buttons aren&apos;t required to keep things
        working. They tidy files so the long tail of old data uses the current
        format. Every button is safe to re-run.
      </p>
      <p>
        Click any button and a status line appears below the description
        showing what the pass scanned, repaired, or appended (plus a red
        &ldquo;failed&rdquo; count if anything broke).
      </p>
      <ul>
        <li>
          <strong>Import experiment</strong>, opens a dialog for loading an
          experiment exported by another ResearchOS user (a{" "}
          <code>-raw.zip</code> bundle). You match its project and methods
          against your own before anything is written.
        </li>
        <li>
          <strong>Repair method links</strong>, rewrites tasks that still
          store their linked method in the old <code>method_id</code> field
          into the current multi-method shape.
        </li>
        <li>
          <strong>Repair method source paths</strong>, walks every method
          (private and public) and renames the legacy <code>github_path</code>{" "}
          field to <code>source_path</code>. Same value, just under a new key.
        </li>
        <li>
          <strong>Split Lab Notes / Results attachments</strong>, walks every
          task you own and splits the shared per-task <code>Files/</code> and{" "}
          <code>Images/</code> folders into per-tab folders (one set under{" "}
          <em>notes/</em>, one under <em>results/</em>), copying each file into
          whichever tab body references it and rewriting markdown links to
          match. Files referenced by neither body stay put in the legacy
          folder.
        </li>
        <li>
          <strong>Repair stamp formats</strong>, walks every notes, results,
          and method markdown file and rewrites the legacy stamp header at the
          top into the newer HTML-comment format. Older files render fine, but
          a stray stamp-end line sometimes bleeds into the preview until this
          repair runs.
        </li>
        <li>
          <strong>Reconcile cross-owner project sharing</strong>, walks every
          task and every project hosted manifest and fixes drift between the
          two sides (a hosted task that&apos;s no longer marked as external on
          its origin, or a manifest entry pointing at a deleted task). Safe to
          run any time, with no destructive operations beyond pruning broken
          refs.
        </li>
        <li>
          <strong>Clean up orphaned LabArchives credentials</strong>, scans for
          two sidecar files left behind by the removed institutional LabArchives
          API: <code>_labarchives-deployer.json</code> at the folder root
          (which stored an institutional access password in plaintext) and{" "}
          <code>users/&lt;u&gt;/_labarchives.json</code> per user. If orphans
          are found, the button shows a confirmation before deleting. An amber
          detection banner appears above the row automatically when these files
          are present.
        </li>
      </ul>
      <Callout variant="tip" title="When to run these">
        Run the repair buttons once, in order, the first time you open a
        long-lived folder after a ResearchOS update. After that, you only need
        to re-run them if you notice old-format files appearing (for example,
        a task synced from another user who hasn&apos;t run them yet). They
        never delete data, only rewrite fields in place.
      </Callout>

      <h2>Onboarding</h2>
      <p>
        A single row for restarting the v4 BeakerBot walkthrough on your real
        account. New users see the tour automatically on their first sign-in;
        existing users can opt back in here any time.
      </p>
      <p>
        Clicking <strong>Re-run tour</strong> clears the tour&apos;s completion
        and skip flags so Phase 1 setup runs again, then launches the in-product
        walkthrough immediately without a page reload.
      </p>
      <p>
        If a previous tour left demo data on your real account (because the
        auto-cleanup at the end was skipped), an <strong>amber recovery
        banner</strong> appears above the button. It shows the count of
        leftover demo items and explains that re-running the tour will offer
        to clean them up at the end.
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
        entirely. Passwords are hashed with PBKDF2-SHA-256 at 600k iterations
        before being written to disk.
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
        link&rdquo; email. To clear a forgotten password, open the shared
        data folder in Finder or Explorer, go into{" "}
        <code>users/&lt;you&gt;/</code>, and delete{" "}
        <code>_auth.json</code>. Sign in again and the gate is gone. A lab
        admin (or anyone with access to the folder) can do this for you. The
        Account password popup&apos;s &ldquo;Forgot your password?&rdquo;
        link walks through the same steps inside the app.
      </Callout>

      <h2>Offline mode</h2>
      <p>
        A single toggle, <strong>Block calls to our server</strong>, that
        disables the two proxy routes the app uses for external data fetching:
        <code>/api/calendar-feed</code> (ICS calendar sync) and{" "}
        <code>/api/telegram-file</code> (Telegram CDN file downloads). Enabling
        this makes the app make no outbound calls to its own server.
      </p>
      <p>
        Direct Telegram polling (browser to <code>api.telegram.org</code>)
        continues regardless of this setting, because that path does not go
        through the app&apos;s proxy. An amber notice appears while the toggle
        is on, confirming which features are paused.
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
