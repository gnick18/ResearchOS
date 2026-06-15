import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function DemoModePage() {
  return (
    <WikiPage
      intro="An in-browser preview of ResearchOS, seeded with a fake yeast lab. No folder picker, nothing to install, edits disappear on reload."
    >
      <p>
        Open <code>/demo</code> (e.g.,{" "}
        <a
          href="https://research-os-xi.vercel.app/demo"
          target="_blank"
          rel="noopener noreferrer"
        >
          research-os-xi.vercel.app/demo
        </a>
        , the canonical public URL as of this writing, so check the
        project site for the current link if it has moved) and you land
        straight inside
        ResearchOS as a researcher named <strong>alex</strong>, with a
        populated lab to click around in. Nothing touches your disk and the
        browser never asks for a folder.
      </p>

      <h2>What you&apos;ll see</h2>
      <p>
        The Home page opens with four projects, all prefixed{" "}
        <strong>DEMO:</strong> so it&apos;s obvious nothing here is real
        research. Each project has experiments on the Gantt, methods in the
        library, a couple of PCR protocols, a funded purchase list, and a few
        results pages with lab notes. Other seeded users have shared records
        across alex&apos;s projects, so the comment threads, the lab
        announcements, and the cross-user views all have real content the
        moment you arrive.
      </p>
      <p>
        Bare <code>/demo</code> stays at <code>/demo</code> in the URL bar
        and renders the Home page. Click any nav link (Gantt, Methods,
        Calendar) and the URL switches to the regular app path
        (<code>/gantt</code>, <code>/methods</code>). Demo state follows you
        through those navigations via a sticky session flag, so the
        watermarked data and the demo affordances persist across every route.
        Deep links like <code>/demo/methods</code> also work. The app installs
        the fixture first, then redirects to <code>/methods</code> so the
        shareable link lands the visitor on the right view.
      </p>

      <h2>Who&apos;s in the demo lab</h2>
      <p>
        Three seeded users are available from the user-picker. It helps to
        know who is who, since exploring the lab-head views and the shared
        records means signing in as the right researcher.
      </p>
      <ul>
        <li>
          <strong>alex</strong> (member). The default sign-in. Owns all four
          DEMO: projects and is the user you start as on <code>/demo</code>.
        </li>
        <li>
          <strong>morgan</strong> (member). Shares one project with alex and
          drops comments into alex&apos;s threads, so any view that filters by
          shared records shows real cross-user activity.
        </li>
        <li>
          <strong>Dr. Mira Castellanos</strong> (account_type{" "}
          <code>lab_head</code>). The PI of the demo lab. Pick her to explore
          the lab-head views, the lab inbox, the PI audit log, the
          announcements, and the flag-for-review notifications. She owns the
          orange (#f97316) user color in the comment threads.
        </li>
      </ul>
      <p>
        There&apos;s also a fourth person in the data, <strong>Dr. Sam
        Whitley</strong> (member, archived). He&apos;s not in the user-picker
        because mira archived him on 2026-03-15, and archived users drop out of
        the sign-in roster and the assignment pickers. He&apos;s there to show
        what archiving does. His historical comments are still visible across
        the lab, so you can see that an archived member&apos;s past work
        sticks around even after they&apos;re gone.
      </p>

      <h2>Edits are temporary</h2>
      <p>
        Everything you do in <code>/demo</code> (dragging a Gantt bar,
        editing a lab note, adding a task, dropping in an image) stays in
        this browser tab. There&apos;s no disk write, no upload, no account.
        Refresh the tab and the demo resets to its seed state. Good for
        kicking the tires, not for real research.
      </p>

      <h2>Dates always feel current</h2>
      <p>
        Every demo experiment, goal, and event gets its start and end date
        rebased on the fly. Every date shifts by exactly the number of days
        since your last visit, so the demo&apos;s &ldquo;now&rdquo; lines up
        with your real now. Visit the demo this week and upcoming experiments
        stay upcoming, the Gantt scrolls to the current week, and the calendar
        shows events around now.
      </p>
      <p>
        Method history, PCR protocol creation dates, and lab note timestamps
        stay put, because they read as history rather than schedule. Visit the
        demo one day, come back a month later, and the timeline slides forward
        without compounding drift, since each visit shifts only the days since
        the last one.
      </p>

      <h2>Floating affordances in the demo</h2>
      <p>
        Two small pill buttons live in the bottom-right corner and follow you
        across every route while the demo&apos;s sticky session flag is set,
        including wiki pages you may bounce to. Both use the same muted neutral
        pill style (surface-raised background, border, foreground-muted text)
        so they read as quiet controls rather than dominating the screen.
      </p>
      <ul>
        <li>
          <strong>View as lab head / View as member.</strong> The demo signs
          you in as <strong>alex</strong> (a lab member) by default. The{" "}
          <strong>View as lab head</strong> pill switches the fixture identity
          to <strong>Mira</strong>, the demo&apos;s PI, so you can explore the
          Lab Overview dashboard and other PI-only surfaces. Clicking it again
          (labeled <strong>View as member</strong>) switches back to alex. The
          identity switch is a hard navigation through <code>/demo</code> so
          the fixture re-seeds as the target user.
        </li>
        <li>
          <strong>Leave demo.</strong> An always-visible escape hatch. Clicking
          it opens the Leave the demo dialog described below. It never
          disappears so you always have a one-click exit.
        </li>
      </ul>
      <p>
        Feature wiki pages with a demo-able view embed an amber inline call-out
        (the <code>TryInDemo</code> component) that drops you into{" "}
        <code>/demo/&lt;route&gt;</code> for that view. Each call-site picks
        its own label, so you&apos;ll see variants like{" "}
        <em>Try the Gantt view</em>, <em>Try methods in the demo</em>,{" "}
        <em>Try the Workbench</em>, and <em>Open the demo and try Lab
        Notes</em> depending on which feature page you&apos;re reading. The
        click installs the fixture and lands you on the live editor with the
        demo&apos;s seeded protocols already loaded.
      </p>

      <h2>Leaving the demo</h2>
      <p>
        The muted <strong>Leave demo</strong> pill in the bottom-right follows
        you across every route while the demo flag is set. It&apos;s
        undismissable, so you never lose the exit. Clicking it opens a dialog
        titled <strong>Leave the demo?</strong> with two choices.
      </p>
      <ul>
        <li>
          The <strong>Leave demo</strong> button at the top resets all demo
          state in this tab and drops you on the connect screen, ready to
          pick a real folder (or start a new one). Demo edits are not saved
          to disk anywhere, so they go away with the reload. If you opened{" "}
          <code>/demo</code> from a tab that was already connected to a real
          folder, the original folder is restored automatically.
        </li>
        <li>
          The smaller <strong>Keep exploring the demo</strong> link at the
          bottom just closes the dialog if you clicked Leave demo by mistake.
        </li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/demo-mode-overview.png"
        alt="The demo app with the muted Leave demo pill and View as lab head pill visible in the bottom-right corner."
        caption="The demo with both floating pills visible. Leave demo is always present; View as lab head toggles the fixture identity."
      />

      <Screenshot
        src="/wiki/screenshots/demo-mode-leave.png"
        alt="The Leave the demo dialog with a primary Leave demo button and a smaller Keep exploring link below."
        caption="The Leave Demo dialog. Confirm to reset and return to the connect screen, or keep exploring."
      />

      <h2>Three ways to try the app</h2>
      <ul>
        <li>
          <strong>
            <code>/demo</code> (this page).
          </strong>{" "}
          Fastest. Open the URL, click around, no setup. Edits are temporary
          and vanish on reload. Best for a first look or for sharing a link
          with a labmate.
        </li>
        <li>
          <strong>The &ldquo;download as a starter folder&rdquo; link.</strong>{" "}
          On the welcome page there is a link to download{" "}
          <code>demo-lab.zip</code> with the same seeded yeast lab. Unzip it,
          point ResearchOS at the unzipped folder, and your edits persist on
          disk for as long as you keep the folder around.
        </li>
        <li>
          <strong>Connect a real folder.</strong> For actual research work.
          See{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting Your Folder
          </Link>{" "}
          for the connect flow, and{" "}
          <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>{" "}
          for putting that folder in OneDrive / Drive / Dropbox / iCloud so
          your whole lab shares it.
        </li>
      </ul>

      <Callout variant="tip" title="Every name in the demo is invented">
        The demo lab is full of fake-on-purpose labels:{" "}
        <code>FakeYeast</code>, <code>DEMO-NIH-GM999999</code>,{" "}
        <code>DemoStrain ΔADE2</code>, and so on. If you decide to export the
        demo as a starter folder, rename the projects before you start filing
        real data in there so nothing reads as a tutorial leftover later.
      </Callout>
    </WikiPage>
  );
}
