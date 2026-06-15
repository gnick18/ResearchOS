import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function OneOnOnesFeaturePage() {
  return (
    <WikiPage
      title="Check-ins"
      intro="A check-in is a shared advising workspace between two or more people. Both people type into the same areas (weekly goals, meeting notes, freeform notes, and a running agenda), so the record of an advising relationship lives in one place instead of scattered across emails and personal notes. Check-in spaces live on their own Workbench tab, separate from your notebooks."
    >
      <Screenshot
        src="/wiki/screenshots/check-ins-new-dialog.png"
        alt="The Start a check-in dialog, with a person-picker field and a checkbox for marking yourself as the mentor in this relationship."
        caption="The Start a check-in dialog. Pick any other member and optionally mark the mentoring direction. Any account type can create a check-in space."
      />

      <h2>What a check-in space is</h2>
      <p>
        A check-in is one shared space per pair (or group). It is not a
        notebook and it does not appear in the Notes rail. It is a purpose-built
        advising workspace that all members edit, so the weekly goals you agreed
        on, the notes from your last meeting, and the agenda for the next one all
        sit together. Anyone in the space can open it and see the same thing.
      </p>
      <p>
        Each space is shared with exactly the people in it. Everything you add
        inside is visible to all of them and to no one else (a PI&apos;s implicit
        view-all still applies, the same as everywhere else in ResearchOS). See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for how that read access works.
      </p>

      <h2>The tab is always &quot;Check-ins&quot;</h2>
      <p>
        The Workbench tab reads <strong>Check-ins</strong> for every account
        type. The old role-flipped &quot;Mentoring&quot; label is retired. The
        tab is always visible regardless of how many spaces you are in, so
        starting your first space is always reachable. The empty state in the
        panel explains what a check-in is and offers a{" "}
        <strong>Start a check-in</strong> button right there.
      </p>
      <p>
        Within a pair space, the per-space entry in the left rail shows the
        other member&apos;s name. In a group space it shows the group title (if
        one is set) or a summary like &quot;Alex, Morgan +1&quot;. A soft
        relationship hint (you mentor them, they mentor you, peer) is shown
        inside the open space as a cue, not baked into the tab or rail label.
      </p>

      <h2>Who can create a check-in</h2>
      <p>
        Any account can start a check-in space. The old lab-head gate is
        retired. Click <strong>Start a check-in</strong> in the rail header (or
        in the empty state), pick the other person, and optionally tick{" "}
        <strong>I am the mentor in this relationship</strong>. The other person
        sees the space appear in their Check-ins tab automatically.
      </p>

      <h2>The core sub-tabs (all spaces)</h2>
      <p>
        Every check-in space has four shared areas, shown as sub-tabs in the
        main pane. All members can add to and edit all four.
      </p>
      <ol>
        <li>
          <strong>Weekly goals.</strong> A per-week checklist either person can
          add to and check off. A week selector moves between weeks, so the
          goals you set in one meeting stay attached to that week.
        </li>
        <li>
          <strong>Meeting notes.</strong> A shared running log, one entry per
          meeting, with a date picker so each entry is filed under the meeting
          it belongs to.
        </li>
        <li>
          <strong>Notes.</strong> Freeform shared notes scoped to this space,
          for anything that is not a goal or a meeting note.
        </li>
        <li>
          <strong>Agenda.</strong> A running list of items for the next meeting.
          Items carry between meetings until they are checked off, so nothing
          falls through.
        </li>
      </ol>

      <h2>Extra sub-tabs for mentoring pairs and groups</h2>
      <p>
        Beyond the four core tabs, additional sub-tabs appear depending on the
        space type.
      </p>
      <ul>
        <li>
          <strong>IDP</strong> (Individual Development Plan). Appears on pair
          spaces where a mentor direction is set. The trainee sees{" "}
          <em>My IDP</em>; the mentor sees a review surface. Peer pairs and
          groups have no IDP tab.
        </li>
        <li>
          <strong>Expectations.</strong> A mentoring compact (goals and
          expectations both sides agreed to). Available on all spaces, started
          on demand.
        </li>
        <li>
          <strong>Onboarding.</strong> A checklist for onboarding a new member.
          Available on all spaces, most relevant for new-member spaces.
        </li>
        <li>
          <strong>Task board.</strong> Appears on group spaces (three or more
          members). A per-assignee task view for the group.
        </li>
        <li>
          <strong>Rotation.</strong> Appears on group spaces. A presenter or
          journal-club rotation tracker. Pair spaces have no rotation tab (it
          takes three or more people to rotate).
        </li>
      </ul>

      <h2>Group spaces</h2>
      <p>
        A group space holds three or more members. It carries the same four core
        tabs as a pair space, plus the Task board and Rotation tabs described
        above. Group spaces are created the same way as pair spaces: click{" "}
        <strong>Start a check-in</strong> and pick multiple people.
      </p>

      <Callout variant="info" title="A check-in space is not a shared notebook">
        These are two independent things. A{" "}
        <Link href="/wiki/features/experiments">shared notebook</Link> is a plain
        container of notes that any two or more people can share, with no weekly
        goals, meetings, or agenda. A check-in is the structured advising
        workspace with all those areas. A lab head and a member can have both at
        the same time, and they stay separate.
      </Callout>

      <h2>Where to find it</h2>
      <p>
        The Check-ins tab is always present on the{" "}
        <Link href="/wiki/features/experiments">Workbench</Link>, alongside
        Projects, Experiments, Notes, and Lists. If you have no spaces yet, the
        tab still shows and offers the empty-state start button.
      </p>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/experiments">The Workbench</Link> covers
          the other tabs the check-ins surface sits next to, including shared
          notebooks.
        </li>
        <li>
          <Link href="/wiki/features/lab-head">PI</Link> covers the lab-head
          role and the mentoring relationship.
        </li>
        <li>
          <Link href="/wiki/features/sharing-and-permissions">
            Sharing and permissions
          </Link>{" "}
          explains the read and write access that backs every shared space.
        </li>
      </ul>
    </WikiPage>
  );
}
