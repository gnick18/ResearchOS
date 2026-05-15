import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeFeaturePage() {
  return (
    <WikiPage
      title="Lab Mode"
      intro="One view that pulls every user's projects, tasks, methods, and purchases together. Built for the times when you want to see what the lab as a whole is up to, not what one person is doing."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode.png"
        alt="Lab Mode with the Activity tab open and a user filter chip in the corner."
        caption="Lab Mode opens on Activity by default. The chip in the bottom-right is the user filter that drives every tab."
      />

      <h2>Who Lab Mode is for</h2>
      <p>
        Normally each user only sees their own projects, tasks, methods, and
        purchases. That works when you&apos;re heads-down on your own
        experiments, but it turns &quot;what&apos;s the team up to this week?&quot;
        into a chore of switching from user to user and trying to hold it all
        in your head.
      </p>
      <p>
        Lab Mode is the answer to that. Some examples of when it earns its
        keep:
      </p>
      <ul>
        <li>
          A <strong>PI prepping for lab meeting</strong> who wants a one-page
          read on what every member is running this week and what just
          wrapped.
        </li>
        <li>
          A <strong>grad student about to start a new experiment</strong> who
          wants to check whether anyone in the lab has already tried the same
          method, and what the outcome was.
        </li>
        <li>
          A <strong>lab admin scanning lab-wide spend</strong> against a grant
          deadline to see how much budget is left on each funding account.
        </li>
        <li>
          Anyone writing a <strong>progress report</strong> who needs a
          shareable summary of the team&apos;s recent activity without
          interrupting each person to ask.
        </li>
      </ul>
      <p>
        If you&apos;re the only person in the folder, Lab Mode still loads. You
        just won&apos;t see anyone else&apos;s rows. It earns its keep once two
        or more labmates share the same folder.
      </p>

      <h2>Getting to Lab Mode</h2>
      <p>There are two paths into it:</p>
      <ul>
        <li>
          Click the <strong>Lab</strong> tab in the header from anywhere in the
          app.
        </li>
        <li>
          On the user-picker, sign in as the special user <code>lab</code>.
          That account auto-redirects into Lab Mode and is the right choice for
          a wall-mounted TV in the lab or a recurring lab-meeting tab. No
          private data is exposed because the <code>lab</code> user only ever sees
          aggregated views.
        </li>
      </ul>
      <p>
        Lab Mode is read-only. Clicking into a task opens the same popup you
        see in your own dashboard, but the edit buttons are hidden. Lab Mode
        never writes anything back.
      </p>

      <Callout variant="info" title="Lab Mode shows everyone regardless of sharing">
        Project-level sharing (the share icon on a project popup) lets one
        labmate surface a specific project to a specific other labmate&apos;s{" "}
        <Link href="/wiki/features/home">Home page</Link>. Lab Mode is the
        broader view. Every labmate in the folder shows up on every tab
        whether they shared anything with you or not. Use sharing when you
        want a labmate&apos;s project on your own Home. Use Lab Mode when
        you want a lab-wide read-only roll-up.
      </Callout>

      <h2>What&apos;s inside</h2>
      <p>
        The header swaps in a row of tabs. Each one shows the same kind of
        data, but rolled up across every user you have selected in the filter.
      </p>
      <ul>
        <li>
          <Link href="/wiki/features/lab-mode/activity">
            <strong>Activity</strong>
          </Link>
          : the default tab. Three rolling sections: what&apos;s in flight
          right now, what just wrapped, and which shared notes were updated
          recently.
        </li>
        <li>
          <Link href="/wiki/features/lab-mode/gantt">
            <strong>GANTT</strong>
          </Link>
          : one combined timeline with every user&apos;s tasks overlaid. Bars
          are tinted by the user&apos;s color so you can scan whose work
          you&apos;re looking at.
        </li>
        <li>
          <Link href="/wiki/features/lab-mode/purchases">
            <strong>Purchases</strong>
          </Link>
          : funding-account budget cards at the top, then either a list of
          purchase orders or a summary view with per-month, per-user, and
          per-project spend rollups.
        </li>
        <li>
          <Link href="/wiki/features/lab-mode/cross-user-lists">
            <strong>Experiments, Methods, Roadmaps, and Notes</strong>
          </Link>
          : four cross-user lists. Each is a flat view of everyone&apos;s rows
          for that area, with the contributor&apos;s avatar and color attached
          to every line. The shape is the same across the four, with small
          differences per list.
        </li>
        <li>
          <strong>Search</strong>: the cross-user variant of the regular
          search page. Same filter form, but results pull from every selected
          user&apos;s data. See{" "}
          <Link href="/wiki/features/search">Search</Link> for the filter
          fields and how match-highlighting works.
        </li>
      </ul>

      <h2>Filtering by user</h2>
      <p>
        The floating <strong>Users</strong> chip in the bottom-right corner
        controls who shows up on every tab at once. Click it to open the
        picker, toggle users on or off, or open one user&apos;s side panel for
        a focused read on that person&apos;s work.
      </p>
      <p>
        The selection sticks per browser, and the chip itself is draggable if
        it&apos;s in your way. See{" "}
        <Link href="/wiki/features/lab-mode/user-filter">
          The user filter
        </Link>{" "}
        for the full breakdown including the per-user detail panel.
      </p>

      <Callout variant="tip" title="Set up a shared folder first">
        Lab Mode only has data to aggregate if multiple users share the same
        folder. If you haven&apos;t set that up yet, read{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>.
      </Callout>
    </WikiPage>
  );
}
