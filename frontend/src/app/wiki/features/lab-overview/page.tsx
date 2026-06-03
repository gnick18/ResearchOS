import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function LabOverviewFeaturePage() {
  return (
    <WikiPage
      title="Lab Overview"
      intro="The Lab Overview at /lab-overview is the lab head's landing page: a fixed, curated, action-first view of the whole lab. It's the same designed layout for every PI, ordered so the things that need you sit at the top. There's nothing to configure: no tiles to add, no canvas to rearrange. You open it and the lab's state is already laid out for you."
    >
      <h2>Who this page is for</h2>
      <p>
        Lab Overview is gated on the lab head (PI) account type. A PI lands
        here automatically on sign-in. Lab members and solo researchers never
        see it: they land on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> instead, which
        opens on their projects. So the two starting points answer two
        different questions. The Workbench asks &quot;what's on my plate,&quot;
        and Lab Overview asks &quot;what is the lab doing right now and what
        needs my attention.&quot;
      </p>
      <Callout variant="info" title="One fixed page, not a dashboard you build">
        Lab Overview used to be a customizable widget canvas: a grid of
        draggable tiles, an add-widget palette, a configurable sidebar rail.
        That's gone. The page is now a single curated layout that's the same
        for every PI. You can't add, remove, drag, or reset anything, because
        there's nothing to arrange. The design does the curating for you.
      </Callout>

      <h2>How the page is laid out</h2>
      <p>
        The sections run top to bottom in a deliberate, action-first order, so
        the things that need a decision from you sit above the fold and the
        ambient lab context sits below.
      </p>
      <ul>
        <li>
          <strong>Pending approvals bar.</strong> A compact row at the very top
          that summarizes what's waiting on you: purchase approvals, the flag
          queue, and unread @-mentions. Each segment links straight to the
          surface that resolves it. When nothing is pending, the bar collapses
          to a thin &quot;you're all caught up&quot; line, so a clear queue
          reads as clear at a glance.
        </li>
        <li>
          <strong>Browse link-outs.</strong> Two buttons (&quot;Browse lab
          experiments&quot; and &quot;Browse lab notes&quot;) that drop you
          into the lab-wide view of the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link>.
        </li>
        <li>
          <strong>Announcements.</strong> The lab-wide announcement stream from
          the <Link href="/wiki/features/lab-inbox">Lab Inbox</Link>, posted
          inline so the latest notices are visible without leaving the page.
        </li>
        <li>
          <strong>Lab activity.</strong> The centerpiece feed: a running log of
          what members have been doing across the lab (saves, completions, new
          experiments, and the like).
        </li>
        <li>
          <strong>Today's events.</strong> A right-rail panel showing today's
          calendar events, drawn from the same{" "}
          <Link href="/wiki/features/calendar">Calendar</Link> the rest of the
          app uses.
        </li>
        <li>
          <strong>Member workload.</strong> A right-rail panel rolling up how
          much each member currently has on their plate, so you can spot who's
          overloaded and who has room.
        </li>
        <li>
          <strong>Trainee notes &amp; goals.</strong> An expandable section at
          the bottom for the per-member notes and goals a PI keeps on their
          trainees.
        </li>
      </ul>
      <p>
        On a wide screen the lab-activity feed sits in the main column with
        Today's events and Member workload stacked in a right rail beside it.
        On a narrow screen the rail drops below the feed. That's the only thing
        about the layout that changes, and it changes for you, based on screen
        width, not by configuration.
      </p>

      <Callout variant="info" title="Comments on your work">
        Mentions and comments on a PI's own work surface through the pending
        approvals bar (the unread @-mentions segment) and resolve on the{" "}
        <Link href="/wiki/features/lab-inbox">Lab Inbox</Link>. There's no
        separate comments tile to pin anymore. The bar tells you there's
        something to read and links you to it.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          For the PI role itself (the account type that gates this whole page),
          see <Link href="/wiki/features/lab-head">PI</Link>.
        </li>
        <li>
          For where members and solo researchers land instead, see{" "}
          <Link href="/wiki/features/home">Where you land</Link> and the{" "}
          <Link href="/wiki/features/experiments">Workbench</Link>.
        </li>
        <li>
          The announcements, comments, and @-mention streams live on the{" "}
          <Link href="/wiki/features/lab-inbox">Lab Inbox</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
