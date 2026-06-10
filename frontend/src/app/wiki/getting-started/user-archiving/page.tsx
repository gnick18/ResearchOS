import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function UserArchivingPage() {
  return (
    <WikiPage
      title="User archiving"
      intro="When a lab member leaves (graduates, rotates out, switches projects), archiving their account is the right move. Archiving hides them from active views but keeps every byte of their data on disk and in the lab's history. They drop out of the login picker, the member-workload chart, and the pickers you use to assign new work. The records they already wrote stay readable to anyone with permission."
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
        Only a lab head can archive a member. Open{" "}
        <strong>Settings</strong> &rarr; <strong>Lab Mode tab</strong> and the{" "}
        <strong>Lab Roster</strong> section lists every member. Hover any
        row to reveal an <strong>Archive</strong> button on the right (you
        can also right-click a row for the same action). There is no password
        and no edit session to unlock anymore, being a lab head is enough.
        Clicking Archive opens a short confirmation dialog so you do not
        archive someone by accident, and that is the only gate.
      </p>

      <h2>What happens on archive</h2>
      <p>
        One archive is a single action that does a few things at once.
      </p>
      <ol>
        <li>
          Stamps the member&apos;s onboarding sidecar as archived, with the
          time and the lab head who did it.
        </li>
        <li>
          Hides the member from the login picker by default (see filter
          control below).
        </li>
        <li>
          Drops the member from the active-member list on the Lab
          Overview, so the workload view counts active people first (an
          archived member only resurfaces when you drill into their row
          to restore them).
        </li>
        <li>
          Filters them out of the @mention picker, the share dialog, and
          the assignee dropdown, so you do not assign new work to someone
          who left.
        </li>
        <li>
          Keeps their records (tasks, notes, purchases) readable to anyone
          who already had access. No permissions are stripped, and the
          comments and announcements they already wrote stay exactly where
          they are.
        </li>
        <li>
          Writes an entry to the{" "}
          <Link href="/wiki/features/lab-head/audit-log">audit log</Link>{" "}
          recording the actor, the target, and the timestamp. A restore
          writes a matching entry.
        </li>
      </ol>

      <h2>Bringing an archived member back</h2>
      <p>
        Archived members do not disappear from the Lab Roster. They sit at
        the bottom of the same table in a muted style with an{" "}
        <strong>Archived</strong> badge, and the row shows a{" "}
        <strong>Restore</strong> button where active rows show Archive. One
        click (after the same confirmation dialog) brings them back on every
        surface as if they never left, and the audit log records the restore.
      </p>
      <p>
        The login picker is the one place archived members are hidden by
        default. When a lab has archived accounts, a small{" "}
        <strong>Show archived</strong> link appears below the account grid.
        Click it to reveal former members so you can sign in as one of them
        to check their work.
      </p>

      <Callout variant="info" title="The 'who archived me' question">
        Members never see an &quot;archived&quot; banner on their own account.
        If a lab head archives someone who later signs back in, that person
        signs in normally and sees their data as they left it. Only the
        shared lab surfaces stop including them. The audit log is the source
        of truth for &quot;why am I not showing up in the workload widget,&quot;
        and the lab head can read it from the member&apos;s record.
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
          year. Archive now, unarchive when they return.
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
