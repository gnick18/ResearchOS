import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SharingAndPermissionsPage() {
  return (
    <WikiPage
      title="Sharing and permissions"
      intro="Every record in ResearchOS (a method, a note, a task, a project) carries a single sharing field: shared_with, a string array of usernames. That one field plus a sentinel value for 'the whole lab' is the entire permission story. Two primitives, canRead and canWrite, build on top of it. Lab Heads have implicit view-all on top of that. This page is the canonical reference for how the model works."
    >
      {/* TODO screenshot agent: capture a Method share dialog showing the share_with list.
          Route: open a method popup, click the share affordance
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: any user fixture; share dialog mounted with one explicit username chip
                 and the All Lab Users sentinel as a separate option
          Save to: frontend/public/wiki/screenshots/sharing-method-share-dialog.png
      */}
      <Screenshot
        src="/wiki/screenshots/sharing-method-share-dialog.png"
        alt="A share dialog over a method popup, showing a list of usernames already in shared_with plus the All Lab Users sentinel option."
        caption="The share dialog. Add explicit usernames, or pick All Lab Users to set the whole-lab sentinel."
      />

      <h2>The shared_with array</h2>
      <p>
        Every shareable record carries a field:
      </p>
      <pre className="text-sm bg-gray-100 rounded p-3 overflow-x-auto">
        <code>{`shared_with: string[]   // array of usernames`}</code>
      </pre>
      <p>
        The array is the union of every user who can read this record beyond
        its owner. An empty array means &quot;private to me&quot;, the owner
        is implicit and never appears in their own list. Adding a username
        grants that user read access. Removing them revokes it.
      </p>

      <h2>The WHOLE_LAB_SENTINEL</h2>
      <p>
        A special string, the constant <code>WHOLE_LAB_SENTINEL</code> with
        the value <code>&quot;*&quot;</code>, can appear in the array
        anywhere a username can. It means &quot;every user in the lab folder,
        present and future.&quot; When you click <strong>Share with All
        Lab Users</strong> in any share dialog, the affordance pushes{" "}
        <code>&quot;*&quot;</code> onto <code>shared_with</code> rather than
        enumerating every current username (which would silently exclude
        anyone who joins the lab later).
      </p>
      <p>
        The sentinel is comparable to a Unix <code>everyone</code> group:
        one entry that expands to the current member set at read time. It is
        not stored as a list of names, so adding or archiving a member does
        not require a sweep across every record to keep the lists in sync.
      </p>

      <h2>The two primitives: canRead and canWrite</h2>
      <p>
        Every permission decision in the app comes down to one of two
        functions:
      </p>
      <ul>
        <li>
          <strong>canRead(record, user)</strong>: returns true if{" "}
          <em>user</em> is the owner, or appears in{" "}
          <code>record.shared_with</code>, or the array contains{" "}
          <code>WHOLE_LAB_SENTINEL</code>, or <em>user</em> is a Lab Head.
        </li>
        <li>
          <strong>canWrite(record, user)</strong>: returns true if{" "}
          <em>user</em> is the owner, or appears in{" "}
          <code>record.shared_with</code> with edit permission, or (for
          structured-method types) was the original creator. Lab Heads do
          not get implicit write, only implicit read.
        </li>
      </ul>
      <p>
        Both functions are pure: same input, same output, no side effects.
        They are also synchronous, so every render and every save can call
        them without async ceremony.
      </p>

      <h2>The Lab Head implicit view-all</h2>
      <p>
        A user whose <code>account_type === &quot;lab_head&quot;</code> gets
        an extra rule on the read side only: they can <code>canRead</code>{" "}
        every record in the lab regardless of <code>shared_with</code>. The
        Lab Overview cross-lab dashboards depend on this rule: the member
        workload widget has to be able to read every member&apos;s active
        tasks even when those tasks are private to the member.
      </p>
      <p>
        The implicit view-all does not extend to writes. A Lab Head reading
        a member&apos;s private note can leave a comment (since comments
        respect read access) but cannot edit the note body. See{" "}
        <Link href="/wiki/features/lab-head">Lab Head</Link> for the broader
        role.
      </p>

      <Callout variant="info" title="Migrating from Lab Mode">
        ResearchOS used to ship with a special &ldquo;Lab Mode&rdquo;
        account that held shared records on behalf of the whole lab. That
        mode has been retired in favor of per-user accounts plus the{" "}
        <code>shared_with</code> sharing primitive described above;
        pre-retirement folders auto-migrate on first login. No user action
        is required, and no Settings button needs to be clicked: the
        rewrite runs in the background and is idempotent on repeat logins.
      </Callout>

      <h2>Granularity: what is shareable</h2>
      <p>
        Sharing is per-record:
      </p>
      <ul>
        <li>
          <strong>Methods</strong> can be shared with the whole lab or with
          specific users. Public-sharing a method makes it readable across
          libraries; the structured-method editor still gates writes on
          <code>canWrite</code>, which usually keeps edits to the original
          creator. See{" "}
          <Link href="/wiki/features/methods">Methods Library</Link>.
        </li>
        <li>
          <strong>Projects</strong> share the project itself plus every task
          under it. The dialog offers view-only or edit permission. The
          owner&apos;s Home page is the source of truth; the receiver sees a
          live read of the owner&apos;s data.
        </li>
        <li>
          <strong>Tasks</strong> can be shared one at a time when you want a
          single experiment visible without sharing the whole project.
        </li>
        <li>
          <strong>Notes</strong> can be shared the same way.
        </li>
      </ul>

      <h2>Cross-link map</h2>
      <p>
        Pages elsewhere in the wiki that touch sharing decisions:
      </p>
      <ul>
        <li>
          <Link href="/wiki/features/methods">Methods Library</Link> covers
          method-level sharing UI.
        </li>
        <li>
          <Link href="/wiki/features/home">Home and Projects</Link> covers
          project-level sharing and the receiver&apos;s view.
        </li>
        <li>
          <Link href="/wiki/features/experiments">The Workbench</Link>{" "}
          covers task-level sharing.
        </li>
        <li>
          <Link href="/wiki/features/lab-head">Lab Head</Link> covers the
          implicit view-all rule.
        </li>
        <li>
          <Link href="/wiki/security">Security</Link> covers what the gate
          actually protects against (and what it does not).
        </li>
      </ul>
    </WikiPage>
  );
}
