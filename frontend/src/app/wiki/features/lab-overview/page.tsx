import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabOverviewFeaturePage() {
  return (
    <WikiPage
      title="Lab Overview"
      intro="The Lab Overview at /lab-overview is the PI's landing page. It is a fixed, curated, action-first view of the whole lab, laid out the same way for every PI. The things that need a decision sit at the top. The ambient lab context sits below. There is nothing to configure or rearrange."
    >
      <h2>Who this page is for</h2>
      <p>
        Lab Overview is gated on the lab head (PI) account type. A PI lands
        here automatically on sign-in. Lab members and solo researchers never
        see it. They land on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link> instead. The
        two starting points answer two different questions: the Workbench asks
        &quot;what is on my plate,&quot; and Lab Overview asks &quot;what is
        the lab doing and what needs my attention.&quot;
      </p>

      <Callout variant="info" title="One fixed page, not a canvas you build">
        Lab Overview used to be a customizable widget canvas with draggable
        tiles and an add-widget palette. That is gone. The page is now a
        single curated layout that is identical for every PI. There is nothing
        to add, remove, drag, or configure.
      </Callout>

      <h2>What needs you hero</h2>
      <Screenshot
        src="/wiki/screenshots/lab-overview-needs-you-hero.png"
        alt="The What needs you section at the top of Lab Overview, showing amber and rose tiles for pending approvals, flagged records, overdue tasks, and @-mentions, each as a clickable count tile."
        caption="The What needs you hero. Each tile is a live count that links directly to where that queue lives."
      />
      <p>
        The top section of the page is titled <strong>What needs you</strong>.
        It shows up to four amber or rose count tiles, one per category of
        outstanding item.
      </p>
      <ul>
        <li>
          <strong>Approvals.</strong> Pending purchase approvals. Links to{" "}
          <code>/approvals</code>.
        </li>
        <li>
          <strong>Flagged.</strong> Records you have flagged for review that
          have not been resolved. Links to <code>/approvals</code>.
        </li>
        <li>
          <strong>Overdue.</strong> Incomplete tasks across the lab that are
          past their due date. Links to <code>/people</code>.
        </li>
        <li>
          <strong>Mentions.</strong> Comments in shared notes where you were
          @-mentioned. Links to <code>/lab-notes</code>.
        </li>
      </ul>
      <p>
        When all counts are zero the hero collapses to a single calm green
        &quot;You&apos;re all caught up&quot; line.
      </p>

      <h2>Lab stat strip</h2>
      <Screenshot
        src="/wiki/screenshots/lab-overview-stat-strip.png"
        alt="The compact stat strip below the hero, showing four cells: member count, active experiments count, open tasks count, and overdue task count, separated by vertical dividers."
        caption="The lab stat strip. Four live counts give a snapshot of the lab state without requiring any clicks."
      />
      <p>
        Immediately below the hero is a compact stat strip showing four counts
        across the whole lab.
      </p>
      <ul>
        <li>Total lab members.</li>
        <li>Active experiments (incomplete experiments across the lab).</li>
        <li>Open tasks (all incomplete tasks).</li>
        <li>Overdue tasks (incomplete tasks past their due date).</li>
      </ul>

      <h2>Post an announcement</h2>
      <Screenshot
        src="/wiki/screenshots/lab-overview-announcement-composer.png"
        alt="The Post an announcement section showing a textarea and a Post announcement button, with a Pin to top checkbox on the left."
        caption="The announcement composer. PIs type and post directly. Members see announcements in this same section in read mode."
      />
      <p>
        Below the stat strip is the announcement composer. A PI types a
        message, optionally pins it, and clicks Post. There is no password
        prompt and no timer. A member viewing the same page sees the
        published announcements in read-only mode. See{" "}
        <Link href="/wiki/features/lab-inbox/announcements">
          Announcements
        </Link>{" "}
        for the full posting, pinning, and editing flow.
      </p>

      <h2>Lab activity and People snapshot</h2>
      <p>
        The lower portion of the page uses a two-column grid on wide screens.
        The main column holds the <strong>Lab activity</strong> feed, a
        running cross-lab log of recent experiments, notes, and tasks. The
        narrower column holds a <strong>People</strong> snapshot showing
        workload across lab members, with a <strong>View all</strong> link
        to <code>/people</code> for the full roster and IDP view.
      </p>

      <h2>Audit trail and New Project</h2>
      <p>
        Two header buttons sit in the top-right of the page. The{" "}
        <strong>Audit trail</strong> button opens the{" "}
        <Link href="/wiki/features/lab-head/audit-log">AuditTrailViewer</Link>{" "}
        popup, a read-only window onto the per-field edit history a lab head
        has produced across member records. The <strong>New Project</strong>{" "}
        button opens the project creation modal directly, so a PI can start
        a new project without navigating away from the lab overview.
      </p>

      <Callout variant="info" title="Sections that are no longer on this page">
        Earlier versions of Lab Overview included a Today&apos;s events
        calendar panel, a Trainee notes and goals section, a full
        announcement-history stream, and a set of Browse link-out buttons.
        All of these have been removed. Calendar events stay on the personal
        Calendar tab. Browse lab experiments and Browse lab notes remain as
        standalone pages linked from the People page. The full member roster
        now lives at <code>/people</code>.
      </Callout>

      <h2>Where to go next</h2>
      <ul>
        <li>
          For the PI role itself, see{" "}
          <Link href="/wiki/features/lab-head">PI</Link>.
        </li>
        <li>
          For the pending-approval queue, see{" "}
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>{" "}
          and the <code>/approvals</code> page.
        </li>
        <li>
          For the People page and workload view, see the{" "}
          <Link href="/wiki/features/lab-head">PI</Link> page.
        </li>
        <li>
          Announcements are documented at{" "}
          <Link href="/wiki/features/lab-inbox/announcements">
            Announcements
          </Link>
          .
        </li>
        <li>
          For the audit trail viewer, see{" "}
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>.
        </li>
      </ul>
    </WikiPage>
  );
}
