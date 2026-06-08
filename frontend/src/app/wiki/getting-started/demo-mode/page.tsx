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
        {" "}, the canonical public URL as of this writing; check the project
        site for the current link if it has moved) and you land straight inside
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
        Four seeded users are available from the user-picker. It helps to know
        who is who, since exploring the lab-head views and the shared records
        means signing in as the right researcher.
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
        <li>
          <strong>Dr. Sam Whitley</strong> (member, archived). Sam was
          archived by mira on 2026-03-15 and exists to demo the
          user-archiving feature. His historical comments and methods are
          still visible across the lab, but he no longer shows up in
          assignment pickers.
        </li>
      </ul>

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
        rebased on the fly so the demo&apos;s &ldquo;today&rdquo; matches
        your real today. Visit the demo this week and upcoming experiments
        stay upcoming, the Gantt scrolls to the current week, and the
        calendar shows events around now. Visit it again in a month and the
        whole timeline slides forward to match.
      </p>
      <p>
        Method history, PCR protocol creation dates, and lab note timestamps
        stay put, because they read as history rather than schedule. The
        rebase is also idempotent, so visiting twice in the same day
        doesn&apos;t accumulate drift.
      </p>

      <h2>Reading the docs from inside the demo</h2>
      <p>
        Two floating affordances stay with you across every route inside the
        demo, regardless of whether the URL is a <code>/demo</code> path or
        the equivalent live app path (<code>/methods</code>,{" "}
        <code>/gantt</code>, and so on).
      </p>
      <p>
        In the bottom-right corner, a darker pill-shaped{" "}
        <strong>Read the docs</strong> button (with a small upward-right arrow
        glyph) shows up whenever the current view has a matching wiki page.
        Click it on <code>/methods</code> and you land on the Methods wiki
        entry, ready to read about what you just clicked. The button silently
        hides on views without a docs page yet. Browser-back puts you
        straight back inside the demo with your state intact, because the
        sticky demo flag survives the trip to <code>/wiki</code>.
      </p>
      <p>
        The mirror move works from the wiki side. Feature pages with a
        demo-able view embed an amber inline call-out (the{" "}
        <code>TryInDemo</code> component) that drops you into{" "}
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
        A floating amber <strong>Leave Demo</strong> button lives in the
        bottom-right and follows you across every route while the demo flag
        is set. It&apos;s undismissable, so you never lose the exit. Clicking
        it opens a dialog titled <strong>Leave the demo?</strong> with two
        choices.
      </p>
      <ul>
        <li>
          The amber <strong>Leave demo</strong> button at the top resets all
          demo state in this tab and drops you on the connect-folder screen,
          ready to pick a real folder (or start a new one). Demo edits are
          not saved to disk anywhere, so they go away with the reload. If you
          opened <code>/demo</code> from a tab that was already connected to
          a real folder, the original folder is restored automatically.
        </li>
        <li>
          The smaller <strong>Keep exploring the demo</strong> link at the
          bottom just closes the dialog if you clicked Leave Demo by mistake.
        </li>
      </ul>

      <Screenshot
        src="/wiki/screenshots/demo-mode-leave.png"
        alt="The Leave the demo dialog with a primary Leave demo button and a smaller Keep exploring link below."
        caption="The Leave Demo dialog. Confirm to reset and return to the folder picker, or keep exploring."
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
          <strong>The &ldquo;Or download as a starter folder&rdquo; link.</strong>{" "}
          On the connect-folder screen there&apos;s a small text link under
          the big <strong>Explore demo in browser</strong> button. It
          downloads <code>demo-lab.zip</code> with the same seeded yeast lab.
          Unzip it, point ResearchOS at the unzipped folder, and your edits
          persist on disk for as long as you keep the folder around.
        </li>
        <li>
          <strong>Connect a real folder.</strong> For actual research work.
          See{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting Your Folder
          </Link>{" "}
          for the picker flow, and{" "}
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
