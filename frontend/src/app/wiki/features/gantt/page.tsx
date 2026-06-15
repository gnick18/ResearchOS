import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function GanttFeaturePage() {
  return (
    <WikiPage
      intro="The Gantt timeline holds every active task across every project you can see. You scan packed rows of colored bars and your eye picks out the busy weeks, the dependencies that cross projects, and the gaps where nothing is planned yet. The chart is a working surface, not a read-only report. You drag bars to reschedule, drop one on another to chain them, and right-click a day to mark it as PTO."
    >
      {/* TODO screenshot agent: capture the Gantt with the redesigned toolbar + diverse bar styles.
          Route: /gantt
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture with 3-4 projects on the timeline; the multi-select project
                 dropdown visible (collapsed) in the toolbar; PTO stripes on a Saturday; a
                 dependency stripe across two bars
          Save to: frontend/public/wiki/screenshots/gantt-overview.png
      */}
      <Screenshot
        src="/wiki/screenshots/gantt-overview.png"
        alt="The Gantt timeline with packed rows of colored bars, a multi-select project dropdown in the toolbar, PTO stripes on a Saturday cell, and a dependency stripe linking two bars across rows."
        caption="The Gantt at a glance, with packed rows of bars colored by project, a multi-select project dropdown in the toolbar, weekend hash, and PTO stripes."
      />

      <TryInDemo href="/gantt">Try the Gantt view</TryInDemo>

      <h2>Anatomy of the Gantt</h2>
      <p>
        Every visual element on the Gantt encodes one specific thing. Once
        you know the vocabulary, a scroll across the timeline tells you
        most of what you need at a glance.
      </p>
      <ul>
        <li>
          <strong>One colored bar per task.</strong> Bar color is the
          project&apos;s color. Bar start and length are the task&apos;s
          start date and duration. Tasks pack into rows automatically (the
          chart is not grouped by project), so non-overlapping tasks share
          a row to keep the chart dense.
        </li>
        <li>
          <strong>Dependency stripes.</strong> A short top stripe in a
          contrasting color marks tasks in a dependency chain. Every bar in
          the same chain shares the same stripe color, so you can trace a
          chain visually across rows. Standalone tasks show a dimmer
          per-experiment stripe.
        </li>
        <li>
          <strong>Type icons.</strong> A horizontal-lines icon on the right
          plus a thicker white left edge marks a list task. A dollar-sign
          icon and a diagonal stripe mark a purchase task.
        </li>
        <li>
          <strong>High-level tasks.</strong> Render in muted amber and sit
          at the top of the packed rows so they read as overlays on the
          regular schedule.
        </li>
        <li>
          <strong>Completion state.</strong> Completed tasks desaturate and
          go partially transparent with a checkmark on the right edge. A
          partial fill on the left of a bar shows sub-task completion
          progress.
        </li>
        <li>
          <strong>Shared badges.</strong> A small bracketed initial like{" "}
          <code>[K]</code> on a bar means this task is shared. The bar still
          uses the project&apos;s color, not the owner&apos;s.
        </li>
        <li>
          <strong>Edge fade.</strong> Bars that start before or end after
          the visible window fade to black on that edge to signal that they
          continue offscreen.
        </li>
        <li>
          <strong>PTO stripes.</strong> Days you have marked as PTO render
          with sky-blue diagonal stripes plus a small dot in the day header.
          Cascades skip these days when computing dependent task dates.
        </li>
        <li>
          <strong>Weekend hash.</strong> Saturday and Sunday columns read
          as light grey background. Tasks belonging to a 5-day project
          overlay weekend portions with a diagonal hash so you know work
          does not actually happen on those days. A 7-day project draws
          solid across weekends.
        </li>
      </ul>

      <h2>The toolbar</h2>
      <p>
        The toolbar at the top of the page is where you scope and zoom the
        chart. The 2026-05 redesign collapsed the old per-project pill row
        into a single multi-select dropdown so a lab with many projects can
        keep the chrome compact.
      </p>
      <ul>
        <li>
          <strong>Projects dropdown</strong> (multi-select). Click it to open
          the project list. Every project starts checked, so the default
          chart shows everything. Untick a project to hide its bars. Two
          quick actions sit at the top. <strong>Select all</strong> restores the
          everyone-checked default, and <strong>Unselect all</strong> clears the
          list so you can re-tick only the project you want.
        </li>
        <li>
          <strong>Tag chips.</strong> When any task or project has tags, a
          row of tag chips appears next to the project dropdown. Toggle a
          chip to narrow the chart to tasks matching that tag.
        </li>
        <li>
          <strong>Shared toggle.</strong> A small share-icon switch that
          hides or shows tasks others have shared with you.
        </li>
        <li>
          <strong>Zoom segmented control.</strong> Eight buttons:{" "}
          <code>1W</code>, <code>2W</code>, <code>3W</code>, <code>1M</code>,{" "}
          <code>3M</code>, <code>6M</code>, <code>1Y</code>, <code>All</code>.
          Shorter zooms keep day-level detail. Longer ones span many weeks.
          <strong> All</strong> currently shows an 8-week window starting
          from the current Monday, not a full-history view.
          <Screenshot
            src="/wiki/screenshots/gantt-zoom-controls.png"
            alt="The Gantt toolbar showing the zoom segmented control with eight buttons (1W, 2W, 3W, 1M, 3M, 6M, 1Y, All) and the week navigator with back/forward arrows, a date picker, and a Today link."
            caption="Zoom segmented control and week navigator. The eight zoom levels set how many days each column represents. The navigator steps or jumps to any Monday."
          />
        </li>
        <li>
          <strong>Week navigator</strong> on the right. Step the visible
          window back and forward one week at a time, with a date picker for
          jumping to a specific Monday and a <strong>Today</strong> link
          that snaps back to this week.
        </li>
        <li>
          <strong>+ Task</strong> and <strong>+ Goal</strong> buttons at the
          far right of the toolbar to add a task or a high-level goal
          without leaving the chart.
        </li>
      </ul>

      <h2>Reschedule by dragging</h2>
      <p>
        Grab any bar and drag it to a different day. On drop, the task&apos;s
        start date moves to that day and its duration stays the same. Any
        downstream tasks linked through a dependency recompute their dates to
        keep their constraints valid. An FS (start-after) child of a moved
        parent slides forward to start the day after the new parent end.
      </p>
      <p>
        Most cascades apply silently. The orange{" "}
        <strong>&quot;This change will affect N task(s)&quot;</strong> modal
        only opens when an SF (finish-before) chain would shift a task to
        start in the past. The modal lists every affected task with its old
        and new dates and a per-task warning line for the past-date
        conflicts. <strong>Apply Changes</strong> commits the cascade, and{" "}
        <strong>Cancel</strong> leaves the chain alone.
      </p>

      <Callout variant="tip" title="Weekend rules ride along">
        Dropping on a Saturday or Sunday in a project that has weekends
        disabled bumps the start date to the next Monday. Toggle the weekend
        setting from each project&apos;s detail popup on the{" "}
        <Link href="/wiki/features/home">Home</Link> page.
      </Callout>

      <h2>Chain two tasks with a dependency</h2>
      <p>
        A dependency captures the idea that one piece of bench work cannot
        sensibly begin (or end) until another one reaches a certain point.
        On the Gantt you express that by dragging one bar and dropping it on
        top of another. A popup then asks how the two tasks should be linked.
      </p>
      <ul>
        <li>
          <strong>Start at same time</strong> (SS). Both tasks begin on the
          same day. On the chart they line up at the same left edge.
        </li>
        <li>
          <strong>Start after</strong> (FS). The dragged task starts the day
          after the target finishes, so the two sit back to back with no
          overlap.
        </li>
        <li>
          <strong>Finish before</strong> (SF). The dragged task finishes the
          day before the target starts. This is a strict gap, where the predecessor
          clears the calendar entirely before the successor begins, so the two
          never share a day even when the predecessor is a single-day task.
        </li>
      </ul>
      <p>
        Once you pick a relationship, the dragged task&apos;s start date
        snaps to whatever the dependency requires. Tasks in the same chain
        share the same colored top stripe, so you can trace a chain across
        bars. Drag a bar in the chain and downstream tasks shift with it.
      </p>
      <Callout variant="info" title="Dependency chains are experiment-only">
        Only experiments can be chained. Lists and purchases are deliberately
        kept out of dependency chains, since linking a shopping order or a
        checklist into a scheduling chain tends to create constraints nobody
        wanted. On the Gantt this shows up as a non-interactive signal. Drag a
        list or purchase bar (or aim one at a list or purchase target) and the
        blue drop zone never appears, so the link simply will not form. The
        same rule holds when you build a task, where the &quot;After Task&quot;
        scheduling mode and its parent picker only surface for experiment
        tasks.
      </Callout>

      <h3>See a whole chain at once with hover-highlight</h3>
      <p>
        Because bars pack into rows by date rather than by chain, the members
        of one dependency chain can end up scattered across the timeline. Two
        cues help you read them as a group. The first is always on. Each bar
        in a chain carries small chain-colored dots in its corner, where the
        dot count matches the chain length and the fully-opaque dot marks this
        task&apos;s position in the order.
      </p>
      <p>
        The second cue is the hover treatment. Move your cursor over any bar
        that belongs to a multi-member chain and the whole chain lights up.
        Every bar in that chain stays at full strength and picks up a ring in
        the chain&apos;s color, while every bar outside the chain dims back so
        the group reads as one unit. Move off and the chart returns to normal.
        Solo tasks (a chain of one, with no peers) do not trigger the effect.
      </p>

      <h2>Filter with the multi-select project dropdown</h2>
      <p>
        The redesigned toolbar replaced the long pill row with a single
        dropdown. Here is how it works.
      </p>
      <ul>
        <li>Click <strong>Projects</strong> to expand the list.</li>
        <li>
          The default is <strong>all checked</strong>. The chart shows every
          project until you uncheck something.
        </li>
        <li>
          <strong>Select all</strong> at the top of the dropdown restores
          the everyone-checked default (useful after a long Unselect-and-pick
          session).
        </li>
        <li>
          <strong>Unselect all</strong> clears every checkmark in one click,
          so you can quickly re-tick only the one or two projects you want
          to focus on.
        </li>
        <li>
          The dropdown stays open while you click, so you can stage the
          right filter set without dropdown-bounce.
        </li>
      </ul>

      <h3>Standalone tasks have no project to filter by</h3>
      <p>
        Not every task belongs to a project. A quick experiment you spin up
        without filing it under a research question lives in the
        &quot;Miscellaneous&quot; standalone slot, with no project attached.
        Those orphan tasks used to vanish the moment you scoped the chart to a
        specific project, since they have no project key to match against.
      </p>
      <p>
        The bottom of the Projects dropdown now carries a{" "}
        <strong>Standalone</strong> row (set off by a dashed divider and marked
        with a hollow dashed swatch and a small &quot;no project&quot; hint)
        whose tooltip reads &quot;Toggle visibility of experiments with no
        project.&quot; Tick it to fold your standalone tasks back into the
        view alongside whatever projects you have checked, or untick it to
        hide them while you concentrate on real projects. It composes with the
        project checkboxes rather than replacing them, so you can show one
        project plus your standalone bucket at the same time.
      </p>
      <p>
        To move a task into or out of that bucket, open the task and use the
        project dropdown in its detail popup. Alongside your real projects it
        lists a <strong>Standalone (no project)</strong> option. Picking it
        drops the task off every project, and picking a real project files an
        orphan task back under it.
      </p>

      <h2>Gantt for PIs</h2>
      <p>
        PIs land on the same Gantt UI as every member, but the
        timeline pulls from a wider pool. The project dropdown on the
        left of the toolbar now spans every member&apos;s projects
        across the lab, not just the PI&apos;s own. One scroll of
        the chart shows the whole lab&apos;s work side by side.
      </p>
      <p>
        That changes what the page is for. For a member, the Gantt is a
        personal schedule. For a PI, it becomes a coordination
        surface. Dependency chains can stretch across users, the
        project dropdown doubles as a per-member filter (untick a
        student&apos;s projects to focus on a co-PI&apos;s timeline),
        and rescheduling a bar cascades downstream tasks regardless of
        who owns them. The interaction model stays identical, but the
        decisions you make on the chart land on more people at once.
      </p>
      <Screenshot
        src="/wiki/screenshots/gantt-overview-lab-head.png"
        alt="The Gantt as a PI, with the project dropdown open showing projects from every member in the lab."
        caption="Lab head view, where the project dropdown spans every member's projects, so one timeline shows the whole lab."
      />

      <h2>Attach an image to a task</h2>
      <p>
        To file a gel image or a microscope snap, click the bar to open the
        task, then drag the image file from Finder onto the open popup card.
        The drop works anywhere on the card, so you do not have to aim at a
        specific field. The image saves to the task&apos;s Images folder and
        shows up in the image strip, and a toast confirms it was added to
        Lab Notes.
      </p>
      <p>
        Dropping a file does not splice a reference into the notes body. That
        stays your call. When you want the image to appear inline in your
        notes, drag it out of the strip and into the notes editor, and
        ResearchOS places the reference where you drop it.
      </p>

      <h2>Mark a day as PTO</h2>
      <p>
        Right-click any day cell in the date grid to open a context menu
        with a <strong>Mark as PTO</strong> /{" "}
        <strong>Unmark PTO</strong> option. Marked days render with sky-blue
        diagonal stripes and a small dot in the day header so they stand out
        at a glance. When a cascade computes new dates for chained tasks,
        PTO days are skipped, so dependent tasks slide past your time off
        automatically.
      </p>
      <p>
        PTO marks are per-user (your time off is private), so a labmate
        looking at the same chart will not see your stripes unless they are
        viewing through a PI dashboard that aggregates across members.
      </p>

      <h2>Goals on the timeline</h2>
      <p>
        Goals appear in two places. Above each week&apos;s day headers,
        every active goal that overlaps the week renders as a thin colored
        bar (longer goals sit lower). Hover one for a tooltip showing the
        goal name and days remaining (or overdue). Click a bar to open the
        goal editor.
      </p>
      <p>
        The <strong>Goal sidebar</strong> on the right lists active goals as
        cards. Each card surfaces SMART subgoals as checkboxes so you can
        tick them off without leaving the chart. Use the{" "}
        <strong>+ Goal</strong> button in the toolbar to add a new
        high-level goal.
      </p>

      <h2>Open a task</h2>
      <p>
        Click a bar to open the task detail popup, where you can edit name,
        dates, tags, attached methods, notes, results, and subtasks. The
        popup is the same one used by{" "}
        <Link href="/wiki/features/experiments">the Workbench</Link> and the
        calendar, so changes here sync everywhere.
      </p>
      {/* TODO screenshot agent: capture a task detail popup opened over the Gantt.
          Route: /gantt with one task popup mounted
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: any user fixture; popup showing Details / Lab Notes / Method / Results tabs
          Save to: frontend/public/wiki/screenshots/gantt-task-popup.png
      */}
      <Screenshot
        src="/wiki/screenshots/gantt-task-popup.png"
        alt="A task detail popup opened over the Gantt chart, with Details, Lab Notes, Method, and Results tabs."
        caption="Clicking a bar opens the full task editor over the Gantt. Same popup as the Workbench and the calendar."
      />
    </WikiPage>
  );
}
