import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LabArchivesIntegrationPage() {
  return (
    <WikiPage
      title="LabArchives"
      intro="Bring notebooks out of LabArchives and into ResearchOS as native, file-on-disk tasks, and recover the inline images that LabArchives keeps in the cloud, all without any API credentials."
    >
      <h2>The shape of the integration</h2>
      <p>
        LabArchives and ResearchOS sit at opposite ends of a hand-off, not in
        a live sync. LabArchives is your ELN of record while you&apos;re
        running experiments, and ResearchOS is where you bring those notebooks
        once you want them on disk in a structured form. There&apos;s no two-way
        connection, and ResearchOS never writes back to LabArchives.
      </p>
      <p>
        Everything runs through one entry point under{" "}
        <strong>Settings &rarr; LabArchives</strong>.
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Import from LabArchives</strong> is the import wizard. You
          download an Offline Notebook ZIP from LabArchives and feed it to the
          wizard. Every notebook page becomes a ResearchOS task, and every
          folder becomes a project you can map to your existing project list.
          No credentials, works offline.
        </li>
      </ul>

      <h2 id="form-a-vs-form-b">Form-A vs Form-B inline images</h2>
      <p>
        LabArchives stores inline images in two ways internally. The legacy
        path, called <em>Form-A</em>, embeds the image as a binary file inside
        the notebook page entry itself. The newer path, <em>Form-B</em>,
        uploads the image to LabArchives&apos; cloud and leaves only a URL
        behind in the entry body.
      </p>
      <p>
        When you generate an Offline Notebook export ZIP, only the Form-A
        images come along. The Form-B URLs are still in the entry text, but
        the image bytes were never bundled. In a typical recent notebook
        that&apos;s roughly half the inline images.
      </p>
      <p>
        If you import the ZIP without fetching Form-B images, the wizard writes
        a <code>missing-&hellip;</code> placeholder for each one. Your notes
        still come across, and the images at those URLs aren&apos;t there
        yet. You can recover them at any time using one of the three paths
        described below, or remove individual placeholders using the
        broken-image popup.
      </p>
      <p>
        When images are recovered, inline images land in the task&apos;s{" "}
        <code>notes/Images/</code> folder and the markdown is rewritten to
        point at the local copy. File attachments (non-image uploads) land in{" "}
        <code>notes/Files/</code>.
      </p>

      <Callout variant="tip" title="Skip image fetch on the first pass">
        It&apos;s fine to skip image recovery during the initial import. Form-B
        images become placeholders you can clean up later. The broken-image
        popup in any imported note lets you handle them one at a time, and the
        per-task &quot;Rehydrate images&quot; panel lets you batch them all at
        once.
      </Callout>

      <h2 id="exporting-from-labarchives">
        Exporting an Offline Notebook ZIP from LabArchives
      </h2>
      <p>
        The ZIP that ResearchOS imports is LabArchives&apos; built-in Offline
        Notebook export. Both the import and any image-recovery run depend on
        having this file first.
      </p>
      <Steps>
        <Step>
          Open the notebook you want to export in LabArchives on the web.
        </Step>
        <Step>
          Open the <strong>&equiv;</strong> menu &rarr;{" "}
          <strong>Utilities</strong> &rarr;{" "}
          <strong>Create Offline Notebook</strong>. (The exact wording varies
          a little by institution build.)
        </Step>
        <Step>
          Wait. Large notebooks take minutes to assemble, and LabArchives
          emails you when the ZIP is ready.
        </Step>
        <Step>
          Download the ZIP from the email link. Don&apos;t unzip it, since
          ResearchOS reads the raw archive.
        </Step>
      </Steps>

      <h2 id="import">Running the import</h2>
      <Steps>
        <Step>
          Go to <strong>Settings &rarr; LabArchives</strong> and click{" "}
          <strong>Open import&hellip;</strong> on the{" "}
          <em>Import from LabArchives</em> card.
        </Step>
        <Step>
          On the <strong>Choose format</strong> step, leave the default
          (Offline Notebook ZIP). The PDF and Chrome-print formats are sketched
          in as coming-soon and stay disabled.
        </Step>
        <Step>
          Drag the Offline Notebook ZIP into the <strong>Upload ZIP</strong>{" "}
          step. The wizard parses the bundle and surfaces a preview of pages,
          folders, and inline images.
        </Step>
        <Step>
          On the <strong>Preview notebook</strong> step, glance through the
          page list and confirm the entry counts look right.
        </Step>
        <Step>
          On the <strong>Map projects</strong> step, point each LabArchives
          folder at one of your existing ResearchOS projects, or let the wizard
          create a new project named{" "}
          <code>&lt;folder&gt; (imported)</code>. If that name is already taken,
          the wizard appends a number (<code>(imported 2)</code>,{" "}
          <code>(imported 3)</code>) so you never end up with two projects
          sharing a name.
        </Step>
        <Step>
          If the wizard detected Form-B images (and you&apos;re not in demo
          mode), a <strong>Fetch images</strong> step appears with two
          tabs.
          <ul className="list-disc pl-6 mt-2 space-y-1">
            <li>
              <strong>Generate browser script</strong> is the DevTools-script
              path (see below).
            </li>
            <li>
              <strong>Drop your own images</strong> is the manual folder/ZIP
              drop path (see below).
            </li>
          </ul>
          Either fetch images now or click <strong>Skip, leave as
          placeholders</strong> to continue without them.
        </Step>
        <Step>
          The <strong>Apply</strong> step writes everything to disk. When
          it&apos;s finished, the <strong>Done</strong> step lists what landed
          where.
        </Step>
      </Steps>

      <Callout variant="info" title="What ends up on disk">
        Each notebook page becomes a directory under{" "}
        <code>users/&lt;you&gt;/results/task-&lt;id&gt;/</code> with a{" "}
        <code>notes.md</code> body alongside a <code>notes/</code> folder that
        holds a <code>Files/</code> subfolder for file attachments, an{" "}
        <code>Images/</code> subfolder for inline images, and an{" "}
        <code>_import_source.json</code> for provenance. Tasks
        are marked complete, with{" "}
        <code>task_type = &quot;experiment&quot;</code> and{" "}
        <code>start_date</code> set to the page&apos;s newest entry timestamp.
      </Callout>

      <Callout variant="info" title="Importing the same notebook twice">
        Importing a notebook you&apos;ve already brought over is safe. Pages
        that haven&apos;t changed are recognized and left alone. If a page was
        edited in LabArchives after your last import (new entries, or an
        existing entry updated), the Preview step flags it and lets you tick
        which changed pages to overwrite. Overwriting replaces that
        task&apos;s notes and attachments while keeping the task itself, so its
        id, name, project, dates, and any sharing stay intact. Nothing is
        overwritten unless you tick it.
      </Callout>

      <h2 id="recovering-form-b-images">Recovering Form-B images</h2>
      <p>
        Three paths exist to pull Form-B images into your notes. All three
        are credential-free, so ResearchOS never asks for your LabArchives
        password. The wizard hides its Fetch images step in demo mode, but the
        per-task Rehydrate panel and these recovery paths still work there,
        since they all run client-side against files you bring in.
      </p>

      <h3 id="devtools-script">Path 1, the DevTools browser script</h3>
      <p>
        The <strong>Generate browser script</strong> tab (in the wizard&apos;s
        Fetch images step, or in the per-task Rehydrate panel) shows a
        self-contained JavaScript snippet you paste into the browser console
        while you&apos;re logged into LabArchives. Here&apos;s what the script
        does.
      </p>
      <ol className="list-decimal pl-6 space-y-1">
        <li>
          Checks that it&apos;s running on <code>labarchives.com</code>. It
          refuses to do anything on other origins.
        </li>
        <li>
          Fetches each missing image URL using your existing session cookies
          (no password, no API key, only the session the browser already has
          from your login).
        </li>
        <li>
          Packages all successful fetches into a single ZIP and triggers one
          browser download.
        </li>
      </ol>
      <p>
        Drop the downloaded ZIP into the <strong>Drop your own images</strong>{" "}
        tab (or drag it straight into the panel) and ResearchOS matches
        filenames automatically.
      </p>

      <Steps>
        <Step>
          In the <strong>Fetch images</strong> wizard step (or per-task
          Rehydrate panel), click the{" "}
          <strong>Generate browser script</strong> tab and copy the script.
        </Step>
        <Step>
          Open LabArchives in your browser and navigate to any page of the
          notebook you imported. You just need to be logged in.
        </Step>
        <Step>
            Open DevTools (F12 or right-click and Inspect), switch to the{" "}
          <strong>Console</strong> tab, paste the script, and press Enter.
        </Step>
        <Step>
          The script logs progress in the console and triggers a single ZIP
          download when done. Save the ZIP somewhere easy to find.
        </Step>
        <Step>
          Switch back to ResearchOS and drop the ZIP into the{" "}
          <strong>Drop your own images</strong> tab. The panel shows how many
          filenames matched and stages them for import.
        </Step>
        <Step>
          Click <strong>Continue with N images</strong>. The Apply step writes
          them to <code>notes/Images/</code> and rewrites the markdown
          references.
        </Step>
      </Steps>

      <Callout variant="info" title="Security posture of the script">
        The script runs entirely in your browser. ResearchOS never sees the
        image bytes until you explicitly drop the resulting ZIP back into the
        wizard. The URLs are hard-coded into the script (no dynamic eval, no
        network round-trip back to ResearchOS). The{" "}
        <code>credentials: &quot;include&quot;</code> flag only attaches cookies
        the browser already has from your LabArchives login, so the script
        cannot fetch anything you couldn&apos;t load by clicking the image
        yourself.
      </Callout>

      <h3 id="manual-drop">Path 2, a manual folder or ZIP drop</h3>
      <p>
        If you already have the Form-B image files on disk (from a previous
        download, a screenshot batch, or an export from another tool), use
        the <strong>Drop your own images</strong> tab. Drop a folder or a{" "}
        <code>.zip</code> containing the image files and ResearchOS matches
        them to the expected filenames automatically. No script needed.
      </p>
      <p>
        This path also accepts the ZIP produced by the DevTools script above,
        which is why the two-tab flow is designed the way it is. Generate
        and download in the DevTools tab, then drop the result in the manual
        tab.
      </p>

      <h3 id="broken-image-popup">
        Path 3, the per-image broken-placeholder popup
      </h3>
      <p>
        After import, any task that still has unresolved Form-B images shows
        broken image placeholders in the Lab Notes editor. Clicking a broken
        placeholder opens a small popup with three options.
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          <strong>Find on LabArchives</strong> opens the original image URL
          in a new tab pointed at{" "}
          <code>mynotebook.labarchives.com</code>. If you&apos;re logged in,
          the image loads and you can right-click and Save. Then use{" "}
          <em>Replace from disk</em> below, or drag the saved file onto the
          note.
        </li>
        <li>
          <strong>Replace from disk</strong> opens a file picker. Pick a
          local image file, and ResearchOS writes it to{" "}
          <code>notes/Images/</code>, rewrites the markdown reference, and
          removes the entry from the task&apos;s <code>_import_source.json</code>{" "}
          sidecar so the popup doesn&apos;t re-appear on the next open.
        </li>
        <li>
          <strong>Remove reference</strong> deletes the broken placeholder
          from the markdown entirely. Use this when you don&apos;t have the
          image and don&apos;t need it.
        </li>
      </ul>

      <Callout variant="tip" title="Drag-and-drop shortcut">
        If you saved an image via &quot;Find on LabArchives&quot; and it
        filename-matches an outstanding placeholder, dragging it straight onto
        the note triggers the same recovery pipeline as the file picker, no
        need to open the popup first.
      </Callout>
    </WikiPage>
  );
}
