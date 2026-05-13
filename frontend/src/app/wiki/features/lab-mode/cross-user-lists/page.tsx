import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeCrossUserListsPage() {
  return (
    <WikiPage
      title="Cross-user lists"
      intro="The Experiments, Methods, Roadmaps, and Notes tabs all share one shape: a flat list across every selected user, with the contributor's color and avatar attached to every row."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-cross-user-lists.png"
        alt="The Methods tab in Lab Mode showing rows grouped by method with a cluster of user avatars on each row."
        caption="A typical cross-user list. The avatar cluster on the right shows which lab members are using each row."
      />

      <h2>What these four tabs share</h2>
      <p>
        The Experiments, Methods, Roadmaps, and Notes tabs aren&apos;t four
        different ideas — they&apos;re the same flat-list-across-the-lab idea
        applied to four different kinds of records. Once you know how to read
        one of them, the others click into place.
      </p>
      <p>Every row carries:</p>
      <ul>
        <li>
          <strong>A user color marker</strong> — either an avatar on the left
          or a small colored dot. This is the contributor&apos;s color from
          the lab&apos;s user metadata.
        </li>
        <li>
          <strong>The title</strong> — the experiment, method, goal, or note
          name.
        </li>
        <li>
          <strong>The owner&apos;s username</strong> — usually inline in a
          context line, sometimes as a colored chip.
        </li>
        <li>
          <strong>A way to drill in</strong> — clicking a row opens either the
          task popup, the per-user detail panel, or an inline expansion with
          more detail.
        </li>
      </ul>

      <h2>Experiments</h2>
      <p>
        The Experiments tab is every <em>experiment</em>-type task across the
        lab. The stats strip at the top counts total experiments, completed,
        in progress, and the number of distinct users with experiments in the
        current view.
      </p>
      <p>Two view modes:</p>
      <ul>
        <li>
          <strong>Grouped View</strong> — organized first by user, then by
          project name. A header row for each group shows the avatar, the
          project name, and a count badge. Underneath, each experiment is a
          row with a small color dot, name, dates, duration, a methods
          badge if there are any, and a status pill (<em>Complete</em> or{" "}
          <em>In Progress</em>). Click a row to open the read-only task popup.
        </li>
        <li>
          <strong>Table View</strong> — a flat sortable table with columns for
          user, project, experiment, start date, duration, methods, and
          status. Click a column header to sort by it. Click again to flip the
          direction.
        </li>
      </ul>

      <h2>Methods</h2>
      <p>
        The Methods tab is one row per <em>method</em> in the library, with a
        rollup of how often it&apos;s used. The page splits into two sections:
      </p>
      <ul>
        <li>
          <strong>Methods in use</strong> — methods attached to at least one
          experiment within the last 90 days. Useful for spotting which
          protocols are active in the lab right now.
        </li>
        <li>
          <strong>Unused</strong> — methods that haven&apos;t been touched in
          90+ days or have never been attached to an experiment. Rows are
          dimmed to keep them visually subordinate.
        </li>
      </ul>
      <p>
        Each row shows the method name, a <code>public</code> or owner-username
        chip, and a one-line stat (<em>X uses across Y users · last used …</em>).
        On the right is a cluster of avatars — every lab member who&apos;s
        attached this method to one of their experiments. Click any avatar in
        the cluster to open that user&apos;s detail panel. Click the row body
        to expand it inline; the expansion lists every experiment using the
        method, newest first, each with a status pill and a click target that
        opens the experiment popup.
      </p>
      <p>
        The search box at the top filters by name. The sort dropdown to its
        right flips between <em>Most used</em>, <em>Recent</em>, and{" "}
        <em>A–Z</em>.
      </p>

      <h2>Roadmaps</h2>
      <p>
        The Roadmaps tab is each user&apos;s high-level goals grouped under
        their avatar. The framing is by-person, not by-goal: every section is
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
        Click a goal to expand it and see the SMART sub-goal checklist —
        completed sub-goals get a green check and strikethrough; pending ones
        show as an empty box.
      </p>
      <p>
        Personal goals — ones a user attached to themselves rather than to a
        project — never appear in Lab Mode. Users can also flip a switch on
        their own Home page to hide all their goals from the lab view.
        That&apos;s why a user with goals might still not show up on the
        Roadmaps tab.
      </p>

      <h2>Notes</h2>
      <p>
        The Notes tab shows every shared note from every selected user.
        Private notes never appear; the share toggle is the author&apos;s call,
        which keeps Lab Mode safe to display on a shared screen.
      </p>
      <p>
        The list is the same notes browser used in the personal app: a search
        bar, filters for &quot;running log&quot; vs ordinary notes, and a card
        per note with title, author, and updated-at timestamp. Notes appear
        with the author&apos;s color so a quick scan tells you who&apos;s
        been writing.
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
          <Link href="/wiki/features/home">Home &amp; Projects</Link> for the
          goal editor and the &quot;hide my goals from Lab Mode&quot; toggle.
        </li>
      </ul>
    </WikiPage>
  );
}
