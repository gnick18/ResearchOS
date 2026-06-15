import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabInboxAnnouncementsPage() {
  return (
    <WikiPage
      title="Announcements"
      intro="Announcements are the PI's broadcast channel. They are short posts every member can see, pinnable to the top of the stream. Members read. PIs compose and post directly from the Lab Overview, with no password prompt and no timed session to unlock first."
    >
      {/* TODO screenshot agent: capture the announcement composer on Lab Overview with a draft in progress.
          Route: /lab-overview
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; "Post an announcement" section visible; textarea has draft text
          Save to: frontend/public/wiki/screenshots/lab-overview-announcement-composer.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-overview-announcement-composer.png"
        alt="The Post an announcement section on the Lab Overview page, showing a textarea with a draft message, a Pin to top checkbox, and a Post announcement button."
        caption="The announcement composer on the Lab Overview. Type a message, optionally pin it, and post. No unlock step required."
      />

      <h2>Who can post</h2>
      <p>
        Posting is PI only. The compose form does not render for member
        accounts, and the underlying write is rejected for any account without{" "}
        <code>account_type === &quot;lab_head&quot;</code>. Reading is open to
        every member. Everyone in the lab sees the same announcement stream.
      </p>

      <h2>Posting an announcement</h2>
      <p>
        The composer lives in the{" "}
        <strong>Post an announcement</strong> section on the Lab Overview page.
        A logged-in PI can type and post immediately. There is no password and
        no edit-session unlock. The PI&apos;s account sign-in is the only gate.
      </p>
      <ol>
        <li>
          Type the message in the text area. Drafts are persisted to{" "}
          <code>sessionStorage</code> as you type, so an accidental tab close
          or refresh does not lose an in-progress announcement.
        </li>
        <li>
          Optionally check <strong>Pin to top</strong> to keep the
          announcement at the head of the stream regardless of post date.
        </li>
        <li>
          Click <strong>Post announcement</strong>. The post goes out
          immediately and every lab member receives a notification.
        </li>
      </ol>

      <h2>Pin, edit, and delete</h2>
      <p>
        Once an announcement is published, the author has three actions on it.
      </p>
      <ul>
        <li>
          <strong>Pin / Unpin.</strong> A pinned announcement floats to the
          top of the stream regardless of post date. Unpinning lets it
          slide back into chronological order.
        </li>
        <li>
          <strong>Edit.</strong> Opens the composer pre-filled with the
          current text. Save to update. When the text changes, every
          recipient&apos;s notification preview refreshes to match the new body.
        </li>
        <li>
          <strong>Delete.</strong> Removes the announcement after a native
          confirm prompt. Recipients&apos; notification rows for that
          announcement are also cleaned up so the bell count stays accurate.
        </li>
      </ul>
      <p>
        Only the original author can edit or delete an announcement. A second
        PI cannot edit another PI&apos;s post. They can post their own
        follow-up.
      </p>

      <h2>Draft persistence</h2>
      <p>
        The composer persists in-progress text to{" "}
        <code>sessionStorage</code> as you type. The draft is keyed by the
        PI&apos;s username, so each PI keeps their own draft independently of
        any other PI. The draft restores automatically when the composer
        mounts again in the same browser session. It does not survive a
        fresh browser session, which is intentional since a long-dead draft
        is rarely worth resurfacing.
      </p>

      <h2>The audit trail</h2>
      <p>
        Announcement writes (post, edit, delete, pin toggle) can append a row
        to the lab-root audit file at <code>_pi_audit.json</code>. Because
        announcements are lab-scoped rather than owned by any single member,
        the audit entry lives at the lab root rather than in a per-user folder.
        See{" "}
        <Link href="/wiki/features/lab-head/audit-log">Audit log</Link> for
        the entry schema and the trail viewer.
      </p>

      <Callout variant="info" title="Audit lives at the lab root">
        Unlike edits to member records, which write to each member&apos;s own{" "}
        <code>users/&lt;member&gt;/_pi_audit.json</code>, announcement audit
        entries go to <code>_pi_audit.json</code> at the lab folder root.
        There is no per-user announcement audit view because announcements are
        inherently lab-wide.
      </Callout>

      <h2>Announcements vs. comments</h2>
      <p>
        Announcements and comments are both async, but they serve different
        purposes.
      </p>
      <ul>
        <li>
          <strong>Post an announcement</strong> when the message is for the
          whole lab, should persist for at least a few days, and benefits from
          being on the lab&apos;s shared front page. Examples include a freezer
          outage notice, a lab meeting rescheduled, or an equipment ordering
          deadline.
        </li>
        <li>
          <strong>Post a comment</strong> when the message is about a specific
          record. The comment stays tied to its host, appears in context inside
          the record popup, and does not need to appear on the front page. See{" "}
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
