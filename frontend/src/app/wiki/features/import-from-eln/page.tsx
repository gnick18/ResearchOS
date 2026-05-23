import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ImportFromELNPage() {
  return (
    <WikiPage
      title="Import from LabArchives"
      intro="The 7-step wizard that turns a LabArchives Offline Notebook ZIP into native ResearchOS tasks, plus the bulk-sort screen for cleaning up after."
    >
      <h2>Page-as-task</h2>
      <p>
        The mental model for the importer is one rule:{" "}
        <strong>each LabArchives page becomes one ResearchOS task</strong>.
        Every entry on that page (text, headings, attachments, embedded
        images) is collapsed into the task&apos;s Lab Notes body. The
        page&apos;s newest entry timestamp becomes the task&apos;s start
        date, the task is marked complete, and its{" "}
        <code>task_type</code> is set to <code>experiment</code>. You can
        re-classify pages that aren&apos;t experiments later using the
        bulk-sort screen, covered below.
      </p>
      <p>
        Notebook folders become projects. By default each folder lands as
        a new project named <code>&lt;folder&gt; (imported)</code>, but
        the wizard lets you point folders at projects you already have or
        leave them unassigned.
      </p>
      <p>
        You start from{" "}
        <strong>Settings → LabArchives → Open import…</strong>, which
        opens the wizard as a modal. The first-run setup screen has the
        same entry point under <em>Coming from LabArchives?</em>. If you
        haven&apos;t produced an Offline Notebook ZIP yet, hop over to{" "}
        <Link href="/wiki/getting-started/labarchives-export">
          Exporting from LabArchives
        </Link>{" "}
        first.
      </p>

      <Callout variant="info" title="No live sync, no writeback">
        ResearchOS reads the ZIP and stops there. It never calls back
        into LabArchives to write changes, and it doesn&apos;t poll
        LabArchives for new content. The import is a one-way snapshot,
        and you can re-run it whenever you have a fresher ZIP.
      </Callout>

      <h2>The 7-step wizard</h2>
      <p>
        The wizard runs a fixed sequence of steps. You can back out at
        any point before the apply phase starts. The step header in the
        modal shows where you are.
      </p>

      <Steps>
        <Step>
          <strong>Choose format.</strong> The wizard supports the
          LabArchives Offline Notebook ZIP. PDF and Chrome-print formats
          are on the roadmap and show as <em>Coming soon</em> cards on
          this step. Pick the ZIP option and continue.
          <Screenshot
            src="/wiki/screenshots/import-eln-format-pick.png"
            alt="The import wizard's Choose format step, with three cards: LabArchives Offline Notebook ZIP selected in blue, and two grayed-out Coming soon cards for the PDF and Chrome print paths."
            caption="Step 1, only the Offline Notebook ZIP path is live right now."
          />
        </Step>
        <Step>
          <strong>Upload ZIP.</strong> Drag the file you downloaded from
          your LabArchives confirmation email onto the drop zone, or
          click to pick it from disk. The wizard validates that the file
          is a <code>.zip</code> and warns if it&apos;s larger than
          500&nbsp;MB (the parser holds the archive in browser memory,
          so multi-gigabyte notebooks can blow past the per-tab heap).
        </Step>
        <Step>
          <strong>Preview notebook.</strong> The wizard parses the ZIP
          and shows what it found: folder count, page count, entry
          count, attachment count, plus a collapsible tree of the
          notebook structure. If LabArchives left some inline images as
          URLs rather than bundling them, an amber banner here calls
          that out so you know to expect the <em>Fetch images</em> step
          later.
        </Step>
        <Step>
          <strong>Map projects.</strong> One row per top-level notebook
          folder. Each row offers three decisions: <em>Create new
          project</em> (the default, with a suggested name you can
          edit), <em>Use existing</em> (pick from your live project
          list), or <em>No project</em> (the pages on that branch land
          unassigned). Project mapping is covered in more depth below.
        </Step>
        <Step>
          <strong>Fetch images</strong> (optional). If the notebook has
          inline images that LabArchives stores as URLs (and you&apos;re
          not in demo mode), the wizard offers a step to bring those
          images in. Two paths are available, both credential-free: a
          generated DevTools script you paste into a browser tab where
          you&apos;re already signed in to LabArchives, or a manual drop
          zone where you drag the image files you&apos;ve downloaded
          elsewhere. You can also skip this step and rehydrate later
          from the post-import banner on any imported task. See the{" "}
          <Link href="/wiki/integrations/labarchives">
            LabArchives integration
          </Link>{" "}
          page for the full picture of how Form-B images work.
        </Step>
        <Step>
          <strong>Importing.</strong> A progress bar walks through the
          two write phases: creating new projects first, then writing
          one task directory per page. Leave the tab open. Each page
          becomes <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code>{" "}
          with a <code>notes.md</code>, a <code>notes/Files/</code>{" "}
          folder for attachments, a <code>notes/Images/</code> folder
          for inline images, and a{" "}
          <code>notes/_import_source.json</code> sidecar (inside the{" "}
          <code>notes/</code> subdirectory, not at the task root).
        </Step>
        <Step>
          <strong>Done.</strong> The summary lists how many tasks and
          projects landed, how many pages were skipped as duplicates of
          earlier imports, how many online-only images were rehydrated,
          and any per-page warnings. From here you can close the
          wizard, or jump straight to <em>Open bulk-sort</em> to
          re-classify imported tasks in batches.
        </Step>
      </Steps>

      <Callout variant="info" title="A note on screenshots">
        Several wizard-step screenshots are pending capture. Steps 2
        (Upload) and 5 (Fetch images) require an actual notebook ZIP and
        a signed-in LabArchives session, neither of which the
        wiki-capture fixture seeds. Steps 3 (Preview notebook), 4 (Map
        projects), and the bulk-sort screen are also missing captures and
        are queued for the next fixture-mode screenshot pass. Run the
        wizard against your own Offline Notebook ZIP to see those steps
        live.
      </Callout>

      <h2>Project mapping in detail</h2>
      <p>
        Every notebook folder that contains pages you&apos;re importing
        gets a row in the Map projects step. Pages directly at the
        notebook root (no folder above them) don&apos;t show up as a
        mapping row, they just inherit the wizard&apos;s default of{" "}
        <em>no project</em> unless you assign them later. Rows that
        don&apos;t affect any pages aren&apos;t shown either.
      </p>
      <p>
        The three decisions behave like this:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Create new project</strong>: the wizard creates a new
          project named <code>&lt;folder&gt; (imported)</code> and
          attaches every page under that folder to it. You can edit the
          name in the row before applying.
        </li>
        <li>
          <strong>Use existing</strong>: pick one of your live
          (non-archived) projects from the dropdown. Pages under that
          folder are attached to the project you picked.
        </li>
        <li>
          <strong>No project</strong>: the pages land as tasks with no
          project assignment. You can move them to projects later from
          the bulk-sort screen or by opening each task individually.
        </li>
      </ul>
      <p>
        The <em>Start import</em> button stays disabled while any row has a
        validation error (empty new-project name, no existing project
        picked). Once the mapping is valid, clicking <em>Start import</em>{" "}
        kicks off the apply phase.
      </p>

      <h2>The bulk-sort screen</h2>
      <p>
        Right after the wizard finishes, the Done step shows an{" "}
        <strong>Open bulk-sort</strong> button. Clicking it replaces the
        wizard with a full-screen list of every task the import just
        created. Tasks are grouped by their assigned project (or under{" "}
        <em>(no project)</em> if unassigned), and each row exposes the
        same three knobs:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          A <strong>project</strong> dropdown to move that task to a
          different project (or to <em>no project</em>).
        </li>
        <li>
          A <strong>task type</strong> dropdown to flip the task from{" "}
          <code>experiment</code> (the default) to <code>purchase</code>{" "}
          or <code>list</code>.
        </li>
        <li>
          A <strong>Delete</strong> button for tasks that don&apos;t
          belong anywhere, useful when an old notebook had stray
          meeting-notes pages mixed in with experiments.
        </li>
      </ul>
      <p>
        Tick the checkbox on multiple rows and the top of the screen
        switches to a bulk action bar: <em>Move to</em> a project,{" "}
        <em>Change type to</em>, or <em>Delete N tasks</em>. Edits write
        through to disk one row at a time, so you can leave the screen
        partway through and the work already done stays.
      </p>

      <h2 id="re-running">Re-running the import</h2>
      <p>
        Every imported task carries a sidecar file at{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/notes/_import_source.json</code>{" "}
        with the source ZIP path, the LabArchives page id, the entry
        count at the time of import, and the import timestamp. The
        importer uses those sidecars to decide what to skip on a
        re-run:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Same ZIP, same pages.</strong> Running the wizard
          again on the same file is a no-op for already-imported pages.
          The Done step counts them as <em>duplicates skipped</em>, and
          your existing tasks aren&apos;t touched.
        </li>
        <li>
          <strong>Newer ZIP, brand new pages.</strong> Pages that
          weren&apos;t in the previous ZIP land as new tasks. The
          duplicates from the prior ZIP are still skipped.
        </li>
        <li>
          <strong>Newer ZIP, edited pages.</strong> If a page that you
          imported before has new or edited entries in the newer ZIP,
          the Preview step calls those out in a blue panel and offers a
          per-page <em>overwrite</em> checkbox. The default is still
          skip-as-duplicate. Ticking a page overwrites that task&apos;s{" "}
          <code>notes.md</code>, <code>notes/Files/</code>, and{" "}
          <code>notes/Images/</code>, while preserving the task id,
          name, project assignment, and sharing metadata. Anything you
          edited yourself on the Notes tab after the original import is
          discarded by overwrite.
        </li>
      </ul>

      <h2>What doesn&apos;t import</h2>
      <p>
        The importer is deliberately scoped to the content of the
        Offline Notebook ZIP. A few LabArchives concepts don&apos;t
        round-trip:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Comments and revision history.</strong> LabArchives
          tracks per-entry comments and a full edit history. The Offline
          Notebook ZIP exports the latest version of each entry, and
          comments aren&apos;t bundled.
        </li>
        <li>
          <strong>Per-page ACLs and sharing.</strong> LabArchives&apos;
          notebook-level and page-level access controls don&apos;t
          carry over. Imported tasks land owned by whichever ResearchOS
          user ran the importer. Use ResearchOS&apos;s own sharing model
          afterwards if you want others to see the imported tasks.
        </li>
        <li>
          <strong>Form-B inline images, by default.</strong> Images that
          LabArchives stores as cloud URLs aren&apos;t in the ZIP. The
          Fetch images step pulls them in when reachable, otherwise the
          markdown gets a placeholder you can rehydrate later from the
          per-task banner.
        </li>
        <li>
          <strong>Live LabArchives links between pages.</strong> If a
          LabArchives page links to another page by its LabArchives URL,
          the link comes across as plain text. ResearchOS doesn&apos;t
          rewrite those into local task links.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          Need to produce the ZIP first? See{" "}
          <Link href="/wiki/getting-started/labarchives-export">
            Exporting from LabArchives
          </Link>
          .
        </li>
        <li>
          Curious about how the inline-image rehydration paths work? The{" "}
          <Link href="/wiki/integrations/labarchives">
            LabArchives integration
          </Link>{" "}
          page breaks down Form-A vs Form-B and the DevTools-script
          path.
        </li>
        <li>
          Imported tasks look and behave the same as native ResearchOS
          tasks. The{" "}
          <Link href="/wiki/features/experiments">Experiments &amp; Notes</Link>{" "}
          page covers the task popup, the Lab Notes editor, and how
          attachments work once they&apos;re on disk.
        </li>
      </ul>
    </WikiPage>
  );
}
