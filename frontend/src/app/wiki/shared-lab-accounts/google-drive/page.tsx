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

      <h2>Choose Mirror mode (the important step)</h2>
      <p>
        Drive for desktop offers two modes when you set up the &quot;My
        Drive&quot; folder:
      </p>
      <ul>
        <li>
          <strong>Stream files</strong>: files live in the cloud and download
          on demand. Lighter on disk, but <strong>not compatible</strong> with
          ResearchOS unless you per-folder mark &quot;Available offline&quot;.
        </li>
        <li>
          <strong>Mirror files</strong>: every file is kept on your local
          drive. <strong>This is the mode you want.</strong> Use it on every
          laptop where you&apos;ll run ResearchOS.
        </li>
      </ul>

      <Callout variant="tip" title="Switching modes later">
        Already running in Stream mode? In Drive for desktop&apos;s
        Preferences → My Drive → Mirror files → Confirm. Drive will download
        everything to your disk over the next few minutes or hours depending
        on size. Or, per-folder, right-click the lab folder →{" "}
        <strong>Make available offline</strong>.
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
          <strong>Stream mode by accident.</strong> If files show a cloud icon
          or take seconds to open, you&apos;re in Stream mode without
          per-folder offline. Switch to Mirror.
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
