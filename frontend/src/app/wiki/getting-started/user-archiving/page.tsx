import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function UserArchivingPage() {
  return (
    <WikiPage
      title="User archiving"
      intro="When a lab member leaves (graduates, rotates out, switches projects), archiving their account is the right move. Archiving hides them from active views but keeps every byte of their data on disk and in the lab's history. They drop out of the login picker, member workload, and lab activity feeds; the records they wrote stay readable to anyone with permission."
    >
      {/* TODO screenshot agent: capture the LabRoster in Settings with the Archive action on a row.
          Route: /settings (Lab Mode tab, LabRoster section)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture in active edit session; roster shows 3 active members
                 with hover state on one row exposing the Archive button
          Save to: frontend/public/wiki/screenshots/user-archiving-roster.png
      */}
      <Screenshot
        src="/wiki/screenshots/user-archiving-roster.png"
        alt="The LabRoster table in Settings with three members listed and an Archive button revealed on hover for one of the rows."
        caption="The LabRoster in Settings, Lab Mode tab. Hover a member row to surface the Archive action."
      />

      <h2>Archive vs. delete</h2>
      <p>
        These two paths do different jobs.
      </p>
      <ul>
        <li>
          <strong>Archive</strong> hides the user from active surfaces while
          preserving their on-disk data. Tasks they own, notes they wrote,
          purchases they logged, all stay where they are. Anyone with read
          access still sees them. The archived user just stops appearing in
          the picker, the member workload widget, and the active member roster.
        </li>
        <li>
          <strong>Delete</strong> removes the user&apos;s folder from disk
          entirely. Their data goes with them. The delete affordance lives
          on the user picker (a trash icon on each row, documented in{" "}
          <Link href="/wiki/getting-started/creating-a-user">
            Creating a user
          </Link>) and is the right tool only when you genuinely want the
          data gone (a test account, a duplicate).
        </li>
      </ul>
      <p>
        Archive is reversible. Unarchive a member and they reappear on every
        surface as if they never left. Delete is permanent (modulo any
        archive ZIP you chose to download at delete time).
      </p>

      <h2>Where the affordance lives</h2>
      <p>
        Archiving is a PI soft-write. Open{" "}
        <strong>Settings</strong> &rarr; <strong>Lab Mode tab</strong> and the{" "}
        <strong>LabRoster</strong> section lists every member. Hover any
        row to reveal an <strong>Archive</strong> button on the right. The
        first archive in a fresh session prompts for the PI password
        (see{" "}
        <Link href="/wiki/features/lab-head/edit-session-and-password">
          Edit session and password
        </Link>); subsequent archives during the same 5-minute window run
        without re-prompting.
      </p>

      <h2>What happens on archive</h2>
      <p>
        One archive runs six steps, all in a single atomic action.
      </p>
      <ol>
        <li>
          Sets <code>archived_at</code> on the member&apos;s metadata entry.
        </li>
        <li>
          Hides the member from the user picker by default (see filter
          control below).
        </li>
        <li>
          Drops the member from member-workload, lab-activity, and
          recent-activity widgets on the Lab Overview.
        </li>
        <li>
          Keeps their records (tasks, notes, purchases) readable to anyone
          who already had access. No permissions are stripped retroactively.
        </li>
        <li>
          Keeps their comments and announcements visible in their original
          places, with an archived badge next to their name.
        </li>
        <li>
          Writes an <code>archive_user</code> row to{" "}
          <Link href="/wiki/features/lab-head/audit-log">_pi_audit.json</Link>{" "}
          recording the actor, target, and timestamp.
        </li>
      </ol>

      <h2>Bringing an archived member back</h2>
      <p>
        At the top of the LabRoster section is a{" "}
        <strong>Show archived</strong> toggle. Flip it on and archived
        members reappear in the table with a muted style and an{" "}
        <strong>Unarchive</strong> button instead of Archive. One click
        (still gated by the edit session) restores them on every surface,
        and the audit row this time is <code>unarchive_user</code>.
      </p>
      <p>
        Archived members are also filterable on the user picker. By default
        the picker hides them; a small <strong>Show archived</strong>{" "}
        checkbox at the bottom of the picker reveals them when you need to
        sign in as a former member to check their work.
      </p>

      <Callout variant="info" title="The 'who archived me' question">
        Members never see an &quot;archived&quot; banner on their own account.
        If a PI archives someone who later signs back in, that person
        signs in normally and sees their data as they left it; only the
        cross-lab surfaces stop including them. The audit log is the source
        of truth for &quot;why am I not showing up in the workload widget,&quot;
        readable by the PI from PI Actions.
      </Callout>

      <h2>When to archive</h2>
      <ul>
        <li>
          A graduate student finished and is no longer doing lab work, but
          their results and notes still need to be readable for the next
          person who picks up the project.
        </li>
        <li>
          A rotation student wrapped up and you do not want them on the
          member-workload chart for upcoming planning.
        </li>
        <li>
          An undergrad worked over the summer and is gone for the school
          year; archive now, unarchive when they return.
        </li>
      </ul>
      <p>
        The right tool for &quot;this account was a test that should not
        exist&quot; is delete, not archive. Archive is for real members
        whose work you want to keep.
      </p>
    </WikiPage>
  );
}
