import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import TryInDemo from "@/components/wiki/TryInDemo";

export default function SettingsFeaturePage() {
  return (
    <WikiPage
      title="Settings"
      intro="A left-rail shell that organizes every preference into groups. Click a rail item to load its section in the pane. Reach Settings from the gear icon in the top-right of the header, or press Escape inside the page to go back."
    >
      <Screenshot
        src="/wiki/screenshots/settings-rail-overview.png"
        alt="The Settings page showing the left navigation rail with groups You, Usage and billing, Workspace, and Data, and a section pane on the right with Profile and appearance open."
        caption="The left rail groups all sections. Click any item to open it on the right."
      />

      <p>
        Each change saves the moment you toggle, type, or pick a new option. A
        small &ldquo;Saving&hellip;&rdquo; indicator near the page title flips
        to a green &ldquo;Saved&rdquo; for about a second, then disappears. The
        &ldquo;Saved&rdquo; state reflects the write to your{" "}
        <code>users/&lt;you&gt;/settings.json</code> file in the connected
        data folder.
      </p>

      <h2>Rail search</h2>
      <p>
        A search bar at the top of the left rail filters the list of sections
        down to whatever matches your typed text. Type{" "}
        <code>notification</code> and only the Notifications item stays visible.
        Type <code>trash</code> and the rail narrows to Trash &amp; history. Clear
        the bar to restore the full list. The currently open section always stays
        loaded in the pane even when the search filters it out of the rail.
      </p>

      <h2>Groups and sections</h2>
      <p>
        The rail is divided into four groups. You, Usage &amp; billing, Workspace,
        and Data. Lab accounts add a fifth Lab group. A lab head&apos;s Lab group
        moves to the top of the rail so the most-used controls lead.
      </p>

      <h3>You</h3>
      <p>
        Three sections about your identity in the app.
      </p>
      <ul>
        <li>
          <strong>Profile &amp; appearance</strong> - your display name, avatar
          color and gradient, tinted header toggle, ORCID, affiliation,
          researcher profile, and the public-profile card. Also shows your
          account and keys (sharing identity, fingerprint, recovery code).
          This folds in everything that used to live on the separate{" "}
          <code>/profile</code> route.
        </li>
        <li>
          <strong>Account &amp; security</strong> - who you are signed in as,
          a Switch user button that opens the same picker as the app login
          screen, and the password gate for this account. The password wraps
          your keys with Argon2id (a deliberately slow, memory-hard function)
          before anything is written to disk. Setting a password gives you a
          one-time recovery code to store somewhere safe.
        </li>
        <li>
          <strong>Add a free account</strong> (solo users only) - a gentle
          one-card explainer of the features a free cloud account unlocks
          (BeakerBot AI, cloud storage, email and phone notifications, Companion
          pairing, and sharing). If you already have a cloud account this card
          is hidden and Usage &amp; billing appears instead.
        </li>
      </ul>

      <Callout variant="warning" title="What a password protects, and what it doesn&apos;t">
        The password gate stops someone from accidentally signing into the wrong
        account through the app UI. It does <strong>not</strong> encrypt your
        files. Anyone with direct access to the shared folder (OneDrive, Dropbox,
        iCloud) can still read your raw markdown and image files.
      </Callout>
      <Callout variant="info" title="Forgot your password?">
        On the sign-in screen, click your account and choose{" "}
        <strong>Use your recovery code</strong>. If you lost the code too, a
        lab admin can reset you from their own account. The &ldquo;Forgot your
        password?&rdquo; link inside the Account password popup walks through
        the same steps.
      </Callout>

      <h3>Usage &amp; billing</h3>
      <p>
        Visible only to users with a cloud account (or an active OAuth session).
        Solo users without an account see the Add a free account card in the You
        group instead.
      </p>

      <Screenshot
        src="/wiki/screenshots/settings-usage-billing.png"
        alt="The AI usage section showing a BeakerBot token balance, recent task costs, and three top-up packs at 10, 25, and 50 dollars."
        caption="AI usage shows your live token balance and lets you top up in one click."
      />

      <ul>
        <li>
          <strong>AI usage</strong> - your live BeakerBot token balance, recent
          task costs, and three prepaid top-up packs ($10, $25, $50). During the
          beta period, when billing enforcement is off, the section instead shows
          the &ldquo;AI is free during the beta&rdquo; framing. Token amounts for
          each pack come from the live rate, so the numbers stay accurate as
          rates change. A link to the pricing page shows the current per-token
          rate. Flagged with a &ldquo;new&rdquo; pill.
        </li>
        <li>
          <strong>Cloud storage</strong> - how much of your cloud storage cap
          you have used, what tier you are on, and a link to the pricing page
          for upgrade options. Flagged with a &ldquo;new&rdquo; pill.
        </li>
      </ul>

      <h3>Workspace</h3>
      <p>
        Controls for how the app looks and behaves for you day to day.
      </p>

      <h4 id="appearance-motion">Appearance &amp; motion</h4>
      <p>
        Three sections under one rail item.
      </p>
      <ul>
        <li>
          <strong>Appearance</strong> - three tiles (Light, Dark, System) that
          set the app theme. System follows your device. This is a per-device
          preference and does not sync between computers. The welcome page always
          stays light.
        </li>
        <li>
          <strong>Animation</strong> - a grid of celebration themes for the
          animation that plays when you complete a task. Ten themes plus a None
          tile to skip the animation entirely. Click a tile for a live preview.
          Separately, a BeakerBot animations toggle governs streak and milestone
          celebrations. The two controls are independent.
        </li>
        <li>
          <strong>Professional mode</strong> - one switch that silences the
          streak badge, the per-task animation, and BeakerBot personality at
          once. Turning it back off does not re-enable those automatically; you
          restore each one from its own panel.
        </li>
      </ul>

      <h4>Defaults</h4>
      <p>
        Four dropdowns and one toggle for the starting view on the two biggest
        pages. None of these lock you in. Flipping the view inside a page
        overrides the default for that session; reopening brings the default
        back.
      </p>
      <ul>
        <li><strong>GANTT default range</strong> - 1 week, 2 weeks, 3 weeks, 1 month, 3 months, 6 months, 1 year, or All.</li>
        <li><strong>Calendar default view</strong> - Month, Week, or Day.</li>
        <li><strong>Date format</strong> - MM/DD/YYYY (US), DD/MM/YYYY (EU), or YYYY-MM-DD (ISO).</li>
        <li><strong>Time format</strong> - 12-hour (1:30 PM) or 24-hour (13:30).</li>
        <li><strong>Show shared content by default</strong> - when on, GANTT and other views include tasks shared with you, not only your own.</li>
      </ul>

      <h4>Sidebar &amp; tabs</h4>
      <p>
        Two controls under one section.
      </p>
      <p>
        <strong>Tabs</strong> is a grid of checkboxes for every tab in the
        header. The full list is Home, Workbench, GANTT, Methods, Sequences,
        Chemistry, Data Hub, Phylogenetics, Figures, Inventory, Purchases,
        Calendar, and Links. Home is always on. Uncheck any other tab to
        hide it from your header. Below the grid, a{" "}
        <strong>Default landing tab</strong> dropdown picks where the app opens
        on load. It only lists tabs you have visible, so you can&apos;t land on
        a hidden tab.
      </p>
      <Callout variant="info" title="Settings is always reachable">
        Settings does not appear in the tabs grid. It lives behind the gear icon
        so it can never be hidden, even if you uncheck every other tab.
      </Callout>
      <p>
        <strong>Sidebar</strong> has two toggles for the left sidebar that
        appears on every page except Calendar. The Tasks toggle shows your due,
        overdue, and upcoming tasks for today. The Calendar events toggle adds
        events from any{" "}
        <Link href="/wiki/integrations/calendar-feeds">ICS feeds</Link> you
        have subscribed to. When Calendar events is on, a{" "}
        <strong>How much calendar to show</strong> dropdown lets you pick
        Today only, or Today plus the next 3, 7, 14, or 30 days. If you uncheck
        both toggles, an amber warning appears to tell you the sidebar will be
        empty on non-calendar pages.
      </p>

      <h4 id="companion">Companion</h4>
      <Screenshot
        src="/wiki/screenshots/settings-companion-section.png"
        alt="The Companion section showing an Open Companion hub button, two toggles for the header button and auto-publish snapshots, and the paired devices list."
        caption="Companion settings control the header button visibility, snapshot push, and paired devices."
      />
      <p>
        The Companion section is where you pair your phone to the{" "}
        <Link href="/wiki/companion">ResearchOS Companion app</Link> and adjust
        two push preferences.
      </p>
      <ul>
        <li>
          <strong>Open Companion hub</strong> - a button that opens the
          Companion hub popup (Connect, Info, and Settings tabs) from inside
          Settings. This is the escape hatch when the header Companion button
          is hidden, because the popup&apos;s own Settings tab is still reachable here.
        </li>
        <li>
          <strong>Show Companion button on Home</strong> - toggles the phone
          icon in the app header. Off hides it from the header; Companion is
          still reachable from this Settings section.
        </li>
        <li>
          <strong>Auto-publish snapshots to paired phones</strong> - when on,
          the laptop pushes today, inventory, and notebook snapshots to your
          paired phones. Off stops the push.
        </li>
      </ul>
      <p>
        Below the toggles, the paired devices list (from DevicesSection) shows
        every phone you have linked with a QR code, along with its last-seen
        time and an option to unpair it.
      </p>

      <h4>Notifications</h4>
      <p>
        A 5x4 routing matrix. Five notification categories (rows) crossed with
        four delivery channels (columns). Every cell is an independent toggle.
      </p>
      <p>The five categories are:</p>
      <ul>
        <li><strong>Shared &amp; assigned to me</strong> - a task, method, or project shared with you, or a task assigned or flagged for your review.</li>
        <li><strong>Comments &amp; mentions</strong> - someone comments on your work or @-mentions you.</li>
        <li><strong>Lab announcements</strong> - your PI posts a lab-wide announcement.</li>
        <li><strong>Purchases &amp; orders</strong> - an order you requested is placed or approved, or one is assigned to you.</li>
        <li><strong>Reminders &amp; schedule changes</strong> - calendar reminders, and when a shared task&apos;s date shifts.</li>
      </ul>
      <p>The four channels are:</p>
      <ul>
        <li><strong>Bell</strong> - the in-app notification bell. Always on; collects everything.</li>
        <li><strong>Laptop</strong> - desktop pop-ups on your computer.</li>
        <li><strong>Phone</strong> - push notifications to your paired Companion phone (account required).</li>
        <li><strong>Email</strong> - email delivery (account required).</li>
      </ul>
      <p>
        Phone and Email channels require a cloud account. Solo users without an
        account see a gentle upsell in those columns instead of dead controls.
      </p>

      <h4 id="ai-helper">AI Helper</h4>
      <p>
        Generates a schema-aware prompt you can paste into Claude, ChatGPT,
        Gemini, or Microsoft Copilot to turn it into a support assistant that
        understands your ResearchOS data model. The section has three parts, a
        size picker, a copy button, and one-click open-in buttons.
      </p>
      <p>
        The <strong>size picker</strong> is a three-option radio group. Token
        counts are read live from the AI Helper manifest at runtime, so they
        reflect the current build rather than a hardcoded figure.
      </p>
      <ul>
        <li>
          <strong>Lean</strong> - fits most chat windows including free-tier
          context limits.
        </li>
        <li>
          <strong>Full (recommended)</strong> - best for big-context models like
          Claude Sonnet, GPT-5, or Gemini 2.5 Pro.
        </li>
        <li>
          <strong>Minimal</strong> - for tiny windows or local models.
        </li>
      </ul>
      <p>
        The <strong>Copy prompt to clipboard</strong> button copies the selected
        size&apos;s markdown. The <strong>Open in your AI</strong> row has four
        buttons (Claude, ChatGPT, Gemini, Copilot). Each one copies the prompt
        and opens that provider in a new tab.
      </p>
      <p>
        When the prompt served by the app is older than the running code, an
        amber stale-prompt callout appears with a{" "}
        <strong>Pull latest from research-os-xi.vercel.app</strong> trapdoor.
        Clicking it fetches the current manifest and prompt from the live deploy
        cross-origin. A freshness footer below the buttons shows the date the
        prompt was built and the commit it came from.
      </p>

      <h4>Behavior</h4>
      <p>
        Two toggles. <strong>Confirm destructive actions</strong> shows an
        &ldquo;Are you sure?&rdquo; prompt before you delete a task, project,
        or similar object. Switching it off skips the prompt.{" "}
        <strong>Spell-check in the editor</strong> underlines likely
        misspellings as you write notes. It is off by default because bench
        shorthand (gene names, reagents, abbreviations) reads as misspelled. The
        dictionary already knows common lab terms; you can add any flagged word
        to your own dictionary.
      </p>

      <h4 id="streaks">Streaks &amp; PTO</h4>
      <p>
        Tracks how many workdays in a row you have saved something in
        ResearchOS. Streak data is stored in a per-user sidecar and is visible
        only to you.
      </p>
      <p>
        The section has a single <strong>Enable streak tracking</strong> toggle.
        Disabling it pauses tracking but preserves your existing count so you can
        re-enable later without losing your history. When enabled, a stat trio
        appears below the toggle showing your current streak, personal best
        (always preserved even after a reset), and the date the current run
        began.
      </p>
      <p>
        The <strong>Reset streak</strong> button (red) zeros the current count.
        A confirmation modal shows your count and asks whether you also want to
        clear celebrations seen (so milestone animations can re-fire). Click
        Cancel to back out.
      </p>
      <p>
        Below the reset, the <strong>PTO</strong> subsection lets you mark
        planned days off so the streak counter skips them.
      </p>

      <h4>Tips</h4>
      <p>
        Two cards. <strong>What&apos;s new</strong> opens the release notes
        modal listing the most recent feature additions. <strong>Explore
        demo</strong> launches the app in demo mode with a pre-seeded folder so
        you can try any feature without touching your real data.
      </p>

      <h3>Data</h3>
      <p>
        Controls for your connected folder, local data inventory, and import or
        maintenance tasks.
      </p>
      <ul>
        <li>
          <strong>Data folder</strong> - the folder this app currently reads and
          writes. A <strong>Connect or switch folder</strong> button re-points
          the app at a different folder. Switching never moves or deletes any
          files.
        </li>
        <li>
          <strong>Inventory &amp; export</strong> - a read-only transparency
          panel. Files on disk lists every file path the app has written to your
          folder, grouped by top-level directory. Browser IndexedDB keys lists
          the four known keys the app keeps in your browser (the folder access
          handle, handle metadata, current user, and main user). External calls
          lists every destination the browser contacts when using ResearchOS:
          the <code>/api/calendar-feed</code> proxy, Vercel anonymous analytics
          (<code>va.vercel-scripts.com</code> and{" "}
          <code>vitals.vercel-insights.com</code>), and the live deploy domain
          (<code>research-os-xi.vercel.app</code>) when you pull the latest AI
          Helper prompt.
        </li>
        <li>
          <strong>Trash &amp; history</strong> - the cleanup window radio picks
          how long deleted records stay recoverable (a fixed number of days, or
          never auto-purge). An Open trash link takes you to the{" "}
          <Link href="/wiki/features/trash">trash page</Link> to restore or
          permanently delete items.
        </li>
        <li>
          <strong>Maintenance</strong> - an Import experiment button for
          bringing in a <code>-raw.zip</code> bundle another ResearchOS user
          exported, and a Format upgrades row that shows how many background
          format checks have run. A Re-run all checks button replays the whole
          set for support or power-user cases. Format upgrades now run
          automatically at folder-connect time.
        </li>
        <li>
          <strong>Lab archives</strong> - the LabArchives import wizard. A
          single card with an Open import button that lets you bring a
          LabArchives Offline Notebook ZIP into ResearchOS, mapping each
          notebook page to a task and each folder to a project. See the{" "}
          <Link href="/wiki/integrations/labarchives">LabArchives integration page</Link>{" "}
          for the full walkthrough.
        </li>
        <li>
          <strong>Offline &amp; sync</strong> - a Block calls to our server
          toggle that disables the <code>/api/calendar-feed</code> proxy route.
          An amber notice confirms which features are paused while the toggle
          is on.
        </li>
      </ul>

      <Callout variant="info" title="Settings are per-user, per-folder">
        Every user&apos;s preferences are stored at{" "}
        <code>users/&lt;you&gt;/settings.json</code> inside the connected data
        folder. Switching users in the picker loads that user&apos;s settings.
        Switching to a different folder gives you a clean slate of defaults
        until you tweak it.
      </Callout>

      <h3>Lab group (lab accounts)</h3>
      <p>
        Lab accounts see a Lab group in the rail. For a lab head, this group
        moves to the top of the rail. Lab members see only the Members section;
        the PI-only sections (Audit trail, Retention registry, and Department
        routing) stay hidden.
      </p>

      <Screenshot
        src="/wiki/screenshots/settings-lab-members.png"
        alt="The Members section showing the cloud lab roster with an invite link and pending join requests, and below it the folder roster with archive and restore controls."
        caption="Members combines the cloud lab roster and the folder roster on one page."
      />

      <ul>
        <li>
          <strong>Members</strong> - a unified view of the cloud lab roster
          (invite link, pending join requests) and the folder roster (archive
          and restore for a legacy multi-user folder). If there are pending join
          requests, the Members rail item shows a red count pill and an
          attention dot so a PI can see it at a glance without opening the
          section.
        </li>
        <li>
          <strong>Lab settings</strong> - the Account type tile (Member vs PI)
          that reshapes your nav and available controls, plus, for a lab head,
          the lab identity card (name, PI title, optional logo) and the
          membership agreement (mode, visibility, approval policy). Clicking
          a non-current Account type tile opens a confirmation dialog before
          writing anything, and a 10-second Switch back toast lets you undo.
        </li>
        <li>
          <strong>Audit trail</strong> (PI only) - a read-only log of every
          field change you saved to a member&apos;s record as the lab head.
          An Open audit trail button launches the viewer with a member picker.
          This surface never edits anything.
        </li>
        <li>
          <strong>Retention registry</strong> (PI only) - configure per-funder
          and per-member retention policy and run a folder manifest for
          compliance records.
        </li>
        <li>
          <strong>Department routing</strong> (PI only) - opt in to the purchase
          routing module. Add department and HR contacts, and edit the draft
          email template that the Send to department button on a purchase populates.
          Drafts open in your own mail app, so they send from your real address
          with no stored credentials.
        </li>
      </ul>

      <TryInDemo href="/settings">Open Settings in demo mode</TryInDemo>
    </WikiPage>
  );
}
