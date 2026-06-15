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
        and task data, images, attachments, and calendar
        subscriptions all stay in that folder. Nothing about your work is
        uploaded to a database we control, because there is no database
        we control. A couple of narrow proxy routes we wrote exist for
        browser CORS reasons and are documented below, but they are
        streams, not stores. Vercel Web Analytics adds one outbound
        destination, also documented below.
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
      <p>Here is what the folder holds.</p>
      <ul>
        <li>Every experiment, lab note, and result you write.</li>
        <li>
          Every image, PDF, and arbitrary attachment you drop into a note.
        </li>
        <li>
          The JSON for projects, tasks, dependencies, methods, and PCR
          protocols.
        </li>
        <li>Your calendar subscription URLs and the events they pulled in.</li>
        <li>
          The Argon2id-protected credentials in <code>_account.json</code>{" "}
          guarding your per-user profile.
        </li>
      </ul>
      <details className="mt-4 border border-border rounded-lg p-3 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer font-medium text-foreground">
          Show me the exact file layout
        </summary>
        <pre className="text-meta overflow-x-auto">
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
      _account.json              Argon2id-protected credentials (replaces _auth.json)
      _counters.json             id counters per entity type
      _shared_with_me.json       inbound sharing pointers
      _calendar-feeds.json       subscribed iCal URLs
      _notifications.json        bell-dropdown rows
      _history/                  per-record version history (.jsonl append logs)
        task/<id>.jsonl
        task_notes/<id>.jsonl
        task_results/<id>.jsonl
        project/<id>.jsonl
        notes/<id>.jsonl
        sequences/<id>.jsonl
        molecules/<id>.jsonl
        inventory_items/<id>.jsonl
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
      sequences/<id>.json        DNA/RNA/protein sequences
      molecules/<id>.json        chemical structures
      inventory_items/<id>.json  inventory catalog entries
      datahub/<id>.json          Data Hub datasets
      phylo/<id>.json            phylogenetic tree files
      figures/<id>.json          figure composer artboards
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
      inbox/Images/              photos awaiting routing`}
          </code>
        </pre>
      </details>

      <h2>What briefly touches a server we operate</h2>
      <p>
        A few routes on the ResearchOS server are involved. Two are
        CORS-bypass streams that exist because browsers refuse to talk
        directly to the upstream service. One is the optional AI assistant.
        The last two are anonymous telemetry, a page-view ping and a
        feature-usage beacon. None of them ever sees the contents of your
        data folder.
      </p>
      <ul>
        <li>
          <strong>Calendar feed sync.</strong> When you subscribe to an iCal
          URL (Google, Outlook, iCloud, a university calendar), the browser
          asks <code>/api/calendar-feed</code> to fetch the iCal text from
          the upstream and stream it back. The subscription URL travels in
          the <code>x-calendar-url</code> request header rather than in the
          URL query string, so it is never written to Vercel access logs. A
          15-minute edge cache keeps repeated polls from hammering the
          upstream. We do not persist the URL or the contents.
        </li>
        <li>
          <strong>ORCID publication lookup.</strong> When you view a
          researcher profile that lists an ORCID iD (during sharing or
          profile setup), the browser asks{" "}
          <code>/api/orcid/works</code> to fetch that person&apos;s public
          publication list from the ORCID API and hand it back. ORCID&apos;s
          API isn&apos;t CORS-open, so the call has to go server-side. The
          route only ever touches public ORCID data, it&apos;s rate-limited
          per IP, and it stores nothing.
        </li>
        <li>
          <strong>BeakerBot AI assistant.</strong> When you send a message to
          the built-in AI assistant (BeakerBot), the browser calls{" "}
          <code>/api/ai/chat</code>, which forwards the conversation to the
          Fireworks inference API and streams the response back. The route is
          only active when <code>AI_ASSISTANT_ENABLED</code> is on. It stores
          nothing server-side. No message content, no conversation history,
          and no file contents are persisted on our servers. Your local
          records are read on your machine and bundled into the request
          entirely in the browser before the call is made.
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
        <li>
          <strong>Feature-usage beacon.</strong> When you use a tracked
          feature like sending a share or publishing a directory profile, the
          browser fires a small anonymous beacon to{" "}
          <code>/api/analytics/event</code> so the operator dashboard can count
          how often features get used. The payload is allow-listed enum and
          boolean flags only (was an ORCID present, did the share go to an
          existing user), never an ID, name, title, or anything you typed. It
          rides the same <strong>Offline mode</strong> gate, and the server
          re-validates and stores only the allow-listed shape.
        </li>
      </ul>
      <p>
        The calendar CORS-bypass proxy uses the most defensive shape we
        know how to write, with HTTPS only, private-IP blocking, redirect
        re-validation, byte cap, timeout, content-type denylist, and
        per-IP rate limiting. The Vercel Analytics endpoint is a
        Vercel-owned script and beacon target, its posture is
        Vercel&apos;s, not ours. The route-defense code is in{" "}
        <code>frontend/src/lib/api/url-guards.ts</code> and{" "}
        <code>frontend/src/lib/api/rate-limit.ts</code> if you want to read
        it line by line.
      </p>

      <h2>What we collect, and what we don&apos;t</h2>
      <p>
        We collect anonymous page-view pings via Vercel Web Analytics. When
        you navigate between pages, anonymous beacons go to Vercel. No IDs, no
        folder contents, no typed text, no markdown bodies. We use this to know
        which pages get used and which sit idle.{" "}
        <strong>Settings &rarr; Offline mode</strong> disables it durably, the
        script is not injected when the toggle is on, and the toggle is read at
        component-mount time so the choice survives reloads.
      </p>
      <p>
        We also collect anonymous feature-usage counts via{" "}
        <code>/api/analytics/event</code>, such as how often a share gets sent.
        These carry allow-listed enum and boolean flags only, never an ID,
        name, or anything you typed, and they ride the same{" "}
        <strong>Offline mode</strong> gate.
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
        These claims hold, but they have implications worth understanding
        before you trust ResearchOS with anything sensitive.
      </p>
      <Callout variant="warning" title="Folder sharing means folder trust">
        If you share your data folder with a lab-mate over OneDrive,
        Dropbox, Google Drive, or iCloud, every byte in it is theirs to
        read. The per-user password gate stops accidental account-switching
        inside the app, not someone opening the folder in their own file
        browser.
      </Callout>
      <Callout variant="warning" title="Passwords aren't encryption">
        Account credentials are protected with Argon2id (t=3, m=64 MiB),
        stored in <code>_account.json</code>, so a snooping co-located user
        cannot trivially extract them, but the research data itself is stored
        as plain JSON on disk. Anyone with direct disk access to the folder
        can read it. Turn on OS-level full-disk encryption (FileVault on
        macOS, BitLocker on Windows) if your laptop walks around.
      </Callout>
      <Callout variant="warning" title="Public hosting is opt-in, and the proxy is open">
        If you self-host ResearchOS on a public Vercel deploy with no auth
        gate, anyone on the internet can hit the calendar-feed proxy route
        (subject to rate limiting). This is not a data-exfiltration risk
        because the proxy has no access to your data folder, but it does mean
        someone could burn your Vercel function budget. Set both{" "}
        <code>UPSTASH_REDIS_REST_URL</code> and{" "}
        <code>UPSTASH_REDIS_REST_TOKEN</code> for shared-state rate limiting
        on public deploys (the Vercel Upstash integration provisions both).
        The wiring is already in place.
      </Callout>
      <Callout variant="warning" title="Live collaboration uploads a readable copy">
        One-time sends to someone outside your folder are end-to-end encrypted,
        the relay holds only ciphertext and we cannot read it. Live real-time
        collaboration is the exception. When you co-edit a note or a shared
        notebook live, the shared document is synced to our servers in readable
        form so every change reaches the other person right away, which means we
        can read what you co-edit there. Anything you do not put into a live
        shared document stays on your machine and is never uploaded.
      </Callout>

      <h2>How to verify it yourself</h2>
      <p>
        You don&apos;t have to take any of this on faith. There are two
        ways to confirm what the app is doing. The first is built into
        Settings and takes about thirty seconds.
      </p>
      <Callout variant="tip" title="The easy way is to open Settings">
        ResearchOS ships three affordances inside Settings.
        <ul>
          <li>
            The <strong>Data inventory</strong> panel lists every file path
            the app has written and every IndexedDB key in use, alongside
            an External Calls section that names each outbound endpoint
            in plain English.
          </li>
          <li>
            The <strong>Offline mode</strong> toggle disables the proxy
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
      <Screenshot
        src="/wiki/screenshots/security-data-inventory-panel.png"
        alt="The Data inventory panel in Settings, listing every file path the app has written and the External Calls section naming each outbound endpoint."
        caption="Data inventory panel in Settings. Every file path and every outbound endpoint is listed here."
      />
      <Screenshot
        src="/wiki/screenshots/security-offline-mode-toggle.png"
        alt="The Offline mode toggle in Settings, shown in the on position, with the note that the Vercel Analytics script and proxy routes are disabled."
        caption="Offline mode toggle in Settings. One click disables the analytics script and all proxy routes."
      />
      <details className="mt-4 border border-border rounded-lg p-3 [&[open]>summary]:mb-3">
        <summary className="cursor-pointer font-medium text-foreground">
          The thorough way, open DevTools and watch the network yourself
        </summary>
        <p className="text-body text-foreground mt-2">
          Your browser already shows every network request the app makes.
          This is the audit-grade path for anyone who wants to see the
          bytes themselves.
        </p>
        <Steps>
          <Step>
            Open ResearchOS in Chrome or Edge, then open DevTools.{" "}
            <Kbd>F12</Kbd> works on Windows and Linux. <Kbd>Cmd</Kbd> +{" "}
            <Kbd>Option</Kbd> + <Kbd>I</Kbd> works on macOS.
          </Step>
          <Step>
            Switch to the <strong>Network</strong> tab and check{" "}
            <strong>Preserve log</strong> so refreshes don&apos;t clear
            the view.
          </Step>
          <Step>
            Reload the page. Visit Calendar, the inbox, and the
            experiments you care about. Watch every outbound request as
            you go.
          </Step>
          <Step>
            You should see requests to your own ResearchOS origin (for
            JavaScript, CSS, and static assets), occasional requests to{" "}
            <code>/api/calendar-feed</code> when a subscribed feed
            refreshes, a one-off request to <code>/api/orcid/works</code>{" "}
            if you open a researcher profile that lists an ORCID iD, and
            occasional requests to{" "}
            <code>va.vercel-scripts.com</code> and{" "}
            <code>vitals.vercel-insights.com</code> for anonymous
            page-view pings, plus an occasional anonymous{" "}
            <code>/api/analytics/event</code> beacon when you use a tracked
            feature like sending a share (allow-listed enum and boolean props
            only, no IDs or text). All of those stop when{" "}
            <strong>Offline mode</strong> is on. One more
            destination may appear in a narrow circumstance. If the AI
            Helper prompts bundled with your running app are older than
            the latest deploy and you click{" "}
            <strong>Pull latest from research-os-xi.vercel.app</strong>{" "}
            in <strong>Settings &rarr; AI Helper</strong>, the browser
            fetches{" "}
            <code>https://research-os-xi.vercel.app/ai-helper/manifest.json</code>{" "}
            and{" "}
            <code>https://research-os-xi.vercel.app/ai-helper/&#123;size&#125;.md</code>.
            This is a user-initiated, on-demand pull, not a background call.
            Nothing else.
          </Step>
          <Step>
            For a second pass, switch from the <strong>Network</strong>{" "}
            tab to <strong>Application</strong>{" "}
            &rarr; <strong>IndexedDB</strong>. ResearchOS uses two
            IndexedDB databases.
            <ul>
              <li>
                <code>research-os-fsa</code> holds the opaque File System
                Access handle for your data folder. This is what gives
                the browser permission to read and write the folder you
                picked.
              </li>
              <li>
                <code>keyval-store</code> holds three small
                session-routing strings, the folder name plus its grant
                timestamp, the currently signed-in user, and (if you are
                a PI signed in) the primary account.
              </li>
            </ul>
          </Step>
        </Steps>
      </details>

      <h2>What we just fixed</h2>
      <p>
        ResearchOS went through an internal security audit on 2026-05-15.
        It closed one Critical finding (cross-site scripting via
        unsanitized markdown HTML across all 8 markdown rendering sites in
        the app) and several Important findings around the proxy routes,
        the LabArchives credential flow, and the in-app verification
        surface (data inventory, offline mode, storage hints). The audit
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

      <h2>Atomic-write safety</h2>
      <p>
        A subtler kind of data loss has nothing to do with the network and
        everything to do with timing. If an app is halfway through writing a
        file when the tab closes, the laptop sleeps, or the process crashes,
        a naive implementation can leave the file zero-byte or truncated, and
        the good version you had a second ago is gone. ResearchOS is built so
        that cannot happen.
      </p>
      <p>
        Every save writes to a temporary <code>.tmp</code> file first, lets
        that file finish landing durably on disk, and only then atomically
        moves it into place over the real file. The move is the kind of
        operation that either fully happens or does not happen at all, with
        no in-between state on disk. So if a crash interrupts a save, the
        worst case is that your previous good version survives untouched. You
        can never be left with a half-written or empty file in place of your
        data. The implementation is in{" "}
        <code>frontend/src/lib/file-system/file-service.ts</code> if you want
        to read the exact sequence.
      </p>
      <Callout variant="tip" title="The worst case is your last good save">
        A torn write can only ever leave the old file contents intact, never
        a corrupt or empty one. The atomic move is the whole point. Either the
        new version replaces the old one cleanly, or the old one is still
        there.
      </Callout>

      <h2>Tested on every commit</h2>
      <p>
        A trust claim is only as good as the thing that keeps it true over
        time. The whole app is gated by automated tests that run on every
        commit and every pull request to <code>main</code>. That gate runs
        linting, a full TypeScript typecheck, the Vitest unit and integration
        suite with coverage, and Playwright end-to-end tests in a real browser. The
        workflow lives in <code>.github/workflows/ci.yml</code>. If any of
        those gates fail, the change does not ship. That same machinery is
        what keeps the scientific calculations honest, which is its own page.{" "}
        <a href="/wiki/trust/method-validation">Method validation</a> explains
        how every sequence and lab calculation is re-checked against the
        reference tools the field trusts, on every commit.
      </p>
    </WikiPage>
  );
}
