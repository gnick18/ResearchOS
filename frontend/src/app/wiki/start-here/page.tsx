import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export const metadata = {
  title: "Start Here · ResearchOS Wiki",
  description:
    "The one page to read if you only read one. What ResearchOS is, the handful of things that make the difference between bouncing and being fluent, and how to actually use this wiki.",
};

export default function StartHerePage() {
  return (
    <WikiPage
      title="Oh god, another massive docs site"
      intro={
        <>
          Yeah, fair. There are a lot of pages in here. Good news: this is an
          encyclopedia, not a textbook. You are not supposed to read it cover
          to cover. You are supposed to land back here whenever you want to
          know how some specific thing works, find the page for it, skim, and
          leave.
        </>
      }
    >
      <p>
        If you only read one wiki page, read this one. It covers the small
        handful of things that make the difference between &quot;I tried it
        once and bounced&quot; and &quot;I am fluent in this app.&quot; Then
        it tells you how to find the rest of the wiki when you actually need
        it.
      </p>

      <h2>What ResearchOS is, in one paragraph</h2>
      <p>
        A research project management app that runs entirely in your browser
        and reads / writes a folder on your own computer. No accounts, no
        sign-up, no upload. You point it at a folder, pick a username, and it
        stores everything (projects, tasks, lab notes, methods, PCR protocols,
        purchases, attachments) as plain JSON and image files inside that
        folder. If you put the folder inside OneDrive or Dropbox or iCloud,
        your whole lab can work out of the same one.
      </p>

      <h2>The 7 things worth knowing up front</h2>
      <p>
        These are the highest-leverage facts about ResearchOS. If you absorb
        these and nothing else, you will be in good shape.
      </p>

      <Callout variant="tip" title="1. Your data is yours, on your machine">
        Everything you do writes to the folder you connected. Nothing uploads.
        There is no ResearchOS server holding your research. If you want to
        back it up, copy the folder. If you want to walk away, delete it. The
        only network calls the app makes are to fetch your own Telegram
        photos and your own calendar feed URLs, both opt-in. See{" "}
        <Link href="/wiki/security">Security</Link> for the full story.
      </Callout>

      <Callout
        variant="tip"
        title="2. The “?” button is your shortcut into this wiki"
      >
        Top-right of every page in the app. Click it and it opens the wiki
        page for whatever surface you were just looking at. Looking at the
        Gantt and confused about a colored bar? Hit &quot;?&quot; and you
        land on the Gantt wiki page. Use it liberally. That is what it is
        there for.
      </Callout>

      <Callout
        variant="tip"
        title="3. BeakerBot will walk you through the app on first login"
      >
        A guided tour auto-starts the first time you sign in. It is roughly
        20 minutes, hands-on, in your actual account. You can skip it any
        time and re-run it later from <strong>Settings → Walkthrough</strong>.
        Most users who skip end up running it eventually because the app has
        enough surface area that the tour pays for itself.
      </Callout>

      <Callout
        variant="tip"
        title="4. Home is for status. The Workbench is for doing experiments."
      >
        Two surfaces, two purposes.{" "}
        <Link href="/wiki/features/home">Home</Link> is the dashboard you
        glance at each morning: today&apos;s tasks, upcoming deadlines,
        recent activity. The{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> is where you
        actually run experiments: three tabs (Experiments, Notes, Lists), a
        project filter that sticks across tabs, and a popup with details,
        lab notes, method, and results. If you find yourself working out of
        Home for hours, you probably want the Workbench.
      </Callout>

      <Callout
        variant="tip"
        title="5. Tasks live in projects, projects live in your account"
      >
        Hierarchy: account → projects → tasks. Sharing happens at the task
        level (or implicitly through shared methods). When you share a task
        with a labmate, they see it in their own Workbench under the
        project, with editing rights if you grant them. The unit of
        collaboration is the task, not the whole project. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the rules.
      </Callout>

      <Callout
        variant="tip"
        title="6. Lab Heads (PIs) get a Lab Overview surface"
      >
        If your account is flagged as a <strong>Lab Head</strong>, you
        unlock <Link href="/wiki/features/lab-overview">Lab Overview</Link>,
        a customizable dashboard with cross-member widgets (member workload,
        recent activity, purchase queue, audit log). It is not visible to
        regular members. If you are a PI running a lab, set this on your
        account and you get the bird&apos;s-eye view. See{" "}
        <Link href="/wiki/features/lab-head">Lab Head</Link>.
      </Callout>

      <Callout
        variant="tip"
        title="7. Integrations (Telegram, calendar, AI Helper) are all opt-in"
      >
        ResearchOS works completely standalone. The{" "}
        <Link href="/wiki/integrations/telegram">Telegram bot</Link> (snap
        a photo on your phone, it lands in your inbox), the{" "}
        <Link href="/wiki/integrations/calendar-feeds">calendar feeds</Link>{" "}
        (subscribe to a Google / Outlook / iCloud calendar), and the AI
        Helper are all in Settings, all off by default, and all separately
        switchable. Connect them when you actually want them, not because
        you feel like you have to.
      </Callout>

      <h2>How to use this wiki</h2>
      <p>
        The wiki has dozens of pages because the app has dozens of features.
        Three ways to navigate it, in order of speed:
      </p>
      <ul>
        <li>
          <strong>Type a phrase in the search bar at the top of the
          sidebar.</strong> Fastest. If you know the word for the thing you
          want (&quot;gradient,&quot; &quot;telegram,&quot; &quot;edit
          session&quot;), search beats browsing every time.
        </li>
        <li>
          <strong>Browse by category in the sidebar on the left.</strong>{" "}
          Pages are grouped under Getting Started, Shared Lab Accounts,
          Features, Integrations, and Security. If you know roughly what
          area you are in, this works well.
        </li>
        <li>
          <strong>Hit the &quot;?&quot; button inside the app.</strong> Bounces
          you straight to the wiki page for whatever surface you were just
          looking at. This is the right move when you are mid-task and want
          context, not when you are exploring.
        </li>
      </ul>
      <p>
        Each page is built concept-first. The top of the page explains what
        the feature actually is and why it exists. Below that are screenshots
        and procedural steps. You can usually skim to the screenshot of the
        thing you need and stop there.
      </p>

      <h2>If you are brand new, start here</h2>
      <p>
        Walk these in order (each is short):
      </p>
      <ol>
        <li>
          <Link href="/wiki/getting-started/browser-requirements">
            Browser requirements
          </Link>
          . Chrome, Edge, or Brave. The folder API does not work in Safari
          or Firefox.
        </li>
        <li>
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting your folder
          </Link>
          . Picking the folder ResearchOS reads and writes.
        </li>
        <li>
          <Link href="/wiki/getting-started/creating-a-user">
            Creating a user
          </Link>
          . Username, optional password.
        </li>
        <li>
          <Link href="/wiki/getting-started/welcome-wizard">
            Welcome tour (BeakerBot)
          </Link>
          . What the guided walkthrough covers.
        </li>
        <li>
          If you want a sandbox first,{" "}
          <Link href="/wiki/getting-started/demo-mode">try the demo</Link>{" "}
          (in-browser, fake yeast lab, edits vanish on reload).
        </li>
      </ol>

      <h2>If you are setting up a shared lab folder</h2>
      <p>
        Read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>{" "}
        first. Putting the ResearchOS folder inside OneDrive, Google Drive,
        Dropbox, Box, or iCloud lets your whole lab work out of one folder.
        The catch: you have to configure the sync client to keep the folder
        downloaded locally rather than on-demand. If you skip that, the app
        will fail to read or write at random and the experience will be
        miserable. The per-provider pages walk you through the exact setting.
      </p>

      <h2>One last thing</h2>
      <p>
        This app is local-first, single-developer, and the wiki tries to be
        honest about what works and what does not yet. If something is
        broken or confusing, the{" "}
        <Link href="/wiki/features/feedback">Feedback</Link> page in the app
        files a GitHub issue with the context pre-filled. Use it. It is the
        fastest way to get things fixed.
      </p>
    </WikiPage>
  );
}
