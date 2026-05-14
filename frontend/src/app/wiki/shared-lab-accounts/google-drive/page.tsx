import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function GoogleDrivePage() {
  return (
    <WikiPage
      intro="Install Drive for desktop and choose Mirror mode. Mirror means every file is stored locally on your disk."
    >
      <h2>Install Drive for desktop</h2>
      <p>
        Download{" "}
        <a
          href="https://www.google.com/drive/download/"
          target="_blank"
          rel="noopener noreferrer"
        >
          Drive for desktop
        </a>{" "}
        for Windows or macOS. The browser interface at <code>drive.google.com</code>
        is not enough. ResearchOS needs the desktop app because that&apos;s what
        creates the local filesystem folder you point ResearchOS at.
      </p>

      <h2>Make the lab folder always available offline</h2>
      <p>
        Drive for desktop has two ways of keeping a folder on disk:{" "}
        <strong>Stream files</strong> (download on demand) and{" "}
        <strong>Mirror files</strong> (always local). ResearchOS reads
        directly from disk, so anything still in Stream mode breaks. Most
        labs don&apos;t want the whole Drive switched to Mirror (your
        unrelated personal files, downloads, photos all get pulled local).
        Instead, mark just the lab folder as offline.
      </p>
      <Steps>
        <Step>
          Open the lab folder in Finder (macOS) or Explorer (Windows). It
          shows up wherever Drive mounts (see &quot;Where the folder lives
          on disk&quot; below).
        </Step>
        <Step>
          Right-click the folder. The Drive menu adds an{" "}
          <strong>Offline access</strong> submenu.
        </Step>
        <Step>
          Click <strong>Available offline</strong>. The folder gets a small
          green check icon, and Drive starts pulling every file inside it
          down to disk.
        </Step>
        <Step>
          Wait for the green check on every file inside. Cloud icons mean
          the file isn&apos;t local yet — ResearchOS won&apos;t be able to
          read those until they download.
        </Step>
      </Steps>
      <p>
        Each member has to do this on every laptop they use ResearchOS
        from. Drive doesn&apos;t carry the &quot;available offline&quot;
        flag across machines.
      </p>

      <Callout variant="tip" title="Or switch the whole Drive to Mirror">
        If you want all of Drive locally (not just the lab folder), open
        Drive for desktop&apos;s <strong>Preferences → My Drive → Mirror
        files</strong> and confirm. Drive will download everything you have
        in My Drive over the next few minutes or hours depending on size.
        Pick this if you don&apos;t mind the extra disk use or you have
        other folders besides the lab folder that need to stay local.
      </Callout>

      <h2>Share the lab folder</h2>
      <Steps>
        <Step>
          One member creates an empty folder in their Google Drive (e.g.,{" "}
          <code>LabName-ResearchOS</code>).
        </Step>
        <Step>
          Right-click the folder → <strong>Share</strong>. Add lab members by
          email with <strong>Editor</strong> access.
        </Step>
        <Step>
          Each invited member opens drive.google.com, finds the folder under{" "}
          <strong>Shared with me</strong>, right-clicks it, and selects{" "}
          <strong>Add shortcut to Drive → My Drive</strong>. This is what makes
          the folder show up on disk via Drive for desktop.
        </Step>
        <Step>
          On each laptop, confirm in Finder / Explorer that the shared folder
          is fully downloaded (i.e., no cloud icon next to file names).
        </Step>
        <Step>
          Open ResearchOS, click <strong>Connect Folder</strong>, and pick that
          shared folder.
        </Step>
      </Steps>

      <h2>Where the folder lives on disk</h2>
      <ul>
        <li>
          <strong>Windows</strong>: usually mounted as drive <code>G:</code> or
          under <code>%USERPROFILE%\GoogleDrive</code>.
        </li>
        <li>
          <strong>macOS</strong>: under{" "}
          <code>~/Library/CloudStorage/GoogleDrive-&lt;you@…&gt;/</code> or
          shown as a volume on the desktop.
        </li>
      </ul>

      <h2>Common pitfalls</h2>
      <ul>
        <li>
          <strong>Stream mode by accident.</strong> If files in the lab
          folder show a cloud icon or take seconds to open, the folder
          isn&apos;t marked offline yet. Right-click the lab folder and
          pick <strong>Available offline</strong> (or switch your whole
          Drive to Mirror if you prefer that).
        </li>
        <li>
          <strong>&quot;Shared with me&quot; is not synced.</strong> A shared
          folder doesn&apos;t appear in your local Drive folder until you{" "}
          <em>Add shortcut to Drive</em>. Without that, ResearchOS has nothing
          to point at.
        </li>
        <li>
          <strong>Workspace admins</strong> sometimes lock Mirror mode off.
          Check with your IT admin if Drive for desktop only shows the Stream
          option.
        </li>
      </ul>

      <h2>Google documentation</h2>
      <ul>
        <li>
          <a
            href="https://support.google.com/drive/answer/10838124"
            target="_blank"
            rel="noopener noreferrer"
          >
            Use files offline with Drive for desktop (Google Help)
          </a>
        </li>
        <li>
          <a
            href="https://support.google.com/drive/answer/2375057"
            target="_blank"
            rel="noopener noreferrer"
          >
            Share folders in Google Drive (Google Help)
          </a>
        </li>
      </ul>
    </WikiPage>
  );
}
