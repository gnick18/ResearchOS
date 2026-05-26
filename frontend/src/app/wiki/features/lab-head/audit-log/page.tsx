import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadAuditLogPage() {
  return (
    <WikiPage
      title="Audit log"
      intro="Every PI soft-write writes a row to _pi_audit.json. The log is the forensic trail of the lab: who approved which purchase, who flagged which note, who archived which user. The data is on disk in plain JSON, and the PiActions popup gives you a sortable view on top of it. Use it to settle a 'who said what' question, or just to remember what you did last week."
    >
      {/* TODO screenshot agent: capture the Audit Log tab of the PI Actions popup.
          Route: /lab-overview (PI Actions Tool popup, Audit log tab)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture with several audit rows: approvals, declines, archive, flag
          Save to: frontend/public/wiki/screenshots/lab-head-audit-log-tab.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-audit-log-tab.png"
        alt="The Audit log tab of the PI Actions popup, showing a chronological list of soft-write rows with actor, action, target, field path, and old/new values."
        caption="The Audit log tab. Each row is one soft-write, with the field path that changed and the before / after values."
      />

      <h2>What gets logged</h2>
      <p>
        Every soft-write affordance appends a row. The captured fields per
        row are:
      </p>
      <ul>
        <li>
          <strong>actor</strong>: the PI username who performed the
          action.
        </li>
        <li>
          <strong>action</strong>: a string identifier like{" "}
          <code>approve_purchase</code>, <code>decline_purchase</code>,{" "}
          <code>reapprove_purchase</code>, <code>assign_task</code>,{" "}
          <code>flag_record</code>, <code>resolve_flag</code>,{" "}
          <code>post_announcement</code>, <code>edit_announcement</code>,{" "}
          <code>delete_announcement</code>, <code>archive_user</code>,{" "}
          <code>unarchive_user</code>.
        </li>
        <li>
          <strong>target</strong>: the affected record id (purchase id, task
          id, note id, announcement id, or username).
        </li>
        <li>
          <strong>field_path</strong>: a dotted path into the record showing
          which field changed, when the action mutates a field (e.g.{" "}
          <code>status</code>, <code>assigned_to</code>,{" "}
          <code>flagged_for_review</code>).
        </li>
        <li>
          <strong>old_value</strong>: the value before the change. Null for
          create-type actions (post announcement).
        </li>
        <li>
          <strong>new_value</strong>: the value after the change. Null for
          delete-type actions.
        </li>
        <li>
          <strong>timestamp</strong>: ISO-8601 UTC timestamp.
        </li>
      </ul>

      <h2>Where the file lives</h2>
      <p>
        The lab-level audit log is at <code>_pi_audit.json</code> at the
        root of the lab folder, alongside the shared funding accounts and
        lab metadata. Per-user audit entries also append to{" "}
        <code>users/&lt;username&gt;/_pi_audit.json</code> when the action
        targets a record owned by that user. The two views serve different
        purposes:
      </p>
      <ul>
        <li>
          <strong>Lab-level</strong>: every soft-write across the whole lab,
          read by the PiActions popup&apos;s Audit log tab.
        </li>
        <li>
          <strong>Per-user</strong>: every soft-write touching this user&apos;s
          records, visible on their own profile surface so members can audit
          what was done to their work.
        </li>
      </ul>
      <p>
        Both files are append-only on the write side. The reader is free to
        sort and filter the rows however the UI needs.
      </p>

      <h2>How to read it (PiActions popup, tab 3)</h2>
      <p>
        Open the PI Actions popup from the Lab Overview (its tile, or via the
        Tools launcher) and switch to the third tab,{" "}
        <strong>Audit log</strong>. The tab renders the lab-level file as a
        sortable table:
      </p>
      <ul>
        <li>
          <strong>Default sort</strong>: timestamp descending (most recent
          first).
        </li>
        <li>
          <strong>Filter chips</strong>: by action category (approvals,
          flags, announcements, user-mgmt), by actor, and by date range.
        </li>
        <li>
          <strong>Click a row</strong> to expand the field path and the
          old / new value inline. For longer values (announcement bodies, for
          example) the expansion shows a diff-style view.
        </li>
      </ul>

      <h2>Forensic use cases</h2>
      <p>
        The audit log is the place to go when:
      </p>
      <ul>
        <li>
          A purchase shows up as approved and the member needs to confirm
          who signed off and when (audit by target id).
        </li>
        <li>
          An announcement was edited or deleted and you want to see the
          original (audit row carries the old body).
        </li>
        <li>
          A member was archived months ago and you want to know which PI
          archived them and why (paired with the announcement or
          comment they left at the time).
        </li>
        <li>
          The lab is preparing for a compliance review and needs a flat
          export of who approved which lab purchases over a date range
          (filter chips plus the JSON file underneath).
        </li>
      </ul>

      <Callout variant="info" title="The log is not encrypted">
        Like every other ResearchOS file, the audit log sits in plaintext
        on disk. Anyone with read access to the lab folder can read it
        directly. The point of the log is accountability across PI
        sessions, not protection against an adversary on the file system.
        See <Link href="/wiki/security">Security</Link> for the data-at-rest
        story.
      </Callout>

      <Callout variant="tip" title="Audit append-only">
        The writer never modifies an existing row, only appends. So a PI
        cannot quietly &quot;edit&quot; an old audit entry to hide what
        they did. If a row looks wrong, the right move is to write a new
        action that corrects it (re-approve a wrongly-declined purchase, for
        example) so both rows are visible in the chronological view.
      </Callout>
    </WikiPage>
  );
}
