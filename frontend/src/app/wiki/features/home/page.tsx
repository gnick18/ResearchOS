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
      </p>
      <p>
        Own project cards show a six-dot drag handle on the right. Cards for
        projects a labmate shared with you do not have a handle and cannot be
        reordered.
      </p>
      <p>
        The color you pick follows the project everywhere: the bar on the{" "}
        <Link href="/wiki/features/gantt">Gantt</Link>, the badge on the{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        widgets, and the overlay on the calendar. Pick distinct colors
        early so a busy Gantt stays readable.
      </p>
      <p>
        Clicking a task name <em>inside</em> the <strong>Next Up</strong>{" "}
        list opens that task&apos;s detail popup directly. Clicking anywhere
        else on the card navigates to that project&apos;s dedicated route
        (see{" "}
        <Link href="/wiki/features/projects">Project Surface</Link> for the
        full walkthrough of Overview, Results, Methods, Goals, and Activity).
      </p>

      <h2>Card actions (kebab menu)</h2>
      <p>
        Hover any project card to reveal a three-dots kebab button in the
        top-right corner. The menu contains the following items:
      </p>
      <ul>
        <li>
          <strong>Edit</strong> opens the EditProjectModal, where you can
          rename the project, change its color, edit tags, and toggle the
          7-day schedule.
        </li>
        <li>
          <strong>Share</strong> opens the share dialog so you can grant a
          labmate access. This item is hidden on projects that were shared{" "}
          <em>to</em> you (only the owner can grant access).
        </li>
        <li>
          <strong>Archive / Unarchive</strong> triggers an amber confirmation
          dialog. Archived projects keep all their tasks but move to the
          separate <strong>Archived Projects</strong> section below the active
          grid, where they appear as muted cards and stop showing in the Gantt
          and task sidebar. Unarchive from the same menu whenever you want
          them back.
        </li>
        <li>
          <strong>Delete</strong> is disabled on projects shared to you. Only
          the original owner can delete the project. Use the kebab Delete item
          (or the trash-can icon in the project route&apos;s top bar) to
          permanently remove a project you own. This also deletes every task
          in the project and cannot be undone, so archive first if you&apos;re
          not sure.
        </li>
      </ul>
      <Callout variant="info" title="The Miscellaneous project is permanent">
        A built-in project called <strong>Miscellaneous</strong> holds
        standalone tasks that don&apos;t belong to a research project. The
        kebab menu is hidden entirely for Miscellaneous. You can share it and
        open its tasks, but the project itself can&apos;t be renamed or
        removed.
      </Callout>

      <h2>Projects a labmate shared with you</h2>
      <p>
        When a labmate shares a project with you, its card slides into the
        Home grid right next to your own. The card looks the same as any
        other (the project&apos;s color bar, the same progress bar and{" "}
        <strong>Next Up</strong> list). There&apos;s no special badge or
        owner pill marking it as shared.
      </p>
      <p>
        The tasks listed inside the project route are the <em>owner&apos;s</em>{" "}
        tasks for that project, the same tasks they see on their own
        Home page. The progress bar and the stats counts on the card all
        reflect those tasks too.
      </p>
      <p>
        On a shared project, a few actions change their behavior:
      </p>
      <ul>
        <li>
          <strong>The Share kebab item is hidden.</strong> Only the original
          owner can grant access to a project. If you want a third labmate
          to see it too, ask the owner to share with them as well.
        </li>
        <li>
          <strong>The Delete item is disabled for receivers.</strong> Hover it
          and a tooltip points back to the owner. Only the original owner can
          destroy the project file.
        </li>
        <li>
          <strong>View-only receivers see greyed-out edit controls.</strong>{" "}
          The Edit item and the Archive action both render but stay disabled
          with a tooltip explaining that only the owner and edit-permission
          collaborators can change the project.
        </li>
      </ul>
      <p>
        Whether your edits actually go anywhere depends on the permission
        the owner picked when they shared:
      </p>
      <ul>
        <li>
          <strong>Edit permission</strong>: the edit form, the archive
          action, and task edits inside the project route all save back to the
          original owner&apos;s copy of the data. Your changes show up on
          their Home page too (after their next refresh, since each
          person&apos;s app reads its own files on its own schedule).
        </li>
        <li>
          <strong>View permission</strong>: edit and archive actions are
          disabled. Treat the project as read-only and use it as a window into
          the owner&apos;s work.
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

      <Callout variant="tip" title="Want a lab-wide read-only roll-up?">
        Project sharing is the right tool when one labmate wants a
        specific other labmate to follow along on a specific project. For
        a single dashboard that rolls up every labmate&apos;s projects,
        tasks, purchases, and announcements at once, the Lab Head opens
        the <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        at <code>/lab-overview</code>.
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

      <h2>Reorder and archive</h2>
      <ul>
        <li>
          <strong>Drag a card</strong> to a new spot in the grid. The order
          is per-user and persists across sessions. Only own project cards
          have a drag handle; shared-in cards cannot be reordered.
        </li>
        <li>
          <strong>Archive a project</strong> from the kebab menu&apos;s{" "}
          <strong>Archive Project</strong> option. Archived projects keep
          all their tasks but move below the active grid into a separate{" "}
          <strong>Archived Projects</strong> section, where they read as
          muted cards. Their tasks stop showing in the Gantt and the task
          sidebar. Unarchive from the same kebab menu whenever you want them
          back.
        </li>
      </ul>

      <Callout variant="tip" title="Color is visual grouping everywhere">
        The color you pick on Home drives every project bar on the Gantt,
        every badge across the Lab Overview widgets, and the calendar
        overlay. Pick distinct colors early so the Gantt stays readable
        as the project count grows.
      </Callout>

      <h2>The customizable widget canvas</h2>
      <p>
        Beyond the project grid, Home is also a customizable widget canvas.
        New accounts start with two default widgets at the top of the
        page: <strong>Upcoming tasks</strong> on the left and{" "}
        <strong>Today&apos;s events</strong> on the right. From there, you
        can add, remove, and reorder widgets from the canvas controls to
        match how you actually start your day. The canvas works the same
        way as the{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        canvas: tiles open into full popups, drag-and-drop reorders them,
        and edit mode (top-right of the toolbar) reveals the layout
        controls.
      </p>
      {/* TODO screenshot agent: capture Home with the default widget canvas + project grid below.
          Route: /home
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: member fixture with default widget set + 3 project cards
          Save to: frontend/public/wiki/screenshots/home-widget-canvas.png
      */}
      <Screenshot
        src="/wiki/screenshots/home-widget-canvas.png"
        alt="The Home page showing the two default widgets (Upcoming tasks, Today's events) at the top with the project grid below."
        caption="Home, with the two default widgets on top and the project grid below. Pin and reorder the widgets that match how you start your day."
      />
      <ul>
        <li>
          <strong>+ Add widget</strong> opens the palette of every available
          widget (the same catalog the Lab Overview uses). Drag a tile onto
          the canvas to pin it.
        </li>
        <li>
          <strong>Drag tiles to reorder</strong> with edit mode on. Tiles
          snap to the grid and the layout persists in your settings sidecar.
        </li>
        <li>
          <strong>Tools launcher</strong> in the header opens any Tool
          popup directly, without pinning. Useful for one-shot looks.
        </li>
        <li>
          <strong>Default widgets</strong>: new accounts start with
          Upcoming tasks (top) and Today&apos;s events (next to it). They
          cover the two most common &ldquo;what do I do this morning&rdquo;{" "}
          questions without crowding the canvas. Pin extras like
          announcements, comments, or lab activity from the catalog
          whenever you want more on the page.
        </li>
      </ul>
    </WikiPage>
  );
}
