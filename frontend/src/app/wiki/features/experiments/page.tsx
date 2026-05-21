import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function ExperimentsFeaturePage() {
  return (
    <WikiPage
      title="The Workbench"
      intro="The Workbench is where active research lives day to day. One page, three tabs (Experiments, Notes, Lists), each with its own way of grouping work. The URL is /workbench, and /experiments still redirects there for backwards compatibility."
    >
      <Screenshot
        src="/wiki/screenshots/workbench-experiments.png"
        alt="The Workbench page with the Experiments tab active, showing the three-tab strip, the project filter pills, and the stacked section headers."
        caption="The Workbench in its default state: Experiments tab selected, sections stacked top-to-bottom."
      />

      <TryInDemo href="/workbench">Try the Workbench</TryInDemo>

      <h2>Three tabs, three ways to slice the work</h2>
      <p>
        The Workbench packs three different views of your in-flight work
        into one page. The tab strip across the top names them and gives
        each a color identity:
        <strong> Experiments</strong> (blue),
        <strong> Notes</strong> (emerald),
        <strong> Lists</strong> (violet).
        The active tab fills with its color; the other two read as gray
        text buttons.
      </p>
      <p>
        Each tab uses a different organizing principle, which is the
        whole point of keeping them apart. The Experiments tab groups
        protocols by where they sit in the run cycle (ready, blocked,
        running, awaiting writeup, recent results, archive). The Lists
        tab groups list tasks by how close their dates are to right now
        (overdue, doing, upcoming, recently done, earlier). The Notes
        tab skips grouping entirely and offers a flat, search-driven
        list. So if you want to know &quot;what can I run today,&quot;
        you reach for Experiments. If you want to know &quot;what
        paperwork is overdue,&quot; you reach for Lists. If you want to
        find the meeting note from three weeks ago, you reach for Notes.
      </p>

      <h2>The project filter pill strip</h2>
      <p>
        Directly below the tab strip sits a row of colored pills, one
        per project, plus an <strong>All projects</strong> pill on the
        left. Click a pill to narrow the view to that project; click it
        again (or pick a different one) to clear. The filter applies
        across tabs: pick a project on Experiments and then switch to
        Lists, and the Lists tab opens already narrowed to the same
        project. That keeps a single research question coherent across
        the three views.
      </p>
      <Callout variant="info" title="Notes intentionally skips the project filter">
        Notes aren&apos;t tied to any single project, so the pill strip
        hides on this tab by design. A filter that can&apos;t actually
        narrow anything would just be visual noise. To scope the note
        grid, use the search box at the top of the tab and filter by
        content instead.
      </Callout>

      <h2>The Experiments tab</h2>
      <p>
        The Experiments tab organizes every experiment task in your
        library by stage of the protocol. Six sections stack vertically,
        always in this order:
      </p>

      <h3>1. Ready to start</h3>
      <p>
        Experiments scheduled to begin today or recently, with no
        incomplete upstream task blocking the start. These are the cards
        you can pick up and run today, so the section sits at the top
        and reads first.
      </p>

      <h3>2. Blocked</h3>
      <p>
        Experiments that depend on an upstream task that hasn&apos;t
        finished yet. The blocking parent&apos;s name renders directly
        under the card in a small amber strip so you know what
        you&apos;re waiting on. Click the parent name to jump straight
        to that task and unblock the chain.
      </p>

      <h3>3. Running</h3>
      <p>
        Experiments where today falls between the start date and the end
        date. Each card carries a <strong>Day N of M</strong> freshness
        label, and (if the experiment is part of a chain) a gray
        <strong> Next:</strong> pointer to the experiment that follows it
        so you can step through a multi-day protocol without leaving the
        Workbench.
      </p>

      <h3>4. Awaiting writeup</h3>
      <p>
        Experiments marked complete but with no results body or attached
        images on disk yet. This section is your reminder pile: bench
        work is done, the writeup is still owed. The header stays put
        even when the section is empty, with a green &quot;All recent
        experiments have results logged&quot; note in its place, so
        the absence of a queue is itself useful feedback.
      </p>

      <h3>5. Recent results</h3>
      <p>
        Completed experiments with results landed in the last 30 days.
        When you have results across two or more projects, this section
        sub-groups them by project (a small colored dot per project
        header) so a busy month doesn&apos;t collapse into one
        undifferentiated grid.
      </p>

      <h3>6. Earlier results</h3>
      <p>
        The archive: completed experiments older than 30 days. The
        section header carries a <strong>Flat</strong> / <strong>Grouped</strong>{" "}
        toggle so you can flip between a single time-ordered grid and
        one block per project. There&apos;s no time cap, so the whole
        completion history is reachable from one place.
      </p>

      <Screenshot
        src="/wiki/screenshots/workbench-experiments-sections.png"
        alt="The Experiments tab scrolled to show several stacked section headers (Ready to start, Blocked, Running, Awaiting writeup) with cards underneath each."
        caption="Each section reads as an uppercase header with a count, plus a one-line helper on the right summarizing the rule (e.g., 'Today falls between start and end date')."
      />

      <h3>Cards and chain stacks</h3>
      <p>
        Each card carries the experiment name, a project pill, the
        project color along the edge, a hero image (if the writeup has
        one), a method chip strip, and a freshness label keyed to the
        section it&apos;s in. When two or more experiments are linked by
        a dependency, they collapse into a single stacked card labeled
        <strong> N tasks</strong>. Clicking the stack opens the{" "}
        <em>root</em> experiment&apos;s popup. The{" "}
        <Link href="/wiki/features/gantt">Gantt page</Link> is where you
        walk a chain step-by-step.
      </p>

      <h3>+ New Experiment</h3>
      <p>
        The blue button at the top right of the tab opens the New Task
        modal with the type pre-selected to <em>experiment</em>. It is
        the same modal you&apos;d get from the Gantt.
      </p>

      <h2>The Notes tab</h2>
      <p>
        The Notes tab holds every note that isn&apos;t tied to a
        specific experiment. Meeting notes from a Tuesday lab meeting, a
        running log of equipment-room weirdness, half-formed ideas you
        want to find again next month: they all land here, in one flat
        list with no section headers. The choice to skip grouping is
        deliberate. Notes are search-first, not date-first, because a
        researcher coming back to a note usually remembers <em>what</em>{" "}
        the note was about, not <em>when</em> it was written.
      </p>
      <Screenshot
        src="/wiki/screenshots/workbench-notes.png"
        alt="The Notes tab showing a search box, three type filter buttons (All / Single / Running Logs), the New Note button, and a grid of note cards."
        caption="The Notes tab leads with a search box and three type filters; the grid below filters live as you type."
      />
      <p>
        The header carries a search box on the left and three type
        filter buttons in the middle (<strong>All</strong>,{" "}
        <strong>Single</strong>, <strong>Running Logs</strong>). Single
        notes are one-page records of a moment (a meeting, an idea).
        Running logs are timestamped multi-entry pages you append to
        over time (an equipment journal, a daily standup log). The
        <strong> New Note</strong> button on the right opens a dropdown
        that asks which kind to create.
      </p>
      <Callout variant="info" title="When to use Notes vs Lab Notes">
        The Notes tab is for writing that isn&apos;t attached to any
        single experiment. Per-experiment lab notes (running observations,
        what reagents you grabbed, the photo at the bench five minutes
        ago) live inside that experiment&apos;s popup on its{" "}
        <strong>Lab Notes</strong> tab. If the writing belongs to a
        protocol, it goes there. If it belongs to the lab, it goes here.
      </Callout>

      <h2>The Lists tab</h2>
      <p>
        The Lists tab is the queue view of every list task you own.
        Lists are the non-experiment task type: checklists, paperwork,
        ordering tasks, errands, anything that isn&apos;t a protocol.
        The Lists tab sorts them into five stages by how their dates
        relate to today, stacked top-to-bottom in this order:
      </p>
      <ol>
        <li>
          <strong>Overdue</strong>: list tasks whose end date has passed
          and that aren&apos;t complete yet. The first thing in your
          queue every morning.
        </li>
        <li>
          <strong>Doing</strong>: list tasks where today falls between
          start and end.
        </li>
        <li>
          <strong>Upcoming</strong>: list tasks scheduled to start
          later.
        </li>
        <li>
          <strong>Recently done</strong>: completed in the last 30 days.
        </li>
        <li>
          <strong>Earlier</strong>: completed more than 30 days ago.
          Collapsed by default; click the header to expand.
        </li>
      </ol>
      <p>
        Each row carries the task name, project pill, and a date signal
        phrased relative to today (&quot;3d overdue&quot;,
        &quot;Started yesterday&quot;, &quot;Starts in 4d&quot;).
        Clicking a row opens the same list-task popup you&apos;d get
        from the Gantt or the Home page, with the popup landing on the
        <strong> Details</strong> tab so you can read what the task is
        for and check off sub-tasks.
      </p>
      <Screenshot
        src="/wiki/screenshots/workbench-lists.png"
        alt="The Lists tab with five stacked sections (Overdue, Doing, Upcoming, Recently done, Earlier), each with rows of list-task entries underneath."
        caption="The Lists tab buckets list tasks into five date-relative stages, top to bottom."
      />
      <Callout variant="info" title="Lists holds list tasks, not experiments">
        Experiment tasks always render on the Experiments tab, never on
        Lists, even when their dates would make them overdue or
        upcoming. The split is by task type, not by status. The Lists
        tab is for the to-do work that supports your protocols, not the
        protocols themselves.
      </Callout>

      <h2>Opening an experiment: the four-tab popup</h2>
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="An open experiment popup with the four tabs (Details, Lab Notes, Method, Results) visible across the top and the Details tab active."
        caption="The popup opens on the Details tab by default. Use the fullscreen icon in the header to expand it to the whole window."
      />
      <p>
        Clicking any experiment card opens a centered modal. The popup
        always opens on the <strong>Details</strong> tab, regardless of
        whether the experiment is ready, running, awaiting writeup, or
        completed. A consistent entry point matters more than a smart
        guess at where you&apos;re heading next: you land on the same
        view every time, and you pick the tab that fits the task at
        hand.
      </p>
      <p>The popup carries four tabs across the header:</p>
      <ul>
        <li>
          <strong>Details</strong> is the entry tab. It holds the name,
          dates, duration, project, tags, and the high-level toggles. If
          the task carries a (legacy) deviation log string, it renders
          here in an amber box.
        </li>
        <li>
          <strong>Lab Notes</strong> is the during-the-run markdown body
          plus a Files sub-tab for PDFs and other non-image attachments.
        </li>
        <li>
          <strong>Method</strong> shows one tab per attached method,
          with the Variation Notes panel and (for PCR methods) an
          editable gradient and recipe.
        </li>
        <li>
          <strong>Results</strong> is the second markdown editor, for
          the final writeup (the gel image you&apos;d put in a paper,
          the plot for a thesis chapter), with its own Files sub-tab.
        </li>
      </ul>
      <p>
        The header row also holds a green completion checkmark, an
        <strong> Export</strong> icon (down arrow, experiments only), a
        Share button, a fullscreen toggle, and Delete. Drag any file
        onto the popup and it lands in the last-viewed editor tab&apos;s{" "}
        <code>Files/</code> or <code>Images/</code> folder, with a
        confirmation toast at the drop point.
      </p>

      <h2>Lab Notes and Results</h2>
      <p>
        The two markdown tabs hold different kinds of writing on the
        same experiment. <strong>Lab Notes</strong> is the
        during-the-run record: running observations, what reagents you
        grabbed, what went sideways, the photo you took at the bench
        five minutes ago. <strong>Results</strong> is the final-output
        writeup: the gel image, the plot, the short summary of what the
        experiment actually showed. Both live on the same task and both
        write to the same per-task folder on disk, so flipping between
        the two tabs in the popup is instantaneous.
      </p>
      <p>
        Both tabs use the same editor surface: a markdown body with a
        three-way <strong>Edit / Hybrid / Preview</strong> mode toggle,
        an image strip pinned below the editor, and a{" "}
        <strong>📎 Add File</strong> toolbar button. The full editor
        reference (shortcuts, block-level editing in Hybrid, the
        language picker, image-resize popovers) lives on its own page:{" "}
        <Link href="/wiki/features/markdown-editor">
          The Markdown Editor
        </Link>
        .
      </p>
      <p>
        Drag images straight into the body to place them inline, or drop
        them on the strip to attach without inlining. The Files sub-tab
        holds non-image attachments (PDFs especially), and renders them
        as a thumbnail grid you can open in a new tab.
      </p>
      <Callout variant="info" title="Where the files live">
        Lab Notes saves to{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/notes.md</code>{" "}
        and Results saves to{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/results.md</code>.
        Attachments split per-tab into{" "}
        <code>.../notes/Images</code>, <code>.../notes/Files</code>,{" "}
        <code>.../results/Images</code>, and{" "}
        <code>.../results/Files</code>. PDFs added through the Files
        sub-tab land in <code>NotesPDFs/</code> or{" "}
        <code>ResultsPDFs/</code>.
      </Callout>

      <h2>Attach a method (or a PCR protocol)</h2>
      <Steps>
        <Step>
          Open the <strong>Method</strong> tab and click the{" "}
          <strong>+</strong> button on the tab strip.
        </Step>
        <Step>
          The Method Picker opens with{" "}
          <em>Recently used in this project</em> and <em>Recently used</em>{" "}
          pinned at the top, the full library below grouped by folder,
          and a search box that also takes <code>#tag</code> queries.
          PCR protocols show up alongside markdown methods (their tab
          gets a small <strong>PCR</strong> badge).
        </Step>
        <Step>
          Pick a method. It becomes a new tab on the strip. Attach as
          many as the experiment needs.
        </Step>
      </Steps>

      <h2>Variation Notes and per-run PCR tweaks</h2>
      <p>
        Each attached method has a collapsible amber{" "}
        <strong>Variation Notes</strong> panel at the top of its tab.
        Click <strong>+ Add Note</strong> and the editor prepends a
        fresh <code>### Variation - &lt;date&gt; &lt;time&gt;</code>{" "}
        heading so each entry is timestamped. Hover any rendered entry
        to reveal an in-place delete button. The notes save back to the
        experiment, not the method, so the shared method file stays
        clean.
      </p>
      <p>
        For PCR-typed methods, the gradient editor and recipe table
        below the variation panel are editable per-experiment.{" "}
        <strong>Reset to Method</strong> drops your overrides back to
        the protocol&apos;s defaults, and <strong>Save Changes</strong>{" "}
        writes them to this task only.
      </p>

      <h2>Export an experiment</h2>
      <p>
        Click the down-arrow icon in the popup header (tooltip:{" "}
        <em>Export experiment</em>) to open the <strong>Export</strong>{" "}
        dialog. The dialog heading reads{" "}
        <em>Export &lt;experiment name&gt;</em> and lists three format
        cards, each with a short description of what you get and who
        it&apos;s for. Click a card and the file downloads straight to
        your browser&apos;s Downloads folder.
      </p>
      <Screenshot
        src="/wiki/screenshots/experiments-export-dialog.png"
        alt="The Export dialog open over an experiment popup, showing three format cards: PDF report, HTML report, and Raw ResearchOS format."
        caption="The Export dialog. Pick a format card to start the download; close with Cancel or the Escape key."
      />
      <ul>
        <li>
          <strong>PDF report</strong>: a professional, printable PDF
          with a title page, a clickable table of contents, an outline
          pane (bookmarks) for jumping between sections, and inline
          images. Lab Notes, Results, every attached method (rendered,
          with per-run PCR tweaks), Sub-tasks, the Deviation log, and a{" "}
          <em>Files attached</em> appendix all live in the same
          document. Text is selectable, so you can copy passages
          straight out into a thesis chapter, IRB filing, or grant
          report.
        </li>
        <li>
          <strong>HTML report</strong>: a single self-contained{" "}
          <code>.html</code> page bundled in a <code>.zip</code> with
          its attachments. Images are base64-inlined so the page
          renders even offline; PDF methods and other non-image files
          sit alongside in <code>attachments/Notes/</code>,{" "}
          <code>attachments/Results/</code>, and{" "}
          <code>attachments/Methods/</code>. Open it in any browser, or
          mail the zip to a collaborator who doesn&apos;t run
          ResearchOS.
        </li>
        <li>
          <strong>Raw ResearchOS format</strong>: the full experiment
          as a sharable <code>.zip</code> bundle (<code>task.json</code>,{" "}
          <code>project.json</code>, the raw <code>notes.md</code> and{" "}
          <code>results.md</code>, each method as its own JSON file
          including PCR protocols, plus every attached image and file
          in the same folder layout the app uses on disk). This is the
          format another ResearchOS user imports through{" "}
          <strong>Settings → Import experiment</strong> to land the
          experiment in their own folder with all the methods, PCR
          protocols, and attachments wired up.
        </li>
      </ul>
      <p>
        While the file builds, the dialog shows a{" "}
        <em>Preparing export…</em> spinner and disables every button
        (Escape and the backdrop are also locked) so you can&apos;t
        kick off a second export by accident. If anything goes wrong,
        an alert shows the error and the dialog stays open for a retry.
      </p>
      <Callout variant="tip" title="Pick the format by where the file is going">
        <strong>PDF</strong> for thesis chapters, IRB filings,
        lab-meeting handouts, and anything destined for print.{" "}
        <strong>HTML</strong> for sharing a polished read-only report
        with a collaborator who works outside ResearchOS.{" "}
        <strong>Raw</strong> for archival, lab handoff, or when another
        ResearchOS user is going to import the experiment into their
        own folder.
      </Callout>
      <Callout variant="info" title="Exporting more than one at a time">
        The Export icon on an experiment popup is single-experiment
        only. To bundle a batch of experiments into one download, use{" "}
        <strong>Select</strong> on the{" "}
        <Link href="/wiki/features/search">Search</Link> page (or its
        Lab Mode counterpart). Tick the result cards you want, click{" "}
        <strong>Export selected</strong>, and the same dialog packages
        every chosen experiment into an{" "}
        <code>experiments-&lt;YYYY-MM-DD&gt;.zip</code> with one entry
        per experiment.
      </Callout>

      <Callout variant="info" title="Sub-tasks live on list tasks, not experiments">
        The sub-task checklist you may have seen on the Home page
        belongs to the <em>list</em> task type, not <em>experiment</em>.
        Experiment popups don&apos;t carry a sub-task list. If you want
        a checklist alongside an experiment, make a separate list task
        and link it as a dependency.
      </Callout>
    </WikiPage>
  );
}
