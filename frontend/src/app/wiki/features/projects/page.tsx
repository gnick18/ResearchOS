import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ProjectsFeaturePage() {
  return (
    <WikiPage
      title="Project Surface"
      intro="A project has two faces. A compact card on the Workbench Projects tab for quick stats and a way in, and a full route page that hosts the project's hypothesis prose, results, methods, sequences, goals, activity, and funding."
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
          project&apos;s chosen color sits next to the project name.
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
        The card has no drag handle and no menu button. Clicking anywhere on the
        card navigates to the project&apos;s route at{" "}
        <code>/workbench/projects/&lt;id&gt;</code>. There is no popup
        intermediate step. Project-level actions (rename, share, archive,
        delete) live on the route&apos;s top bar, covered below.
      </p>

      <Callout variant="info" title="Where the URL points">
        Your own projects live at <code>/workbench/projects/3</code>. A
        project a labmate has shared with you appends an owner hint:{" "}
        <code>/workbench/projects/3?owner=morgan</code>. That second segment
        is how ResearchOS picks the right per-user file path when ids collide
        across labmates.
      </Callout>

      <h2>The project route</h2>
      <Screenshot
        src="/wiki/screenshots/projects-route-overview.png"
        alt="The project route page with a color stripe, a breadcrumb back to Projects, the project name, top-bar action icons, and a row of tabs reading Overview Results Methods."
        caption="The project route at /workbench/projects/1, opened on the Overview tab."
      />
      {/* SCREENSHOT TODO: projects-route-overview.png predates the real-tabs
          redesign — it may still show the old sticky scroll-anchor strip. Do
          NOT capture here; recapture when the route UI settles. */}
      <p>
        The route opens with a color stripe across the top edge, then a sticky
        top bar. The top bar carries a <strong>&#8592; Projects</strong>{" "}
        breadcrumb back to the grid, the project name, and (on the right) a{" "}
        <strong>View timeline &rarr;</strong> link that jumps to the Gantt
        prefiltered to this project, plus a row of icon buttons for version
        history, edit, share, deposit, archive, and delete.
      </p>
      <p>
        Below the top bar sits a row of <strong>tabs</strong>. These are real
        tabs backed by app state, not scroll anchors, so only the active
        section&apos;s content renders at a time. The full set is{" "}
        <strong>Overview</strong>, <strong>Results</strong>,{" "}
        <strong>Methods</strong>, <strong>Sequences</strong>,{" "}
        <strong>Goals</strong>, <strong>Activity</strong>, and{" "}
        <strong>Funding</strong>, but a tab only appears when it has something to
        show. Overview always shows. Results, Methods, Sequences, and Activity
        auto-hide when they are empty, and Goals appears only when you opted into
        goals. So a brand-new project with just a hypothesis shows close to a
        single Overview tab, never a tab that leads nowhere.
      </p>
      <Callout variant="info" title="Empty sections hide themselves">
        You will not see a Results or Methods tab until the project actually has
        a result image or an attached method. The tab strip grows as the project
        fills in, which keeps an early-stage project from looking broken.
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

      <h3>Sequences</h3>
      <p>
        The Sequences section lists the plasmids and sequences from your{" "}
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

      <h3>Funding</h3>
      <p>
        The Funding section ties a project to the grants that pay for it, which
        is the backbone of an accurate data-management or grant report. It shows
        two complementary things.
      </p>
      <ul>
        <li>
          <strong>Primary grant.</strong> The single funding account you linked
          to the project in the Edit dialog. This is the project&apos;s declared
          funding source. When nothing is linked, the section reads{" "}
          <em>No primary grant linked</em>.
        </li>
        <li>
          <strong>Grants charged in this project.</strong> The distinct set of
          grants that purchases inside the project were actually charged to,
          derived live from each purchase&apos;s funding line. This can differ
          from the primary grant, which is the whole point. It surfaces where
          the money really went. A charged line with no matching account in your
          lab carries a small <em>(no matching account)</em> note.
        </li>
      </ul>
      <p>
        The section is read-only and self-hides when a project has no primary
        link and no charged grants, so an unfunded project stays uncluttered.
        For how the grant metadata flows into a deposit and a compliant report,
        see{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH data-management compliance
        </Link>
        .
      </p>

      <h2>Top-bar actions on the route</h2>
      <p>
        The project route&apos;s sticky top bar holds the project-level actions
        as icon buttons on the right. Hover any icon for a tooltip naming it.
      </p>
      <ul>
        <li>
          <strong>Version history</strong> opens a side panel of saved versions.
          Pick one to preview a read-only diff, and (when you can write the
          project) restore it. After a restore an <strong>Undo restore</strong>{" "}
          button appears in the top bar for a 24-hour window.
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
          of the active grid and the Gantt. Unarchive from the same button.
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
        standalone tasks that don&apos;t belong to a research project. Its route
        top bar hides every action button (edit, share, deposit, archive,
        delete), and it can&apos;t be renamed or removed. The route still works
        as a read-only progress view.
      </Callout>

      <h2>Sharing and shared projects</h2>
      <p>
        When a labmate shares a project with you, the URL gains an{" "}
        <code>?owner=&lt;username&gt;</code> query parameter so the route knows
        which user&apos;s files to read.
      </p>
      <p>
        How much you can change depends on the permission you were granted.
      </p>
      <ul>
        <li>
          <strong>View permission.</strong> The Edit and Archive buttons render
          disabled (cursor-not-allowed), and the Share button is omitted
          entirely. The route still loads, and you can read the overview, browse
          the results gallery, scan the methods and sequences inventories, and
          read the activity feed. You cannot type into the overview textarea (it
          renders read-only).
        </li>
        <li>
          <strong>Edit permission.</strong> The Edit and Archive actions are
          live. Your writes route back to the owner&apos;s directory, so they
          reflect on their copy too. Delete is still owner-only, grayed out for
          any receiver regardless of permission.
        </li>
      </ul>
      <p>
        On the route, a small <strong>Shared by &lt;owner&gt;</strong> chip sits
        next to the project name so you always know whose namespace you&apos;re
        reading from.
      </p>

      <h2>The Miscellaneous bucket</h2>
      <p>
        ResearchOS ships with a built-in <strong>Miscellaneous</strong> project
        for standalone tasks that don&apos;t belong to a specific research
        project. It behaves differently from a real project.
      </p>
      <ul>
        <li>
          Its <strong>route top bar hides every action button</strong>. Edit,
          Share, Deposit, Archive, and Delete are not available, because
          Miscellaneous can&apos;t be renamed, shared, archived, or removed.
        </li>
        <li>
          Clicking its card on the grid <strong>navigates to the route</strong>{" "}
          at <code>/workbench/projects/&lt;misc-id&gt;</code>, where you can see
          progress and the activity feed.
        </li>
        <li>
          There is <strong>no Overview, Results, Methods, or Sequences</strong>{" "}
          to fill in, because Miscellaneous has no hypothesis, no experiments,
          and no protocol or construct inventory worth deduplicating.
        </li>
      </ul>
      <Callout variant="info" title="Miscellaneous is a permanent catch-all">
        Miscellaneous holds ad-hoc tasks and can&apos;t be edited, shared,
        archived, or deleted. Its route still works as a read-only progress
        view.
      </Callout>

      <h2>Getting around the Surface</h2>
      <Steps>
        <Step>
          Open the <strong>Projects</strong> tab on the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link> (it&apos;s
          where you land by default) to see the grid of project cards.
        </Step>
        <Step>
          Click a card to navigate to that project&apos;s route. The card itself
          has no menu; project-level actions live on the route&apos;s top bar.
        </Step>
        <Step>
          On the route, write into the Overview textarea and use the tab strip
          to move between Results, Methods, Sequences, optional Goals, Activity,
          and Funding. Only the tabs with content show.
        </Step>
        <Step>
          Use the <strong>&#8592; Projects</strong> breadcrumb in the top bar
          to return to the grid.
        </Step>
      </Steps>

      <Callout variant="tip" title="Bookmark the project route">
        Project routes are first-class URLs. Bookmark them, paste them into
        your lab notebook, or drop the link into a Slack thread. Anyone with
        view-or-edit access on a shared project lands on the same view when
        they open the URL.
      </Callout>
    </WikiPage>
  );
}
