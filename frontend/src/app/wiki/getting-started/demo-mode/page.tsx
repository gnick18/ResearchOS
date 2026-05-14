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
        ) and you land straight inside ResearchOS as a researcher named{" "}
        <strong>alex</strong>, with a populated lab to click around in. Nothing
        touches your disk and the browser never asks for a folder.
      </p>

      <h2>What you&apos;ll see</h2>
      <p>
        The Home page opens with four projects, all prefixed{" "}
        <strong>DEMO:</strong> so it&apos;s obvious nothing here is real
        research. Each project has experiments on the Gantt, methods in the
        library, a couple of PCR protocols, a funded purchase list, and a few
        results pages with lab notes. A second researcher named{" "}
        <strong>morgan</strong> shares one project with alex, so the Lab Mode
        tab has cross-user data to play with too.
      </p>
      <p>
        Bare <code>/demo</code> stays at <code>/demo</code> in the URL bar
        and renders the Home page. Click any nav link (Gantt, Methods,
        Calendar, Lab) and the URL switches to the regular app path
        (<code>/gantt</code>, <code>/methods</code>, etc.). Demo state
        follows you through those navigations via a sticky session flag,
        so the demo banner, the watermarked data, and the floating exit
        button are all still there. Deep links like{" "}
        <code>/demo/methods</code> also work: the app installs the fixture
        first, then redirects to <code>/methods</code> so the shareable
        link lands the visitor on the right view.
      </p>

      <Screenshot
        src="/wiki/screenshots/demo-mode-banner.png"
        alt="The Demo Lab banner sitting across the top of the page, with the Leave Demo button on the right."
        caption="The amber demo banner sits across the top of every page in /demo."
      />

      <h2>Edits are temporary</h2>
      <p>
        Everything you do in <code>/demo</code> (e.g., dragging a Gantt bar,
        editing a lab note, adding a task, dropping in an image) stays in
        this browser tab. There&apos;s no disk write, no upload, no account.
        Refresh the tab and the demo resets to its seed state. Good for
        kicking the tires, not for real research.
      </p>
      <p>
        The amber <strong>You&apos;re viewing the Demo Lab</strong> banner sits
        across the top of every page as a constant reminder. The actual exit
        button lives in the bottom-right of the window (described below).
      </p>

      <h2>Dates always feel current</h2>
      <p>
        Every demo experiment, goal, and event gets its start and end date
        rebased on the fly so the demo&apos;s &ldquo;today&rdquo; matches your
        real today. Visit the demo this week and upcoming experiments stay
        upcoming, the Gantt scrolls to the current week, and the calendar
        shows events around now. Visit it again in a month and the whole
        timeline slides forward to match.
      </p>
      <p>
        Method history, PCR protocol creation dates, and lab note timestamps
        stay put, because they read as history rather than schedule. The
        rebase is also idempotent, so visiting twice in the same day
        doesn&apos;t accumulate drift.
      </p>

      <h2>Reading the docs from inside the demo</h2>
      <p>
        Alongside the exit button in the bottom-right, a darker{" "}
        <strong>📖 Read the docs ↗</strong> button shows up whenever the view
        you&apos;re on has a wiki page. Click it on <code>/methods</code> and
        you land on the Methods wiki entry, ready to read about what you just
        clicked. Browser-back puts you straight back inside the demo with
        your state intact, since the demo flag survives the trip. The button
        silently hides itself on views without a docs page yet.
      </p>
      <p>
        The mirror move works from the wiki side: feature pages that have a
        demo-able view show an amber inline call-out (
        <strong>🧪 Try this in the demo →</strong>) that drops you into{" "}
        <code>/demo/&lt;route&gt;</code> for that view. Reading about the PCR
        editor on the wiki, click the call-out, and the next click is on the
        live editor with the demo&apos;s seeded protocols already loaded.
      </p>

      <h2>Leaving the demo</h2>
      <p>
        A floating amber <strong>Leave Demo</strong> button lives in the
        bottom-right of every demo page (a second <strong>Leave Demo</strong>{" "}
        link is also on the banner up top). Either one opens a dialog called{" "}
        <strong>Leaving the demo</strong> with two ways out:
      </p>
      <ul>
        <li>
          <strong>Save my demo edits as a starter folder.</strong> Builds a ZIP
          (<code>DemoLab-from-browser.zip</code>) that wraps the demo lab plus
          whatever you changed in this session. Unzip it, click{" "}
          <strong>Link Existing Folder</strong> on the next screen, and pick
          the unzipped <code>DemoLab</code> folder to keep working with your
          edits in a real ResearchOS session.
        </li>
        <li>
          <strong>Discard and start fresh.</strong> Throws everything away and
          drops you on the connect-folder screen so you can pick a real folder
          (or start a new one).
        </li>
      </ul>
      <p>
        A third button, <strong>Keep exploring the demo</strong>, just closes
        the dialog if you clicked Leave Demo by mistake.
      </p>

      <Screenshot
        src="/wiki/screenshots/demo-mode-leave.png"
        alt="The Leaving the demo dialog with two primary actions: save as a starter folder, or discard and start fresh."
        caption="The Leave Demo dialog. Save your edits as a starter folder, or discard and start fresh."
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
