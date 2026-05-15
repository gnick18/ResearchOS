import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function HomeFeaturePage() {
  return (
    <WikiPage
      intro="The Home page is your project hub. Each project gets a card with its color, a progress bar, and a peek at what's coming up next."
    >
      <Screenshot
        src="/wiki/screenshots/home-projects.png"
        alt="Home page showing several colored project cards and the New Project button."
        caption="The Home page after creating a few projects."
      />

      <h2>The project card</h2>
      <p>
        Each card carries the project&apos;s color bar at the top, its name,
        and a <strong>7-day</strong> badge if weekends are active. Below that
        you&apos;ll see a progress bar (completed / total tasks with a
        percentage), an <strong>Active / Overdue / Upcoming</strong> stats
        row, and a <strong>Next Up</strong> list of the next five upcoming
        tasks. Project tags appear as <code>#tag</code> chips at the bottom.
        A six-dot drag handle on the right hints that the card can be
        dragged.
      </p>
      <p>
        The color you pick follows the project everywhere: the bar on the{" "}
        <Link href="/wiki/features/gantt">Gantt</Link>, the badge in{" "}
        <Link href="/wiki/features/lab-mode">Lab Mode</Link>, and the
        overlay on the calendar. Pick distinct colors early so a busy Gantt
        stays readable.
      </p>
      <p>
        Clicking a task name <em>inside</em> the <strong>Next Up</strong>{" "}
        list opens that task&apos;s detail popup directly. It
        doesn&apos;t open the project popup. Clicking anywhere else on the
        card opens the project popup described next.
      </p>

      <h2>Open a project</h2>
      <Screenshot
        src="/wiki/screenshots/home-project-popup.png"
        alt="A project detail popup open over the Home page, showing the task list and header buttons."
        caption="The project popup, opened by clicking a card."
      />
      <p>
        Clicking a card opens that project&apos;s detail popup. It lists the
        project&apos;s tasks split into <strong>In Progress</strong>,{" "}
        <strong>Overdue</strong>, and <strong>Upcoming</strong>. Click any
        task to open a quick popup over the list. From there you can expand
        into the full task detail.
      </p>
      <p>
        Three icon buttons sit in the popup header. A <strong>pencil</strong>{" "}
        enters edit mode (rename, change color, edit tags, toggle the 7-day
        schedule, or delete the project). A connected-circles{" "}
        <strong>share</strong> icon opens the share dialog so you can grant
        a labmate access. A close button dismisses the popup. The body has
        an <strong>Archive Project</strong> button (or{" "}
        <strong>Unarchive Project</strong> on already-archived projects).
      </p>

      <h2>Recently completed</h2>
      <p>
        Below the <strong>Upcoming</strong> group, the popup shows a green{" "}
        <strong>Recently completed</strong> section listing every task in
        this project that finished in the last 30 days. The list covers all
        task types (experiments, purchases, regular tasks), each with a
        color-coded dot on the left and the completion date on the right.
      </p>
      <p>
        Clicking a recently-completed task skips the quick popup and opens
        the full task detail popup straight on the{" "}
        <strong>Results</strong> tab, so you land on the writeup or
        attached files without an extra click. This is where the old
        Results page lived before it was rolled into the project popup.
      </p>

      <h2>Hosted from others</h2>
      <p>
        On your own projects, the popup may include an amber{" "}
        <strong>Hosted from others</strong> section at the bottom of the
        task list. Tasks here are owned by another labmate but have been
        shared <em>into</em> this project, so this view stays the complete
        picture of what&apos;s happening on the project (not just the tasks
        you own). Each row shows the task name, a{" "}
        <code>by &lt;owner&gt;</code> chip, and the start date. Hover the{" "}
        <strong>?</strong> next to the section title for a tooltip
        explaining the arrangement.
      </p>
      <p>
        The small <strong>X</strong> on the right of each row removes the
        task from <em>this</em> project. The task file stays in the
        original owner&apos;s library, only the link to your project goes
        away. The section is hidden on archived projects and on projects
        that were shared <em>to</em> you (you only see your own hosted
        guests, not your collaborators&apos;).
      </p>

      <h2>Projects a labmate shared with you</h2>
      <p>
        When a labmate shares a project with you, its card slides into the
        Home grid right next to your own. The card looks the same as any
        other (the project&apos;s color bar, the same progress bar and{" "}
        <strong>Next Up</strong> list). There&apos;s no special badge or
        owner pill marking it as shared. If you want to know which projects
        came from someone else, the project popup spells it out once you
        open the card.
      </p>
      <p>
        The tasks listed inside the popup are the <em>owner&apos;s</em>{" "}
        tasks for that project, the same tasks they see on their own
        Home page. The progress bar and the stats counts on the card all
        reflect those tasks too.
      </p>
      <p>
        On a shared project, a few header and edit-form buttons change
        their behavior rather than disappearing outright:
      </p>
      <ul>
        <li>
          <strong>The share icon is hidden.</strong> Only the original
          owner can grant access to a project. If you want a third labmate
          to see it too, ask the owner to share with them as well.
        </li>
        <li>
          <strong>The delete button greys out for everyone.</strong> Open
          the edit form on a shared project (view <em>or</em> edit
          permission) and the red <em>Delete Project</em> button is
          disabled. Hover it and a tooltip points back to the owner. Only
          the original owner can destroy the project file.
        </li>
        <li>
          <strong>View-only receivers see greyed-out edit controls.</strong>{" "}
          The pencil icon and the <em>Archive Project</em> button both
          render but stay disabled with a tooltip explaining that only the
          owner and edit-permission collaborators can change the project.
        </li>
      </ul>
      <p>
        Whether your edits actually go anywhere depends on the permission
        the owner picked when they shared:
      </p>
      <ul>
        <li>
          <strong>Edit permission</strong>: the pencil, the archive
          button, and the task edits inside the popup all save back to the
          original owner&apos;s copy of the data. Your changes show up on
          their Home page too (after their next refresh, since each
          person&apos;s app reads its own files on its own schedule).
        </li>
        <li>
          <strong>View permission</strong>: the pencil and archive button
          are disabled. Treat the project as read-only and use it as a
          window into the owner&apos;s work.
        </li>
      </ul>
      <p>
        Individual tasks behave the same way. When you open a task that
        was shared to you (either directly or by belonging to a shared
        project), the share icon vanishes and the delete button greys out
        with a tooltip pointing back to the owner. If you have edit
        permission, edits to the task (completion toggle, dates, lab
        notes, results, sub-tasks) save back to the owner&apos;s task
        file.
      </p>

      <Callout variant="tip" title="Want everyone&rsquo;s work at once?">
        Project sharing is the right tool when one labmate wants a
        specific other labmate to follow along on a specific project. For
        a single view that rolls up every labmate&apos;s projects, tasks,
        and methods all at once, switch to{" "}
        <Link href="/wiki/features/lab-mode">Lab Mode</Link> instead.
      </Callout>

      <Callout variant="info" title="The Miscellaneous project is permanent">
        A built-in project called <strong>Miscellaneous</strong> holds
        standalone tasks that don&apos;t belong to a research project. Its
        popup hides the edit, archive, and delete actions. You can share
        it and open its tasks, but the project itself can&apos;t be renamed
        or removed.
      </Callout>

      <h2>Create a new project</h2>
      <Steps>
        <Step>
          Click <strong>+ New Project</strong> at the top right of the Home
          page.
        </Step>
        <Step>
          Type a name (e.g. <em>CRISPR Gene Editing Study</em>) and pick a
          color from the row of swatches.
        </Step>
        <Step>
          Optionally add tags as a comma-separated list (e.g.{" "}
          <code>sequencing, LC-MS, cell-culture</code>). They show up as{" "}
          <code>#tag</code> chips on the card and in search.
        </Step>
        <Step>
          Tick <strong>7-day schedule (weekends active)</strong> if work on
          this project spills into Saturday and Sunday. The Gantt respects
          this setting when it shifts dates around dependencies.
        </Step>
        <Step>
          Click <strong>Create Project</strong>. The card appears in the
          active grid.
        </Step>
      </Steps>

      <h2>Reorder, archive, delete</h2>
      <ul>
        <li>
          <strong>Drag a card</strong> to a new spot in the grid. The order
          is per-user and persists across sessions.
        </li>
        <li>
          <strong>Archive a project</strong> from the popup&apos;s{" "}
          <strong>Archive Project</strong> button. Archived projects keep
          all their tasks but move below the active grid into a separate{" "}
          <strong>Archived Projects</strong> section, where they read as
          muted cards. Their tasks stop showing in the Gantt and the task
          sidebar. Unarchive from the same popup whenever you want them
          back.
        </li>
        <li>
          <strong>Delete a project</strong> from edit mode (pencil, then{" "}
          <strong>Delete Project</strong> at the bottom-left of the form).
          This also deletes every task in the project and can&apos;t be
          undone, so archive first if you&apos;re not sure.
        </li>
      </ul>

      <Callout variant="tip" title="Color is visual grouping everywhere">
        The color you pick on Home drives every project bar on the Gantt,
        every badge in Lab Mode, and the calendar overlay. Pick distinct
        colors early so the Gantt stays readable as the project count grows.
      </Callout>
    </WikiPage>
  );
}
