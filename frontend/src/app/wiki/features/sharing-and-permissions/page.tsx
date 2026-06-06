import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SharingAndPermissionsPage() {
  return (
    <WikiPage
      title="Sharing and permissions"
      intro="Every shareable record in ResearchOS (a method, a note, a task, a project, a high-level goal) carries one sharing field: shared_with, an array of small objects pairing a username with a permission level. That field plus a single sentinel value for 'the whole lab' is the entire permission story. Two primitives, canRead and canWrite, build on top of it. PIs get an implicit view-all on the read side. This page is the canonical reference for how the model works."
    >
      {/* TODO screenshot agent: capture a Method share dialog showing the shared_with list.
          Route: open a method popup, click the share affordance
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: any user fixture; share dialog mounted with one explicit username chip
                 plus the whole-lab toggle
          Save to: frontend/public/wiki/screenshots/sharing-method-share-dialog.png
      */}
      <Screenshot
        src="/wiki/screenshots/sharing-method-share-dialog.png"
        alt="The In your lab tab of the share dialog over a method popup, showing recipient rows each with a read/edit toggle, plus a Share with the whole lab toggle below."
        caption="The In your lab tab of the share dialog. Each recipient has its own read or edit toggle, and a Share with the whole lab toggle covers present and future members at read-only by default."
      />

      <h2>The shared_with array</h2>
      <p>
        Every shareable record carries a field whose TypeScript signature
        is:
      </p>
      <pre className="text-body bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`type SharedUser = {
  username: string;
  level: "read" | "edit";
};

shared_with: SharedUser[];`}</code>
      </pre>
      <p>
        Each entry pairs a recipient with the level of access they get on
        this record. An empty array means &quot;private to me&quot;: the
        owner is implicit and never appears in their own list. Adding an
        entry grants that user the chosen level. Removing the entry revokes
        access entirely. The shape lives in
        {" "}<code>frontend/src/lib/sharing/unified.ts</code>, which is also
        where the read and write helpers documented below are defined.
      </p>
      <p>
        Inspecting your JSON folder, you will see the objects on disk. A
        method shared with two members at different levels looks like:
      </p>
      <pre className="text-body bg-surface-sunken rounded p-3 overflow-x-auto">
        <code>{`"shared_with": [
  { "username": "alex",   "level": "read" },
  { "username": "morgan", "level": "edit" }
]`}</code>
      </pre>

      <Callout variant="info" title="Older records with permission: view | edit">
        Pre-R1 records (and older share-API callers) used a{" "}
        <code>permission</code> field with values <code>&quot;view&quot;</code>
        {" "}or <code>&quot;edit&quot;</code> instead of <code>level</code>.
        The reader (<code>normalizeSharedWith</code> in{" "}
        <code>lib/sharing/unified.ts</code>) accepts both shapes so the rest
        of the app only ever sees the unified <code>level</code> field
        (<code>&quot;view&quot;</code> maps to <code>&quot;read&quot;</code>;
        unknown values fall back to <code>&quot;read&quot;</code>, the
        conservative default). Records still on the legacy shape get
        rewritten to <code>level</code> on next save. New code always writes
        <code>level</code>.
      </Callout>

      <h2>The WHOLE_LAB_SENTINEL</h2>
      <p>
        A reserved username, the constant{" "}
        <code>WHOLE_LAB_SENTINEL</code> with the value{" "}
        <code>&quot;*&quot;</code>, can appear in any entry where a real
        username would. It means &quot;every user in this lab folder,
        present and future.&quot; When you flip the{" "}
        <strong>Share with the whole lab</strong> toggle in the{" "}
        <em>In your lab</em> tab of any share dialog, the affordance writes one
        entry, <code>{`{ username: "*", level: "read" }`}</code>, rather
        than enumerating every current member (which would silently exclude
        anyone who joins later). Whole-lab shares default to{" "}
        <strong>read-only</strong>. Bump that one entry to{" "}
        <code>level: &quot;edit&quot;</code> the same way you would any other
        recipient row if you want the whole lab to be able to edit.
      </p>
      <p>
        The sentinel is comparable to a Unix <code>everyone</code> group:
        one entry that expands to the current member set at read time. The
        backing list is not stored, so adding or archiving a lab member
        never requires a sweep across every record to keep things in sync.
      </p>

      <h2>The two primitives: canRead and canWrite</h2>
      <p>
        Every permission decision in the app routes through one of two
        pure, synchronous functions:
      </p>
      <ul>
        <li>
          <strong>canRead(record, viewer)</strong>: true if the viewer is
          the owner, OR the viewer&apos;s account_type is{" "}
          <code>lab_head</code> (implicit view-all), OR{" "}
          <code>record.shared_with</code> has an entry whose{" "}
          <code>username</code> matches the viewer OR is{" "}
          <code>WHOLE_LAB_SENTINEL</code>.
        </li>
        <li>
          <strong>canWrite(record, viewer, session)</strong>: true if the
          viewer is the owner, OR the viewer is a PI AND the
          edit-session is currently unlocked for the record&apos;s owner
          (the Phase 5 passcode flow, see{" "}
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            PI edit session
          </Link>
          ), OR <code>record.shared_with</code> has an entry whose{" "}
          <code>username</code> matches (or is <code>&quot;*&quot;</code>){" "}
          AND the entry&apos;s <code>level</code> is{" "}
          <code>&quot;edit&quot;</code>.
        </li>
      </ul>
      <p>
        Both functions are pure: same input, same output, no I/O. They are
        synchronous, so every render and every save can call them without
        async ceremony.
      </p>

      <h2>The PI implicit view-all</h2>
      <p>
        A user whose <code>account_type === &quot;lab_head&quot;</code> gets
        an extra rule on the read side only: <code>canRead</code> returns
        true for every record in the lab regardless of{" "}
        <code>shared_with</code>. The Lab Overview cross-lab dashboards
        depend on this rule: the member workload widget has to be able to
        read every member&apos;s active tasks even when those tasks are
        private to the member.
      </p>
      <p>
        The implicit view-all does not extend to writes. A PI reading
        a member&apos;s private note can leave a comment (comments respect
        read access) but cannot edit the note body unless the lab-head
        edit-session is unlocked for that member&apos;s data. See{" "}
        <Link href="/wiki/features/lab-head">PI</Link> for the broader
        role and{" "}
        <Link href="/wiki/features/lab-head/edit-session-and-password">
          edit session and password
        </Link>
        {" "}for the passcode-gated write path.
      </p>

      <h2>Methods auto-grant via task-share</h2>
      <p>
        One non-obvious rule sits next to <code>canRead</code>: when a user
        shares a task with you, you also get transient read access on any
        method that task references. The pure helper{" "}
        <code>canReadMethodViaTask</code> in{" "}
        <code>lib/sharing/unified.ts</code> performs the depth-1 check, and
        the read path emits a{" "}
        <code>method-transient-read</code> entry into the method
        owner&apos;s audit log so they can see who has been reading their
        protocols via task-share. So sharing a task that uses one of your
        own private methods does not silently leak the method without a
        paper trail, and a method owner can spot a viewer who only ever
        reaches the protocol through someone else&apos;s task. The grant is
        scoped to direct task-to-method references; compound-method
        children do not transitively unlock. See{" "}
        <Link href="/wiki/features/methods">Methods Library</Link> for where
        this surfaces in the protocol-reading UX.
      </p>

      <Callout variant="info" title="Migrating from Lab Mode">
        ResearchOS used to ship with a special &ldquo;Lab Mode&rdquo;
        account that held shared records on behalf of the whole lab. That
        mode has been retired in favor of per-user accounts plus the{" "}
        <code>shared_with</code> sharing primitive described above;
        pre-retirement folders auto-migrate on first login. Any old record
        that carried <code>is_public: true</code> rewrites to{" "}
        <code>{`shared_with: [{ username: "*", level: "read" }]`}</code>{" "}
        on first read. No user action is required, and no Settings button
        needs to be clicked: the rewrite runs in the background and is
        idempotent on repeat logins.
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

      <h2>When someone shares with you</h2>
      <p>
        Sharing is not silent on the receiving end. When a labmate adds you to a
        record, it shows up in your <strong>Inbox</strong> under the{" "}
        <strong>Shared with me</strong> segment, the running list of everything
        people in your folder have shared to you, newest first. The Inbox badge
        carries a count so you can tell at a glance that something new is waiting,
        and the bell-style notification surfaces the share without you having to
        go looking for it. Opening the item from the Inbox takes you straight to
        the live record in the owner&apos;s data, so what you read is always their
        current copy, edits and all. See{" "}
        <Link href="/wiki/features/notifications">Notifications</Link> for how the
        Inbox and its badge behave.
      </p>

      <h2>Hosting a labmate&apos;s task in your project</h2>
      <p>
        Sharing a task one way is read or edit access on that task. Hosting goes a
        step further: a labmate can let one of their tasks{" "}
        <strong>also appear inside your project</strong>, so the experiment lives
        in your project board alongside your own tasks without ever leaving its
        original owner&apos;s folder. The task file stays where it started (so the
        owner keeps editability), and your project keeps a small sidecar manifest
        listing every foreign task hosted into it.
      </p>
      <p>
        The link is <strong>bidirectional</strong>: the task points at your
        project and your project points back at the task, and both sides have to
        agree for the host to count. If the two ever drift apart (a task gets
        deleted, or the reference goes stale), ResearchOS{" "}
        <strong>self-heals</strong> the mismatch on read and through a background
        sweep, dropping orphaned entries so the board never shows a phantom task.
        The repair is automatic, so hosting feels seamless from both ends.
      </p>

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
          <Link href="/wiki/features/lab-head">PI</Link> covers the
          implicit view-all rule.
        </li>
        <li>
          <Link href="/wiki/features/notifications">Notifications</Link> covers
          the Inbox, the Shared with me segment, and the badge that flags a new
          share.
        </li>
        <li>
          <Link href="/wiki/security">Security</Link> covers what the gate
          actually protects against (and what it does not).
        </li>
      </ul>
    </WikiPage>
  );
}
