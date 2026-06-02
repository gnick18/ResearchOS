import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import Kbd from "@/components/wiki/Kbd";

export default function ProjectsFeaturePage() {
  return (
    <WikiPage
      title="Project Surface"
      intro="Each project has two faces. The Home page card for quick stats and card-level actions, and a full route page that hosts the project's hypothesis prose, results, methods, goals, and activity."
    >
      <h2>Home page card anatomy</h2>
      <p>
        Each project is represented by a card on the Home page grid. From top
        to bottom, a card contains:
      </p>
      <ul>
        <li>
          <strong>Color stripe</strong> across the top edge, matching the
          project&apos;s chosen color.
        </li>
        <li>
          <strong>Project name</strong>, with an optional{" "}
          <strong>7-day</strong> badge when weekends are active on that
          project.
        </li>
        <li>
          <strong>Progress bar</strong> showing completed tasks out of total,
          with a percentage.
        </li>
        <li>
          <strong>Active / Overdue / Upcoming</strong> stats row.
        </li>
        <li>
          <strong>Next Up</strong> task list (up to 5 upcoming tasks). Clicking
          a task name here opens that task&apos;s detail popup directly.
        </li>
        <li>
          <strong>Tag chips</strong> at the bottom for any tags attached to the
          project.
        </li>
        <li>
          <strong>Drag handle</strong> (own cards only). Own project cards show
          a six-dot handle on the right for reordering. Cards for projects
          shared to you have no handle and cannot be reordered.
        </li>
        <li>
          <strong>Kebab menu</strong> (own and edit-permission cards). A
          three-dots button appears in the top-right corner on hover (see
          &ldquo;Card actions&rdquo; below).
        </li>
      </ul>
      <p>
        Clicking anywhere on the card (other than a task name or the kebab)
        navigates directly to the project&apos;s Workspace route at{" "}
        <code>/workbench/projects/&lt;id&gt;</code>. There is no popup
        intermediate step.
      </p>
      <p>
        Archived projects do not appear in the active grid. They show in a
        separate <strong>Archived Projects</strong> section below the active
        grid, rendered as muted cards with an archived-date badge.
      </p>

      <Callout variant="info" title="Where the URL points">
        Your own projects live at <code>/workbench/projects/3</code>. A
        project a labmate has shared with you appends an owner hint:{" "}
        <code>/workbench/projects/3?owner=morgan</code>. That second segment
        is how ResearchOS picks the right per-user file path when ids collide
        across labmates.
      </Callout>

      <h2>Card actions (kebab menu)</h2>
      <p>
        Hover any project card to reveal a three-dots kebab button in the
        top-right corner. Clicking it opens a dropdown with the following
        items:
      </p>
      <ul>
        <li>
          <strong>Edit</strong> opens the EditProjectModal, where you can
          rename the project, change its color, edit tags, and toggle the
          7-day schedule. Disabled (cursor-not-allowed) for view-only
          receivers.
        </li>
        <li>
          <strong>Share</strong> opens the share dialog so you can grant a
          labmate access. This item is hidden entirely on projects that were
          shared to you. Only the original owner can grant access.
        </li>
        <li>
          <strong>Archive / Unarchive</strong> triggers an amber confirmation
          dialog before archiving. Archived projects keep all their tasks but
          move to the separate <strong>Archived Projects</strong> section
          below the active grid. Their tasks stop showing in the Gantt and
          the task sidebar. Unarchive from the same kebab menu whenever you
          want them back. Disabled for view-only receivers.
        </li>
        <li>
          <strong>Delete</strong> is disabled (grayed out) for any receiver,
          view or edit permission. Only the original owner can destroy the
          project file.
        </li>
      </ul>
      <Callout variant="info" title="The Miscellaneous project is permanent">
        A built-in project called <strong>Miscellaneous</strong> holds
        standalone tasks that don&apos;t belong to a research project. The
        kebab menu is suppressed entirely for Miscellaneous. Clicking the card
        navigates to the project route, which shows progress, next-up tasks,
        and activity, but Edit, Share, Archive, and Delete are not available.
      </Callout>

      <h2>The Workspace route</h2>
      <Screenshot
        src="/wiki/screenshots/projects-route-overview.png"
        alt="The project route page with a color stripe, breadcrumb back to Projects, the project name, and a sticky anchor strip reading Overview Results Methods Activity."
        caption="The Workspace at /workbench/projects/1, scrolled to Overview."
      />
      <p>
        The Workspace is a single scrolling page with a sticky top bar. The
        top bar carries the project&apos;s color stripe, a{" "}
        <strong>&#8592; Projects</strong> breadcrumb back to Home, the project
        name, and icon buttons for <strong>Edit</strong>,{" "}
        <strong>Share</strong>, <strong>Archive</strong>, and{" "}
        <strong>Delete</strong>. A <strong>View timeline &rarr;</strong> link
        jumps you across to the Gantt prefiltered by this project.
      </p>
      <p>
        Below the icons, a row of anchor links lets you jump between sections
        without scrolling: <strong>Overview</strong> <Kbd>│</Kbd>{" "}
        <strong>Results</strong> <Kbd>│</Kbd> <strong>Methods</strong>{" "}
        <Kbd>│</Kbd> <strong>Activity</strong>. The anchor strip stays pinned
        as you scroll, so the jump links are always within reach.
      </p>

      <h3>Overview</h3>
      <p>
        The Overview is where you write the project&apos;s hypothesis,
        motivation, and big-picture context. It is a plain resizable textarea
        with no toolbar, no image-paste, and no drag-drop file attachment.
      </p>
      <p>
        Edits autosave 1.5 seconds after the last keystroke. A small{" "}
        <strong>Saving&hellip;</strong> / <strong>Saved</strong> indicator
        near the section title tells you when the write has landed. The text
        lives in a sidecar file at{" "}
        <code>users/&lt;owner&gt;/projects/&lt;id&gt;-overview.md</code>, so
        it is portable, greppable, and editable outside the app.
      </p>

      <h3>Results</h3>
      <Screenshot
        src="/wiki/screenshots/projects-route-results.png"
        alt="The Results section of the project route, showing two experiment groups each with their own header row and a strip of thumbnail images."
        caption="Results are grouped by experiment, newest images first."
      />
      <p>
        The Results section pulls every image from every{" "}
        <strong>Results</strong> tab on every experiment that belongs to this
        project, then groups them by experiment. Each group has a collapsible
        header with the experiment name and the image count. Within a group,
        thumbnails are sorted newest-first. Click a thumbnail to open the
        full-size image with its caption.
      </p>
      <p>
        Experiments hosted into this project by labmates (their experiments,
        attached to your project) appear in their own groups with a{" "}
        <strong>Shared by &lt;owner&gt;</strong> chip. Hosted groups are
        suppressed on archived projects.
      </p>

      <h3>Methods</h3>
      <Screenshot
        src="/wiki/screenshots/projects-route-methods.png"
        alt="The Methods section of the project route, listing several methods with type pills and a 'used in N experiments' badge on each row."
        caption="The Methods inventory deduplicates across experiments and counts usage."
      />
      <p>
        The Methods section is a flat, deduplicated inventory of every method
        attached to an experiment in this project. Each row carries the method
        name, a type pill (Markdown, PDF, PCR), and a{" "}
        <strong>used in N experiments</strong> badge so you can see which
        protocols this project actually leans on.
      </p>
      <p>
        Rows are sorted by usage count descending, with the method name as an
        alphabetical tiebreaker. Click any row to jump to the full method in
        the <Link href="/wiki/features/methods">Method Library</Link>. If the
        same method appears on hosted experiments (from labmates), you&apos;ll
        see a <strong>via &lt;owner&gt;</strong> chip next to the row.
      </p>

      <h3>Goals (opt-in)</h3>
      <p>
        If you turned <strong>Goals</strong> on during the{" "}
        <Link href="/wiki/getting-started/welcome-wizard">Welcome Wizard</Link>
        , a fourth section slots in between Methods and Activity. It lists
        every high-level goal whose <code>project_id</code> matches this
        project, with active goals on top and completed ones below. Each row
        shows the goal&apos;s color dot, name, date range, and SMART sub-goal
        progress.
      </p>
      <p>
        Click a row to open the goal editor. The section heading reads{" "}
        <strong>Goals</strong> with a sibling count badge to its right showing
        the total number of goals on the project. If you skipped Goals during
        the wizard, the section is hidden entirely. You can opt in later from{" "}
        <Link href="/wiki/features/settings">Settings</Link>.
      </p>

      <h3>Activity</h3>
      <Screenshot
        src="/wiki/screenshots/projects-route-activity.png"
        alt="The Activity section, listing a chronological feed of events. Each row has an icon, a summary line, and a relative timestamp on the right."
        caption="Activity is a chronological feed scoped to this project."
      />
      <p>
        Activity is a newest-first feed of events scoped to this project. The
        feed picks up task completions, image drops on any of the
        project&apos;s experiments, methods attached or removed, overview
        edits, share events, and archive flips. Each row carries an icon, a
        one-line summary, and a relative timestamp on the right. Hover the
        timestamp to see the exact ISO string.
      </p>
      <p>
        Events live in a sidecar at{" "}
        <code>users/&lt;owner&gt;/projects/&lt;id&gt;-activity.json</code>,
        which means every collaborator on a shared project sees the same feed.
        Events older than 90 days are lazily pruned the next time the file is
        written.
      </p>

      <h2>Sharing and shared projects</h2>
      <p>
        When a labmate shares a project with you, the URL gains an{" "}
        <code>?owner=&lt;username&gt;</code> query parameter so the Workspace
        knows which user&apos;s files to read.
      </p>
      <p>
        How much you can change depends on the permission you were granted:
      </p>
      <ul>
        <li>
          <strong>View permission.</strong> In the kebab menu and the Workspace
          top bar, Edit and Archive render disabled (cursor-not-allowed). The
          Share item is omitted entirely from the kebab (not just disabled) for
          any shared-in card. The Workspace still loads, and you can read the
          overview, browse the results gallery, scan the methods inventory, and
          read the activity feed. You cannot type into the overview textarea (it
          renders as read-only).
        </li>
        <li>
          <strong>Edit permission.</strong> The Edit and Archive actions are
          live in both the kebab and the Workspace top bar. Your writes route
          back to the owner&apos;s directory, so they reflect on their copy
          too. The <strong>Delete</strong> action is still owner-only: only the
          original owner can destroy the project file, and Delete is grayed out
          for any receiver regardless of permission.
        </li>
      </ul>
      <p>
        On the Workspace, a small <strong>Shared by &lt;owner&gt;</strong>{" "}
        chip sits next to the project name so you always know whose namespace
        you&apos;re reading from.
      </p>

      <h2>The Miscellaneous bucket</h2>
      <p>
        ResearchOS ships with a built-in <strong>Miscellaneous</strong> project
        for standalone tasks that don&apos;t belong to a specific research
        project. It is treated differently on every Project Surface:
      </p>
      <ul>
        <li>
          The <strong>kebab menu is suppressed entirely</strong> for
          Miscellaneous cards. Edit, Share, Archive, and Delete are not
          available from the Home grid.
        </li>
        <li>
          Clicking the card <strong>navigates to the project route</strong> at{" "}
          <code>/workbench/projects/&lt;misc-id&gt;</code>, where you can see
          progress, the next-up task list, and the activity feed. The route
          top bar also hides Edit, Share, Archive, and Delete for Miscellaneous.
        </li>
        <li>
          There is <strong>no Overview, Results, or Methods</strong> section
          because Miscellaneous has no hypothesis, no experiments, and no
          protocol inventory worth deduplicating.
        </li>
      </ul>
      <Callout variant="info" title="Miscellaneous is a permanent catch-all">
        Miscellaneous holds ad-hoc tasks and can&apos;t be edited, shared,
        archived, or deleted. The project route still works as a read-only
        progress view.
      </Callout>

      <h2>Getting around the Surface</h2>
      <Steps>
        <Step>
          From the Home grid, hover a project card to reveal the three-dots
          kebab in the top-right corner. Use it for project-level CRUD (rename,
          share, archive, delete).
        </Step>
        <Step>
          Click anywhere else on the card (or a task name in the Next Up list
          to open that task directly) to navigate to the Workspace route.
        </Step>
        <Step>
          On the Workspace, write into the Overview textarea, scroll for
          Results, Methods, optional Goals, and Activity. Use the anchor strip
          to jump between sections.
        </Step>
        <Step>
          Use the <strong>&#8592; Projects</strong> breadcrumb in the top bar
          to return to the Home grid.
        </Step>
      </Steps>

      <Callout variant="tip" title="Bookmark the Workspace">
        Project Workspaces are first-class URLs. Bookmark them, paste them into
        your lab notebook, or drop the link into a Slack thread. Anyone with
        view-or-edit access on a shared project lands on the same view when
        they open the URL.
      </Callout>
    </WikiPage>
  );
}
