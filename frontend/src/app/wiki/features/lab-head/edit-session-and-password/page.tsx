import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function LabHeadEditSessionPage() {
  return (
    <WikiPage
      title="Edit as lab head"
      intro="A lab head can read and edit any member's records. To prevent an accidental keystroke from changing someone else's work, the first time you edit a given record the app asks for one confirmation. After you confirm, that record stays freely editable for the rest of the browser session. There is no password and no timer."
    >
      <h2>How the confirm-once gate works</h2>
      <p>
        When a lab head opens a record they did not create, the record opens
        in read-only review mode. An <strong>Edit as lab head</strong> button
        appears in the header (amber, with a pencil icon). Clicking it opens a
        small confirmation dialog that names the member whose record you are
        about to change and explains that the edit will be logged to the audit
        trail. Two buttons follow, <strong>Cancel</strong> and{" "}
        <strong>Edit as lab head</strong>.
      </p>
      <p>
        Once you confirm, the confirmation is remembered for that specific
        record for the rest of the browser session. The dialog does not appear
        again if you close and reopen the same record. A page reload or a
        user switch clears the memory, so the next session always starts fresh.
      </p>

      <Callout variant="info" title="One confirmation per record, not one unlock for all">
        The gate is keyed by record, not by a shared session. Confirming on one
        member&apos;s note does not unlock a different member&apos;s purchase.
        Each record gets its own confirmation the first time you edit it.
      </Callout>

      <h2>What happens when you edit</h2>
      <p>
        After confirming, the record becomes editable exactly as if it were
        your own. Your edits are written back to the member&apos;s folder, not
        copied to you, so ownership does not change. Each field you change
        appends a row to that member&apos;s{" "}
        <code>users/&lt;member&gt;/_pi_audit.json</code> file so the change
        leaves a complete record. See{" "}
        <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>.
      </p>

      <h2>What it replaced</h2>
      <p>
        Before June 2026 the lab-head edit path used a separate PI password
        and a shared 5-minute timed session that unlocked every soft-write
        affordance at once. That gate was removed. A logged-in lab head is
        already authenticated through the normal account sign-in, so a
        password prompt was a redundant step. The per-record confirm dialog
        keeps the friction that stops accidental edits while removing the
        friction that slowed down intentional ones.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>{" "}
          covers the purchase approval, task assignment, and flag-for-review
          affordances.
        </li>
        <li>
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>{" "}
          covers the{" "}
          <code>_pi_audit.json</code> file and how to open the trail viewer.
        </li>
        <li>
          <Link href="/wiki/features/lab-experiments">Browse lab experiments</Link>{" "}
          and{" "}
          <Link href="/wiki/features/lab-notes">Browse lab notes</Link>{" "}
          are the main surfaces where a PI reads and edits member records.
        </li>
      </ul>
    </WikiPage>
  );
}
