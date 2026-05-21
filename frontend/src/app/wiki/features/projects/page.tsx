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
      intro="Each project has two faces. A slim popup for quick stats and project-level actions, and a full route page that hosts the project's hypothesis prose, results, methods, goals, and activity."
    >
      <h2>Inspector and Workspace</h2>
      <p>
        A project in ResearchOS now answers two different questions, on two
        different surfaces.
      </p>
      <ul>
        <li>
          <strong>The Inspector</strong> is the slim popup you get when you
          click a card on Home. It tells you, at a glance, how the project is
          doing (total tasks, completed, overdue), and gives you the small set
          of project-level actions you reach for occasionally (edit, share,
          archive, delete). It is read-once and dismiss.
        </li>
        <li>
          <strong>The Workspace</strong> is the full page at{" "}
          <code>/workbench/projects/&lt;id&gt;</code>. It is where the
          project&apos;s identity actually lives: the hypothesis, the
          aggregated results, the methods inventory, optional goals, and the
          activity feed. It is bookmark-able, share-able by URL, and the
          place you spend time inside a project.
        </li>
      </ul>
      <p>
        Wherever you reach a project, both faces are one click apart. The
        Inspector always offers a way into the Workspace (two of them, in
        fact). The Workspace top bar always offers a way back to your project
        list.
      </p>

      <Callout variant="info" title="Where the URL points">
        Your own projects live at <code>/workbench/projects/3</code>. A
        project a labmate has shared with you appends an owner hint:{" "}
        <code>/workbench/projects/3?owner=morgan</code>. That second segment
        is how ResearchOS picks the right per-user file path when ids
        collide across labmates.
      </Callout>

      <h2>The Inspector popup</h2>
      <Screenshot
        src="/wiki/screenshots/projects-slim-popup.png"
        alt="The slim project popup hovered over the Home page, showing the color stripe, name, tag chips, a three-stat row, two Open full view affordances, and an Archive Project button."
        caption="Click a project card on Home to open the Inspector."
      />
      <p>
        Click a project card on the Home page and the Inspector opens over the
        grid. The header shows the project name, color stripe, and any tag
        chips. Below the header, a three-stat row reports{" "}
        <strong>Total Tasks</strong>, <strong>Completed</strong>, and (when
        the count is nonzero) <strong>Overdue</strong>.
      </p>
      <p>
        Everything else in the popup is project-level CRUD. The header
        carries icon buttons for <strong>Edit project</strong> (rename,
        retag, recolor, toggle weekends), <strong>Share project</strong>{" "}
        (owners only), and <strong>Close</strong>. The body has a single
        <strong> Archive Project</strong> action (or{" "}
        <strong>Unarchive Project</strong> on archived ones). Edit mode
        reveals the destructive <strong>Delete Project</strong> button.
      </p>
      <p>
        Two affordances link out to the Workspace. A small{" "}
        <strong>Open full view →</strong> link sits in the popup header next
        to the action icons, and a full-width{" "}
        <strong>Open full view →</strong> button sits at the bottom of the
        body. Either dismisses the popup and navigates to the route.
      </p>
      <Callout variant="info" title="Why two links to the same place">
        The bottom-of-popup button is the muscle-memory affordance (read the
        stats, decide to dig in, click the prominent CTA). The header link
        is for power users who already know they want the route and would
        rather not skim the stats first.
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
        <strong>← Projects</strong> breadcrumb back to Home, the project
        name, and the same icon-button cluster for{" "}
        <strong>Edit</strong>, <strong>Share</strong>,{" "}
        <strong>Archive</strong>, and <strong>Delete</strong> that the
        Inspector has. A <strong>View timeline →</strong> link jumps you
        across to the Gantt prefiltered by this project.
      </p>
      <p>
        Below the icons, a row of anchor links lets you jump between
        sections without scrolling: <strong>Overview</strong>{" "}
        <Kbd>│</Kbd> <strong>Results</strong> <Kbd>│</Kbd>{" "}
        <strong>Methods</strong> <Kbd>│</Kbd> <strong>Activity</strong>. The
        anchor strip stays pinned as you scroll, so the jump links are
        always within reach.
      </p>

      <h3>Overview</h3>
      <p>
        The Overview is where you write the project&apos;s hypothesis,
        motivation, and big-picture context as long-form markdown. It uses
        the same <Link href="/wiki/features/markdown-editor">live markdown
        editor</Link> as lab notes and methods, with the full toolbar,
        image-paste, and drag-drop file attachment.
      </p>
      <p>
        Edits autosave 1.5 seconds after the last keystroke. A small{" "}
        <strong>Saving…</strong> /<strong> Saved</strong> indicator near the
        section title tells you when the write has landed. The text lives in
        a sidecar file at{" "}
        <code>users/&lt;owner&gt;/projects/&lt;id&gt;-overview.md</code>, so
        it is portable, greppable, and editable outside the app.
      </p>
      <p>
        Dragging an image into the editor writes it to{" "}
        <code>projects/&lt;id&gt;-attachments/Images/</code> and appends a
        reference to the prose. Dragging any other file lands in{" "}
        <code>projects/&lt;id&gt;-attachments/Files/</code> the same way.
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
        The Methods section is a flat, deduplicated inventory of every
        method attached to an experiment in this project. Each row carries
        the method name, a type pill (Markdown, PDF, PCR), and a{" "}
        <strong>used in N experiments</strong> badge so you can see which
        protocols this project actually leans on.
      </p>
      <p>
        Rows are sorted by usage count descending, with the method name as
        an alphabetical tiebreaker. Click any row to jump to the full method
        in the <Link href="/wiki/features/methods">Method Library</Link>. If
        the same method appears on hosted experiments (from labmates),
        you&apos;ll see a <strong>via &lt;owner&gt;</strong> chip next to
        the row.
      </p>

      <h3>Goals (opt-in)</h3>
      <p>
        If you turned <strong>Goals</strong> on during the{" "}
        <Link href="/wiki/getting-started/welcome-wizard">Welcome
        Wizard</Link>, a fourth section slots in between Methods and
        Activity. It lists every high-level goal whose{" "}
        <code>project_id</code> matches this project, with active goals on
        top and completed ones below. Each row shows the goal&apos;s color
        dot, name, date range, and SMART sub-goal progress.
      </p>
      <p>
        Click a row to open the goal editor. The section header doubles as
        a count of total goals on the project. If you skipped Goals during
        the wizard, the section is hidden entirely (no empty placeholder, no
        marketing CTA). You can opt in later from{" "}
        <Link href="/wiki/features/settings">Settings</Link>.
      </p>
      <Callout variant="info" title="Why this is conditional">
        Goals are a deliberate workflow, not a default. The wizard&apos;s
        fourth question asks whether you want to commit to multi-week
        outcomes. If you answered no, the rest of the app respects that and
        the project route doesn&apos;t litter the anchor strip with a
        feature you opted out of.
      </Callout>

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
        which means every collaborator on a shared project sees the same
        feed. Events older than 90 days are lazily pruned the next time the
        file is written.
      </p>

      <h2>The sidebar Projects rail</h2>
      <Screenshot
        src="/wiki/screenshots/projects-sidebar-nav.png"
        alt="The left sidebar of a project route, showing a Projects header at top and a sub-list of project names. One project name is highlighted in blue as the active route."
        caption="The Projects rail in the left sidebar. The active project is highlighted."
      />
      <p>
        On every project route, the left sidebar adds a third rail next to
        the <strong>Daily Tasks</strong> and <strong>Calendar</strong>{" "}
        rails. The header at the top is a <strong>Projects</strong> link
        back to the Home grid. Below it, a sub-list of your active projects
        lets you jump between routes without going through Home first.
      </p>
      <p>
        Each entry carries the project&apos;s color bar on the left. The
        currently-open project is highlighted blue. Shared projects show
        with the same shape as your own, and clicking one keeps the{" "}
        <code>?owner=</code> hint in the URL so it stays scoped to the right
        labmate&apos;s data.
      </p>
      <Callout variant="info" title="What's excluded from the rail">
        The rail intentionally skips two categories. <strong>Archived
        projects</strong> stay out of the sub-list to keep it focused on
        what you&apos;re actively working on. The{" "}
        <strong>Miscellaneous</strong> project is also excluded, because it
        has no Workspace route (more below).
      </Callout>

      <h2>Sharing and shared projects</h2>
      <p>
        When a labmate shares a project with you, the URL gains an{" "}
        <code>?owner=&lt;username&gt;</code> query parameter so the
        Workspace knows which user&apos;s files to read. The Inspector,
        Workspace, and sidebar rail all pass the same owner hint through.
      </p>
      <p>
        How much you can change depends on the permission you were granted:
      </p>
      <ul>
        <li>
          <strong>View permission.</strong> The Inspector&apos;s edit,
          archive, and delete actions all render but stay disabled with a
          tooltip pointing back to the owner. The Workspace still loads,
          and you can read the overview, browse the results gallery, scan
          the methods inventory, and read the activity feed. You cannot
          type into the overview (the editor renders as read-only).
        </li>
        <li>
          <strong>Edit permission.</strong> The Inspector&apos;s edit and
          archive actions are live, and the Workspace&apos;s overview
          editor is editable. Your writes route back to the owner&apos;s
          directory, so they reflect on their copy too. The{" "}
          <strong>Delete</strong> action is still owner-only: only the
          original owner can destroy the project file.
        </li>
      </ul>
      <p>
        On the Workspace, a small <strong>Shared by &lt;owner&gt;</strong>{" "}
        chip sits next to the project name so you always know whose
        namespace you&apos;re reading from.
      </p>

      <h2>The Miscellaneous bucket</h2>
      <p>
        ResearchOS ships with a built-in <strong>Miscellaneous</strong>{" "}
        project for standalone tasks that don&apos;t belong to a specific
        research project. It is treated differently on every Project Surface:
      </p>
      <ul>
        <li>
          The <strong>Inspector</strong> opens, but the edit, share,
          archive, and delete buttons are hidden. Both{" "}
          <strong>Open full view →</strong> affordances are suppressed.
        </li>
        <li>
          There is <strong>no Workspace route</strong>. The URL{" "}
          <code>/workbench/projects/&lt;misc-id&gt;</code> is not a
          meaningful destination, so the popup never offers a link to it.
        </li>
        <li>
          The <strong>sidebar rail</strong> hides the Miscellaneous entry
          for the same reason: there is no route page to navigate to.
        </li>
      </ul>
      <Callout variant="warning" title="This isn't a missing feature">
        Miscellaneous is a permanent catch-all for ad-hoc tasks. It has no
        hypothesis to write, no results to aggregate, no methods inventory
        worth deduplicating. Routing it like a research project would just
        produce a sad-looking page. The Inspector still works so you can
        share it or browse its task counts.
      </Callout>

      <h2>Getting around the Surface</h2>
      <Steps>
        <Step>
          From the Home grid, click a project card. The Inspector opens
          over the grid.
        </Step>
        <Step>
          Use the Inspector for project-level CRUD (rename, share, archive,
          delete) or to glance at the task totals.
        </Step>
        <Step>
          Click either <strong>Open full view →</strong> link to land on
          the Workspace. The Inspector closes behind you.
        </Step>
        <Step>
          On the Workspace, write into the Overview, scroll for Results,
          Methods, optional Goals, and Activity. Use the anchor strip to
          jump between sections.
        </Step>
        <Step>
          Use the left sidebar to hop directly between project Workspaces
          without going back to Home. Click the <strong>Projects</strong>{" "}
          header at the top of the rail to return to the grid.
        </Step>
      </Steps>

      <Callout variant="tip" title="Bookmark the Workspace">
        Project Workspaces are first-class URLs. Bookmark them, paste them
        into your lab notebook, or drop the link into a Slack thread.
        Anyone with view-or-edit access on a shared project lands on the
        same view when they open the URL.
      </Callout>
    </WikiPage>
  );
}
