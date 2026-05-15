import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeActivityPage() {
  return (
    <WikiPage
      title="Activity"
      intro="The default tab when you open Lab Mode. Three rolling sections that answer 'what is the lab doing right now, what just wrapped, and what notes were updated recently.'"
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-activity.png"
        alt="The Activity tab in Lab Mode with three sections: Running now, Recently completed, and Recent shared notes."
        caption="Three stacked panels. Each row has the contributor's avatar, the title, a type chip, and a date label."
      />

      <h2>What you&apos;re looking at</h2>
      <p>
        Activity is the &quot;what&apos;s happening in the lab this week?&quot;
        view. Instead of a raw event log, it groups things by status into three
        panels, top to bottom:
      </p>
      <ul>
        <li>
          <strong>Running now</strong>: experiments and purchases whose
          window covers today (i.e., the task is started but not yet complete
          and the end date is still ahead or today). Sorted by end date, so
          the things wrapping soonest are at the top.
        </li>
        <li>
          <strong>Recently completed</strong>: experiments and purchases
          marked complete with an end date in the last 30 days. Sorted by
          end date, newest first.
        </li>
        <li>
          <strong>Recent shared notes</strong>: shared notes (running logs
          included) that were updated in the last 30 days, newest first.
          Personal notes that the author hasn&apos;t marked as shared never
          show up here.
        </li>
      </ul>
      <p>
        Each panel has a count badge in the corner and an empty state if there
        is nothing to show.
      </p>

      <h2>Anatomy of a row</h2>
      <p>Every row is built the same way:</p>
      <ul>
        <li>
          <strong>Avatar on the left</strong>: circular, tinted with the
          contributor&apos;s user color. Click it (not the row) to open that
          person&apos;s detail panel. Useful when you spot something and want
          to drill into their full dashboard rather than just that one task.
        </li>
        <li>
          <strong>Title and type chip</strong>: the task or note name, with a
          colored pill next to it that says <code>experiment</code>,{" "}
          <code>purchase</code>, or <code>note</code>. The chip uses the same
          color family as the rest of the app (blue for experiments, amber for
          purchases, emerald for notes).
        </li>
        <li>
          <strong>Context line</strong>: the contributor&apos;s username, a
          dot, then the project name (for tasks) or &quot;Note&quot; / &quot;Running log&quot;
          (for notes).
        </li>
        <li>
          <strong>Date label on the right</strong>: relative for task rows in
          either Running now or Recently completed (<em>ends tomorrow</em>,{" "}
          <em>ends in 3d</em>, <em>yesterday</em>, <em>3d ago</em>), and an
          absolute month/day stamp (<em>May 14</em>) for the Recent shared
          notes section.
        </li>
      </ul>

      <h2>Clicking around</h2>
      <p>
        Clicking the body of an experiment or purchase row opens the same task
        popup you&apos;d see in your own dashboard, but with edit controls
        hidden. From the popup you can read the description, see attached
        methods and PCR protocols, browse images, and copy whatever you need.
      </p>
      <p>
        Clicking a note row jumps you over to the{" "}
        <Link href="/wiki/features/lab-mode">Notes tab</Link> in Lab Mode where
        you can open the full note inline.
      </p>
      <p>
        Clicking an avatar (which is itself a button) opens the{" "}
        <Link href="/wiki/features/lab-mode/user-filter">
          per-user detail panel
        </Link>{" "}
        on the right side of the screen, a focused dashboard for just that
        person.
      </p>

      <Callout variant="tip" title="Driven by the user filter">
        Activity only includes rows from users you have selected in the
        floating Users chip. If you only want to see one labmate&apos;s
        in-flight work, deselect everyone else.
      </Callout>

      <h2>Things to know</h2>
      <ul>
        <li>
          The 30-day window applies to both Recently completed and Recent
          shared notes. There is no UI to widen it. For longer-range queries,
          use the Search tab.
        </li>
        <li>
          &quot;Running now&quot; is derived from start and end dates. A task
          with no dates set never appears, even if it&apos;s actively being
          worked on.
        </li>
        <li>
          Notes that haven&apos;t been marked as shared by their author stay
          private. Activity is a public-facing rollup, so it respects each
          user&apos;s sharing choice.
        </li>
      </ul>
    </WikiPage>
  );
}
