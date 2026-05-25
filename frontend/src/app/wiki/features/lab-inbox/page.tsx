import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabInboxFeaturePage() {
  return (
    <WikiPage
      title="Lab Inbox"
      intro="The Lab Inbox is the lab-wide activity surface for everything anyone said to anyone else. Comments on tasks, notes, and purchases all land here, as do @-mentions and lab-wide announcements. It is the asynchronous chat layer of ResearchOS: the place you check first thing in the morning to see what happened while you were away."
    >
      {/* TODO screenshot agent: capture the Lab Inbox popup with mixed comment + announcement rows.
          Route: /lab-overview (Lab Inbox Tool popup open)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture; comments + announcements + @-mentions visible in a single stream
          Save to: frontend/public/wiki/screenshots/lab-inbox-overview.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-inbox-overview.png"
        alt="The Lab Inbox popup showing a mix of comments, @-mentions, and announcement rows in a single chronological stream."
        caption="The Lab Inbox in one stream: comments, @-mentions, and announcements all flow through here."
      />

      <h2>Who sees what</h2>
      <p>
        Lab Inbox is universal. Every lab member (and every Lab Head) sees the
        same inbox surface, scoped by what they have read access to. Comments
        on a private task only show up for the people who can see that task;
        announcements posted to the whole lab show up for everyone. The
        permission model is the same one that gates the underlying records,
        so the inbox never reveals anything you could not already see by
        navigating to the record itself.
      </p>

      <h2>What lands in the inbox</h2>
      <ul>
        <li>
          <strong>Comments.</strong> Threaded replies on tasks, notes, and
          purchases. One-level reply nesting (a comment plus its direct
          replies). See{" "}
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link>{" "}
          for the data shape and @-mention behavior.
        </li>
        <li>
          <strong>Announcements.</strong> Lab-wide posts from a Lab Head.
          They sit in chronological order by default. A Lab Head can pin
          one to keep it at the top of the feed, and the pin persists
          until they explicitly unpin it. See{" "}
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>.
        </li>
        <li>
          <strong>@-mentions.</strong> A filtered view of comments where you
          were called out by name. The mention array is denormalized (see
          the Comments page for the why), so the filter is a fast index
          lookup, not a body regex.
        </li>
      </ul>

      <h2>How it relates to the bell</h2>
      <p>
        The Lab Inbox and the bell-icon notification dropdown are siblings
        with different scopes. The bell is your personal queue: shared-with-me,
        reminders, shift alerts, things you specifically need to acknowledge.
        The Lab Inbox is the lab&apos;s ambient chatter: a place to drop a
        comment without summoning the recipient with a hard ping. The two
        intentionally do not duplicate each other.
      </p>
      <p>
        See{" "}
        <Link href="/wiki/features/notifications">Notifications and Inbox</Link>{" "}
        for the bell, the Telegram image inbox, and the calendar reminders
        that live in the personal queue.
      </p>

      <Callout variant="info" title="Cross-owner read access">
        Comments are visible to everyone with read access to the host record,
        not just the record&apos;s owner. So if a Lab Head reads a member&apos;s
        task and leaves a comment, the next time another member with read
        access (via sharing) opens that task, they see the comment in
        context. The inbox is the cross-record version of that same surface.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link> covers
          threading, mentions, and the in-place source-record popup.
        </li>
        <li>
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>{" "}
          covers posting, pinning, edit-session unlock, and the audit trail.
        </li>
        <li>
          For the Lab Overview surface that hosts the Lab Inbox Tool, see{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
