import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadFeaturePage() {
  return (
    <WikiPage
      title="PI (Principal Investigator)"
      intro="A PI is a per-user role. It's an account flagged with account_type === 'lab_head' that gains a small superset of affordances over a regular member. PI is not a separate user pool, it's a property on a normal account. One or more lab members fill this role (typical labs have a single PI, but co-PI labs and shared-leadership models work too). The role unlocks the Lab Overview surface, the soft-write approval queue, the audit trail, and the user-archiving controls."
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
        have one or more accounts flagged as PI, and co-PI labs set
        the flag on every PI. A PI is otherwise a normal account, with
        their own projects, tasks, and notes. The role does not replace
        any of that, it adds a layer of cross-lab affordances on top.
      </p>
      <p>
        Picking a PI is a deliberate decision the lab makes. Usually
        the principal investigator who actually runs the lab fills the
        role, but it can be anyone, like a senior postdoc, a lab
        manager, or a designated person who triages purchases. The role does
        not assume any particular real-world title.
      </p>

      <h2>The six phases of the PI feature</h2>
      <p>
        The PI role shipped in six tracked phases. Each one added a
        capability.
      </p>
      <ol>
        <li>
          <strong>Account type + comment attribution.</strong> Introduced{" "}
          <code>account_type</code>, the picker badge, and the &quot;posted
          by PI&quot; styling on comment rows.
        </li>
        <li>
          <strong>Comment threading + @-mentions.</strong> Built out the
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
          burn rate. The dashboard data feeds the fixed, curated Lab Overview
          page.
        </li>
        <li>
          <strong>Edit-session unlock + audit log.</strong> A password-gated
          5-minute session per &quot;Request Edit&quot; affordance, with every
          soft-write writing to <code>_pi_audit.json</code>. See{" "}
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            Edit session and password
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
        On the user picker, the PI shows up with a small badge and is
        pinned to the top of the list, regardless of which account is set as
        the &quot;main user.&quot; This makes it easy to find the PI
        account on a shared lab laptop without scrolling.
      </p>
      <p>
        The badge is also visible on comment rows wherever the PI
        posted. It&apos;s a small chip next to their name so members can tell when
        feedback is coming from the PI versus from another member.
      </p>

      <Callout variant="info" title="PI implicit view-all">
        A PI has implicit read access to every record in the lab,
        regardless of <code>shared_with</code>. The permission system still
        respects the explicit sharing arrays for writes, but for reads, the
        PI sees everything. That&apos;s what makes the Lab Overview
        dashboards possible (the lab-wide member workload widget, for
        example, has to read every member&apos;s active tasks). See{" "}
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
          person triaging purchases instead of everyone approving their
          own.
        </li>
        <li>
          You need a forensic trail of who approved what (the audit log is
          gated on the PI role).
        </li>
        <li>
          You want the curated, lab-wide Lab Overview page instead of every
          member working only from their own Home page.
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
          You do not need the audit log or the approval gate.
        </li>
      </ul>

      <h2>Where to go next</h2>
      <ul>
        <li>
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            Edit session and password
          </Link>{" "}
          covers the Phase 5 unlock pattern.
        </li>
        <li>
          <Link href="/wiki/features/lab-head/soft-write-actions">
            Soft-write actions
          </Link>{" "}
          walks the approval queue, task assignment, and flag-for-review.
        </li>
        <li>
          <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>{" "}
          covers <code>_pi_audit.json</code> and how to read it.
        </li>
        <li>
          The <Link href="/wiki/features/lab-overview">Lab Overview</Link>{" "}
          dashboard surface is gated on the PI role.
        </li>
      </ul>
    </WikiPage>
  );
}
