import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function VersionHistoryPage() {
  return (
    <WikiPage
      title="Version History"
      intro="Every time you save a note, ResearchOS quietly records what changed, when, and who changed it. Open the version history sidebar and you can scroll back through that timeline, see each edit highlighted in place, and roll the note back to any earlier state. It is the experimental record keeping its own audit trail, automatically."
    >
      <Callout variant="info" title="What has version history today">
        Version history, including restore and the 24-hour undo, is on for
        everyone on free-form <strong>Notes</strong>, <strong>Tasks</strong>, and{" "}
        <strong>Projects</strong>. There&apos;s nothing to configure or turn on, it
        works automatically. The same timeline, diff, and restore also cover a
        task&apos;s <strong>Lab Notes</strong> and <strong>Results</strong> documents
        and the{" "}
        <Link href="/wiki/features/sequences">Sequences history tab</Link>,
        though those document surfaces record the restore as a normal forward
        version rather than offering the one-click 24-hour undo.{" "}
        <strong>Purchase items</strong> also have version history via
        PurchaseHistoryPopup when the purchase history feature is enabled; the
        History button appears in the purchase editor and opens the same
        timeline and diff view. We&apos;re working on version history for Methods
        next. The page below uses Notes as the worked example, but the behavior
        is the same on every surface that has it.
      </Callout>

      <h2>What a version is</h2>
      <p>
        A <strong>version</strong> is a single saved state of a note. You do not
        create versions by hand and there is no &quot;commit&quot; button to
        remember. You save explicitly by clicking <strong>Save checkpoint</strong>{" "}
        in the editor (see{" "}
        <Link href="/wiki/features/markdown-editor">Saving in the editor</Link>),
        and every one of those saves appends one row to an append-only history
        file that lives next to the note on disk, at{" "}
        <code>users/&lt;owner&gt;/_history/notes/&lt;id&gt;.jsonl</code>. The row
        records what changed since the previous save, the timestamp, and the
        editor who made it.
      </p>
      <p>
        Because the file is append-only and stores deltas, the history never
        rewrites the live note. The note you are editing is always the ground
        truth. The history is a side-channel that the save path writes{" "}
        <em>after</em> the note is safely on disk, and a failure to write history
        can never block or corrupt a save.
      </p>
      <p>
        This is a different kind of safety net than the{" "}
        <Link href="/wiki/features/trash">Trash</Link>. Trash recovers a note you{" "}
        <em>deleted</em>, while version history recovers a note you{" "}
        <em>edited</em>. A paragraph you overwrote three saves ago is not in the
        trash, because the note itself was never deleted, but it is sitting in
        the version history, exactly as you last left it.
      </p>

      <h2>Where you find it</h2>
      <p>
        Open any note and look for the clock-arrow{" "}
        <strong>history</strong> control on the note popup. Click it and a
        <strong> version history sidebar</strong> slides in on the right while the
        note body stays on the left. The sidebar is the timeline, and the body
        column becomes the place where each version is shown.
      </p>
      <Screenshot
        src="/wiki/screenshots/version-history-sidebar.png"
        alt="A note open with the version history sidebar on the right, showing versions grouped under day headers and editing sessions, each row with an editor avatar, a one-line change summary, and a relative timestamp."
        caption="The version history sidebar. Saves are grouped by day, then by editing session, with the current version pinned at the top."
      />
      <p>
        Each row in the sidebar is one version. It shows the editor&apos;s
        avatar, a one-line summary of what that save changed (for example,
        &quot;edited 2 paragraphs&quot;), and a relative timestamp like &quot;3
        hours ago.&quot; Hover the timestamp for the full date and time. The
        newest state sits at the top, tagged <strong>Current version</strong>.
        Scroll down to walk backward in time.
      </p>

      <h2>Grouped by day, then by session</h2>
      <p>
        A working note can accumulate dozens of saves in an afternoon. A flat
        list of every save would be overwhelming, so the sidebar groups them the way
        you actually remember your work, by <strong>day</strong> first, then by{" "}
        <strong>editing session</strong> within the day.
      </p>
      <ul>
        <li>
          <strong>Day headers</strong> (&quot;Today,&quot; &quot;Yesterday,&quot;
          then dated) split the timeline into the days you worked on the note.
        </li>
        <li>
          <strong>Sessions</strong> bundle a run of consecutive saves by the same
          editor into one collapsible group. A burst of ten small saves while you
          tightened up a protocol collapses to a single &quot;Mira, 10
          versions&quot; row you can expand when you need the detail and leave
          folded when you do not.
        </li>
      </ul>
      <Callout variant="info" title="Long histories stay fast">
        Notes with a very long history are paginated (a <em>Load older
        versions</em> button at the bottom), and saves from far enough back are
        summarized into a single &quot;earlier versions&quot; note rather than
        kept row by row. You always keep the recent, detailed timeline, and the
        deep past is condensed so the sidebar opens instantly.
      </Callout>

      <h2>The in-place diff</h2>
      <p>
        Select any version and the note body column does not just show that old
        snapshot. It shows a <strong>diff</strong>, the note as it stands, with
        the selected version&apos;s changes marked inline. Added lines render in
        green, removed lines in red with a strike-through, and unchanged prose
        renders normally so you keep your bearings. The change is shown in the
        full context of the note, not as a stripped-down patch.
      </p>
      <Screenshot
        src="/wiki/screenshots/version-history-diff.png"
        alt="A note body showing an in-place diff: added lines in green, removed lines in red with strike-through, with a colored left border and an editor avatar marking the run of lines a given person changed."
        caption="The selected version's changes, shown in place. Each changed run carries a left border tinted with the editor's color and their avatar, so who-changed-what reads at a glance."
      />
      <p>
        On a note that more than one person edits, the diff goes a step further
        and <strong>tints each change by editor</strong>. Every changed run of
        lines carries a left border in that editor&apos;s personal color, with
        their avatar at the start of the run, so you can see at a glance that Mira
        rewrote the lysis step while Alex corrected the buffer table. It is the
        same per-collaborator coloring you know from shared documents elsewhere.
      </p>
      <Callout variant="tip" title="Color is never the only signal">
        Added and removed lines always carry the green/red coloring, the
        strike-through, and a <code>+</code>/<code>-</code> gutter mark in
        addition to the editor tint, so the diff reads clearly for color-blind
        users. The per-editor color is supplementary, never load-bearing on its
        own.
      </Callout>

      <h2>Compare against previous or current</h2>
      <p>
        By default, a version is diffed against the one immediately{" "}
        <strong>before</strong> it, so you see exactly what that single save
        changed. A toggle at the top of the sidebar switches the comparison base
        to the <strong>current</strong> version instead. That answers a
        different question, &quot;what is different between this old state and the
        note as it stands right now?&quot; Use <em>Previous</em> to audit one
        edit, or <em>Current</em> to see everything that has happened since.
      </p>
      <Screenshot
        src="/wiki/screenshots/version-history-compare-toggle.png"
        alt="The compare toggle at the top of the version history sidebar, a two-option segmented control reading Previous and Current, with Previous selected."
        caption="The compare base toggle. Previous shows what one save changed; Current shows the full delta from an old state to today."
      />

      <h2>Who sees it, local and private</h2>
      <p>
        Version history is part of your data folder, not a cloud service. The
        history file sits inside the note owner&apos;s folder on disk, right
        beside the note, and it travels with the rest of your data through
        whatever sync you already use (OneDrive, Google Drive, Dropbox, and the
        others covered under{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>).
        Nothing about the history is uploaded to a ResearchOS server.
      </p>
      <p>
        Visibility follows the same rules as the note itself. A note that is
        private to you keeps its history private to you. If you share the note
        with the lab, a labmate who can read the note can read its history too.
        The history does not widen access, and it does not leak past edits to
        anyone who could not already read the note. See{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>{" "}
        for the full read/write model.
      </p>

      <h2 id="restore">Restoring a version</h2>
      <p>
        Selecting any earlier version reveals a{" "}
        <strong>Restore this version</strong> button in a sticky footer at the
        bottom of the sidebar (the current version has nothing to restore to, so
        it never shows the button). Clicking it asks for an inline confirmation
        rather than popping a browser dialog, in keeping with the rest of the
        app.
      </p>
      <Screenshot
        src="/wiki/screenshots/version-history-restore.png"
        alt="The version history sidebar with an earlier version selected and a green Restore this version button in a sticky footer, plus the inline confirm and cancel prompt."
        caption="An earlier version offers a Restore button. The confirm step is inline, not a native dialog."
      />
      <p>
        Restoring does not erase anything. The note&apos;s current state is kept
        as a version in the history before the older state becomes the live note,
        so a restore is just one more forward edit on the timeline. You can always
        see what the note looked like before you restored it.
      </p>

      <h3>The 24-hour undo</h3>
      <p>
        A restore is reversible. For <strong>24 hours</strong> after you restore
        a version, an <strong>Undo restore</strong> affordance lets you put the
        note back the way it was before the restore, in one click. After the
        window closes the restore simply stands as a normal edit in the history,
        which you can still walk back through manually like any other version.
      </p>
      <Screenshot
        src="/wiki/screenshots/version-history-undo.png"
        alt="The note popup header showing an Undo restore button after a restore, with a note that the undo window is open for 24 hours."
        caption="For 24 hours after a restore, Undo restore reverses it in one click. The undo is itself recorded as a forward edit."
      />

      <h2>Why it matters for compliance</h2>
      <p>
        A per-entry edit history with the ability to revert is one of the things
        funders and reviewers look for in a research record. It is what makes the
        record <em>provenanced</em>, a tamper-evident trail of who changed what
        and when. ResearchOS records that trail automatically and keeps it in your
        own data folder in an open, plain-text format you can read without the
        app. For how this fits the NIH Data Management and Sharing expectations,
        and how it compares to other electronic lab notebooks, see the{" "}
        <Link href="/wiki/compliance/nih-data-management">
          NIH Data Management and Sharing
        </Link>{" "}
        and{" "}
        <Link href="/wiki/compliance/labarchives-comparison">
          ResearchOS vs LabArchives
        </Link>{" "}
        pages.
      </p>
    </WikiPage>
  );
}
