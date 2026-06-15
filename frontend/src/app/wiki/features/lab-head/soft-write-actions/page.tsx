import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadSoftWritePage() {
  return (
    <WikiPage
      title="Soft-write actions"
      intro="A soft-write is a PI action that touches a record owned by someone else, like approving a member's purchase, assigning a member to a task, or flagging a note for review. Each action writes a row to the audit log so cross-member writes stay accountable. Posting a lab announcement is the PI's own broadcast and does not touch a member's record."
    >
      {/* TODO screenshot agent: capture the /approvals page with pending items visible.
          Route: /approvals
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; 2-3 pending purchases + 1 flagged item visible
          Save to: frontend/public/wiki/screenshots/lab-head-approvals-page.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-approvals-page.png"
        alt="The /approvals page showing a queue of pending purchase items, each with inline Approve and Decline buttons, plus a flagged items section."
        caption="The Approvals page at /approvals. Pending purchases and flagged records appear here with inline approve, decline, and resolve controls."
      />

      <h2>The four soft-write categories</h2>

      <h3>Purchase approval and decline</h3>
      <p>
        Pending purchases appear on the <strong>Approvals page</strong> at{" "}
        <code>/approvals</code>, reachable from the{" "}
        <strong>What needs you</strong> hero on the Lab Overview. Each item in
        the queue has two inline controls.
      </p>
      <ul>
        <li>
          <strong>Approve.</strong> Flips the purchase&apos;s status to
          approved and writes an audit row. The member sees the approval on
          their own Purchases page on the next refresh.
        </li>
        <li>
          <strong>Decline.</strong> Flips the status to declined and stamps a{" "}
          <code>declined_at</code> timestamp. A{" "}
          <code>PurchaseDeclinedBadge</code> appears wherever that purchase
          is displayed.
        </li>
      </ul>
      <p>
        A declined purchase can be re-approved from the same Approvals page.
        This is useful when the original decline reason resolves without
        forcing the member to re-create the purchase from scratch.
      </p>

      <h3>Task assignment</h3>
      <p>
        On any task popup the PI sees an{" "}
        <strong>Assign to member</strong> control above the description. Pick
        a member from the dropdown and the task&apos;s{" "}
        <code>assigned_to</code> field updates. The audit row captures the
        actor (the PI), the record id, and the old and new assignee via the
        <code>field_path</code>.
      </p>
      <p>
        Assigning a task does not move ownership. The original creator still
        owns the file on disk. The assignment surfaces on the assignee&apos;s
        home page and in the member workload panel on the Lab Overview.
      </p>

      <h3>Flag for review</h3>
      <p>
        A PI can flag any task, note, or purchase as needing review. The
        affordance is a <strong>Flag</strong> button on the host record popup.
        Flagged items appear in the{" "}
        <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
        <strong>What needs you</strong> hero and on the{" "}
        <Link href="/wiki/features/lab-head/audit-log">Approvals page</Link>.
        The member also sees a flag stripe on their own copy of the record.
        The member resolves the flag by clicking{" "}
        <strong>Resolve</strong>, which writes a resolve row to the audit
        trail.
      </p>

      <h3>Announcements</h3>
      <p>
        Announcements are a lab-wide PI broadcast covered on their own page.
        Unlike the soft-writes above, posting an announcement does not touch
        any member&apos;s record. A logged-in PI posts directly from the
        composer on the Lab Overview. See{" "}
        <Link href="/wiki/features/lab-inbox/announcements">
          Announcements
        </Link>.
      </p>

      <h2>The confirm-once gate on member record edits</h2>
      <p>
        Soft-writes that change a member&apos;s record go through a one-time
        confirm dialog per record. The first time you edit a given record
        in a browser session the app asks whether you mean to edit that
        member&apos;s work. After you confirm, that record stays freely
        editable for the rest of the session. There is no password and no
        timer. See{" "}
        <Link href="/wiki/features/lab-head/edit-session-and-password">
          Edit as lab head
        </Link>{" "}
        for the full flow.
      </p>

      <Callout variant="info" title="Soft, not hard">
        Soft-writes never overwrite a member&apos;s own work without their
        knowledge. The member always sees the result on their own page. The PI
        signals, rather than silently taking over. If a member&apos;s records
        need to be handed off entirely, the path is to archive the user (see{" "}
        <Link href="/wiki/getting-started/user-archiving">User archiving</Link>),
        not to delete their work one record at a time.
      </Callout>
    </WikiPage>
  );
}
