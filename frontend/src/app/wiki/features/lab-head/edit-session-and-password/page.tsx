import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabHeadEditSessionPage() {
  return (
    <WikiPage
      title="Edit session and password"
      intro="A PI's cross-member soft-write actions (approve a purchase, archive a user, assign a task, flag a record) are gated by a short edit session. You unlock the session once with the PI password, get a 5-minute window during which the affordances become active, and the session auto-expires after. Posting a lab announcement is the one PI action that's exempt: once logged in, a PI posts it directly. This page covers the unlock flow and why the gate exists."
    >
      {/* TODO screenshot agent: capture the Request Edit password dialog open.
          Route: /lab-overview (any soft-write affordance clicked while session is locked)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: lab_head fixture, session locked; password dialog mounted with focus on input
          Save to: frontend/public/wiki/screenshots/lab-head-edit-session-prompt.png
      */}
      <Screenshot
        src="/wiki/screenshots/lab-head-edit-session-prompt.png"
        alt="The Request Edit password dialog with a single password input, an Unlock button, and a remaining-time hint at the bottom."
        caption="The Request Edit dialog. Type the PI password, get a 5-minute session, the soft-write affordances unlock."
      />

      <h2>Why the gate exists</h2>
      <p>
        Soft-write actions are different from a regular edit. A purchase
        approval or a user archive is a lab-wide signal that other people
        will act on (the member sees their purchase approved and orders it,
        an archived member drops out of everyone&apos;s views). An accidental
        click on the wrong button can have real consequences. The
        edit-session pattern adds a deliberate step that interrupts an
        absent-minded press and forces a moment of intent.
      </p>
      <p>
        The model is the same as elevating to admin on a normal OS: the
        password proves intent, not identity. Anyone with the file system
        already has access to your data folder (see{" "}
        <Link href="/wiki/security">Security</Link>); the gate is about
        catching a misclick, not about defending against an adversary.
      </p>

      <h2>Setting the PI password</h2>
      <p>
        A PI account always has a password. Unlike a regular member, where a
        password is optional, a PI is required to set an account password
        during account setup, and that password is enforced at login. So
        there is never a PI account with no password behind it. See{" "}
        <Link href="/wiki/getting-started/creating-a-user">Creating a user</Link>.
      </p>
      <p>
        The edit-session gate reuses that account password on its first
        unlock, so you do not have to invent a second secret to get started.
        The two stay identical until you change one of them: change the PI
        edit password from Settings, or change your account sign-in password,
        and from that point the two diverge. Keeping them separable lets you
        give the edit gate a stronger or different secret than your everyday
        sign-in if you want the two to be orthogonal.
      </p>

      <h2>Unlocking a session</h2>
      <p>
        Any locked soft-write affordance shows a <strong>Request Edit</strong>{" "}
        button (or, on inline affordances, the action itself prompts on
        click). The unlock flow is:
      </p>
      <ol>
        <li>Click <strong>Request Edit</strong>.</li>
        <li>
          Type the PI password in the dialog. On success, the dialog
          closes and a 5-minute countdown starts.
        </li>
        <li>
          The affordances unlock for the duration of the session. Approve a
          purchase, assign a task, flag a record, archive a member, all
          without re-prompting.
        </li>
        <li>
          The session timer is visible in the Lab Overview header so you
          always know how long you have left.
        </li>
      </ol>

      <h2>Session timeout</h2>
      <p>
        After 5 minutes of inactivity (no soft-write actions) the session
        auto-locks. Any open dialog stays mounted but the action buttons
        re-disable, so an in-progress edit is not destroyed mid-keystroke,
        you just have to unlock again to commit. Each soft-write also extends
        the timer to the full 5 minutes, so a busy approval queue does not
        time out on you mid-pass.
      </p>
      <p>
        You can also lock the session manually from the header (a small lock
        icon next to the timer). Useful when you are stepping away from a
        shared lab laptop and want to make sure the next person to sit down
        does not have your edit window open.
      </p>

      <Callout variant="info" title="Forgot the edit-session password?">
        The edit-session secret lives at{" "}
        <code>users/&lt;pi-username&gt;/_lab_head_auth.json</code>. Delete it
        from Finder or Explorer and the next soft-write affordance falls back
        to your account password again, then reseeds from there on the next
        unlock. Your data is untouched. As with the account password, this is
        a deterrent on a shared machine, not encryption.
      </Callout>

      <h2>Other soft-write affordances that use the same session</h2>
      <p>
        The same 5-minute session covers every PI soft-write that touches a
        member&apos;s record:
      </p>
      <ul>
        <li>
          <strong>Purchase approval / decline.</strong> See{" "}
          <Link href="/wiki/features/purchases">Purchases</Link>.
        </li>
        <li>
          <strong>Task assignment.</strong> Assigning a member to a task
          you are looking at.
        </li>
        <li>
          <strong>Flag for review.</strong> Across tasks, notes, and
          purchases.
        </li>
        <li>
          <strong>User archive / unarchive.</strong> See{" "}
          <Link href="/wiki/getting-started/user-archiving">User archiving</Link>.
        </li>
      </ul>
      <p>
        Posting an announcement is the exception. It touches no member&apos;s
        record, so a logged-in PI posts it directly with no edit-session
        unlock. Because there&apos;s no session behind it, an announcement
        doesn&apos;t write an audit row either, the post stays attributed to its
        author and members are notified the usual way. See{" "}
        <Link href="/wiki/features/lab-inbox/announcements">
          Announcements
        </Link>.
      </p>
      <p>
        Every one of the soft-write actions above writes a row to{" "}
        <code>_pi_audit.json</code>. The audit happens whether or not you
        unlocked the session by manual prompt or by an earlier action within
        the 5-minute window, so the trail is complete. See{" "}
        <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>.
      </p>
    </WikiPage>
  );
}
