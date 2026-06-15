import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export const metadata = {
  title: "Read this first · ResearchOS Wiki",
  description:
    "If you read one wiki page, read this one. What ResearchOS is, the few things worth knowing before you start, and how to find the rest of the wiki when you need it.",
};

export default function StartHerePage() {
  return (
    <WikiPage
      title="Read this first"
      intro={
        <>
          Yes, there are a lot of pages in here. Don&apos;t panic. Think of the
          wiki as a reference you dip into, not a book you read front to back.
          Come back here whenever you are stuck on something, find the page for
          it, skim, and get on with your day. This is the one page actually
          worth reading top to bottom.
        </>
      }
    >
      <p>
        It is short. It covers what ResearchOS is, the few things that will save
        you a headache later, and how to find everything else when you need it.
      </p>

      <h2>What ResearchOS is, in one paragraph</h2>
      <p>
        It is a research project manager that runs entirely in your browser and
        reads and writes a folder on your own computer. No upload required. You
        point it at a folder, pick a username, and everything you make
        (projects, tasks, lab notes, methods, protocols, purchases,
        attachments) gets saved as plain JSON and image files inside that
        folder. Optional Free and Lab cloud accounts add sync, sharing, and
        real-time collaboration. Put the folder in OneDrive, Dropbox, or
        iCloud and your whole lab can work out of the same one.
      </p>

      <h2>A few things worth knowing up front</h2>
      <p>
        Get these and you can pick up the rest as you go.
      </p>

      <Callout variant="tip" title="1. Your data stays on your machine">
        Everything you do writes to the folder you connected. Nothing is
        uploaded, and there is no ResearchOS server holding your research. Want
        a backup? Copy the folder. Want to leave? Delete it. Deleting inside the
        app sends records to the Trash (the trash-can icon in the top-right),
        where you can restore them or delete them for good. The handful of
        network calls the app does make (fetching calendar feeds you opted into,
        the AI Helper when you turn it on, anonymous usage analytics) never carry
        your research, and the full story is on{" "}
        <Link href="/wiki/security">Security</Link>.
      </Callout>

      <Callout
        variant="tip"
        title="2. The “?” button jumps you into this wiki"
      >
        It is in the top-right of every page in the app. Click it and you land
        on the wiki page for whatever you were just looking at. Confused by a
        colored bar on the Gantt chart? Hit &quot;?&quot; and you are on the
        Gantt page.
      </Callout>

      <Callout
        variant="tip"
        title="3. There is no home dashboard, you land where you work"
      >
        Opening ResearchOS doesn&apos;t drop you on a dashboard to glance at. The
        root URL is just a router that{" "}
        <Link href="/wiki/features/home">sends you to the surface for your role</Link>.
        A member or solo researcher lands on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, opened to a grid
        of their projects, with its Projects, Experiments, Notes, Lists, and{" "}
        <Link href="/wiki/features/one-on-ones">Check-ins</Link> tabs, a project
        filter that sticks as you move between them, and a popup holding the
        details, lab notes, method, and results. A PI lands on Lab Overview
        instead. Either way, you start on the thing you actually use.
      </Callout>

      <Callout
        variant="tip"
        title="4. Tasks live in projects, projects live in your account"
      >
        The shape is account, then projects, then tasks. Sharing is granular,
        you hand over one record at a time (most often a task, sometimes a
        method, note, project, or goal) and set read or edit per recipient. When
        you share a task with a labmate, it shows up in their Workbench under the
        project, editable if you let them. The rules are on{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>
        .
      </Callout>

      <Callout
        variant="tip"
        title="5. PIs get a Lab Overview surface"
      >
        If your account is marked as a <strong>PI</strong> (Principal
        Investigator), you get{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>, a curated
        page with cross-member views like member workload, recent activity, the
        purchase queue, and an audit log. Regular members never see it. Flip the
        PI flag on your account to get the bird&apos;s-eye view. More on{" "}
        <Link href="/wiki/features/lab-head">PI</Link>.
      </Callout>

      <Callout
        variant="tip"
        title="6. Calendar and the AI Helper are opt-in"
      >
        ResearchOS works fine on its own. The{" "}
        <Link href="/wiki/integrations/calendar-feeds">calendar feeds</Link>{" "}
        (subscribe to a Google, Outlook, or iCloud calendar), the AI Helper, and
        the Companion phone pairing (the phone icon in the top-right) all
        live behind opt-in switches, off by default, and turn on independently.
        Settings sits behind your avatar in the top-right corner (click the
        circle with your initial), not in the top nav. Turn them on if and when
        you want them.
      </Callout>

      <h2>How to find the rest of the wiki</h2>
      <p>
        There are a lot of pages because the app does a lot. Three ways to get
        around, fastest first.
      </p>
      <ul>
        <li>
          <strong>Search the bar at the top of the sidebar.</strong> If you know
          the word for the thing you want (&quot;gradient,&quot;
          &quot;calendar,&quot; &quot;edit session&quot;), this beats browsing
          every time.
        </li>
        <li>
          <strong>Browse the sidebar categories.</strong> Pages are grouped
          under Getting Started, Shared Lab Accounts, Features, Integrations, and
          Security. Good when you know roughly what area you are in.
        </li>
        <li>
          <strong>Hit the &quot;?&quot; button in the app.</strong> Drops you on
          the page for whatever you were just looking at. Best when you are
          mid-task and want context, not when you are browsing.
        </li>
      </ul>
      <p>
        Every page leads with the concept. The top explains what the feature is
        and why it exists, and the screenshots and steps come after. Usually you
        can skim to the screenshot of the thing you need and stop there.
      </p>

      <h2>Brand new? Start here</h2>
      <p>
        Walk these in order. Each one is short.
      </p>
      <ol>
        <li>
          <Link href="/wiki/getting-started/browser-requirements">
            Browser requirements
          </Link>
          . Chrome or Edge. The folder API does not work in Safari, Firefox, or
          Brave.
        </li>
        <li>
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting your folder
          </Link>
          . Pick the folder ResearchOS reads and writes.
        </li>
        <li>
          <Link href="/wiki/getting-started/creating-a-user">
            Creating a user
          </Link>
          . A username, and an optional password.
        </li>
        <li>
          Want a sandbox first?{" "}
          <Link href="/wiki/getting-started/demo-mode">Try the demo</Link>. It
          runs in your browser on a fake yeast lab, and your edits vanish on
          reload.
        </li>
      </ol>

      <h2>Setting up a shared lab folder?</h2>
      <p>
        Read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link> first.
        Putting the ResearchOS folder inside OneDrive, Google Drive, Dropbox,
        Box, or iCloud lets your whole lab work out of one folder. The catch is
        that you have to set the sync client to keep the folder downloaded
        locally instead of on-demand. Skip that and the app will fail to read or
        write at random, and you will hate it. The per-provider pages walk you
        through the exact setting.
      </p>

      <h2>One last thing</h2>
      <p>
        This is a local-first app built by one person, and the wiki tries to be
        honest about what works and what does not yet. If something is broken or
        confusing, the{" "}
        <Link href="/wiki/features/feedback">Feedback</Link> page in the app
        files a GitHub issue with the context already filled in. It is the
        fastest way to get it fixed.
      </p>
    </WikiPage>
  );
}
