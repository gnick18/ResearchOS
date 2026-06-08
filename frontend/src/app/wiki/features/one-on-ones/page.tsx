import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function OneOnOnesFeaturePage() {
  return (
    <WikiPage
      title="Mentoring and check-ins"
      intro="A 1:1 is a private advising workspace shared between a lab head and one member. Both people type into the same four areas (weekly goals, meeting notes, freeform notes, and a running agenda), so the record of an advising relationship lives in one place instead of scattered across emails and personal notes. It lives on its own Workbench tab, separate from your notebooks."
    >
      {/* TODO screenshot agent: capture the 1:1 surface from a lab head's view.
          Route: /workbench?tab=oneonone
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab-head account with at least two 1:1s in the left list, one
                 selected, the Weekly goals area showing a few checked + unchecked
                 goals. Left header should read "Your mentees".
          Save to: frontend/public/wiki/screenshots/one-on-ones-surface.png
      */}
      <Screenshot
        src="/wiki/screenshots/one-on-ones-surface.png"
        alt="The 1:1 surface, with a left list of the viewer's 1:1s and a main pane carrying Weekly goals, Meeting notes, Notes, and Agenda tabs."
        caption="A lab head's view. The left rail lists one row per mentee, and the main pane carries the four shared areas."
      />

      <h2>What a 1:1 is</h2>
      <p>
        A 1:1 is one shared space per lab-head and member pair. It is not a
        notebook and it does not appear in the Notes rail. It is a purpose-built
        advising workspace that both people edit, so the weekly goals you agreed
        on, the notes from your last meeting, and the agenda for the next one all
        sit together. Either person can open it and see the same thing.
      </p>
      <p>
        Each 1:1 is shared with exactly the two people in it. Everything you add
        inside is visible to both of you and to no one else (a PI&apos;s implicit
        view-all still applies, the same as everywhere else in ResearchOS). See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for how that read access works.
      </p>

      <h2>Two names for one surface</h2>
      <p>
        The label is role-relative, so it always names the other person. The same
        underlying record reads differently depending on who is looking.
      </p>
      <ul>
        <li>
          The lab head sees the <strong>Mentoring</strong> framing. The Workbench
          tab reads &quot;Mentoring&quot; and each entry is labeled by the member,
          for example &quot;Alex - Mentoring&quot;.
        </li>
        <li>
          The member sees the <strong>Check-ins</strong> framing. The tab reads
          &quot;Check-ins&quot; and each entry is labeled by the lab head, for
          example &quot;Dr. Lee - Check-ins&quot;.
        </li>
      </ul>
      <p>
        There is no fixed &quot;1:1s&quot; label anywhere in the app. The framing
        derives from your identity, so a lab head always gets Mentoring and a
        member always gets Check-ins for the same shared space.
      </p>

      <h2>The four areas</h2>
      <p>
        Every 1:1 has the same four areas, shown as sub-tabs in the main pane.
        Both people can add to and edit all four.
      </p>
      <ol>
        <li>
          <strong>Weekly goals.</strong> A per-week checklist either person can
          add to and check off. A week selector moves between weeks, so the goals
          you set in one meeting stay attached to that week. The typical flow is
          the lab head assigns and the member checks off, but both can do either.
        </li>
        <li>
          <strong>Meeting notes.</strong> A shared running log, one entry per
          meeting, with a date picker so each entry is filed under the meeting it
          belongs to. Both people type into the same log.
        </li>
        <li>
          <strong>Notes.</strong> Freeform shared notes scoped to this 1:1, for
          anything that is not a goal or a meeting note.
        </li>
        <li>
          <strong>Agenda.</strong> A running list of agenda and action items for
          the next meeting. Items carry between meetings until they are checked
          off, so nothing falls through.
        </li>
      </ol>

      <h2>Who sets it up and who sees it</h2>
      <p>
        The lab head creates a 1:1 and picks the member it is with, using the
        &quot;Start a new 1:1&quot; action on the Mentoring tab. The member then
        sees that 1:1 appear under their Check-ins tab automatically. Access is
        symmetric from that point on.
      </p>
      <p>
        The tab itself is gated so no one stares at an empty surface. A lab head
        always sees the Mentoring tab (so they can set the first one up). Everyone
        else only sees the Check-ins tab once they are actually in at least one
        1:1. A solo user with no lab head and no 1:1s never sees the tab at all.
      </p>

      <Callout variant="info" title="A 1:1 is not a shared notebook">
        These are two independent things. A{" "}
        <Link href="/wiki/features/experiments">shared notebook</Link> is a plain
        container of notes that any two or more people can share, with no weekly
        goals, meetings, or agenda. A 1:1 is the structured advising workspace
        with all four areas. A lab head and a member can have both at the same
        time, and they stay separate.
      </Callout>

      <h2>Where to find it</h2>
      <p>
        The 1:1 surface is the Mentoring (or Check-ins) tab on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, alongside
        Projects, Experiments, Notes, and Lists. If you do not see the tab, it is
        because the gate above is hiding it.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/experiments">The Workbench</Link> covers the
          other tabs the 1:1 sits next to, including shared notebooks.
        </li>
        <li>
          <Link href="/wiki/features/lab-head">PI</Link> covers the lab-head role
          that unlocks the Mentoring tab by default.
        </li>
        <li>
          <Link href="/wiki/features/sharing-and-permissions">
            Sharing and permissions
          </Link>{" "}
          explains the read and write access that backs every shared 1:1.
        </li>
      </ul>
    </WikiPage>
  );
}
