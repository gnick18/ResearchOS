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
        The color you pick follows the project everywhere — the bar on the{" "}
        <Link href="/wiki/features/gantt">Gantt</Link>, the badge in{" "}
        <Link href="/wiki/features/lab-mode">Lab Mode</Link>, and the
        overlay on the calendar. Pick distinct colors early so a busy Gantt
        stays readable.
      </p>
      <p>
        Clicking a task name <em>inside</em> the <strong>Next Up</strong>{" "}
        list opens that task&apos;s detail popup directly — it
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
        task to open a quick popup over the list; from there you can expand
        into the full task detail.
      </p>
      <p>
        Three icon buttons sit in the popup header: a <strong>pencil</strong>{" "}
        to enter edit mode (rename, change color, edit tags, toggle the
        7-day schedule, or delete the project); a connected-circles{" "}
        <strong>share</strong> icon to share the project with a labmate; and
        a close button. The body has an <strong>Archive Project</strong>{" "}
        button (or <strong>Unarchive Project</strong> on already-archived
        projects).
      </p>
      <p>
        Projects that other labmates have shared with you appear on this
        page alongside your own. If a shared project was given edit
        permission, your edits inside its popup save back to the original
        owner&apos;s data.
      </p>
      <Callout variant="info" title="The Miscellaneous project is permanent">
        A built-in project called <strong>Miscellaneous</strong> holds
        standalone tasks that don&apos;t belong to a research project. Its
        popup hides the edit, archive, and delete actions — you can share
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
          <strong>Delete a project</strong> from edit mode (pencil →{" "}
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
