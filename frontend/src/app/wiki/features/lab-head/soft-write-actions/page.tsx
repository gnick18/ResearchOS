import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadSoftWritePage() {
  return (
    <WikiPage
      title="Soft-write actions"
      intro="A soft-write is a PI action that touches a record owned by someone else: approving a member's purchase, assigning a member to a task, flagging a note for review, posting an announcement. Every soft-write goes through the edit-session unlock and writes to the audit log. The pattern keeps cross-member writes accountable without making them painful."
    >
      {/* TODO screenshot agent: capture the PI Actions popup with the Pending Approvals tab open.
          Route: /lab-overview (PI Actions Tool popup, Pending tab)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture in active edit session; pending list has 2-3 pending
                 purchases + 1 declined item visible in "Recently declined"
          Save to: frontend/public/wiki/screenshots/lab-head-pi-actions-pending.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-pi-actions-pending.png"
        alt="The PI Actions popup showing the Pending Approvals tab with a list of waiting purchases and a Recently declined section at the bottom."
        caption="PI Actions, Pending tab. Inline Approve / Decline per row, plus a Recently declined section with a Re-approve affordance."
      />

      <h2>The four soft-write categories</h2>

      <h3>Purchase approval and decline</h3>
      <p>
        Pending purchases show up in the <strong>Pending approvals</strong>{" "}
        tab of the PI Actions popup, on the Pending tile in the Lab Overview
        sidebar, and inline on the Purchases page as a yellow stripe. Each
        row has two inline buttons:
      </p>
      <ul>
        <li>
          <strong>Approve.</strong> Flips the purchase&apos;s status to
          approved and writes an audit row. The member sees the approval
          on their own Purchases page on the next refresh.
        </li>
        <li>
          <strong>Decline.</strong> Flips the status to declined, sets a{" "}
          <code>declined_at</code> timestamp, and the purchase moves into
          the <strong>Recently declined</strong> section of the Pending
          tab. Declined purchases render with a red{" "}
          <code>PurchaseDeclinedBadge</code> wherever they appear.
        </li>
      </ul>
      <p>
        A declined purchase can be re-approved later from the same Recently
        declined section (a small <strong>Re-approve</strong> link on the
        row). This is useful when the original decline reason resolves (the
        member finds funding for the line item, the vendor sorts out a
        stock issue) without forcing the member to re-create the purchase
        from scratch.
      </p>

      <h3>Task assignment</h3>
      <p>
        On any task popup the PI sees an{" "}
        <strong>Assign to member</strong> control above the description.
        Pick a member from the dropdown and the task&apos;s{" "}
        <code>assigned_to</code> field updates. The audit row captures the
        actor (PI), the target (task id), and the old / new assignee.
      </p>
      <p>
        Assigning a task does not move ownership. The original creator still
        owns the file on disk; the assignment is just a soft signal that
        surfaces on the assignee&apos;s home page and in the member workload
        widget on the Lab Overview.
      </p>

      <h3>Flag for review</h3>
      <p>
        A PI can flag any task, note, or purchase as needing review.
        The affordance is a small <strong>Flag</strong> button on the host
        record popup. Flagged items show up:
      </p>
      <ul>
        <li>In the <strong>Flagged</strong> tab of the PI Actions popup.</li>
        <li>On the member&apos;s own copy of the record, with a red stripe and a hint.</li>
        <li>In the Lab Activity stream as a flag-event row.</li>
      </ul>
      <p>
        Flags are intentionally lightweight: there is no required comment or
        category, just a single bit that says &quot;this needs another
        look.&quot; The member resolves the flag by clicking{" "}
        <strong>Resolve</strong> on their copy, which writes a resolve event
        to the audit trail.
      </p>

      <h3>Announcements</h3>
      <p>
        Announcements are a lab-wide soft-write covered in its own page.
        Same edit-session unlock, same audit row. See{" "}
        <Link href="/wiki/features/lab-inbox/announcements">
          Announcements
        </Link>.
      </p>

      <h2>The shared edit-session gate</h2>
      <p>
        Every soft-write goes through the same 5-minute edit-session unlock.
        The first soft-write in a cold session prompts for the PI
        password, the next four-and-a-half minutes worth of actions run
        without re-prompting. See{" "}
        <Link href="/wiki/features/lab-head/edit-session-and-password">
          Edit session and password
        </Link>{" "}
        for the unlock flow and security reasoning.
      </p>

      <Callout variant="info" title="Soft, not hard">
        Soft-writes never overwrite a member&apos;s own work without their
        knowledge. The member always sees the result (the approved purchase,
        the assigned task, the flag) on their own page. The PI can
        signal, not silently take over. If a member needs a record taken
        away from them entirely, the path is to archive the user (see{" "}
        <Link href="/wiki/getting-started/user-archiving">User archiving</Link>),
        not to delete their tasks one by one.
      </Callout>
    </WikiPage>
  );
}
