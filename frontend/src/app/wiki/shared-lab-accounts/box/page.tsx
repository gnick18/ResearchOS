import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function BoxPage() {
  return (
    <WikiPage
      intro="Box Drive streams files on demand. Mark the ResearchOS folder Available Offline so it stays on disk."
    >
      <h2>Install Box Drive</h2>
      <p>
        Download Box Drive from{" "}
        <a
          href="https://www.box.com/resources/downloads"
          target="_blank"
          rel="noopener noreferrer"
        >
          box.com/resources/downloads
        </a>
        . You need the desktop client running. The web interface at{" "}
        <code>box.com</code> is not enough. ResearchOS needs the desktop app
        because that&apos;s what creates the local filesystem folder you point
        ResearchOS at.
      </p>

      <Callout variant="info" title="Box Drive, not Box Sync">
        Box Sync is the older client and has been retired. Make sure
        you&apos;re installing <strong>Box Drive</strong>. Box Drive shows
        every folder you have access to as a virtual filesystem and
        downloads files on demand, whereas Box Sync mirrored selected
        folders to disk. The instructions below assume Box Drive.
      </Callout>

      <h2>Share the lab folder</h2>
      <Steps>
        <Step>
          One member creates an empty folder inside their Box account (e.g.,{" "}
          <code>LabName-ResearchOS</code>). The folder can live anywhere under
          <code> All Files</code>.
        </Step>
        <Step>
          Right-click the folder in Box Drive (or open it on box.com) →{" "}
          <strong>Share</strong>. Invite lab members by email with{" "}
          <strong>Editor</strong> access. <em>Co-owner</em> works too if you
          want them to be able to re-share.
        </Step>
        <Step>
          Each invited member accepts the invite. The folder appears under
          their Box Drive mount on disk (see &quot;Where the folder lives on
          disk&quot; below).
        </Step>
      </Steps>

      <h2>Make it Available Offline (every member, every laptop)</h2>
      <p>
        Box Drive streams files on demand by default, so the folder shows up
        as a placeholder until you open something. ResearchOS reads directly
        from disk, so anything still cloud-only breaks. You need to mark the
        lab folder as available offline on every laptop.
      </p>
      <Steps>
        <Step>
          Open File Explorer (Windows) or Finder (macOS) and navigate to the
          shared lab folder under your Box mount.
        </Step>
        <Step>
          Right-click the folder. In the context menu, choose{" "}
          <strong>Make Available Offline</strong> (Windows) or{" "}
          <strong>Available Offline</strong> (macOS). A green check icon
          replaces the cloud icon on the folder and on every file inside it.
        </Step>
        <Step>
          Wait for Box Drive&apos;s menu-bar / tray icon to report &quot;All
          files up to date&quot; before opening ResearchOS. Large labs can
          take a while on the first sync.
        </Step>
        <Step>
          Open ResearchOS, click <strong>Link Folder</strong>, and pick that
          shared folder.
        </Step>
      </Steps>

      <Callout variant="tip" title="Folder picker may be slow">
        The folder picker can take up to a minute to open for Box folders.
        This is normal; Box Drive needs time to enumerate the folder tree.
        Wait for it rather than clicking again.
      </Callout>

      <Callout variant="warning" title="Enterprise policy can block Make Available Offline">
        Some Box Enterprise admins disable Make Available Offline for
        compliance reasons. If you right-click the folder and don&apos;t see
        the option, or it&apos;s greyed out, ask your IT admin to enable
        offline access for your account. Without it, ResearchOS will hit
        empty placeholder files instead of real content.
      </Callout>

      <h2>Where the folder lives on disk</h2>
      <ul>
        <li>
          <strong>Windows</strong>: under <code>%USERPROFILE%\Box</code> (e.g.{" "}
          <code>C:\Users\you\Box</code>).
        </li>
        <li>
          <strong>macOS</strong>: under <code>~/Library/CloudStorage/Box-Box/</code>{" "}
          on recent macOS versions, or <code>~/Box</code> on older installs.
        </li>
      </ul>

      <h2>Common pitfalls</h2>
      <ul>
        <li>
          <strong>Files revert to cloud-only.</strong> If a colleague opens
          the shared folder&apos;s properties and chooses{" "}
          <em>Free up space</em>, the folder switches back to streaming and
          ResearchOS can&apos;t read it. Re-run{" "}
          <em>Make Available Offline</em>.
        </li>
        <li>
          <strong>Conflict files.</strong> If two members edit the same file
          while offline, Box creates a copy named{" "}
          <code>filename (Conflicted copy …).json</code> next to the
          original. Delete the conflicted copy in Finder / Explorer.
          ResearchOS only reads the canonical name.
        </li>
        <li>
          <strong>Collaborator vs. owner storage.</strong> Shared folders on
          Box count against the <em>folder owner&apos;s</em> quota, not each
          collaborator&apos;s. Pick someone with enough quota (usually the
          lab&apos;s primary Box account) to own the folder.
        </li>
        <li>
          <strong>Single sign-on re-auth.</strong> University Box accounts on
          SSO occasionally drop the Box Drive session and stop syncing
          without an obvious error. If files stop updating, open Box Drive&apos;s
          menu-bar / tray icon and confirm you&apos;re still signed in.
        </li>
      </ul>

      <h2>Box documentation</h2>
      <ul>
        <li>
          <a
            href="https://support.box.com/hc/en-us/articles/360043697094-Installing-Box-Drive"
            target="_blank"
            rel="noopener noreferrer"
          >
            Installing Box Drive (Box Support)
          </a>
        </li>
        <li>
          <a
            href="https://support.box.com/hc/en-us/articles/360044196253-Making-Files-and-Folders-Available-Offline-with-Box-Drive"
            target="_blank"
            rel="noopener noreferrer"
          >
            Making files and folders available offline with Box Drive (Box Support)
          </a>
        </li>
        <li>
          <a
            href="https://support.box.com/hc/en-us/articles/360044196693-Inviting-Collaborators-to-a-Folder"
            target="_blank"
            rel="noopener noreferrer"
          >
            Inviting collaborators to a folder (Box Support)
          </a>
        </li>
      </ul>
    </WikiPage>
  );
}
