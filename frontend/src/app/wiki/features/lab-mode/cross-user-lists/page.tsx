import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeCrossUserListsPage() {
  return (
    <WikiPage
      title="Cross-user lists"
      intro="The Experiments, Methods, Roadmaps, and Notes tabs all show one flat list across every selected user, with the contributor's color and avatar attached to every row."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-cross-user-lists.png"
        alt="The Methods tab in Lab Mode showing rows grouped by method with a cluster of user avatars on each row."
        caption="A typical cross-user list. The avatar cluster on the right shows which lab members are using each row."
      />

      <h2>What every row looks like</h2>
      <p>
        The four tabs apply the same flat-list-across-the-lab idea to four
        different kinds of records. Once you know how to read one of them, the
        others click into place.
      </p>
      <p>Every row carries:</p>
      <ul>
        <li>
          <strong>A user color marker</strong>, either an avatar on the left
          or a small colored dot. This is the contributor&apos;s color from
          the lab&apos;s user metadata.
        </li>
        <li>
          <strong>The title</strong>: the experiment, method, goal, or note
          name.
        </li>
        <li>
          <strong>The owner&apos;s username</strong>, usually inline in a
          context line, sometimes as a colored chip.
        </li>
        <li>
          <strong>A way to drill in</strong>. Clicking a row opens either the
          task popup, the per-user detail panel, or an inline expansion with
          more detail.
        </li>
      </ul>

      <h2>Experiments</h2>
      <p>
        The Experiments tab shows every <em>experiment</em>-type task across
        the selected users as a grid of outcome cards. Each card leads with
        results.md content or the first image in the task&apos;s Images
        folder, so the page reads as a wall of recent findings rather than a
        plain task list.
      </p>
      <p>
        Cards are bucketed into four sections, and each section gets its own
        heading and grid:
      </p>
      <ul>
        <li>
          <strong>Fresh results</strong>: experiments whose results landed in
          the last 7 days.
        </li>
        <li>
          <strong>Active</strong>: experiments still running, sorted by start
          date.
        </li>
        <li>
          <strong>Awaiting results</strong>: experiments marked complete but
          with no <code>results.md</code> or images on disk yet.
        </li>
        <li>
          <strong>Earlier</strong>: older results past the freshness window.
        </li>
      </ul>
      <p>
        Two view modes sit in a toggle at the top of the tab:
      </p>
      <ul>
        <li>
          <strong>Gallery</strong>: the default. Stacks the four sections
          vertically, each as a responsive card grid (1 to 4 columns
          depending on width).
        </li>
        <li>
          <strong>Compare</strong>: regroups the same cards by method instead
          of by freshness, so replicates of the same protocol sit next to
          each other. Each section header is a method name with the number
          of runs. Experiments with no attached method drop into a final
          &quot;Experiments with no attached method&quot; group.
        </li>
      </ul>
      <p>
        Clicking any card opens the read-only experiment popup. The view-mode
        toggle is sticky across reloads.
      </p>

      <h2>Methods</h2>
      <p>
        The Methods tab is one row per <em>method</em> in the library, with a
        rollup of how often it&apos;s used. The page splits into two sections:
      </p>
      <ul>
        <li>
          <strong>Methods in use</strong>: methods attached to at least one
          experiment within the last 90 days. Useful for spotting which
          protocols are active in the lab right now.
        </li>
        <li>
          <strong>Unused</strong>: methods that haven&apos;t been touched in
          90+ days or have never been attached to an experiment. Rows are
          dimmed to keep them visually subordinate.
        </li>
      </ul>
      <p>
        Each row shows the method name, a <code>public</code> or owner-username
        chip, and a one-line stat (<em>X uses across Y users, last used …</em>).
        On the right is a cluster of avatars, one for every lab member
        who&apos;s attached this method to one of their experiments. Click any
        avatar in the cluster to open that user&apos;s detail panel. Click the
        row body to expand it inline. The expansion lists every experiment
        using the method, newest first, each with a status pill and a click
        target that opens the experiment popup.
      </p>
      <p>
        The search box at the top filters by name. The sort dropdown to its
        right flips between <em>Most used</em>, <em>Recent</em>, and{" "}
        <em>A-Z</em>.
      </p>

      <h2>Roadmaps</h2>
      <p>
        The Roadmaps tab is each user&apos;s high-level goals grouped under
        their avatar. The framing is by-person, not by-goal. Every section is
        one researcher, with their goals listed underneath in date order.
      </p>
      <p>Each goal row shows:</p>
      <ul>
        <li>A color dot tinted by the goal&apos;s color, falling back to the user color.</li>
        <li>The goal name and a status pill: <em>In progress</em>, <em>Upcoming</em>, <em>Past due</em>, or <em>Complete</em>.</li>
        <li>The project the goal belongs to, plus its start and end dates.</li>
        <li>
          A progress bar showing how many of the goal&apos;s SMART sub-goals
          are done (e.g., <em>3/5</em>).
        </li>
      </ul>
      <p>
        Click a goal to expand it and see the SMART sub-goal checklist.
        Completed sub-goals get a green check and strikethrough, pending ones
        show as an empty box.
      </p>
      <p>
        Personal goals (ones a user attached to themselves rather than to a
        project) never appear in Lab Mode. Users can also flip the{" "}
        <strong>Hide my goals from lab view</strong> toggle on the Settings
        page (under <em>Notifications &amp; behavior</em>) to hide all their
        project goals from this tab. That&apos;s why a user with goals might
        still not show up under Roadmaps.
      </p>

      <h2>Notes</h2>
      <p>
        The Notes tab shows every shared note from every selected user.
        Private notes never appear. The share toggle is the author&apos;s
        call, which keeps Lab Mode safe to display on a shared screen.
      </p>
      <p>
        A search bar runs along the top, with a three-state filter pill group
        underneath:
      </p>
      <ul>
        <li>
          <strong>All</strong>: every shared note from the selected users.
        </li>
        <li>
          <strong>Single</strong>: only one-off notes, hiding running logs.
        </li>
        <li>
          <strong>Running Logs</strong>: only notes marked as a running log,
          hiding one-offs.
        </li>
      </ul>
      <p>
        Each card shows the title, author, and updated-at timestamp, tinted
        with the author&apos;s color so a quick scan tells you who&apos;s been
        writing.
      </p>

      <Callout variant="tip" title="The user filter scopes every list">
        Each of these tabs honors the floating <strong>Users</strong> chip. If
        you only want to see one labmate&apos;s methods or one subteam&apos;s
        roadmaps, deselect everyone else and the lists narrow accordingly.
      </Callout>

      <h2>Where to look next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/experiments">Experiments &amp; Notes</Link>{" "}
          for how individual experiment tiles work in a single user&apos;s
          dashboard.
        </li>
        <li>
          <Link href="/wiki/features/methods">Methods Library</Link> for
          authoring and editing methods (Lab Mode is read-only).
        </li>
        <li>
          <Link href="/wiki/features/settings">Settings</Link> for the{" "}
          <em>Hide my goals from lab view</em> toggle and other per-user
          preferences.
        </li>
      </ul>
    </WikiPage>
  );
}
