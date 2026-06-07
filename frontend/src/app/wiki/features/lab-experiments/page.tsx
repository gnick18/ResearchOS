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
        A member's own{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> only shows their
        work. A PI usually needs the opposite, the whole lab in one list, so they
        can check on an experiment without asking the member to share it or
        knowing which project it lives under. Browse lab experiments is that
        list. It pulls every member's experiments into a single view, the PI's
        own included, so the lab's bench work all sits in one place.
      </p>
      <Callout variant="info" title="Where you reach it">
        This surface lives behind the &quot;Browse lab experiments&quot; button
        on the <Link href="/wiki/features/lab-overview">Lab Overview</Link>,
        the PI's landing page. It isn't a tab on the member Workbench, and a
        member or solo researcher never sees it.
      </Callout>

      <h2>Who can open it</h2>
      <p>
        The page is gated on the lab head (PI) account type. If a member or solo
        researcher lands on the URL directly, they're sent back home before any
        lab data loads, so there's no way to reach another person's experiments
        through this route without the PI role. For the role itself and how it's
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
          changes the record, so you can read a member's work freely.
        </Step>
        <Step>
          <strong>Edit as the lab head.</strong> If you need to correct
          something, the popup offers an &quot;Edit as lab head&quot; affordance.
          It asks you to confirm once per session, then unlocks editing.
        </Step>
        <Step>
          <strong>The change stays the member's.</strong> Your edit is written
          back to the member who owns the experiment, not copied to you, and it's
          captured in the audit trail so there's a record of the lab head
          touching someone else's work.
        </Step>
      </Steps>
      <Callout variant="warning" title="Editing is deliberate, not the default">
        Opening an experiment never puts it in an editable state on its own. You
        review by default and have to ask for the edit, so a PI skimming the lab
        can't change a member's record by accident.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          For the lab head's landing page that this surface hangs off, see{" "}
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
