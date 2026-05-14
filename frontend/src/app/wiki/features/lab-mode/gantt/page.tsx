import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModeGanttPage() {
  return (
    <WikiPage
      title="Combined GANTT"
      intro="Every selected user's tasks laid out on a single timeline, colored by who owns each bar."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-gantt.png"
        alt="The combined GANTT in Lab Mode. Bars from multiple users are stacked on one timeline, each tinted in the owner's color."
        caption="Bars are colored by user, not by project. The legend underneath maps each color to a username."
      />

      <h2>What you&apos;re looking at</h2>
      <p>
        The Lab Mode GANTT renders the same week-by-week layout as the regular{" "}
        <Link href="/wiki/features/gantt">GANTT chart</Link>, except every
        selected user&apos;s tasks share the same timeline. Where your personal
        GANTT colors bars by project, the combined GANTT colors them by{" "}
        <strong>user</strong> so you can see at a glance whose work is on the
        chart.
      </p>
      <p>
        List-style tasks are filtered out. Only experiments and purchases
        appear. That keeps the timeline focused on real time-bounded work and
        skips the running checklists that don&apos;t have a meaningful date
        range.
      </p>

      <h2>Anatomy of a bar</h2>
      <p>Each bar carries a few small markers on it:</p>
      <ul>
        <li>
          <strong>Fill color</strong>: the owner&apos;s user color. The
          legend strip at the bottom of the chart spells out which color maps
          to which person.
        </li>
        <li>
          <strong>Username badge on the left</strong>: a single uppercase
          letter (the first letter of the username) inside a dark pill.
          Disambiguates when two users have similar colors.
        </li>
        <li>
          <strong>Type indicator on the right</strong>: a beaker emoji
          (🔬) for experiments and a dollar sign ($) for purchases, so you can
          tell the kinds of work apart without reading the title.
        </li>
        <li>
          <strong>Faded look when complete</strong>: finished tasks are
          desaturated and lightened, plus they get a small checkmark on the
          right. Active work pops; finished work fades into the background.
        </li>
        <li>
          <strong>Diagonal stripes for weekends</strong>: same as on the
          regular GANTT. The stripes are a visual cue that a bar spans a
          non-working day.
        </li>
        <li>
          <strong>Fade gradient at the edge</strong>: if a bar extends past
          the visible window, the relevant side fades to a darker color
          instead of being chopped off, hinting that there&apos;s more to see
          by scrolling.
        </li>
      </ul>

      <h2>Controls and behavior</h2>
      <ul>
        <li>
          <strong>View buttons</strong>: the row of small pills above the
          chart (<code>1W</code>, <code>2W</code>, <code>3W</code>,{" "}
          <code>1M</code>, <code>3M</code>, <code>6M</code>, <code>1Y</code>)
          changes how many weeks you see at once. The selection is shared with
          your personal GANTT so the two views stay consistent.
        </li>
        <li>
          <strong>Today is highlighted in red</strong>: the column header for
          the current day is filled with red, and the day&apos;s cells get a
          subtle red tint. Easy to scan for what&apos;s happening right now.
        </li>
        <li>
          <strong>Click any bar</strong>: opens the read-only task popup. The
          tooltip on hover gives the task name, owner, project, and date range
          without having to click.
        </li>
        <li>
          <strong>Stacking</strong>: overlapping bars stack onto separate
          rows automatically. The chart finds the first row where the bar
          doesn&apos;t collide with another and drops it in there, so you
          never get bars on top of each other.
        </li>
        <li>
          <strong>Auto-jump</strong>: if none of the selected users&apos;
          tasks fall inside the current visible window, the chart snaps to the
          week of the earliest visible task so you don&apos;t stare at an
          empty grid.
        </li>
      </ul>

      <Callout variant="tip" title="Stats bar above the chart">
        On the GANTT, Experiments, and Purchases tabs, a stats row appears at
        the top of the page showing total users, projects, experiments, and
        purchases for the current selection. The other Lab Mode tabs hide it
        because they summarize themselves inside their own panel.
      </Callout>

      <h2>How this differs from the per-user GANTT</h2>
      <p>The combined GANTT is similar but not identical to the personal one:</p>
      <ul>
        <li>
          <strong>Coloring rule</strong>: combined uses user color; personal
          uses project color. Same chart, different signal.
        </li>
        <li>
          <strong>No drag-to-reschedule</strong>: Lab Mode is read-only.
          Reschedules happen in the owner&apos;s own dashboard.
        </li>
        <li>
          <strong>No dependency arrows</strong>: dependency cascades are
          per-user namespaces in ResearchOS, so the combined view skips the
          arrow overlay rather than show partial chains.
        </li>
        <li>
          <strong>Every bar shows a user badge</strong>: the personal GANTT
          doesn&apos;t need this because every bar is yours. Combined uses it
          to disambiguate.
        </li>
      </ul>
    </WikiPage>
  );
}
