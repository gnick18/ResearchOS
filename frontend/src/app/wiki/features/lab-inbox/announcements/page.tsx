import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabInboxAnnouncementsPage() {
  return (
    <WikiPage
      title="Announcements"
      intro="Announcements are the Lab Head's broadcast channel: short posts visible to every member, pinned to the top of the lab activity surface until they age out. Members read; Lab Heads write. Writing is gated by an edit-session unlock so an accidental keystroke does not push something out to the whole lab."
    >
      {/* TODO screenshot agent: capture the Announcements composer with a draft in progress.
          Route: /lab-overview (Announcements Tool popup, compose form expanded)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture in active edit session; compose form has title + body draft
          Save to: frontend/public/wiki/screenshots/lab-inbox-announcements-compose.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-inbox-announcements-compose.png"
        alt="The Announcements composer with a title, body, and a Pin checkbox, visible after the Lab Head unlocked an edit session."
        caption="The compose form. Title plus body. Pin keeps the announcement at the top of the stream until you unpin it."
      />

      <h2>Who can post</h2>
      <p>
        Posting is Lab Head only. The compose form does not render for member
        accounts at all, and the underlying API rejects writes from any
        account without <code>account_type === &quot;lab_head&quot;</code>.
        Reading is universal: every member sees the same announcement
        stream.
      </p>

      <h2>Edit-session unlock</h2>
      <p>
        A Lab Head cannot post an announcement directly from a cold session.
        The flow requires a short edit-session unlock first:
      </p>
      <ol>
        <li>
          Click <strong>Request Edit</strong>. A small password dialog opens.
        </li>
        <li>
          Type the Lab Head password (the one you set in Settings, separate
          from the per-user account password).
        </li>
        <li>
          On success, an edit session opens for 5 minutes. The compose form
          becomes active, and any other soft-write affordances (approve a
          purchase, post an announcement, archive a user) work without
          re-prompting for the duration.
        </li>
      </ol>
      <p>
        The 5-minute window matches the rest of the Lab Head soft-write
        pattern. Cross-link to{" "}
        <Link href="/wiki/features/lab-head/edit-session-and-password">
          Edit session and password
        </Link>{" "}
        for the full unlock walkthrough and the security reasoning.
      </p>

      <h2>Pin / edit / delete</h2>
      <p>
        Each announcement carries three actions the author can take after
        publishing:
      </p>
      <ul>
        <li>
          <strong>Pin / Unpin.</strong> A pinned announcement stays at the top
          of the stream regardless of post date. Unpin to let it slide back
          into chronological order.
        </li>
        <li>
          <strong>Edit.</strong> Open the original compose form pre-filled
          with the title and body, make changes, save. The edit is logged
          to the audit trail (see below).
        </li>
        <li>
          <strong>Delete.</strong> Removes the announcement after a
          confirmation. The deletion is logged with the original body so
          you can recover an accidentally-deleted post from the audit
          trail.
        </li>
      </ul>
      <p>
        Only the author can edit or delete an announcement. A second Lab Head
        cannot edit another Lab Head&apos;s post (this would muddy the audit
        trail), only post their own follow-up.
      </p>

      <h2>Draft persistence</h2>
      <p>
        The compose form persists in-progress drafts to{" "}
        <code>sessionStorage</code> as you type, so an accidental tab close
        or refresh does not lose your unposted announcement. The draft
        restores automatically when you next mount the compose form. It is
        per-Lab-Head and per-tab; it does not survive into a fresh browser
        session, which is intentional, since a long-dead draft is rarely
        worth resurrecting.
      </p>

      <h2>The audit trail</h2>
      <p>
        Every announcement write (post, edit, delete, pin, unpin) appends a
        row to <code>_pi_audit.json</code> at the lab folder root. The row
        records the actor (which Lab Head), the action, the affected
        announcement id, the old and new values for edits, and the
        timestamp. See{" "}
        <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>{" "}
        for the full schema and the PiActions popup that reads it.
      </p>

      <Callout variant="info" title="Audit lives at the lab root">
        Unlike per-user soft writes (purchase approvals, task assignments)
        that have both a lab-level and a per-user audit entry, announcements
        only have a lab-level entry because they are inherently lab-scoped.
        There is no per-user view of announcement edits.
      </Callout>

      <h2>When to post an announcement vs. a comment</h2>
      <p>
        Announcements and comments are both async, but they answer different
        questions:
      </p>
      <ul>
        <li>
          <strong>Post an announcement</strong> when the message is for the
          whole lab, persists for at least a few days, and benefits from
          being on the lab&apos;s shared front page. Examples: &quot;Freezer
          is down, do not store anything in -80B,&quot; &quot;Lab meeting
          moved to Thursday,&quot; &quot;Equipment ordering deadline is
          Friday.&quot;
        </li>
        <li>
          <strong>Post a comment</strong> when the message is about a
          specific record (a task, a note, a purchase). The comment stays
          tied to its host, surfaces in the Lab Inbox stream alongside the
          record context, and does not need to clutter the front page. See{" "}
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
