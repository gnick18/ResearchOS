import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function GanttFeaturePage() {
  return (
    <WikiPage
      intro="The Gantt is a single timeline across every project you own (and every shared task you can see). It's the main place you schedule work and watch dependencies cascade."
    >
      <Screenshot
        src="/wiki/screenshots/gantt-overview.png"
        alt="The Gantt chart with multiple project bars color-coded across a timeline."
        caption="Every active task across every project, color-coded by project."
      />

      <h2>What you&apos;re looking at</h2>
      <p>
        Each row is a task. Each colored bar runs from the task&apos;s start
        date to its end date, and the color matches the task&apos;s project on
        the <Link href="/wiki/features/home">Home</Link> page. Bars are grouped
        by project, and the project block can be collapsed.
      </p>
      <p>
        When two tasks are connected by a thin arrow, that&apos;s a{" "}
        <strong>dependency</strong>. The arrow says &quot;the child starts when
        the parent ends.&quot; Move or resize the parent and ResearchOS shifts
        every downstream task by the same amount, respecting each project&apos;s
        weekend setting. There&apos;s no edit-the-chain dialog, you just drag.
      </p>
      <p>
        Tasks shared with you from other users render as bars too, tinted by
        their owner&apos;s color rather than the project&apos;s. If a shared
        task is marked editable, you can drag it like your own.
      </p>

      <h2>Add a task</h2>
      <p>There are two ways to make a new task on the Gantt:</p>
      <Steps>
        <Step>
          Click the <strong>+ Task</strong> button at the top of the page, pick
          a project, and fill in the popup.
        </Step>
        <Step>
          Or, double-click any empty day in a project&apos;s row. ResearchOS
          opens the new-task popup pre-filled with that project and that start
          date. This is the fast path when you&apos;re sketching out a plan
          visually.
        </Step>
      </Steps>

      <h2>Move and resize a task</h2>
      <Steps>
        <Step>
          <strong>Drag the middle of a bar</strong> to move the whole task. The
          duration stays the same, only the start and end dates shift.
        </Step>
        <Step>
          <strong>Drag either end of a bar</strong> to resize. The opposite
          edge holds in place.
        </Step>
        <Step>
          When you drop, any tasks that depend on the one you moved shift
          forward (or backward) by the same amount. You&apos;ll see a brief
          flash on the affected bars so you can tell what was touched.
        </Step>
      </Steps>
      <Callout variant="tip" title="Weekend rules ride along">
        Drag-shift respects each project&apos;s &quot;weekend active&quot;
        setting. If the parent project skips weekends, dropping a dependent
        task on a Saturday lands it on the next Monday. You can toggle the
        setting in the project detail popup on the Home page.
      </Callout>

      <h2>Zoom, filter, and skip weekends</h2>
      <Screenshot
        src="/wiki/screenshots/gantt-zoom-controls.png"
        alt="The top controls of the Gantt page with the zoom selector highlighted."
        caption="The view controls at the top of the page: zoom, project filter, and weekdays-only toggle."
      />
      <ul>
        <li>
          <strong>Zoom</strong> switches between <em>1 week</em>,{" "}
          <em>1 month</em>, <em>3 months</em>, and <em>All time</em>. Wider
          zooms collapse the day columns so you can see months at a glance.
        </li>
        <li>
          <strong>Project filter</strong> (top-left) hides bars whose project
          isn&apos;t in your current set. Useful when you want to look at one
          project in isolation.
        </li>
        <li>
          <strong>Weekdays only</strong> hides Saturday and Sunday columns.
          Pair it with a project that has &quot;weekend active&quot; off and
          the Gantt becomes a clean Mon-Fri grid.
        </li>
      </ul>

      <h2>Open a task</h2>
      <p>
        Click any bar to open the task detail popup, where you can edit dates,
        attach methods, write notes, and link sub-tasks. The popup is the
        same one you get from <Link href="/wiki/features/experiments">Lab Notes</Link>{" "}
        and the calendar, so what you change here syncs everywhere.
      </p>
      <Screenshot
        src="/wiki/screenshots/gantt-task-popup.png"
        alt="A task detail popup opened over the Gantt chart."
        caption="Clicking a bar opens the full task editor over the Gantt."
      />
    </WikiPage>
  );
}
