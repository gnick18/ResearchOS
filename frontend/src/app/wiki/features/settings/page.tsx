import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SettingsFeaturePage() {
  return (
    <WikiPage
      title="Settings"
      intro="Ten panels stacked top to bottom: profile, header tabs, LabArchives import, sidebar, view defaults, the task-completion animation, notifications and safety prompts, on-disk data repair tools, onboarding tips, and your account password. Reach the page through the gear icon in the top-right of the header."
    >
      <Screenshot
        src="/wiki/screenshots/settings.png"
        alt="The Settings page with its stack of panels: Profile, Tabs, LabArchives, Sidebar, View defaults, Animation, Notifications & behavior, Data maintenance, Tips, and Security."
      />

      <p>
        Each change saves the moment you toggle, type, or pick a new option. A
        small &ldquo;Saving&hellip;&rdquo; pill near the page title flips to a
        green &ldquo;Saved&rdquo; for about a second, then disappears. The path
        printed under the page title shows where your preferences are stored
        on disk (<code>users/&lt;you&gt;/settings.json</code>), which is handy
        if you ever need to hand-edit or copy them between labs.
      </p>

      <h2>Profile</h2>
      <p>
        The top panel sets how the rest of the app addresses you. A large
        avatar bubble on the left previews the gradient that&apos;ll appear in
        comments, lab views, and the user-picker. The <strong>Display name</strong>{" "}
        field overrides your folder name (leave it blank to fall back to the
        folder name). The <strong>User color</strong> swatches are a fixed
        10-color palette. Clicking one updates the avatar preview instantly and
        refreshes every avatar bubble across the app on the next paint.
      </p>
      <p>
        The <strong>Tint header with my color</strong> toggle controls one
        thing, whether the top header bar uses your gradient or stays plain
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
        If you uncheck both toggles, an amber warning appears, the sidebar
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
        Choices range from <em>Celebration</em> (confetti, unicorns,
        rainbows) and <em>Rock &amp; Roll</em> (guitars, lightning) to subtler
        themes like <em>Science</em> (atoms, DNA, beakers),{" "}
        <em>Plants</em>, <em>Fungi</em>, and <em>Underwater</em>. Pick the one
        that suits your vibe. The change takes effect the next time you check
        off a task.
      </p>

      <h2>Notifications &amp; behavior</h2>
      <p>
        Three master switches for messaging and safety prompts.
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
          <strong>Confirm destructive actions</strong>, when on, the app shows
          an &ldquo;Are you sure?&rdquo; prompt before you delete a task,
          project, or similar object. Switching it off skips the prompt for
          power-user use.
        </li>
        <li>
          <strong>Hide my goals from lab view</strong>, when on, other lab
          members won&apos;t see your goals in their aggregated Lab Mode
          roadmap. The flag is also mirrored to the shared{" "}
          <code>_user_metadata.json</code> file so the lab-mode reader picks it
          up immediately.
        </li>
      </ul>

      <h2>Data maintenance</h2>
      <p>
        Six rows that each kick off a one-shot cleanup pass over your on-disk
        data. The first row is an import button for bringing experiments in
        from another ResearchOS user. The next four rows are repair buttons
        that normalize older task and method files. The last row reconciles
        cross-owner project sharing. The app already understands the older
        shapes on read, so the repair buttons aren&apos;t required to keep
        things working. They tidy files so the long tail of old data uses the
        current format. Every button is safe to re-run. Re-running on
        already-normalized files just reports them as &ldquo;already clean.&rdquo;
      </p>
      <p>
        Click any <strong>Run repair</strong>, <strong>Run reconcile</strong>,
        or <strong>Import .zip</strong> button and a status line appears below
        the description showing what the pass scanned, repaired, or appended
        (plus a red &ldquo;failed&rdquo; count if anything broke).
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
      </ul>
      <Callout variant="tip" title="When to run these">
        Run the repair buttons once, in order, the first time you open a
        long-lived folder after a ResearchOS update. After that, you only need
        to re-run them if you notice old-format files appearing (for example,
        a task synced from another user who hasn&apos;t run them yet). They
        never delete data, only rewrite fields in place.
      </Callout>

      <h2>Tips</h2>
      <p>
        Controls for the onboarding-tip mascot that points at new affordances
        the first time you visit a page. A <strong>How should I help?</strong>{" "}
        block at the top has three radio options.
      </p>
      <ul>
        <li>
          <strong>Walk me through it</strong>, force-fire each tip one after
          another, 60 seconds apart. Best on day one.
        </li>
        <li>
          <strong>Show me as I go</strong>, land a tip about every 5 minutes
          when the matching feature is on screen. The default for most users.
        </li>
        <li>
          <strong>Stay quiet, thanks</strong>, no tips at all. You can flip
          this back on any time.
        </li>
      </ul>
      <p>
        Below the radio block, a <strong>Replay tips</strong> button clears
        your per-tip dismiss history and resets the cooldown so the whole
        sequence fires again as you visit pages. A small green confirmation
        line appears under the description for a few seconds after you click.
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
