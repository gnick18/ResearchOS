import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ProjectsFeaturePage() {
  return (
    <WikiPage
      title="Projects"
      intro="Projects are the top-level containers for your research. A compact card on the Workbench Projects tab gives quick stats and a way in. Clicking a card opens the ProjectDetailPopup, a full-pane popup that hosts the project's overview, results, methods, sequences, goals, activity, and molecules."
    >
      <h2>The project card on the Workbench</h2>
      <p>
        Your projects live on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, in a responsive
        grid on the <strong>Projects</strong> tab. That tab is the default
        landing view, so a member who opens ResearchOS sees their projects
        first, not a flat task list. Each project is a single card. From top to
        bottom, a card carries four things.
      </p>
      <ul>
        <li>
          <strong>A &ldquo;Shared by&rdquo; pill</strong> at the very top, but
          only on cards for projects a labmate shared with you. Your own cards
          skip it.
        </li>
        <li>
          <strong>Color dot and name.</strong> A small filled dot in the
          project&apos;s chosen color sits next to the project name. A project
          you never picked a color for falls back to one from a built-in
          palette, and you can change it any time from the Edit dialog.
        </li>
        <li>
          <strong>Completion bar.</strong> A thin bar showing the percentage of
          this project&apos;s tasks that are complete, with an{" "}
          <em>N of M complete</em> label and a percentage above it. A project
          with no tasks yet reads <em>No tasks yet</em> at 0 percent.
        </li>
        <li>
          <strong>Count chips.</strong> A row of small chips at the bottom
          counting <strong>experiments</strong>, <strong>list tasks</strong>,
          and (when the project has any) <strong>sequences</strong>.
        </li>
      </ul>
      <p>
        Clicking anywhere on the card opens the project&apos;s{" "}
        <strong>ProjectDetailPopup</strong>. There is no navigation to a
        separate full-page route. Project-level actions (version history, edit,
        share, deposit, archive, delete) are accessible from within the popup
        via a kebab menu in the popup top bar.
      </p>

      <Callout variant="info" title="Deep links still work">
        Bookmarked URLs like{" "}
        <code>/workbench/projects/3</code> and shared links with an owner
        hint (<code>?owner=morgan</code>) still open correctly. They render
        the Workbench Projects view and auto-open the popup for that project,
        exactly as a card click does.
      </Callout>

      <h2>The ProjectDetailPopup</h2>
      <Screenshot
        src="/wiki/screenshots/projects-popup-home.png"
        alt="The ProjectDetailPopup open over the Workbench Projects grid, showing a color stripe at the top, the project name, a kebab menu icon, and a row of tab labels reading Overview Results Methods."
        caption="The ProjectDetailPopup. Click any project card to open it. The kebab menu in the top bar holds version history, edit, share, deposit, archive, and delete."
      />
      <p>
        The popup opens with a color stripe across the top edge. A sticky
        top bar carries the project name, a <strong>View timeline &rarr;</strong>{" "}
        link that jumps to the Gantt prefiltered to this project, and a{" "}
        <strong>kebab menu</strong> (three-dot icon) on the right that holds all
        project-level actions.
      </p>
      <p>
        Below the top bar sits a row of <strong>tabs</strong>. These are real
        tabs backed by app state, not scroll anchors, so only the active
        section&apos;s content renders at a time. The full tab set is{" "}
        <strong>Overview</strong>, <strong>Results</strong>,{" "}
        <strong>Methods</strong>, <strong>Sequences</strong>,{" "}
        <strong>Goals</strong>, and <strong>Activity</strong>. A tab only
        appears when it has something to show. Overview and Results always show.
        Methods, Sequences, Goals, and Activity auto-hide when they are empty,
        so a brand-new project with just a hypothesis shows close to a single
        Overview tab, never a tab that leads nowhere.
      </p>

      <h2>Funding context (always visible, not a tab)</h2>
      <p>
        Funding information sits <strong>above the tab body</strong>, not as a
        tab of its own. It is always-visible context that frames whichever
        section is active. It shows two things.
      </p>
      <ul>
        <li>
          <strong>Primary grant.</strong> The single funding account you linked
          to the project in the Edit dialog. When nothing is linked, this area
          reads <em>No primary grant linked</em>.
        </li>
        <li>
          <strong>Grants charged in this project.</strong> The distinct set of
          grants that purchases inside the project were actually charged to,
          derived live from each purchase&apos;s funding line. This can differ
          from the primary grant, which is the whole point.
        </li>
      </ul>
      <p>
        The funding area self-hides when a project has no primary link and no
        charged grants, so an unfunded project stays uncluttered. For how the
        grant metadata flows into a deposit and a compliant report, see{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH data-management compliance
        </Link>
        .
      </p>

      <Callout variant="info" title="Empty tabs hide themselves">
        You will not see a Methods or Sequences tab until the project actually
        has an attached method or a linked sequence. The tab strip grows as the
        project fills in, which keeps an early-stage project from looking broken.
        Overview and Results are the exception, they always show.
      </Callout>

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
        alt="The Results tab inside a project popup, showing two experiment groups each with their own header row and a strip of thumbnail images."
        caption="Results are grouped by experiment, newest images first."
      />
      <p>
        The Results tab pulls every image from every{" "}
        <strong>Results</strong> tab on every experiment that belongs to this
        project, then groups them by experiment. Each group has a collapsible
        header with the experiment name and the image count. Within a group,
        thumbnails are sorted newest-first. Click a thumbnail to open the
        full-size image with its caption.
      </p>
      <p>
        Experiments hosted into this project by labmates appear in their own
        groups with a{" "}
        <strong>Shared by &lt;owner&gt;</strong> chip. Hosted groups are
        suppressed on archived projects.
      </p>

      <h3>Methods</h3>
      <Screenshot
        src="/wiki/screenshots/projects-route-methods.png"
        alt="The Methods tab inside a project popup, listing several methods with type pills and a 'used in N experiments' badge on each row."
        caption="The Methods inventory deduplicates across experiments and counts usage."
      />
      <p>
        The Methods tab is a flat, deduplicated inventory of every method
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

      <h3>Sequences</h3>
      <p>
        The Sequences tab lists the plasmids and sequences from your{" "}
        <Link href="/wiki/features/sequences">sequence library</Link> that are
        linked to this project. Each row shows the sequence name, its length in
        base pairs, and a type pill (DNA, RNA, or Protein). The tab appears only
        when at least one sequence is linked, so a project with no constructs
        never shows it.
      </p>
      <p>
        This is a read-only roll-up, not the editor. Clicking a row, or the{" "}
        <strong>Manage in the sequence library &rarr;</strong> link in the
        section header, takes you to the full sequence library where you map,
        annotate, and edit. To link a sequence to a project, set its project
        membership in that library.
      </p>

      <h3>Goals (opt-in)</h3>
      <p>
        If you turned <strong>Goals</strong> on during the{" "}
        <Link href="/wiki/getting-started/welcome-wizard">Welcome Wizard</Link>
        , a Goals tab appears just before Activity. It lists every high-level
        goal whose <code>project_id</code> matches this project, with active
        goals on top and completed ones below. Each row shows the goal&apos;s
        color dot, name, date range, and SMART sub-goal progress.
      </p>
      <p>
        Click a row to open the goal editor. If you skipped Goals during the
        wizard, the tab is hidden entirely. You can opt in later from{" "}
        <Link href="/wiki/features/settings">Settings</Link>.
      </p>

      <h3>Activity</h3>
      <Screenshot
        src="/wiki/screenshots/projects-route-activity.png"
        alt="The Activity tab inside a project popup, listing a chronological feed of events. Each row has an icon, a summary line, and a relative timestamp on the right."
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

      <h3>Molecules doorway</h3>
      <p>
        When a project has linked molecules (from the{" "}
        <Link href="/wiki/features/chemistry">Chemistry</Link> library), a{" "}
        <strong>Molecules</strong> doorway appears in the popup&apos;s{" "}
        <strong>Go to</strong> section. Clicking it opens a read-only roll-up of
        all molecules linked to this project, without leaving the popup. The
        doorway is only shown when the Chemistry feature is enabled and the
        project has at least one linked molecule.
      </p>

      <h2>Top-bar kebab menu</h2>
      <p>
        The popup&apos;s sticky top bar holds a kebab menu (three-dot icon) on
        the right. Opening it reveals the project-level actions.
      </p>
      <ul>
        <li>
          <strong>Version history</strong> opens a side panel of saved versions.
          Pick one to preview a read-only diff, and (when you can write the
          project) restore it. After a restore an <strong>Undo restore</strong>{" "}
          button appears for a 24-hour window.
        </li>
        <li>
          <strong>Edit</strong> opens the edit dialog, where you can rename the
          project, change its color, edit tags, toggle the 7-day schedule, and
          link a funding account. Disabled for view-only receivers.
        </li>
        <li>
          <strong>Share</strong> opens the share dialog so you can grant a
          labmate access. Hidden entirely on projects shared to you, since only
          the original owner can grant access.
        </li>
        <li>
          <strong>Deposit to a repository</strong> opens the deposit dialog for
          publishing the project&apos;s outputs to a data repository.
        </li>
        <li>
          <strong>Archive / Unarchive</strong> triggers an amber confirmation
          before archiving. Archived projects keep all their tasks but drop out
          of the active grid and the Gantt. Unarchive from the same item.
          Disabled for view-only receivers.
        </li>
        <li>
          <strong>Delete</strong> is owner-only. It is disabled for any
          receiver, view or edit permission. Only the original owner can destroy
          the project file.
        </li>
      </ul>
      <Callout variant="info" title="The Miscellaneous project is permanent">
        A built-in project called <strong>Miscellaneous</strong> holds
        standalone tasks that don&apos;t belong to a research project. Its popup
        hides every action in the kebab menu (edit, share, deposit, archive,
        delete), and it can&apos;t be renamed or removed. The popup still works
        as a read-only progress view.
      </Callout>

      <h2>Sharing and shared projects</h2>
      <p>
        When a labmate shares a project with you, the deep-link URL gains an{" "}
        <code>?owner=&lt;username&gt;</code> query parameter so the app knows
        which user&apos;s files to read.
      </p>
      <p>
        How much you can change depends on the permission you were granted.
      </p>
      <ul>
        <li>
          <strong>View permission.</strong> The Edit and Archive items in the
          kebab menu render disabled, and the Share item is omitted entirely.
          The popup still loads, and you can read the overview, browse the
          results gallery, scan the methods and sequences inventories, and
          read the activity feed.
        </li>
        <li>
          <strong>Edit permission.</strong> The Edit and Archive actions are
          live. Your writes route back to the owner&apos;s directory, so they
          reflect on their copy too. Delete is still owner-only.
        </li>
      </ul>
      <p>
        A small <strong>Shared by &lt;owner&gt;</strong> chip sits next to the
        project name in the popup so you always know whose namespace you&apos;re
        reading from.
      </p>

      <h2>Getting around</h2>
      <Steps>
        <Step>
          Open the <strong>Projects</strong> tab on the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link> (it&apos;s
          where you land by default) to see the grid of project cards.
        </Step>
        <Step>
          Click a card to open the <strong>ProjectDetailPopup</strong>. Use the
          tabs (Overview, Results, Methods, Sequences, Goals, Activity) to move
          between sections.
        </Step>
        <Step>
          Use the kebab menu in the popup top bar for project-level actions
          (version history, edit, share, deposit, archive, delete).
        </Step>
        <Step>
          Close the popup with the close button or press Escape to return to the
          grid.
        </Step>
      </Steps>

      <Callout variant="tip" title="Bookmark deep links">
        Project deep links are first-class URLs. Bookmark{" "}
        <code>/workbench/projects/3</code>, paste it into your lab notebook,
        or drop the link into a Slack thread. Anyone with view-or-edit access
        on a shared project lands on the same popup when they open the URL.
      </Callout>
    </WikiPage>
  );
}
