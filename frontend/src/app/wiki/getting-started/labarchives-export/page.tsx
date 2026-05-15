import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LabArchivesExportPage() {
  return (
    <WikiPage
      title="Exporting from LabArchives"
      intro="ResearchOS imports LabArchives notebooks by reading the Offline Notebook ZIP that LabArchives exports. This page walks you through producing that ZIP."
    >
      <h2>Why an offline ZIP</h2>
      <p>
        LabArchives is your ELN of record while you&apos;re running
        experiments. ResearchOS doesn&apos;t talk to LabArchives in real
        time, and it doesn&apos;t write anything back to your LabArchives
        account. The hand-off in between is a single file, the{" "}
        <strong>Offline Notebook ZIP</strong>, that LabArchives generates
        on demand and emails you when it&apos;s ready.
      </p>
      <p>
        Once you have that ZIP downloaded, the ResearchOS importer reads
        it directly. You don&apos;t unzip it, and you don&apos;t need
        ResearchOS to be signed in to LabArchives. The next page over,{" "}
        <Link href="/wiki/features/import-from-eln">
          Import from LabArchives
        </Link>
        , covers what the importer does with the file.
      </p>

      <Callout variant="info" title="LabArchives may change their UI">
        LabArchives occasionally renames menu items or moves them between
        toolbars. If a label below doesn&apos;t match what you see on
        screen, look for the same underlying concept: you&apos;re asking
        LabArchives to produce an <strong>Offline Notebook</strong>{" "}
        export of a single notebook. Other names you might see for the
        same action include <em>Create Offline Notebook</em>,{" "}
        <em>Export Notebook</em>, and <em>Backup Notebook</em>.
      </Callout>

      <h2>Generate the offline ZIP</h2>
      <Steps>
        <Step>
          Sign in to LabArchives at{" "}
          <a
            href="https://mynotebook.labarchives.com"
            target="_blank"
            rel="noopener noreferrer"
          >
            mynotebook.labarchives.com
          </a>{" "}
          (or your institution&apos;s LabArchives URL) in a normal
          browser tab.
        </Step>
        <Step>
          Open the notebook you want to bring into ResearchOS from the
          notebook switcher in the top-left. Export is one notebook at a
          time, so if you want several notebooks in ResearchOS, plan to
          repeat this flow for each.
        </Step>
        <Step>
          Open the <strong>≡ Tools</strong> menu in the top toolbar and
          pick <strong>Utilities → Create Offline Notebook</strong>.
          (Older builds park this under <em>More → Offline Notebook</em>{" "}
          or <em>Notebook Settings → Export</em>. You&apos;re after the
          same item either way.)
        </Step>
        <Step>
          Confirm the request when LabArchives prompts. The request goes
          into a queue, and LabArchives builds the ZIP server-side. You
          can close the tab while it works.
        </Step>
        <Step>
          Wait for the email. LabArchives mails you a link as soon as the
          ZIP is ready. Small notebooks take a minute or two, large ones
          with many attachments can take much longer.
        </Step>
        <Step>
          Click the link in the email and download the ZIP to your
          computer. The file is usually named something like{" "}
          <code>offline_&lt;notebook-id&gt;.zip</code>. Save it somewhere
          you can find later (your Downloads folder is fine), and{" "}
          <strong>do not unzip it</strong>. ResearchOS reads the archive
          as a single file.
        </Step>
      </Steps>

      <h2>What&apos;s inside the ZIP</h2>
      <p>
        You don&apos;t need to open the ZIP yourself, but it helps to
        know what&apos;s in there:
      </p>
      <ul className="list-disc pl-6 space-y-1">
        <li>
          One HTML file per notebook page, holding the page title, every
          entry on that page, and the entry text.
        </li>
        <li>
          A subdirectory of attachments for each page, where image
          uploads and other bundled files sit alongside the HTML.
        </li>
        <li>
          A top-level manifest that describes the notebook tree, the
          export timestamp, and who triggered the export.
        </li>
      </ul>
      <p>
        Some inline images live in LabArchives&apos; cloud as URLs rather
        than bundled bytes. The Offline Notebook ZIP keeps the URL but
        not the image itself for those. ResearchOS handles that on import
        through a separate <em>Fetch images</em> step, which the import
        page covers.
      </p>

      <Callout variant="tip" title="One ZIP can be re-imported later">
        ResearchOS&apos;s importer is idempotent against the same ZIP. If
        you re-run the import on the same file, pages you&apos;ve
        already imported are skipped. If you export a fresher ZIP from
        LabArchives later and run it through, only the new pages land.
        See{" "}
        <Link href="/wiki/features/import-from-eln#re-running">
          Re-running the import
        </Link>{" "}
        for the details.
      </Callout>

      <h2>Up next</h2>
      <p>
        With the ZIP downloaded, head to{" "}
        <Link href="/wiki/features/import-from-eln">
          Import from LabArchives
        </Link>{" "}
        to walk through the ResearchOS-side wizard. You&apos;ll pick the
        format, drop the ZIP, preview what&apos;s inside, map folders to
        projects, and apply.
      </p>
    </WikiPage>
  );
}
