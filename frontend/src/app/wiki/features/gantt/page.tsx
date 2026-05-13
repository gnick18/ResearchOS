import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function GanttFeaturePage() {
  return (
    <WikiPage
      intro="A timeline of every task across every project. Drag to reschedule; downstream dependencies cascade automatically."
    >
      <Screenshot
        src="/wiki/screenshots/gantt-overview.png"
        alt="The Gantt chart with multiple project bars color-coded across a timeline."
      />

      <h2>Reschedule a task</h2>
      <Steps>
        <Step>
          Click and drag the middle of a bar to move it. Click and drag either
          end to resize.
        </Step>
        <Step>
          When you drop, any tasks that depend on this one shift forward by the
          same amount. You&apos;ll see a brief flash on the affected bars.
        </Step>
        <Step>
          To undo, drag back to the original position — there&apos;s no global
          undo, but dependency math is reversible.
        </Step>
      </Steps>

      <h2>Zoom and filter</h2>
      <ul>
        <li>
          Use the zoom selector to switch between <strong>1 week</strong>,{" "}
          <strong>1 month</strong>, <strong>3 months</strong>, and{" "}
          <strong>All time</strong>.
        </li>
        <li>
          The project filter (top-left) hides bars whose project isn&apos;t in
          your current set.
        </li>
        <li>
          <strong>Weekdays only</strong> hides Saturday and Sunday columns —
          useful unless you have weekend-active projects.
        </li>
      </ul>

      <Callout variant="tip" title="Dependencies and weekend rules">
        Drag-shift respects each project&apos;s &quot;weekend active&quot;
        setting. If the parent project skips weekends, dropping a dependent
        task on a Saturday lands it on the next Monday. Toggle weekend-active
        from the project detail popup on the Home page.
      </Callout>

      <h2>Open a task</h2>
      <p>
        Click any bar to open the task detail popup, where you can edit dates,
        attach methods, write notes, and link sub-tasks. The popup is identical
        to the one you get from Lab Notes and the Calendar.
      </p>
    </WikiPage>
  );
}
