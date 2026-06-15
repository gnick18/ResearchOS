import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function LabInboxFeaturePage() {
  return (
    <WikiPage
      title="Lab Inbox"
      intro="The /lab-inbox URL is a redirect to /lab-overview. There is no separate Lab Inbox popup or tool. Comments and @-mentions surface inside the record popups where they were posted, and lab-wide announcements from the PI appear in the Announcements section of the Lab Overview page."
    >
      <h2>Where comments appear</h2>
      <p>
        Comments are attached to the record they were written on, not gathered
        into a shared inbox view. Open a task, note, or purchase and the
        comments rail opens on the right side of the popup. The PI badge, the
        author name, and the full thread all appear in context next to the
        record body. See{" "}
        <Link href="/wiki/features/lab-inbox/comments">Comments</Link> for
        threading rules, @-mention behavior, and how to open the rail.
      </p>

      <h2>Where @-mentions appear</h2>
      <p>
        When someone @-mentions you in a comment, the mention pushes a
        notification to your bell. On the Lab Overview, the{" "}
        <strong>What needs you</strong> hero shows a count of unread @-mentions
        and links you to the notes surface so you can find the relevant
        records. The mention is always readable in context by opening the
        record the comment is on.
      </p>

      <h2>Where announcements appear</h2>
      <p>
        Lab-wide announcements from the PI live on the Lab Overview page in
        the <strong>Post an announcement</strong> section. PIs compose and post
        directly from that card. Members see the announcement stream when they
        visit the Lab Overview or when an announcement notification lands in
        their bell. See{" "}
        <Link href="/wiki/features/lab-inbox/announcements">
          Announcements
        </Link>{" "}
        for the full posting, pinning, and edit flow.
      </p>

      <Callout variant="info" title="The /lab-inbox URL is a redirect">
        Any bookmark, notification deep-link, or external URL pointing to{" "}
        <code>/lab-inbox</code> automatically redirects to{" "}
        <code>/lab-overview</code>. The route was renamed when the surface grew
        beyond a simple inbox into the full lab command center.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link> covers
          threading, mentions, and the in-record rail.
        </li>
        <li>
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>{" "}
          covers posting, pinning, and editing.
        </li>
        <li>
          <Link href="/wiki/features/lab-overview">Lab Overview</Link> is where
          both surfaces live on the PI&apos;s landing page.
        </li>
      </ul>
    </WikiPage>
  );
}
