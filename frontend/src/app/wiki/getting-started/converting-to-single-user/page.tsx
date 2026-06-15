import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ConvertingToSingleUserPage() {
  return (
    <WikiPage
      intro="ResearchOS now works best as one folder per person. If you connect a folder that several people still share, ResearchOS offers to split it so everyone ends up with their own workspace. Nothing is ever deleted, and your own data is left exactly as it is."
    >
      <h2>Why one folder per person</h2>
      <p>
        Early versions of ResearchOS let a whole lab work out of a single shared
        folder, with one <code>users/</code> subfolder per person inside it. That
        worked, but it carried real cost. Every read had to reason about who owned
        what and who could see it, the app loaded everyone&apos;s data even when
        you only wanted your own, and a single sync hiccup on the shared drive
        touched all of you at once.
      </p>
      <p>
        ResearchOS has moved to a simpler model. Each person keeps their own
        folder, the data stays local to them, and sharing happens directly
        between people who opt into it (see{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          Sharing and permissions
        </Link>
        ). A solo folder is faster to load, simpler to reason about, and entirely
        yours. The conversion described on this page is how an older shared folder
        becomes a set of those single-user folders.
      </p>

      <Callout variant="tip" title="Nothing is ever deleted">
        Every step here is recoverable. Each person&apos;s data is copied into a
        complete, portable folder <em>before</em> anything is moved, the copy is
        verified, and only then do the originals move to a recoverable Trash
        inside the folder (not a hard delete). If the conversion is interrupted
        partway, you can safely run it again and it picks up where it left off.
      </Callout>

      <h2>The choice you see when you connect</h2>
      <p>
        When you connect a folder that still has two or more people in it,
        ResearchOS shows a blocking choice before you start working. It is
        role-aware, so what you see depends on whether you own the folder or are
        one of the other members in it. You can always pick{" "}
        <strong>Keep it shared for now</strong> to dismiss the prompt; the
        dismiss is persisted to disk so it goes away for this session, but
        it comes back the next time you launch with this folder, until the
        folder is converted.
      </p>
      <p>
        The same conversion is also reachable later from{" "}
        <Link href="/wiki/features/settings">Settings</Link> under{" "}
        <strong>Data maintenance</strong>, as{" "}
        <strong>Convert this folder to single-user</strong>, so you do not have
        to decide the moment you connect.
      </p>

      <Callout variant="info" title="This only appears for a real shared folder">
        The prompt fires only for a signed-in user in a folder that genuinely has
        more than one person. A folder that already has a single user shows
        nothing, and demo and wiki preview modes never trigger it.
      </Callout>

      <h2>If you own the folder, make it your own</h2>
      <p>
        As the folder&apos;s main user you are offered{" "}
        <strong>Convert this folder to mine</strong>. You keep this folder and
        everything in it that is yours. Everyone else is packaged into their own
        portable copy, and their originals here move to a recoverable Trash.
        Before anything happens you see a preview of exactly who moves and how
        many records each person has, and nothing runs until you confirm.
      </p>

      <Screenshot
        src="/wiki/screenshots/migration-convert-owner.png"
        alt="The Convert this folder to single-user modal as the owner. A short explanation at the top, then three points. Everyone else gets a portable copy under _migration_bundles, their data moves to a recoverable Trash under _trash/migrated_users, and shared links are cleared. Below that, a list of the people moving out with each person's record count, and Cancel and Convert to single-user buttons."
        caption="The owner's preview screen. You see every person who will move out and their record count before you confirm. Screenshot pending a capture pass."
      />

      <p>When you confirm, ResearchOS does three things.</p>
      <Steps>
        <Step>
          <strong>Packages everyone else into a portable copy.</strong> Each
          other person is copied into{" "}
          <code>your-folder/_migration_bundles/&lt;name&gt;/</code>. That bundle
          is a complete, connectable single-user folder for them, so you can hand
          it over and they open it as their own workspace without losing any work.
        </Step>
        <Step>
          <strong>Moves their originals to a recoverable Trash.</strong> Once a
          person&apos;s bundle is copied and verified complete, their original{" "}
          <code>users/&lt;name&gt;/</code> moves to{" "}
          <code>your-folder/_trash/migrated_users/&lt;name&gt;/</code>. It is a
          move to Trash, not a delete, so you can put anything back.
        </Step>
        <Step>
          <strong>Clears the now-dangling shared links from your data.</strong>{" "}
          Because a single-user folder shares with no one, any sharing between you
          and the people who left is removed from your records. Only the sharing
          links change. The records themselves keep their full history, and who
          wrote or edited what is preserved (it simply shows as a former member on
          read).
        </Step>
      </Steps>

      <Callout variant="info" title="Your own data is untouched">
        Converting only moves the <em>other</em> people out and tidies up the
        dangling share links those departures leave behind. Your own notes, tasks,
        methods, files, and history are not copied, not moved, and not rewritten
        beyond clearing shares that no longer point at anyone.
      </Callout>

      <p>
        When it finishes, the result screen tells you where to find each
        hand-off copy under <code>_migration_bundles</code> and reminds you that
        the originals are safe in <code>_trash/migrated_users</code> if you ever
        need them. Hand each person their bundle and you are done.
      </p>

      <h2>If you are a labmate, take your data with you</h2>
      <p>
        If you are one of the other members rather than the folder&apos;s owner,
        you are offered <strong>Take my data to my own folder</strong> instead.
        This copies just your data into your own portable folder and removes you
        from the shared folder. Everyone else stays exactly where they are, and
        their data is not touched. It is the same safe, recoverable mechanism,
        scoped to only you.
      </p>
      <p>
        The preview shows your record count and who stays behind. When you
        confirm, ResearchOS does three things.
      </p>
      <Steps>
        <Step>
          Your data is copied into{" "}
          <code>this-folder/_migration_bundles/&lt;you&gt;/</code>, a complete
          folder you open as your own single-user workspace. Nothing of yours is
          left behind.
        </Step>
        <Step>
          Your originals here move to a recoverable Trash, and the shared folder
          stays intact for everyone else.
        </Step>
        <Step>
          The moment your copy is complete, ResearchOS disconnects you from the
          shared folder so the app stops writing as you, and returns you to the
          connect screen.
        </Step>
      </Steps>

      <Screenshot
        src="/wiki/screenshots/migration-selfexport-banner.png"
        alt="The post-export banner pinned to the top of the connect screen. A green check, the line Your data was exported and you left the folder, and a note that the new folder is at _migration_bundles/your-name with instructions to click Open a folder and select it. A recoverable copy path under _trash is also shown, with a dismiss button."
        caption="After a labmate export, a banner on the connect screen tells you exactly where your new folder is and how to open it. Screenshot pending a capture pass."
      />

      <p>
        A banner on the connect screen then tells you exactly where your new
        folder is (<code>_migration_bundles/&lt;you&gt;</code>) and how to reopen
        it. You can move that folder anywhere on your computer first, then click{" "}
        <strong>Open a folder</strong> and select it to keep working as your own
        workspace.
      </p>

      <Callout variant="tip" title="One person leaving does not disrupt the others">
        A labmate export removes only you. It deliberately leaves everyone
        else&apos;s records alone, including any links they had to your data,
        which gracefully show as a former member on their side rather than being
        rewritten without their say.
      </Callout>

      <h2>Where everything lives, and how to recover</h2>
      <p>
        Both paths use the same two folders inside your data folder, and both are
        plain folders you can browse in Finder or Explorer at any time.
      </p>
      <ul>
        <li>
          <code>_migration_bundles/&lt;name&gt;/</code> holds each person&apos;s
          portable copy. Inside it is a normal <code>users/&lt;name&gt;/</code>{" "}
          tree, so the bundle folder itself is a connectable single-user
          ResearchOS folder.
        </li>
        <li>
          <code>_trash/migrated_users/&lt;name&gt;/</code> holds the original
          that was moved out. This is the recovery copy. Nothing is hard-deleted,
          so if something looks off you can restore from here.
        </li>
      </ul>

      <h3>Connecting a bundle as a folder</h3>
      <p>
        A bundle is a real, standalone folder. To open one, hand the{" "}
        <code>_migration_bundles/&lt;name&gt;</code> folder to its owner (or keep
        your own), optionally move it somewhere permanent on disk, then connect it
        like any other folder.
      </p>
      <Steps>
        <Step>
          Copy or move the <code>_migration_bundles/&lt;name&gt;</code> folder to
          a permanent home on your computer (for example{" "}
          <code>Documents/ResearchOS</code>). It is yours to keep, so it does not
          have to stay inside the old shared folder.
        </Step>
        <Step>
          On the connect screen, use <strong>Browse for a folder</strong> (or
          drag the bundle into the drop zone) and select that bundle folder.
          See{" "}
          <Link href="/wiki/getting-started/connecting-your-folder">
            Connecting Your Folder
          </Link>{" "}
          for how the connect flow works.
        </Step>
        <Step>
          ResearchOS opens it as a single-user folder with all of that
          person&apos;s notes, tasks, methods, and history intact.
        </Step>
      </Steps>

      <Callout variant="warning" title="Tidy up the leftovers when you are confident">
        The <code>_migration_bundles</code> and <code>_trash</code> folders stay
        on disk until you remove them, on purpose, so recovery is always
        available. Once everyone has their own folder and you have confirmed their
        data is intact, you can delete those two folders from the keeper&apos;s
        folder to reclaim the space. Do this only after you are sure, because
        deleting them yourself is the one step ResearchOS will not undo for you.
      </Callout>

      <h2>Crash safety, in plain terms</h2>
      <p>
        The conversion is built so an interrupted run can never lose data. For
        each person, the portable copy is written and verified complete before
        anything is moved out, and the single step that removes an original is
        never reached until that verified copy exists. If a sync stalls, a tab
        closes, or the browser quits midway, no data has been deleted. Reopen
        ResearchOS, run the conversion again, and it resumes from where it
        stopped and finishes cleanly.
      </p>

      <Callout variant="info" title="Related reading">
        If you are setting up a folder to share across a lab in the first place,
        see <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>. To
        hide a former member from active views without moving their data, see{" "}
        <Link href="/wiki/getting-started/user-archiving">User Archiving</Link>.
      </Callout>
    </WikiPage>
  );
}
