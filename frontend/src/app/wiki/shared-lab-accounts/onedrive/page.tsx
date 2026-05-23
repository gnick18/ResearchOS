import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function OneDrivePage() {
  return (
    <WikiPage
      intro="OneDrive's Files On-Demand keeps files in the cloud by default. You need to mark the ResearchOS folder Always keep on this device."
    >
      <h2>Get OneDrive</h2>
      <ul>
        <li>
          <strong>Windows 10/11</strong>: pre-installed. Sign in via Settings →
          Accounts.
        </li>
        <li>
          <strong>macOS</strong>: download from{" "}
          <a
            href="https://www.microsoft.com/microsoft-365/onedrive/download"
            target="_blank"
            rel="noopener noreferrer"
          >
            microsoft.com/onedrive/download
          </a>
          .
        </li>
      </ul>

      <h2>Share the lab folder</h2>
      <Steps>
        <Step>
          One member creates an empty folder inside their OneDrive (e.g.,{" "}
          <code>LabName-ResearchOS</code>).
        </Step>
        <Step>
          Right-click the folder → <strong>OneDrive</strong> →{" "}
          <strong>Share</strong>. Invite the other lab members by email and
          give them <strong>Edit</strong> permission.
        </Step>
        <Step>
          Each invited member accepts the share. The folder appears under{" "}
          <strong>OneDrive &rarr; Shared</strong> in the File Explorer left nav
          (Windows) or under your OneDrive folder in Finder (macOS). Using{" "}
          <strong>Add shortcut to My files</strong> is the most reliable way to
          get the shared folder into your normal OneDrive tree, where{" "}
          <strong>Always keep on this device</strong> works consistently.
        </Step>
      </Steps>

      <h2>Make it Always keep on this device (every member, every laptop)</h2>
      <Steps>
        <Step>
          Open File Explorer (Windows) or Finder (macOS) and navigate to the
          shared lab folder.
        </Step>
        <Step>
          Right-click the folder. In the context menu, choose{" "}
          <strong>Always keep on this device</strong>. A green check icon
          replaces the cloud icon on the folder and on every file inside it.
        </Step>
        <Step>
          Wait until OneDrive finishes downloading everything (status &quot;Up
          to date&quot; in the menu-bar / tray icon).
        </Step>
        <Step>
          Open ResearchOS, click <strong>Link Folder</strong>, and pick that
          shared folder.
        </Step>
      </Steps>

      <Callout variant="tip" title="Folder picker may be slow on Windows">
        The folder picker can take up to a minute to open on Windows for
        OneDrive folders. This is normal; OneDrive needs time to enumerate
        the folder tree. Wait for it rather than clicking again.
      </Callout>

      <Callout variant="warning" title="OneDrive Personal vs. Business / SharePoint">
        Shared folders sometimes show up as <em>SharePoint</em> libraries or in
        a separate &quot;Shared with me&quot; section. Microsoft&apos;s{" "}
        <strong>Add shortcut to My files</strong> button is the cleanest way to
        get the shared folder into your normal OneDrive tree, where{" "}
        <strong>Always keep on this device</strong> works reliably.
      </Callout>

      <Callout variant="tip" title="Or keep all of OneDrive local">
        If you&apos;d rather have your whole OneDrive on disk (not just the
        lab folder), click the OneDrive icon in the menu-bar / tray →{" "}
        <strong>Settings &rarr; Sync and backup &rarr; Advanced settings
        &rarr; Files On-Demand</strong> and switch to{" "}
        <strong>Download all OneDrive files now</strong>. Pick this if you
        have other OneDrive folders you also need available offline.
      </Callout>

      <h2>Common pitfalls</h2>
      <ul>
        <li>
          <strong>Storage Sense</strong> on Windows can auto-unpin files you
          haven&apos;t opened recently (i.e., move them back to cloud-only).
          Open Settings → System → Storage → Storage Sense and either disable
          the &quot;content not opened in N days&quot; option for the
          ResearchOS folder, or turn Storage Sense off entirely.
        </li>
        <li>
          <strong>Cloud-only re-tag</strong> happens if you right-click and
          choose <em>Free up space</em> by accident. The folder reverts to
          cloud-only and ResearchOS can&apos;t read it. Re-run{" "}
          <em>Always keep on this device</em>.
        </li>
        <li>
          <strong>Mac users</strong>: confirm the option says &quot;Always keep
          on this device&quot; (Files On-Demand). The older OneDrive Mac client
          stored files locally by default, but newer versions don&apos;t.
        </li>
      </ul>

      <h2>Microsoft documentation</h2>
      <ul>
        <li>
          <a
            href="https://support.microsoft.com/office/save-disk-space-with-onedrive-files-on-demand-for-windows-0e6860d3-d9f3-4971-b321-7092438fb38e"
            target="_blank"
            rel="noopener noreferrer"
          >
            OneDrive Files On-Demand (Microsoft Support)
          </a>
        </li>
        <li>
          <a
            href="https://support.microsoft.com/office/share-onedrive-files-and-folders-9fcc2f7d-de0c-4cec-93b0-a82024800c07"
            target="_blank"
            rel="noopener noreferrer"
          >
            Share OneDrive files and folders (Microsoft Support)
          </a>
        </li>
      </ul>
    </WikiPage>
  );
}
