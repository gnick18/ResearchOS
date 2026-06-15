import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LabNotesFeaturePage() {
  return (
    <WikiPage
      title="Browse lab notes"
      intro="Lab notes at /lab-notes is the lab head's window into every member's notes at once. It works the same way as Browse lab experiments. You open any note to read it, and if you need to fix something you can edit it as the lab head, with the change still recorded against the member who wrote it."
    >
      <h2>What this page is for</h2>
      <p>
        Notes are where a lot of the lab's day-to-day record actually lives,
        recipes, measurements, plasmid names, the running log of what happened at
        the bench. A member's own notes sit on their Workbench. A PI often wants
        to read across the whole lab's notes without hunting through each
        person's projects. Browse lab notes is that single stream, every
        member's notes in one view, the PI's own included.
      </p>
      <Callout variant="info" title="Where you reach it">
        Navigate directly to <code>/lab-notes</code>, or follow the link from
        the <Link href="/wiki/features/lab-head">PI</Link> pages. It is the
        notes counterpart to{" "}
        <Link href="/wiki/features/lab-experiments">Browse lab experiments</Link>.
        The Lab Overview itself does not have a browse link-out button; those
        were retired when the Lab Overview was redesigned.
      </Callout>

      <h2>Who can open it</h2>
      <p>
        The page is gated on the lab head (PI) account type. A member or solo
        researcher who lands on the URL directly is sent back home before any
        lab data loads, so the whole-lab notes view is the PI's alone. For the
        role itself, see <Link href="/wiki/features/lab-head">PI</Link>.
      </p>

      <h2>How browsing and editing work</h2>
      <p>
        The list shows every member's notes. Opening one follows the same
        look-first, edit-only-if-you-mean-to flow as experiments.
      </p>
      <Steps>
        <Step>
          <strong>Open it read-only.</strong> Clicking a note opens it in the
          note popup in review mode. You can read any member's note without
          changing it.
        </Step>
        <Step>
          <strong>Edit as the lab head.</strong> If you need to correct
          something, the popup offers an <strong>Edit as lab head</strong>{" "}
          button. Clicking it opens a one-time confirmation dialog for that
          record. After you confirm, that specific record is freely editable
          for the rest of the browser session without being asked again.
        </Step>
        <Step>
          <strong>The change stays the member's.</strong> Your edit is written
          back to the member who owns the note, not copied to you, and it's
          captured in the audit trail so the lab head touching someone else's
          note leaves a record.
        </Step>
      </Steps>
      <Callout variant="warning" title="Editing is deliberate, not the default">
        Opening a note never puts it in an editable state on its own. You read
        by default and have to click <strong>Edit as lab head</strong> and
        confirm, so skimming the lab&apos;s notes cannot change a member&apos;s
        record by accident. Each distinct record gets its own confirmation the
        first time you edit it.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          For the lab head's landing page this surface hangs off, see{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>.
        </li>
        <li>
          For the same idea applied to experiments, see{" "}
          <Link href="/wiki/features/lab-experiments">
            Browse lab experiments
          </Link>
          .
        </li>
        <li>
          For how notes themselves work and the editor behind them, see the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link> and the{" "}
          <Link href="/wiki/features/markdown-editor">Markdown editor</Link>.
        </li>
        <li>
          For the PI role and how lab-head writes are recorded, see{" "}
          <Link href="/wiki/features/lab-head">PI</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
