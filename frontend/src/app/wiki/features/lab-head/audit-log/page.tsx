import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadAuditLogPage() {
  return (
    <WikiPage
      title="Audit log"
      intro="Every time a lab head edits a member's record, one row per changed field is appended to that member's audit file. The audit trail is the forensic record of cross-member edits. Open it from the Audit trail button on the Lab Overview header to see who changed what, when, and what the value was before and after."
    >
      {/* TODO screenshot agent: capture the AuditTrailViewer popup open from the Lab Overview header.
          Route: /lab-overview
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; "Audit trail" button clicked; viewer shows several per-field rows
          Save to: frontend/public/wiki/screenshots/lab-head-audit-trail-viewer.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-audit-trail-viewer.png"
        alt="The Audit trail viewer popup showing a list of per-field edit rows with actor, record type, field path, old value, new value, and timestamp columns."
        caption="The Audit trail viewer. Each row is one field change, with the before and after values shown inline."
      />

      <h2>How to open it</h2>
      <p>
        Click the <strong>Audit trail</strong> button in the top-right of the
        Lab Overview page. The button is always visible and does not require
        any special state to be active. The viewer opens as a popup. If
        no target member is selected, the viewer shows a member picker first;
        select a member to load their trail. The viewer is read-only. Nothing
        you do in it changes any record.
      </p>

      <h2>What each row records</h2>
      <p>
        Each audit entry corresponds to one field change in one record. A
        single save that touches three fields writes three entries. Here is
        what each entry contains.
      </p>
      <ul>
        <li>
          <strong>actor</strong>: the lab head username who made the edit.
        </li>
        <li>
          <strong>target_user</strong>: the member whose record was changed.
        </li>
        <li>
          <strong>record_type</strong>: a string identifying the kind of
          record, for example <code>task</code>, <code>note</code>, or{" "}
          <code>purchase_item</code>.
        </li>
        <li>
          <strong>record_id</strong>: the numeric or string id of the
          specific record that was changed.
        </li>
        <li>
          <strong>field_path</strong>: a dot-separated path through the
          record shape identifying which field changed, for example{" "}
          <code>name</code>, <code>assigned_to</code>, or{" "}
          <code>sub_tasks.0.title</code>.
        </li>
        <li>
          <strong>old_value</strong>: the value before the change.
        </li>
        <li>
          <strong>new_value</strong>: the value after the change.
        </li>
        <li>
          <strong>session_id</strong>: a synthetic grouping id stamped on
          related entries from the same action, for example{" "}
          <code>lab-head-action</code>. Not a timed session, just a label
          that connects rows that came from the same operation.
        </li>
        <li>
          <strong>timestamp</strong>: ISO 8601 UTC.
        </li>
      </ul>

      <Callout variant="info" title="No action or target fields">
        The audit schema does not have generic <code>action</code> or{" "}
        <code>target</code> summary fields. The record type plus the field
        path together describe what changed. An approval, for example,
        appears as a <code>purchase_item</code> row with{" "}
        <code>field_path: &quot;approved&quot;</code> and{" "}
        <code>old_value: false</code> / <code>new_value: true</code>.
      </Callout>

      <h2>Where the file lives</h2>
      <p>
        Soft-write edits to a member&apos;s records are written to{" "}
        <code>users/&lt;member&gt;/_pi_audit.json</code> inside that
        member&apos;s folder. Announcement writes (post, edit, delete) go to
        a separate <code>_pi_audit.json</code> at the lab folder root, because
        announcements are lab-scoped rather than owned by any single member.
      </p>
      <p>
        Both files use the same entry schema. The viewer reads the per-user
        file for member record edits. The files are append-only on the write
        side. The reader is free to sort and filter.
      </p>

      <h2>Forensic use cases</h2>
      <ul>
        <li>
          A purchase shows up as approved and the member wants to confirm who
          signed off and when. Filter by <code>record_type: purchase_item</code>{" "}
          and the <code>approved</code> field path.
        </li>
        <li>
          A task was reassigned and the original assignment needs to be
          confirmed. Look for the <code>assigned_to</code> field path on the
          relevant task id.
        </li>
        <li>
          A note was edited by the lab head and the original text needs to be
          recovered. The <code>old_value</code> on the body field carries the
          pre-edit text verbatim.
        </li>
      </ul>

      <Callout variant="info" title="The log is not encrypted">
        Like every other ResearchOS file, the audit log sits in plaintext on
        disk. Anyone with read access to the lab folder can open it directly.
        The purpose of the log is accountability, not protection against an
        adversary on the file system. See{" "}
        <Link href="/wiki/security">Security</Link> for the data-at-rest story.
      </Callout>

      <Callout variant="tip" title="Append-only by design">
        The writer never modifies an existing row. A lab head cannot quietly
        erase or rewrite an old audit entry through the app. If a change needs
        to be corrected (re-approving a wrongly-declined purchase, for
        example), the correction writes a new row alongside the original, so
        both are visible in the viewer.
      </Callout>
    </WikiPage>
  );
}
