import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function DropboxPage() {
  return (
    <WikiPage
      intro="Dropbox's Smart Sync can store files online-only. Set the ResearchOS folder to Local so it stays on disk."
    >
      <h2>Install Dropbox</h2>
      <p>
        Download the desktop app from{" "}
        <a
          href="https://www.dropbox.com/install"
          target="_blank"
          rel="noopener noreferrer"
        >
          dropbox.com/install
        </a>
        . You need the desktop client running. The web interface alone
        won&apos;t expose Dropbox as a folder ResearchOS can read.
      </p>

      <h2>Share the lab folder</h2>
      <Steps>
        <Step>
          One member creates an empty folder inside their Dropbox (e.g.,{" "}
          <code>LabName-ResearchOS</code>).
        </Step>
        <Step>
          Right-click the folder → <strong>Share</strong>. Add lab members by
          email with <strong>Can edit</strong> permission.
        </Step>
        <Step>
          Each invited member accepts the share. The folder appears under their
          local Dropbox tree on disk.
        </Step>
      </Steps>

      <h2>Set Smart Sync to Local (every member, every laptop)</h2>
      <Steps>
        <Step>
          Open File Explorer (Windows) or Finder (macOS) and navigate to the
          shared lab folder inside Dropbox.
        </Step>
        <Step>
          Right-click the folder → <strong>Smart Sync</strong> →{" "}
          <strong>Local</strong>. Every file gets downloaded and the cloud icon
          disappears.
        </Step>
        <Step>
          Wait for Dropbox&apos;s menu-bar / tray icon to report &quot;Up to
          date&quot; before opening ResearchOS.
        </Step>
        <Step>
          Open ResearchOS, click <strong>Connect Folder</strong>, and pick that
          shared folder.
        </Step>
      </Steps>

      <Callout variant="warning" title="Smart Sync isn't on every plan">
        Smart Sync is included on Dropbox Plus, Family, Professional, and
        Business plans. On the free Basic plan, all files are local by default,
        so you can skip the Smart Sync step entirely. Just watch your storage
        quota.
      </Callout>

      <Callout variant="tip" title="Or keep all of Dropbox local">
        If you&apos;re on a paid plan and want every Dropbox folder to stay
        on disk by default, open the Dropbox menu-bar / tray icon →{" "}
        <strong>Preferences &rarr; Sync &rarr; New folder default</strong>{" "}
        and set it to <strong>Local</strong>. Existing folders keep their
        current setting; only newly-added folders inherit the new default.
        Pick this if you have multiple Dropbox folders besides the lab
        folder that all need to be always-local.
      </Callout>

      <h2>Common pitfalls</h2>
      <ul>
        <li>
          <strong>Default to Online-only.</strong> Some Business plans default
          new shared folders to <em>Online-only</em>. Check the team admin
          settings if Smart Sync keeps reverting.
        </li>
        <li>
          <strong>Selective Sync vs. Smart Sync.</strong> Selective Sync hides
          the folder entirely from your disk, while Smart Sync keeps a
          placeholder. You want Smart Sync set to <em>Local</em>, not Selective
          Sync excluded.
        </li>
        <li>
          <strong>LAN sync conflicts.</strong> If two members on the same
          network edit the same file in quick succession, Dropbox can produce
          &quot;conflicted copy&quot; files. These appear next to the original.
          Delete the conflicted copy in Finder / Explorer. ResearchOS only
          reads the canonical name.
        </li>
      </ul>

      <h2>Dropbox documentation</h2>
      <ul>
        <li>
          <a
            href="https://help.dropbox.com/sync/smart-sync"
            target="_blank"
            rel="noopener noreferrer"
          >
            How to use Smart Sync (Dropbox Help)
          </a>
        </li>
        <li>
          <a
            href="https://help.dropbox.com/share/share-with-others"
            target="_blank"
            rel="noopener noreferrer"
          >
            Share files and folders (Dropbox Help)
          </a>
        </li>
      </ul>
    </WikiPage>
  );
}
