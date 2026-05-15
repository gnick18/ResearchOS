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
      <p>
        When you pick a data folder, ResearchOS reads and writes everything
        through the browser&apos;s File System Access API. The folder is
        yours, the bytes never leave it, and you can open it in your
        operating system&apos;s file browser at any time to see exactly
        what&apos;s there.
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
      <p>The on-disk layout looks roughly like this:</p>
      <pre>
        <code>
{`<your data folder>/
  users/
    <username>/
      settings.json              user settings, default views, tab visibility
      _auth.json                 PBKDF2-hashed password (only if set)
      _counters.json             id counters per entity type
      _shared_with_me.json       inbound sharing pointers
      _telegram.json             Telegram bot token + inbox state (gitignored)
      _calendar-feeds.json       subscribed iCal URLs
      _notifications.json        bell-dropdown rows
      projects/<id>.json         one flat file per project
      tasks/<id>.json            one flat file per task (notes + results
                                 live in the task JSON or in sibling
                                 directories below)
      methods/<id>.json          reusable protocols
      pcr_protocols/<id>.json    PCR programs and recipes
      lc_gradients/<id>.json     LC gradient programs
      cell_culture_schedules/<id>.json
      plate_layouts/<id>.json
      notes/<id>.json            shared lab notes
      results/<task-id>/         per-task result attachments
        Images/                  pasted or dragged images
        Attachments/             PDFs and arbitrary files
      events/<id>.json           native calendar events
      goals/<id>.json            project goals
      lab_links/<id>.json        link library entries
      purchase_items/<id>.json   purchase orders
      inbox/                     Telegram photos awaiting routing`}
        </code>
      </pre>
      <Callout variant="info" title="You can verify this with your own eyes">
        Open the folder in Finder, Explorer, or your file manager of choice.
        Everything ResearchOS knows about your work is in there, in plain
        files you can read.
      </Callout>

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
        Both routes use the most defensive shape we know how to write:
        HTTPS only, private-IP blocking, redirect re-validation, byte cap,
        timeout, content-type denylist, and per-IP rate limiting. The code
        is in <code>frontend/src/lib/api/url-guards.ts</code> and{" "}
        <code>frontend/src/lib/api/rate-limit.ts</code> if you want to read
        it line by line.
      </p>

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
        You don&apos;t have to take any of this on faith. Your browser
        already shows every network request the app makes. Here&apos;s how
        to watch.
      </p>
      <Steps>
        <Step>
          Open ResearchOS in Chrome, Edge, or Brave, then open DevTools.{" "}
          <Kbd>F12</Kbd> works on Windows and Linux. <Kbd>Cmd</Kbd> +{" "}
          <Kbd>Option</Kbd> + <Kbd>I</Kbd> works on macOS.
        </Step>
        <Step>
          Switch to the <strong>Network</strong> tab and check{" "}
          <strong>Preserve log</strong> so refreshes don&apos;t clear the
          view.
        </Step>
        <Step>
          Reload the page. Visit Calendar, Telegram inbox, the experiments
          you care about. Watch every outbound request as you go.
        </Step>
        <Step>
          You should see requests to your own ResearchOS origin (for
          JavaScript, CSS, and static assets), occasional requests to{" "}
          <code>/api/calendar-feed</code> when a subscribed feed refreshes,
          occasional requests to <code>/api/telegram-file</code> when an
          inbox photo loads, direct requests to{" "}
          <code>api.telegram.org</code> when you exchange messages with
          your bot, and occasional requests to{" "}
          <code>va.vercel-scripts.com</code> and{" "}
          <code>vitals.vercel-insights.com</code> for anonymous page-view
          pings (unless <strong>Offline mode</strong> is on, in which case
          you&apos;ll see none of those). Nothing else.
        </Step>
      </Steps>
      <Callout variant="info" title="In-app verification chips coming soon">
        We&apos;re working on a few affordances inside the app to make this
        even easier:
        <ul>
          <li>
            A <strong>Data inventory diagnostic</strong> in Settings listing
            every file path the app has written and every IndexedDB key
            in use.
          </li>
          <li>
            An <strong>Offline mode</strong> toggle that disables the two
            proxy routes for users who want zero outbound network from the
            app surface.
          </li>
          <li>
            <strong>&ldquo;Where is this stored?&rdquo;</strong> tooltips
            on each integration field so you always know which file holds
            the credential you just entered.
          </li>
        </ul>
      </Callout>

      <h2>What we just fixed</h2>
      <p>
        ResearchOS went through an internal security audit on 2026-05-15.
        It closed one Critical finding (cross-site scripting via
        unsanitized markdown HTML in the live editor) and several Important
        findings around the proxy routes, the LabArchives credential
        flow, and the Telegram token surface. The audit report is checked
        into the repo as{" "}
        <a
          href="https://github.com/gnick18/ResearchOS/blob/main/SECURITY_AUDIT.md"
          target="_blank"
          rel="noopener noreferrer"
        >
          SECURITY_AUDIT.md
        </a>
        , and the merge commit that landed the fixes is{" "}
        <code>94f0ab08</code> on <code>main</code>.
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
