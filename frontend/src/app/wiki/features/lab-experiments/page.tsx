import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function LabExperimentsFeaturePage() {
  return (
    <WikiPage
      title="Browse lab experiments"
      intro="Lab experiments at /lab-experiments is the lab head's window into every member's experiments at once. It's a read-first surface. You open any experiment to review it, and if you need to fix something you can edit it as the lab head, with the change still recorded against the member who owns it."
    >
      <h2>What this page is for</h2>
      <p>
        A member&apos;s own{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> only shows their
        work. A PI usually needs the opposite, the whole lab in one list, so they
        can check on an experiment without asking the member to share it or
        knowing which project it lives under. Browse lab experiments is that
        list. It pulls every member&apos;s experiments into a single view, the PI&apos;s
        own included, so the lab&apos;s bench work all sits in one place.
      </p>
      <Callout variant="info" title="Where you reach it">
        Navigate directly to <code>/lab-experiments</code>, or follow the link
        from the <Link href="/wiki/features/lab-head">PI</Link> pages. It is
        not a tab on the member Workbench, and a member or solo researcher
        never sees it. The Lab Overview itself does not have a browse link-out
        button; those were retired when the Lab Overview was redesigned.
      </Callout>

      <h2>Who can open it</h2>
      <p>
        The page is gated on the lab head (PI) account type. If a member or solo
        researcher lands on the URL directly, they&apos;re sent back home before any
        lab data loads, so there&apos;s no way to reach another person&apos;s experiments
        through this route without the PI role. For the role itself and how it&apos;s
        granted, see <Link href="/wiki/features/lab-head">PI</Link>.
      </p>

      <h2>How browsing and editing work</h2>
      <p>
        The list shows a card per experiment across the whole lab. Opening one is
        a two-stage idea, look first, then edit only if you mean to.
      </p>
      <Steps>
        <Step>
          <strong>Open it read-only.</strong> Clicking a card opens the full
          experiment in the same popup the Workbench uses, with Details, Lab
          Notes, Method, and Results, but in review mode. Nothing you do here
          changes the record, so you can read a member&apos;s work freely.
        </Step>
        <Step>
          <strong>Edit as the lab head.</strong> If you need to correct
          something, the popup offers an <strong>Edit as lab head</strong>{" "}
          button. Clicking it opens a one-time confirmation dialog for that
          record. After you confirm, that specific record is freely editable
          for the rest of the browser session without being asked again.
        </Step>
        <Step>
          <strong>The change stays the member&apos;s.</strong> Your edit is written
          back to the member who owns the experiment, not copied to you, and it&apos;s
          captured in the audit trail so there&apos;s a record of the lab head
          touching someone else&apos;s work.
        </Step>
      </Steps>
      <Callout variant="warning" title="Editing is deliberate, not the default">
        Opening an experiment never puts it in an editable state on its own.
        You review by default and have to click <strong>Edit as lab head</strong>{" "}
        and confirm, so a PI skimming the lab cannot change a member&apos;s
        record by accident. Each distinct record gets its own confirmation the
        first time you edit it.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          For the lab head&apos;s landing page that this surface hangs off, see{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>.
        </li>
        <li>
          For the same idea applied to written notes, see{" "}
          <Link href="/wiki/features/lab-notes">Browse lab notes</Link>.
        </li>
        <li>
          For the experiment popup itself (Details, Lab Notes, Method, Results),
          see the <Link href="/wiki/features/experiments">Workbench</Link>.
        </li>
        <li>
          For the PI role and how lab-head writes are recorded, see{" "}
          <Link href="/wiki/features/lab-head">PI</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
