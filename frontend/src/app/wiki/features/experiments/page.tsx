import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ExperimentsFeaturePage() {
  return (
    <WikiPage
      title="Experiments & Notes"
      intro="The /experiments page is a grid of experiment tiles. Click a tile to open a single popup with Details, Lab Notes, Method, and Results all in one place."
    >
      <Screenshot
        src="/wiki/screenshots/experiments-list.png"
        alt="The Experiments tab with experiment tiles grouped by project, each showing status badges and duration."
        caption="Every active experiment, grouped by project, with status pills and a Show N completed experiments disclosure at the bottom."
      />

      <h2>The Experiments tab</h2>
      <p>
        The page header reads <strong>Lab Notes</strong> and splits into two
        tabs at the top: <strong>Experiments</strong> (the tile grid you see
        first) and <strong>Notes</strong> (meeting notes and running logs,
        unrelated to a specific experiment). Everything below is about the
        Experiments tab.
      </p>
      <p>
        Tiles are grouped under each project (the colored header) and sorted
        by start date. Each tile shows the task name, a status pill
        (<strong>Overdue</strong>, <strong>In Progress</strong>, or the start
        date for upcoming runs), the duration, and a small purple{" "}
        <strong>Has Method</strong> badge if a method is attached. An{" "}
        <strong>In Progress</strong> tile picks up a green progress bar showing
        "Day N of M."
      </p>
      <p>
        The colored pills above the grid are project filters. Click one to
        hide every other project's experiments. Use <strong>+ New
        Experiment</strong> on the right to create a fresh experiment task
        (the same New Task modal you'd get on the Gantt, but the type is
        pre-selected to <em>experiment</em>).
      </p>

      <h2>Chains of dependent experiments</h2>
      <p>
        When two or more experiments are linked by a dependency (e.g., "PCR
        screen" depends on "Transformation"), they collapse into a single
        stacked-card tile labeled <strong>N tasks</strong>. Clicking the
        stacked card opens the <em>root</em> experiment in the popup, and from
        there the Method and Results tabs are the same surface you'd see on
        any single experiment. The Gantt page is where you actually walk a
        chain step-by-step.
      </p>

      <h2>Completed experiments</h2>
      <p>
        Finished experiments don't clutter the main grid. They collapse into a{" "}
        <strong>Show N completed experiments</strong> disclosure at the
        bottom of the tab. Click it to expand a faded, read-but-still-clickable
        grid of completed tiles (and chain stacks), sorted with the most
        recently finished first.
      </p>

      <h2>Inside the experiment popup</h2>
      <Screenshot
        src="/wiki/screenshots/experiments-editor.png"
        alt="An open experiment popup with the four tabs visible across the top."
        caption="The popup opens as a centered modal. Use the fullscreen icon in the header to expand it to the whole window."
      />
      <p>
        Clicking a tile opens a centered modal with four tabs:
      </p>
      <ul>
        <li>
          <strong>Details</strong>: name, dates, duration, project, tags, and
          the high-level toggles. If the task carries a (legacy) deviation log
          string, it renders here in an amber box.
        </li>
        <li>
          <strong>Lab Notes</strong>: the markdown body you write during the
          run, plus a Files sub-tab for PDFs.
        </li>
        <li>
          <strong>Method</strong>: one tab per attached method, with the
          Variation Notes panel and (for PCR methods) editable gradient and
          recipe.
        </li>
        <li>
          <strong>Results</strong>: a second markdown editor for the write-up,
          gels, plots, and final figures, with its own Files sub-tab.
        </li>
      </ul>
      <p>
        The header row holds a green completion checkmark, an{" "}
        <strong>Export</strong> icon (down-arrow, experiments only), a Share
        button, a fullscreen toggle, and Delete. Drag any file onto the popup
        and it lands in the last-viewed editor tab's <code>Files/</code> or{" "}
        <code>Images/</code> folder, with a confirmation toast at the drop
        point.
      </p>

      <h2>Lab Notes and Results</h2>
      <p>
        Both tabs use the same editor surface: a markdown body with a
        three-way <strong>Edit / Hybrid / Preview</strong> mode toggle, an
        image strip pinned below the editor, and a <strong>📎 Add File</strong>{" "}
        toolbar button. The full editor reference (shortcuts, block-level
        editing in Hybrid, the language picker, image-resize popovers) is on
        its own page:{" "}
        <Link href="/wiki/features/markdown-editor">The Markdown Editor</Link>.
      </p>
      <p>
        Drag images straight into the body to place them inline, or drop them
        on the strip to attach without inlining. The Files sub-tab holds
        non-image attachments (PDFs especially), and renders them as a
        thumbnail grid you can open in a new tab.
      </p>
      <Callout variant="info" title="Where the files live">
        Lab Notes saves to{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/notes.md</code> and
        Results saves to{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/results.md</code>.
        Attachments split per-tab into <code>.../notes/Images</code>,{" "}
        <code>.../notes/Files</code>, <code>.../results/Images</code>, and{" "}
        <code>.../results/Files</code>. PDFs added through the Files sub-tab
        land in <code>NotesPDFs/</code> or <code>ResultsPDFs/</code>.
      </Callout>

      <h2>Attach a method (or a PCR protocol)</h2>
      <Steps>
        <Step>
          Open the <strong>Method</strong> tab and click the <strong>+</strong>{" "}
          button on the tab strip.
        </Step>
        <Step>
          The Method Picker opens with <em>Recently used in this project</em>
          {" "}and <em>Recently used</em> pinned at the top, the full library
          below grouped by folder, and a search box that also takes{" "}
          <code>#tag</code> queries. PCR protocols show up alongside markdown
          methods (their tab gets a small <strong>PCR</strong> badge).
        </Step>
        <Step>
          Pick a method. It becomes a new tab on the strip. Attach as many as
          the experiment needs.
        </Step>
      </Steps>

      <h2>Variation Notes and per-run PCR tweaks</h2>
      <p>
        Each attached method has a collapsible amber <strong>Variation
        Notes</strong> panel at the top of its tab. Click{" "}
        <strong>+ Add Note</strong> and the editor prepends a fresh{" "}
        <code>### Variation - &lt;date&gt; &lt;time&gt;</code> heading so each
        entry is timestamped. Hover any rendered entry to reveal an in-place
        delete button. The notes save back to the experiment, not the method,
        so the shared method file stays clean.
      </p>
      <p>
        For PCR-typed methods, the gradient editor and recipe table below the
        variation panel are editable per-experiment. <strong>Reset to
        Method</strong> drops your overrides back to the protocol's defaults,
        and <strong>Save Changes</strong> writes them to this task only.
      </p>

      <h2>Export an experiment</h2>
      <p>
        The download-arrow icon in the popup header (tooltip:{" "}
        <em>Export experiment</em>) drops down a small menu with{" "}
        <strong>📝 Markdown</strong> and <strong>📕 PDF</strong>. PDF bundles
        the Lab Notes body, the Results body, the first attached method's
        markdown, and any PDFs from <code>NotesPDFs/</code> and{" "}
        <code>ResultsPDFs/</code> into a single printable document. Useful for
        thesis chapters and IRB filings.
      </p>
      <Callout variant="tip" title="Bulk export from the tile grid">
        Each tile has a checkbox in its bottom-right corner. Tick two or more
        tiles and a green <strong>Export N selected</strong> button appears
        at the top of the page with the same Markdown / PDF / Clear selection
        choices. Bulk export iterates every attached method, not just the
        first one.
      </Callout>

      <Callout variant="info" title="Sub-tasks live on simple tasks, not experiments">
        The sub-task checklist you may have seen on the Home page belongs to
        the <em>list</em> task type, not <em>experiment</em>. Experiment
        popups don't carry a sub-task list. If you want a checklist alongside
        an experiment, make a separate list task and link it as a dependency.
      </Callout>
    </WikiPage>
  );
}
