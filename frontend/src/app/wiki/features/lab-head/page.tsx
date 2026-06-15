import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadFeaturePage() {
  return (
    <WikiPage
      title="PI (Principal Investigator)"
      intro="A PI is a per-user role. It is an account flagged with account_type === 'lab_head' that gains a small superset of affordances over a regular member. PI is not a separate user pool, it is a property on a normal account. One or more lab members fill this role. The role unlocks the Lab Overview surface, the Approvals queue, the People page, the audit trail, the announcement composer, and the user-archiving controls."
    >
      {/* TODO screenshot agent: capture the login picker with a PI badge + sort-to-top.
          Route: / (login picker)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: two accounts in fixture, one tagged lab_head with the badge visible and
                 sorted to the top of the picker list
          Save to: frontend/public/wiki/screenshots/lab-head-login-picker.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-login-picker.png"
        alt="The user-picker showing two accounts, the PI pinned at the top with a small badge next to their avatar."
        caption="The PI is pinned to the top of the user picker and carries a small role badge."
      />

      <h2>What a PI actually is</h2>
      <p>
        The role is a single flag on a user&apos;s metadata. That flag is{" "}
        <code>account_type</code>, with values <code>&quot;member&quot;</code>{" "}
        (the default) or <code>&quot;lab_head&quot;</code>. A lab folder can
        have one or more accounts flagged as PI, and co-PI labs set the flag
        on every PI. A PI is otherwise a normal account, with their own
        projects, tasks, and notes. The role does not replace any of that.
        It adds a layer of cross-lab affordances on top.
      </p>

      <h2>PI-only surfaces</h2>
      <p>
        A lab head has access to several surfaces that are not visible to
        members.
      </p>
      <ul>
        <li>
          <strong>Lab Overview at <code>/lab-overview</code>.</strong> The
          PI&apos;s landing page. Includes the{" "}
          <strong>What needs you</strong> hero (amber count tiles for pending
          approvals, flagged records, overdue tasks, and @-mentions), the lab
          stat strip, the announcement composer, the lab activity feed, and the
          People snapshot. See{" "}
          <Link href="/wiki/features/lab-overview">Lab Overview</Link>.
        </li>
        <li>
          <strong>Approvals at <code>/approvals</code>.</strong> A unified
          queue of pending purchase approvals and flagged records. Accessible
          from the Lab Overview hero tiles or directly by URL. PI-only; a
          non-PI loading this URL is redirected home.
        </li>
        <li>
          <strong>People at <code>/people</code>.</strong> The full lab roster
          with workload, IDP, and member management. The People snapshot on the
          Lab Overview links here.
        </li>
        <li>
          <strong>Browse lab experiments and Browse lab notes.</strong> Cross-lab
          views of every member&apos;s experiments and notes. See{" "}
          <Link href="/wiki/features/lab-experiments">
            Browse lab experiments
          </Link>{" "}
          and{" "}
          <Link href="/wiki/features/lab-notes">Browse lab notes</Link>.
        </li>
        <li>
          <strong>Audit trail.</strong> Opened from the{" "}
          <strong>Audit trail</strong> button on the Lab Overview header.
          Shows per-field edit history across member records. See{" "}
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>.
        </li>
      </ul>

      <h2>The six phases of the PI feature</h2>
      <p>
        The PI role shipped in six tracked phases, with a capability revamp
        that landed in June 2026.
      </p>
      <ol>
        <li>
          <strong>Account type and comment attribution.</strong> Introduced{" "}
          <code>account_type</code>, the picker badge, and the &quot;posted
          by PI&quot; styling on comment rows.
        </li>
        <li>
          <strong>Comment threading and @-mentions.</strong> Built out the
          comment surface across tasks, notes, and purchases, with one-level
          threading and the denormalized mentions index. See{" "}
          <Link href="/wiki/features/lab-inbox/comments">Comments</Link>.
        </li>
        <li>
          <strong>Soft-write actions.</strong> Purchase approval, task
          assignment, and flag-for-review affordances. See{" "}
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>.
        </li>
        <li>
          <strong>Cross-lab metrics.</strong> Member workload, recent activity,
          burn rate. The data feeds the Lab Overview page.
        </li>
        <li>
          <strong>Audit log.</strong> Every soft-write field change appends to{" "}
          <code>_pi_audit.json</code>. The per-record confirm dialog (no
          password, no timer) replaced an older password gate in June 2026.
          See{" "}
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            Edit as lab head
          </Link>{" "}
          and{" "}
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>.
        </li>
        <li>
          <strong>User archiving.</strong> Remove a former member from active
          views while preserving their data. See{" "}
          <Link href="/wiki/getting-started/user-archiving">User archiving</Link>.
        </li>
      </ol>

      <h2>Picker badge and sort-to-top</h2>
      <p>
        On the user picker, the PI shows up with a small badge and is pinned
        to the top of the list regardless of which account is set as the main
        user. This makes it easy to find the PI account on a shared lab
        laptop. The badge is also visible on comment rows so members can tell
        when feedback is coming from the PI versus another member.
      </p>

      <Callout variant="info" title="PI implicit view-all">
        A PI has implicit read access to every record in the lab, regardless
        of <code>shared_with</code>. The permission system still respects
        explicit sharing arrays for writes, but for reads the PI sees
        everything. That is what makes the Lab Overview dashboards possible.
        See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the rule precedence.
      </Callout>

      <h2>When to use it</h2>
      <p>
        Set one account as the PI in these cases.
      </p>
      <ul>
        <li>
          Your lab has more than two or three people and you want a single
          person triaging purchases instead of everyone approving their own.
        </li>
        <li>
          You need a forensic trail of who approved what and who changed which
          field on which record.
        </li>
        <li>
          You want the curated Lab Overview with the What needs you hero,
          the stat strip, and the People snapshot instead of only your own
          home page.
        </li>
      </ul>
      <p>
        Skip the PI (every account stays <code>&quot;member&quot;</code>)
        in these cases.
      </p>
      <ul>
        <li>
          The lab is a single person, or two people who trust each other to
          manage their own purchases.
        </li>
        <li>
          You do not need the audit log or the approval queue.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>{" "}
          walks the approval queue, task assignment, and flag-for-review.
        </li>
        <li>
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            Edit as lab head
          </Link>{" "}
          covers the per-record confirm-once gate.
        </li>
        <li>
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>{" "}
          covers <code>_pi_audit.json</code> and the trail viewer.
        </li>
        <li>
          The <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
          dashboard is gated on the PI role.
        </li>
      </ul>
    </WikiPage>
  );
}
