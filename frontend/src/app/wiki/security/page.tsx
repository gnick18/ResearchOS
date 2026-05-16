import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import WikiPage from "@/components/wiki/WikiPage";
import Kbd from "@/components/wiki/Kbd";

export default function SecurityPage() {
  return (
    <WikiPage
      intro="Your research data stays on your computer. We never see it. This page is the plain-English version of what that means in practice, where the narrow exceptions are, and how you can verify the claim for yourself."
    >
      <h2>The claim</h2>
      <p>
        ResearchOS is built as a browser-only app that reads and writes a
        folder you pick on your own machine. Your notes, results, project
        and task data, images, attachments, Telegram inbox, and calendar
        subscriptions all stay in that folder. Nothing about your work is
        uploaded to a database we control, because there is no database
        we control. Two narrow proxy routes exist for browser CORS reasons
        and are documented below, but they are streams, not stores.
      </p>

      <h2>What stays on your computer</h2>
      <Callout variant="tip" title="The short version">
        Open your data folder in Finder or Explorer. Every experiment,
        note, image, and attachment you have written is sitting there as
        a regular file you can read. ResearchOS writes to that folder and
        nowhere else. Quit the app and your data stays exactly where it
        is.
      </Callout>
      <p>
        When you pick a data folder, ResearchOS reads and writes
        everything directly to that folder on your machine. The bytes
        never leave it. You can open the folder at any time in your
        operating system&apos;s file browser and see exactly what is
        there.
      </p>
      <p>The folder holds:</p>
      <ul>
        <li>Every experiment, lab note, and result you write.</li>
        <li>
          Every image, PDF, and arbitrary attachment you drop into a note.
        </li>
        <li>
          The JSON for projects, tasks, dependencies, methods, and PCR
          protocols.
        </li>
        <li>Your Telegram bot token and any photos that arrived through it.</li>
        <li>Your calendar subscription URLs and the events they pulled in.</li>
        <li>
          The optional PBKDF2-hashed password protecting your per-user
          profile.
        </li>
      </ul>
      <details className="mt-4 border border-gray-200 rounded-lg p-3 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer font-medium text-gray-800">
          Show me the exact file layout
        </summary>
        <pre className="text-xs overflow-x-auto">
          <code>
{`<your data folder>/
  .gitignore                     app-managed, auto-appended for sensitive sidecars
  users/
    _user_metadata.json          cross-user color preferences + display names
    _global_counters.json        cross-user id allocator
    public/                      methods + PCR protocols shared across all users
    lab/                         shared lab-account state (funding accounts, etc.)
    <username>/
      settings.json              user settings, default views, tab visibility
      _auth.json                 PBKDF2-hashed password (only if set)
      _counters.json             id counters per entity type
      _shared_with_me.json       inbound sharing pointers
      _telegram.json             Telegram bot token + inbox state (gitignored)
      _calendar-feeds.json       subscribed iCal URLs
      _notifications.json        bell-dropdown rows
      projects/<id>.json         one flat file per project
      tasks/<id>.json            one flat file per task (the JSON carries
                                 fields; long-form text and attachments
                                 live under results/task-<id>/ below)
      methods/<id>.json          reusable protocols
      pcr_protocols/<id>.json    PCR programs and recipes
      lc_gradients/<id>.json     LC gradient programs
      cell_culture_schedules/<id>.json
      plate_layouts/<id>.json
      notes/<id>.json            shared lab notes
      results/task-<id>/         per-task long-form content + attachments
        notes.md                 your Lab Notes tab writeup
        results.md               your Results tab writeup
        notes/Images/            images dropped into Lab Notes tab
        notes/Files/             files dropped into Lab Notes tab
        results/Images/          images dropped into Results tab
        results/Files/           files dropped into Results tab
      events/<id>.json           native calendar events
      goals/<id>.json            project goals
      lab_links/<id>.json        link library entries
      purchase_items/<id>.json   purchase orders
      inbox/Images/              Telegram photos awaiting routing`}
          </code>
        </pre>
      </details>

      <h2>What briefly touches a server we operate</h2>
      <p>
        Three routes on the ResearchOS server are involved. The first two
        are CORS-bypass streams that exist because browsers refuse to talk
        directly to the upstream services. The third is an anonymous
        page-view ping. None of them ever sees the contents of your data
        folder.
      </p>
      <ul>
        <li>
          <strong>Calendar feed sync.</strong> When you subscribe to an iCal
          URL (Google, Outlook, iCloud, a university calendar), the browser
          asks <code>/api/calendar-feed</code> to fetch the iCal text from
          the upstream and stream it back. A 15-minute edge cache keeps
          repeated polls from hammering the upstream. We do not persist the
          URL or the contents.
        </li>
        <li>
          <strong>Telegram file CDN.</strong> When a photo arrives through
          your bot, the browser asks <code>/api/telegram-file</code> to
          fetch the bytes from Telegram (whose CDN refuses to set CORS
          headers, so the browser cannot reach it directly). The bot token
          travels in a request header, never in the URL. The bytes stream
          straight through to your folder and we keep none of them.
        </li>
        <li>
          <strong>Vercel Web Analytics.</strong> When you navigate between
          pages, your browser sends an anonymous page-view beacon to Vercel
          telling them which route you visited. No IDs, no folder contents,
          no typed text, no markdown bodies, no project names. Vercel sees
          your IP address (which they hash before storage per their privacy
          policy). The <strong>Settings &rarr; Offline mode</strong> toggle
          disables it durably, the script tag is never injected when
          offline mode is on.
        </li>
      </ul>
      <p>
        The two CORS-bypass proxy routes use the most defensive shape we
        know how to write: HTTPS only, private-IP blocking, redirect
        re-validation, byte cap, timeout, content-type denylist, and
        per-IP rate limiting. The Vercel Analytics endpoint is a
        Vercel-owned script and beacon target, its posture is Vercel&apos;s,
        not ours. The route-defense code is in{" "}
        <code>frontend/src/lib/api/url-guards.ts</code> and{" "}
        <code>frontend/src/lib/api/rate-limit.ts</code> if you want to read
        it line by line.
      </p>
      <Callout variant="info" title="One more thing on the Telegram surface: a browser-side recovery cache">
        <p>
          If your <code>_telegram.json</code> sidecar disappears (a
          misshared OneDrive deletion, an iCloud sync hiccup, a lab-mate
          tidying up), the app can offer a one-click recovery prompt
          instead of making you re-pair from BotFather. The credentials
          that power that prompt live in a browser-scoped IndexedDB store
          (<code>research-os-telegram-token-cache</code>), not on any
          server we operate. The cache stores only{" "}
          <code>bot_token</code>, <code>chat_id</code>, and{" "}
          <code>bot_username</code>, keyed by{" "}
          <code>(folderName, username)</code>.
        </p>
        <p>
          The cache is symmetric in risk with the disk sidecar: both are
          DevTools-readable on the local machine, and the cache is NOT
          exposed via cloud-folder share (browser-scoped, not
          file-scoped). This is actually a small win over disk-only
          storage for the multi-user-folder case, Alice&apos;s cached
          token is invisible to Bob even when they share a OneDrive
          folder.
        </p>
        <p>
          The only network call adjacent to the cache is a{" "}
          <code>getMe</code> round-trip to{" "}
          <code>api.telegram.org</code> to confirm the cached token still
          works before the recovery prompt offers it. That call goes
          direct from your browser to Telegram, the same path the bot
          polling already uses. The <strong>Forget</strong> button in
          Settings &rarr; Data inventory wipes every cache row for the
          current folder in one click.
        </p>
      </Callout>

      <h2>What we collect, and what we don&apos;t</h2>
      <p>
        We collect anonymous page-view pings via Vercel Web Analytics. When
        you navigate between pages, an anonymous beacon goes to Vercel. No
        IDs, no folder contents, no typed text, no markdown bodies. We use
        this to know which pages get used and which sit idle.{" "}
        <strong>Settings &rarr; Offline mode</strong> disables it durably,
        the analytics script is never injected when the toggle is on, and
        the toggle is read at component-mount time so the choice survives
        reloads.
      </p>
      <p>
        We do not collect anything else. No Sentry, no Google Analytics, no
        Mixpanel, no PostHog, no Hotjar, no Datadog, no Amplitude. No
        background phone-home. No crash reporter. No content telemetry.
        Running <code>npm ls</code> against the repo will confirm only{" "}
        <code>@vercel/analytics</code> is present, and the network tab will
        confirm no other endpoints are contacted.
      </p>
      <p>
        The <strong>Report an issue</strong> button does not auto-submit
        anything. When you click it, your browser opens a pre-filled GitHub
        issue URL in a new tab. You see the body, edit it, and click{" "}
        <strong>Submit</strong>. Nothing happens until you do.
      </p>
      <Screenshot
        src="/wiki/screenshots/feedback-modal.png"
        alt="The Report an Issue modal, showing the Type radio group, an editable Title field, an editable description, optional auto-attached error details, and the Cancel / Copy Link / Create GitHub Issue buttons at the bottom."
        caption="The Report an Issue modal. You see the body, you edit the body, you choose whether to submit."
      />

      <h2>Honest limits worth knowing about</h2>
      <p>
        The above claims are real. They have implications you should make
        peace with before you trust ResearchOS with anything sensitive.
      </p>
      <Callout variant="warning" title="Folder sharing means folder trust">
        If you share your data folder with a lab-mate over OneDrive,
        Dropbox, Google Drive, or iCloud, every byte in it is theirs to
        read. The per-user password gate stops accidental account-switching
        inside the app, not someone opening the folder in their own file
        browser.
      </Callout>
      <Callout variant="warning" title="Passwords aren't encryption">
        We hash account passwords with PBKDF2-SHA-256 (600,000 iterations)
        so a snooping co-located user can&apos;t trivially read them, but
        the data itself sits in plaintext on disk. Anyone with disk access
        has it. Turn on OS-level full-disk encryption (FileVault on macOS,
        BitLocker on Windows) if your laptop walks around.
      </Callout>
      <Callout variant="warning" title="Bot tokens are real credentials">
        Your Telegram bot token lives in plaintext in{" "}
        <code>users/&lt;u&gt;/_telegram.json</code>. We auto-gitignore the
        file so it doesn&apos;t slip into a <code>git push</code>, but
        anyone who reads the file can post and read messages on your
        bot&apos;s chats. Treat it like any other API key.
      </Callout>
      <Callout variant="warning" title="Public hosting is opt-in, and the proxies are open">
        If you self-host ResearchOS on a public Vercel deploy with no auth
        gate, anyone on the internet can hit the two proxy routes (subject
        to rate limiting). This is not a data-exfiltration risk because the
        proxies have no access to your data folder, but it does mean
        someone could burn your Vercel function budget. Set{" "}
        <code>UPSTASH_REDIS_REST_URL</code> for shared-state rate limiting
        on public deploys. The wiring is already in place.
      </Callout>

      <h2>How to verify it yourself</h2>
      <p>
        You don&apos;t have to take any of this on faith. There are two
        ways to confirm what the app is doing. The first is built into
        Settings and takes about thirty seconds.
      </p>
      <Callout variant="tip" title="The easy way: open Settings">
        ResearchOS ships three affordances inside Settings:
        <ul>
          <li>
            The <strong>Data inventory</strong> panel lists every file path
            the app has written and every IndexedDB key in use, alongside
            an External Calls section that names each outbound endpoint
            in plain English.
          </li>
          <li>
            The <strong>Offline mode</strong> toggle disables the two proxy
            routes plus the Vercel Analytics script tag in one click, for
            anyone who wants zero outbound network from the app surface.
          </li>
          <li>
            <strong>&ldquo;Where is this stored?&rdquo;</strong> hints on
            each integration field so you always know which file holds the
            credential you just entered.
          </li>
        </ul>
      </Callout>
      <details className="mt-4 border border-gray-200 rounded-lg p-3 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer font-medium text-gray-800">
          The thorough way: open DevTools and watch the network yourself
        </summary>
        <p className="text-sm text-gray-700 mt-2">
          Your browser already shows every network request the app makes.
          This is the audit-grade path for anyone who wants to see the
          bytes themselves.
        </p>
        <Steps>
          <Step>
            Open ResearchOS in Chrome, Edge, or Brave, then open DevTools.{" "}
            <Kbd>F12</Kbd> works on Windows and Linux. <Kbd>Cmd</Kbd> +{" "}
            <Kbd>Option</Kbd> + <Kbd>I</Kbd> works on macOS.
          </Step>
          <Step>
            Switch to the <strong>Network</strong> tab and check{" "}
            <strong>Preserve log</strong> so refreshes don&apos;t clear
            the view.
          </Step>
          <Step>
            Reload the page. Visit Calendar, Telegram inbox, the
            experiments you care about. Watch every outbound request as
            you go.
          </Step>
          <Step>
            You should see requests to your own ResearchOS origin (for
            JavaScript, CSS, and static assets), occasional requests to{" "}
            <code>/api/calendar-feed</code> when a subscribed feed
            refreshes, occasional requests to{" "}
            <code>/api/telegram-file</code> when an inbox photo loads,
            direct requests to <code>api.telegram.org</code> when you
            exchange messages with your bot, and occasional requests to{" "}
            <code>va.vercel-scripts.com</code> and{" "}
            <code>vitals.vercel-insights.com</code> for anonymous
            page-view pings (unless <strong>Offline mode</strong> is on,
            in which case you&apos;ll see none of those). Nothing else.
          </Step>
          <Step>
            For a second pass, switch from the <strong>Network</strong>{" "}
            tab to <strong>Application</strong>{" "}
            &rarr; <strong>IndexedDB</strong>. ResearchOS uses three
            IndexedDB databases.
            <ul>
              <li>
                The first, <code>research-os-fsa</code>, holds the
                opaque File System Access handle for your data folder.
                This is what gives the browser permission to read and
                write the folder you picked.
              </li>
              <li>
                The second, <code>keyval-store</code>, holds three small
                session-routing strings: the folder name plus its grant
                timestamp, the currently signed-in user, and (if you are
                using Lab Mode) the primary account.
              </li>
              <li>
                The third,{" "}
                <code>research-os-telegram-token-cache</code>, exists
                only if you have paired a Telegram bot. It holds one row
                per paired-user-in-this-folder, with the minimal
                credentials <code>bot_token</code>, <code>chat_id</code>,{" "}
                <code>bot_username</code>, keyed by{" "}
                <code>(folderName, username)</code>.
              </li>
            </ul>
            A fresh install with no Telegram pairing shows two
            databases, not three (four IDB keys total, not five). Expand
            the <code>tokens</code> store under{" "}
            <code>research-os-telegram-token-cache</code> to confirm the
            row holds only the three fields named above. Clicking the
            rose <strong>Forget</strong> button in Settings &rarr; Data
            inventory wipes every row for the current folder, the
            change shows up here on the next DevTools refresh.
          </Step>
        </Steps>
      </details>

      <h2>What we just fixed</h2>
      <p>
        ResearchOS went through an internal security audit on 2026-05-15.
        It closed one Critical finding (cross-site scripting via
        unsanitized markdown HTML across all 8 markdown rendering sites in
        the app) and several Important findings around the proxy routes,
        the LabArchives credential flow, the Telegram credential recovery
        surface, and the in-app verification surface (data inventory,
        offline mode, storage hints). The audit
        report is checked into the repo as{" "}
        <a
          href="https://github.com/gnick18/ResearchOS/blob/main/SECURITY_AUDIT.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          SECURITY_AUDIT.md
        </a>
        , and the merge batch on <code>main</code> sits around{" "}
        <code>94f0ab08</code> (audit doc) and <code>813748a5</code>{" "}
        (XSS sanitize + CSP).
      </p>
      <p>
        If you find something that looks wrong, open a GitHub issue (the{" "}
        <strong>Report an issue</strong> button is the fastest path) or
        email the maintainer directly. We&apos;d much rather hear about a
        problem early.
      </p>
    </WikiPage>
  );
}
