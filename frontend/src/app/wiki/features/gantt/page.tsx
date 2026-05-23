import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function GanttFeaturePage() {
  return (
    <WikiPage
      intro="The Gantt is a single timeline that holds every active task across every project you own (plus shared tasks others have given you). You schedule work by dragging bars, and you chain tasks together by dropping one bar on top of another."
    >
      <Screenshot
        src="/wiki/screenshots/gantt-overview.png"
        alt="The Gantt chart with multiple project bars color-coded across a timeline."
        caption="One row per packed group of tasks, color-coded by project, with goals as thin bars above each week."
      />

      <TryInDemo href="/gantt">Try the Gantt view</TryInDemo>

      <h2>What you&apos;re looking at</h2>
      <p>
        Each colored bar is a task. The bar starts on the task&apos;s start
        date, runs for its duration, and uses the color of the project the task
        belongs to. Tasks are packed into rows automatically so non-overlapping
        tasks can share a row (the chart isn&apos;t grouped by project).
      </p>
      <p>
        A few visual cues show up on the bars themselves:
      </p>
      <ul>
        <li>
          A short top stripe in a different color marks any task that belongs
          to a dependency chain. Every bar in the chain shares the same stripe
          color, so you can trace the chain visually across rows. Standalone
          experiments that aren&apos;t part of a chain also show a dimmer
          per-experiment stripe.
        </li>
        <li>
          A ☰ icon on the right and a thicker white left edge mark a list-type
          task. A $ icon and a diagonal stripe mark a purchase task.
        </li>
        <li>
          High-level tasks render in muted amber and sit at the top of the
          packed rows.
        </li>
        <li>
          Completed tasks are desaturated and partially transparent, with a ✓
          on the right edge. A partial fill on the left of a bar shows
          subtask completion progress.
        </li>
        <li>
          A small bracketed initial (e.g., <code>[K]</code>) on a bar means
          this task is shared. The bar itself still uses the project&apos;s
          color, not the owner&apos;s.
        </li>
        <li>
          Bars that start before or end after the visible range fade to black
          on that edge so you know they continue offscreen.
        </li>
      </ul>

      <h2>Add a task</h2>
      <Steps>
        <Step>
          Click the <strong>+ Task</strong> button at the top of the toolbar,
          pick a project, and fill in the popup.
        </Step>
        <Step>
          Or double-click any empty day on the chart. The new-task popup opens
          with that start date already filled in (you still pick the project
          inside the popup, because the chart doesn&apos;t have per-project
          rows).
        </Step>
      </Steps>

      <h2>Reschedule a task</h2>
      <p>
        Grab a bar anywhere and drag it onto a different day. When you drop
        it, the task&apos;s start date moves to that day and its duration
        stays the same. Any tasks downstream of it through a dependency are
        recomputed to keep their constraints valid (so a Finish-Start child
        of a moved parent will slide to start the day after the new parent
        end).
      </p>
      <Callout variant="tip" title="Weekend rules ride along">
        Dropping on a Saturday or Sunday in a project that has weekends
        disabled bumps the start date to the next Monday. You toggle the
        weekend setting from each project&apos;s detail popup on the{" "}
        <Link href="/wiki/features/home">Home</Link> page.
      </Callout>

      <h2>Confirm a cascade that pushes work into the past</h2>
      <p>
        Most cascades apply silently. The orange{" "}
        <strong>&quot;This change will affect N task(s)&quot;</strong> modal
        only opens when an SF (&quot;Finish before&quot;) chain would shift a
        task to start in the past. FS (&quot;Start after&quot;) and SS
        cascades always apply without confirmation. The modal lists every
        affected task with its old &rarr; new dates, plus a warning line per
        past-date conflict. Pick <strong>Apply Changes</strong> to accept the
        cascade or <strong>Cancel</strong> to leave the chain alone.
      </p>

      <h2>Chain two tasks with a dependency</h2>
      <p>
        Drag one bar and drop it on top of another. A popup asks how the two
        tasks should be linked:
      </p>
      <ul>
        <li>
          <strong>Start at same time</strong> (SS). Both tasks begin on the
          same day.
        </li>
        <li>
          <strong>Start after</strong> (FS). The dragged task starts the day
          after the target ends.
        </li>
        <li>
          <strong>Finish before</strong> (SF). The dragged task finishes
          before the target starts.
        </li>
      </ul>
      <p>
        Once you pick a relationship, the dragged task&apos;s start date snaps
        to whatever the dependency requires. Tasks in the same chain share
        the same colored top stripe, so you can trace a chain by following
        the stripe color across bars. Drag a bar in the chain and downstream
        tasks shift with it.
      </p>

      <h2>Zoom, navigate, and filter</h2>
      <Screenshot
        src="/wiki/screenshots/gantt-zoom-controls.png"
        alt="The toolbar at the top of the Gantt page showing project filter pills, the eight zoom buttons, and the week navigator."
        caption="Toolbar: project + tag filters on the left, eight zoom buttons in the middle, and a week navigator with a Monday date picker on the right."
      />
      <ul>
        <li>
          <strong>Zoom</strong> uses eight buttons in a segmented control:{" "}
          <code>1W</code>, <code>2W</code>, <code>3W</code>, <code>1M</code>,{" "}
          <code>3M</code>, <code>6M</code>, <code>1Y</code>, and{" "}
          <code>All</code>. The shorter zooms keep day-level detail and the
          longer ones span many weeks at once. (All shows an 8-week window
          starting from the current Monday, not a full-history view.)
        </li>
        <li>
          <strong>Project pills</strong> on the left of the toolbar toggle
          individual projects on and off. With nothing selected, every
          project is visible. Click a pill to narrow the view to one
          project; click again to unhide the rest.
        </li>
        <li>
          <strong>Tag pills</strong> appear next to projects once any task or
          project has tags. They filter the chart down to tasks that match
          the chosen tags.
        </li>
        <li>
          <strong>Shared</strong> (the small purple toggle with the share
          icon) hides or shows tasks others have shared with you.
        </li>
        <li>
          <strong>Week navigator</strong> on the right side of the toolbar
          steps the visible window back and forward one week at a time, with a
          date picker for jumping to a specific Monday and a{" "}
          <strong>Today</strong> link that snaps you back to this week.
        </li>
      </ul>

      <h2>Goals on the timeline</h2>
      <p>
        Goals appear in two places on the Gantt. Above each week&apos;s day
        headers, every active goal that overlaps that week renders as a thin
        colored bar (longer goals sit lower). Hover one for a tooltip that
        shows the goal name and how many days are left (or how many days
        overdue). Click a bar to open the goal editor.
      </p>
      <p>
        The <strong>Goal sidebar</strong> on the right lists active goals as
        cards. The card surfaces each SMART subgoal as a checkbox so you can
        tick subgoals off without leaving the chart. Use the{" "}
        <strong>Goal</strong> button in the toolbar to add a new high-level
        goal.
      </p>

      <h2>How weekends are drawn</h2>
      <p>
        Weekend columns are always shown in the date grid, but they read as
        background-only (light grey, dimmed labels). When a task belongs to a
        project that doesn&apos;t run on weekends, the part of its bar that
        crosses Saturday or Sunday is overlaid with a diagonal hash so you
        can tell the work doesn&apos;t actually happen on those days. A
        7-day project (or a task with the per-task weekend override on)
        draws solid across weekends instead.
      </p>

      <h2>Mark PTO on the timeline</h2>
      <p>
        Right-click any day cell in the date grid to open a context menu with
        a <strong>Mark as PTO</strong> / <strong>Unmark PTO</strong> option
        (shipped 2026-05-21). Marked days render with sky-blue diagonal
        stripes and a small dot in the day header so they stand out at a
        glance. When a cascade computes new dates for chained tasks, PTO days
        are skipped, so dependent tasks slide past your time off automatically.
      </p>

      <h2>Open a task</h2>
      <p>
        Click a bar to open the task detail popup, where you can edit the
        name, dates, tags, attached methods, notes, results, and subtasks.
        The popup is the same one used by{" "}
        <Link href="/wiki/features/experiments">Lab Notes</Link> and the
        calendar, so anything you change here syncs everywhere.
      </p>
      <Screenshot
        src="/wiki/screenshots/gantt-task-popup.png"
        alt="A task detail popup opened over the Gantt chart."
        caption="Clicking a bar opens the full task editor over the Gantt."
      />
      <Callout variant="info" title="Screenshots pending recapture">
        The three screenshots on this page (<code>gantt-overview.png</code>,{" "}
        <code>gantt-zoom-controls.png</code>, <code>gantt-task-popup.png</code>)
        predate the PTO feature and the Gantt layout redesign (section 6.8).
        They are queued for recapture.
      </Callout>
    </WikiPage>
  );
}
