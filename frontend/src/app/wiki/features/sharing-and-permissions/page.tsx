import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function SharingAndPermissionsPage() {
  return (
    <WikiPage
      title="Sharing and permissions"
      intro="Every shareable record in ResearchOS (a method, a note, a task, a project, a high-level goal) carries one sharing field, shared_with, an array of small objects pairing a username with a permission level. That field plus a single sentinel value for 'the whole lab' is the entire permission story. Two primitives, canRead and canWrite, build on top of it. PIs get an implicit view-all on the read side and write-all on the write side, gated by a once-per-session UI confirm in record popups. This page is the canonical reference for how the model works."
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
        Every shareable record carries a field. Here is its TypeScript
        signature.
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
        this record. An empty array means &quot;private to me&quot;, since the
        owner is implicit and never appears in their own list. Adding an
        entry grants that user the chosen level. Removing the entry revokes
        access entirely. The shape lives in
        {" "}<code>frontend/src/lib/sharing/unified.ts</code>, which is also
        where the read and write helpers documented below are defined.
      </p>
      <p>
        Inspecting your JSON folder, you will see the objects on disk. Here
        is a method shared with two members at different levels.
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
      <p>
        Inventory items are a special case. New inventory records are created
        with <code>{`{ username: "*", level: "edit" }`}</code> by default, so
        the whole lab can add, edit, and decrement stock out of the box. You
        can tighten this per-item by editing its sharing in the inventory popup.
      </p>

      <h2>Account types</h2>
      <p>
        The <code>account_type</code> field on a viewer drives the PI implicit
        view-all and write-all rules. The three values in the system are.
      </p>
      <ul>
        <li>
          <strong><code>&quot;solo&quot;</code></strong>. A user with no lab affiliation.
          No special privileges beyond owning their own records.
        </li>
        <li>
          <strong><code>&quot;lab&quot;</code></strong>. A lab member (not the head). Can
          read and write their own records plus anything explicitly shared with
          them.
        </li>
        <li>
          <strong><code>&quot;lab_head&quot;</code></strong>. The PI. Gets implicit
          view-all on reads and write-all on writes (see below for how the
          write-all is gated in the UI).
        </li>
      </ul>

      <h2>The two primitives: canRead and canWrite</h2>
      <p>
        Every permission decision in the app routes through one of two
        pure, synchronous functions in{" "}
        <code>lib/sharing/unified.ts</code>.
      </p>
      <ul>
        <li>
          <strong>canRead(record, viewer)</strong>: true if the viewer is
          the owner, OR the viewer&apos;s account_type is{" "}
          <code>&quot;lab_head&quot;</code> (implicit view-all), OR{" "}
          <code>record.shared_with</code> has an entry whose{" "}
          <code>username</code> matches the viewer OR is{" "}
          <code>WHOLE_LAB_SENTINEL</code>.
        </li>
        <li>
          <strong>canWrite(record, viewer)</strong>: true if the viewer is
          the owner, OR the viewer&apos;s account_type is{" "}
          <code>&quot;lab_head&quot;</code> (role-based write-all, see note
          below), OR <code>record.shared_with</code> has an entry whose{" "}
          <code>username</code> matches (or is <code>&quot;*&quot;</code>){" "}
          AND the entry&apos;s <code>level</code> is{" "}
          <code>&quot;edit&quot;</code>.
        </li>
      </ul>
      <p>
        Both functions take exactly two arguments and are pure, so the same
        input always gives the same output with no I/O. They are
        synchronous, so every render and every save can call them without
        async ceremony.
      </p>

      <h2>canWriteIgnoringPiRole and the once-per-session UI confirm</h2>
      <p>
        A companion helper,{" "}
        <code>canWriteIgnoringPiRole(record, viewer)</code>, returns true only
        when the viewer is the owner or has an explicit edit-share entry.
        Callers use it to tell whether the PI&apos;s write right comes purely
        from their role or from a normal owner/edit-share basis.
      </p>
      <p>
        When a PI tries to edit a record that passes <code>canWrite</code>{" "}
        only because of the PI role (not because they own it or have an explicit
        edit-share), the <strong>record popup</strong> shows a
        once-per-session confirmation before opening the editor. That
        confirm step is a UI guard in the popup, not a condition in{" "}
        <code>canWrite</code> itself. <code>canWrite</code> is a pure predicate
        with no session state.
      </p>

      <h2>expandSharedWith: resolving the sentinel</h2>
      <p>
        <code>expandSharedWith(shared_with, allLabUsernames, owner)</code> in{" "}
        <code>lib/sharing/unified.ts</code> replaces the <code>&quot;*&quot;</code>{" "}
        sentinel with the concrete set of current lab members. The owner is
        excluded (they already have access). When a user appears both as an
        explicit entry and via the sentinel, the highest level wins
        (edit beats read). This is the function share dialogs use to render
        the per-member recipient list.
      </p>

      <h2>The PI implicit view-all</h2>
      <p>
        A user whose <code>account_type === &quot;lab_head&quot;</code> gets
        an extra rule on the read side: <code>canRead</code> returns true for
        every record in the lab regardless of <code>shared_with</code>. The
        Lab Overview cross-lab dashboards depend on this rule. The member
        workload widget has to be able to read every member&apos;s active tasks
        even when those tasks are private to the member.
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
        needs to be clicked. The rewrite runs in the background and is
        idempotent on repeat logins.
      </Callout>

      <h2>Granularity, what is shareable</h2>
      <p>
        Sharing is per-record.
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
        <li>
          <strong>Inventory items</strong> default to whole-lab edit (the{" "}
          <code>&quot;*&quot;</code> sentinel at level{" "}
          <code>&quot;edit&quot;</code>) so every member can add, use, and
          update stock. You can restrict a particular item per-record.
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

      <h2>Sharing outside your lab</h2>
      <p>
        Everything above is sharing inside one folder, where labmates already see
        the same files. Sharing with a researcher who is not in your folder works
        differently, because they have nothing of yours locally. The share dialog
        handles this on its <strong>Outside your lab</strong> tab, and there are
        two ways to do it.
      </p>

      <h3>A one-time encrypted send</h3>
      <p>
        Send a note, method, project, or file to someone as a frozen copy. You
        pick the recipient by the email tied to their ResearchOS profile, and
        ResearchOS encrypts the payload end to end before it leaves your machine.
        The relay only ever holds ciphertext, never the readable content, and the
        copy is transient. It is deleted the moment the recipient imports it, or
        after thirty days if they never do. This is the right choice for handing
        someone a snapshot you do not need to keep editing together.
      </p>

      <h3>Live collaboration with an outside researcher</h3>
      <p>
        Grant a researcher outside your folder live, editable access to a note,
        the same real-time collaboration labmates get. The document stays live
        until you revoke it. Because the outside person holds nothing of yours
        locally yet, accepting the invite writes a real copy into their own
        folder, so they keep a local-first, exportable copy rather than a
        cloud-only document. From then on both sides edit the same live document.
      </p>

      <h3>How the recipient finds and accepts it</h3>
      <p>
        An outside recipient sees the invite in their own{" "}
        <strong>Shared with me</strong> list, the same place in-lab shares appear.
        Before anything materializes, ResearchOS checks that the sender&apos;s
        identity matches their published directory key, so a spoofed email cannot
        push a document into someone&apos;s folder. The recipient accepts on
        purpose, the copy is written locally, and they can decline or block a
        sender they do not want. Revoking later stops the live updates but leaves
        the recipient their last copy, the same way an export does.
      </p>

      <Callout variant="info" title="Off by default in the hosted beta">
        Outside-your-lab sharing relies on the directory and relay, which are
        turned off in the hosted beta, so it is a laptop and self-host feature
        for now. The in-lab sharing above does not depend on it.
      </Callout>

      <h2>Hosting a labmate&apos;s task in your project</h2>
      <p>
        Sharing a task one way is read or edit access on that task. Hosting goes a
        step further. A labmate can let one of their tasks{" "}
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
        The repair is automatic, so hosting stays clean from both ends.
      </p>

      <h2>Cross-link map</h2>
      <p>
        Pages elsewhere in the wiki that touch sharing decisions.
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
