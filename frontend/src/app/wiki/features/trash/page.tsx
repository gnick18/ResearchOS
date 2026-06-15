import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function TrashFeaturePage() {
  return (
    <WikiPage
      title="Trash &amp; History"
      intro="A recovery window for deletes. When you delete a note, task, project, method, purchase, goal, lab link, mass spec protocol, sequence, molecule, inventory item or stock, or storage location, it does not vanish. It moves into a per-user trash folder where it sits for 30 days. Within that window you can restore it back to its original location with one click. After the window passes, an automatic sweep removes it for good."
    >
      <h2>Why this exists</h2>
      <p>
        Research data has a different relationship to time than consumer data.
        A note about a PCR run from eight months ago is not &ldquo;old, who
        cares,&rdquo; it is the experimental record. A misclick on the delete
        button used to be irrecoverable. The new trash flow gives you a safety
        net without changing how you delete.
      </p>
      <Callout variant="info" title="Deleted vs edited, two different safety nets">
        Trash recovers a record you <strong>deleted</strong>. It does not help
        with a record you <strong>edited</strong>. A paragraph you overwrote
        three saves ago is not in the trash, because the note itself was never
        deleted. For that, ResearchOS keeps a separate per-save timeline you can
        scroll back through and (in the restore pilot) roll back. See{" "}
        <Link href="/wiki/features/version-history">Version History</Link>.
      </Callout>

      <h2>How it works</h2>
      <p>
        When you delete a note, the file moves from
        <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta ml-1">users/&lt;you&gt;/notes/&lt;id&gt;.json</code>
        into
        <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta ml-1">users/&lt;you&gt;/_trash/notes/&lt;id&gt;-&lt;slug&gt;.json</code>.
        A small metadata block is added to the trashed record that records
        when the delete happened, who issued it, and when the auto-cleanup
        sweep will permanently remove it.
      </p>
      <p>
        A sidecar index at
        <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta ml-1">users/&lt;you&gt;/_trash/_index.json</code>{" "}
        keeps a flat summary of every trashed record. The index is rebuilt
        automatically from the directory listing if it ever goes out of sync
        (manual file deletion, OneDrive merge conflict, partial crash). The
        on-disk files are the ground truth. The index is just a read-time
        optimization.
      </p>

      <h2>The /trash page</h2>
      <p>
        Open the trash from the small trash-can icon in the top-right corner
        of the header (just left of your avatar chip) or from the{" "}
        <Link href="/settings#history-and-trash">Settings &rarr; History &amp; Trash</Link>{" "}
        section. Trashed records are grouped into sections by what they are,
        so all your deleted notes sit together, all your deleted tasks sit
        together, and so on. The full set of sections is notes, tasks, projects,
        methods, purchase items, high-level goals, lab links, mass spec protocols,
        sequences, molecules, inventory items, inventory stocks, and storage
        locations. A section only appears when it has something in it, so the
        page stays short when most categories are empty.
      </p>
      <p>Each row shows the following.</p>
      <ul>
        <li>A checkbox for selecting the row (more on that below).</li>
        <li>The record&rsquo;s name (recovered from the original title).</li>
        <li>Who deleted it and when.</li>
        <li>A countdown until auto-cleanup (&ldquo;Expires in 27 days&rdquo;).</li>
        <li>
          A <strong>Restore</strong> button (returns the record to its original
          location) and a <strong>Permanent delete</strong> button (removes the
          trash file immediately, with a confirmation step).
        </li>
      </ul>
      <p>
        A sort dropdown in the header switches between Newest first (default),
        Oldest first, and Expiring soon (urgent-cleanup-first). The sort applies
        inside each section, so the most relevant rows float to the top of
        every category at once.
      </p>

      <h2>Selecting and acting in bulk</h2>
      <p>
        Cleaning up after a big experiment usually means dealing with more
        than one stray record at a time. Rather than restoring or deleting
        rows one by one, you can select several and act on them in a single
        pass. The checkbox on each row drives the selection, and the checkbox
        on each section header is a shortcut for selecting everything in that
        category.
      </p>
      <Steps>
        <Step>
          <strong>Pick your rows.</strong> Tick the checkbox on any row you
          want to act on. Selections can span more than one section, so you
          can grab two notes and a task in the same go.
        </Step>
        <Step>
          <strong>Or grab a whole category.</strong> The checkbox in a section
          header selects every row in that section at once. When only some of
          the rows in a section are selected, the header checkbox shows a dash
          to tell you the section is partly selected rather than fully
          selected.
        </Step>
        <Step>
          <strong>Act from the bar.</strong> As soon as something is selected,
          a bar slides in at the top of the list showing how many items are
          selected. From there you can <strong>Restore</strong> all of them,{" "}
          <strong>Permanent delete</strong> all of them, or{" "}
          <strong>Clear selection</strong> to start over.
        </Step>
        <Step>
          <strong>Confirm a bulk delete.</strong> Restoring in bulk happens
          right away. A bulk permanent delete is irreversible, so it asks you
          to confirm in a dialog first, and only then removes the selected
          records for good.
        </Step>
      </Steps>
      <Screenshot
        src="/wiki/screenshots/trash-bulk-action-bar.png"
        alt="Trash page with two rows selected and the bulk action bar showing Restore, Permanent delete, and Clear selection"
        caption="Selecting rows reveals a bar with Restore, Permanent delete, and Clear selection."
        width={1440}
        height={900}
      />
      <Callout variant="tip" title="Selections clear themselves up">
        If a row leaves the trash while it is selected, whether you restored
        it on its own or the list reloaded, it quietly drops out of the
        selection. The count in the bar always reflects what is actually still
        sitting in the trash.
      </Callout>
      <Callout variant="warning" title="Bulk restore skips the parent prompt">
        Restoring a single record asks what to do when its parent is also in
        the trash (see &ldquo;Restoring with a trashed parent&rdquo; below). A
        bulk restore does not stop to ask. Each selected record is restored on
        its own, so if you want a parent and child to come back together,
        select both of them.
      </Callout>

      <h2>The cleanup window</h2>
      <p>
        Defaults to <strong>30 days</strong>. Change it under{" "}
        <Link href="/settings#history-and-trash">Settings &rarr; History &amp; Trash</Link>.
        Four options, 7 days, 30 days, 90 days, or Never. The Never option
        means automatic cleanup never fires, but you can still delete from the
        trash page manually.
      </p>
      <p>
        The cleanup pass runs once on every folder-connect. If you keep
        ResearchOS open for weeks at a time, the sweep waits until your next
        cold start to clear expired entries. Multi-device users get the same
        behavior on each device when they connect their folder.
      </p>

      <Callout variant="info" title="The window is per-user">
        Each user&rsquo;s cleanup window applies to their own trash. If a lab
        head deletes one of your records, the trash entry lands in your folder
        and inherits your cleanup setting.
      </Callout>

      <h2>Who can delete a record</h2>
      <p>
        Only the record owner sees the Delete button. If a labmate has shared
        edit access to one of your notes, they can edit it, but they cannot
        delete it. That&rsquo;s your call as the owner.
      </p>
      <p>
        The one carve-out is the lab head. A lab head can delete records owned
        by other lab members, based on a real role check (your account is a lab
        head), not a temporary unlock. The trash entry records the lab head as
        the deleter and rides an audit session id along so the audit log groups
        the action with the rest of that batch.
      </p>

      <h2>Restoring a record</h2>
      <p>
        Click <strong>Restore</strong> on the row. The record is written back
        to its original path with the metadata block stripped off, and the
        trash file is removed. The record is now live again at the same id.
      </p>
      <p>
        When restoring a record whose parent (e.g. a Project that contains
        the task) is also in trash, a prompt asks whether to restore both or
        just the child. See &ldquo;Restoring with a trashed parent&rdquo;
        below.
      </p>

      <h2>Permanent delete</h2>
      <p>
        Use <strong>Permanent delete</strong> on the row to remove a trash
        entry ahead of the cleanup window. The button asks for confirmation
        and is final. After permanent delete, the record is gone. There is
        no second-level recycle bin.
      </p>

      <h2>Archive vs trash on Projects</h2>
      <p>
        Projects are the one entity type with TWO recovery states, and both
        coexist on purpose.
      </p>
      <ul>
        <li>
          <strong>Archive</strong> (the existing button) keeps the project at
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta mx-1">users/&lt;you&gt;/projects/&lt;id&gt;.json</code>{" "}
          with <code>is_archived: true</code>. It is hidden from default
          views but visible in the archived list. Use this for projects
          you are done with but want to keep on disk for reference.
        </li>
        <li>
          <strong>Delete</strong> (now routes through trash) moves the project file
          to{" "}
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta mx-1">_trash/projects/</code>{" "}
          and the cleanup window starts. The trash entry preserves the
          <code className="px-1 py-0.5 bg-surface-sunken rounded text-meta mx-1">is_archived</code>{" "}
          flag, so a project you archived first and then deleted will come
          back archived on restore.
        </li>
      </ul>
      <Callout variant="info" title="Archive then trash is fine">
        You can archive a project today and trash it next month. Restoring
        from trash strips the trash metadata only, so the archive state
        survives the round trip.
      </Callout>

      <h2>Restoring with a trashed parent</h2>
      <p>
        Records like Tasks (parent: Project), Notes (no parent), Purchase
        Items (parent: Task), High-level Goals (parent: Project), and a
        sub-method (parent: its parent Method) record a soft reference to their
        parent at delete time. When you restore a record whose parent is ALSO
        in trash, a prompt asks what you want to do.
      </p>
      <ul>
        <li><strong>Restore both</strong> (default): restores the parent first, then this record.</li>
        <li><strong>Just this record</strong>: leaves the parent in trash. The record will exist but its parent reference will dangle.</li>
        <li><strong>Cancel</strong>: nothing happens.</li>
      </ul>
      <p>
        If the parent is not in trash (the common case), no prompt fires and
        the restore proceeds straight through.
      </p>

      <h2>What trash does not yet do</h2>
      <p>
        Per-record edit history (the per-save timeline plus a revert button) is
        now shipping on a separate track. It is live today on free-form Notes as
        a rolling-out pilot. See{" "}
        <Link href="/wiki/features/version-history">Version History</Link> for
        what is on and where it goes next. The settings panel also surfaces an
        &ldquo;Orphaned files&rdquo; row as a placeholder. Image attachments
        referenced only by deleted notes stay on disk for now. A cleanup tool
        that finds and removes unreferenced images ships in a later phase.
      </p>

      <Callout variant="info" title="The promise">
        Every delete you make through the app is recoverable for at least
        seven days (the most aggressive cleanup setting). Within the default
        30-day window, a misclick is a one-button fix. We do not promise the
        trash is tamper-proof. The files sit in your folder and you can edit
        them by hand on disk if you really want to.
      </Callout>
    </WikiPage>
  );
}
