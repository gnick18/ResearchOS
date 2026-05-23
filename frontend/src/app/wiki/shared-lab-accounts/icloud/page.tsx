import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ICloudPage() {
  return (
    <WikiPage
      intro="iCloud Drive Optimize Storage offloads unused files. Mark the ResearchOS folder Keep Downloaded so it stays local."
    >
      <Callout variant="warning" title="macOS only, realistically">
        iCloud Drive technically runs on Windows via the{" "}
        <a
          href="https://support.apple.com/guide/icloud-windows/welcome/icloud"
          target="_blank"
          rel="noopener noreferrer"
        >
          iCloud for Windows
        </a>{" "}
        app, but the experience is rough and Apple-specific permission quirks
        can break ResearchOS&apos;s folder access. If your lab has a mix of Mac
        and Windows users, we recommend OneDrive or Google Drive instead.
      </Callout>

      <h2>Enable iCloud Drive</h2>
      <p>
        On macOS, open <strong>System Settings → Apple ID → iCloud →
        iCloud Drive</strong>. Make sure it&apos;s turned on, and that the{" "}
        <strong>Desktop &amp; Documents Folders</strong> sub-option is enabled
        if you plan to put the lab folder under <code>~/Documents</code>.
      </p>

      <h2>Share the lab folder</h2>
      <Steps>
        <Step>
          One member creates an empty folder inside their iCloud Drive (e.g.,{" "}
          <code>LabName-ResearchOS</code>).
        </Step>
        <Step>
          Right-click the folder in Finder → <strong>Share</strong> →{" "}
          <strong>Collaborate</strong>. Set permissions to{" "}
          <em>Only invited people</em> and <em>Can make changes</em>.
        </Step>
        <Step>
          Send the share link to each lab member. They accept it on their Mac,
          and the folder appears in their iCloud Drive.
        </Step>
      </Steps>

      <h2>Keep Downloaded (every member, every Mac)</h2>
      <Steps>
        <Step>
          In Finder, navigate to the shared lab folder under iCloud Drive.
        </Step>
        <Step>
          Right-click the folder and choose <strong>Keep Downloaded</strong>{" "}
          (it&apos;s near the bottom of the context menu). Every file inside
          downloads and the small cloud-with-arrow icon disappears.
        </Step>
        <Step>
          Wait for the Finder sidebar&apos;s iCloud status to read &quot;Up to
          date&quot;.
        </Step>
        <Step>
          Open ResearchOS, click <strong>Link Folder</strong>, and pick that
          shared folder.
        </Step>
      </Steps>

      <Callout variant="tip" title="Folder picker may be slow">
        The folder picker can take up to a minute to open for iCloud Drive
        folders. This is normal; iCloud needs time to enumerate the folder
        tree. Wait for it rather than clicking again.
      </Callout>

      <Callout variant="tip" title="Or keep all of iCloud Drive local">
        If you&apos;d rather not have macOS offloading anything in iCloud,
        open <strong>System Settings &rarr; Apple ID &rarr; iCloud</strong>{" "}
        and turn off <strong>Optimize Mac Storage</strong>. Every file in
        your iCloud Drive stays on disk from then on. Reasonable if you
        have plenty of disk space and other iCloud folders that also need
        to be always-local; the per-folder route above is the lighter
        option.
      </Callout>

      <h2>Common pitfalls</h2>
      <ul>
        <li>
          <strong>Optimize Mac Storage</strong> (System Settings → Apple ID →
          iCloud) will re-offload files macOS decides you haven&apos;t used
          recently. <em>Keep Downloaded</em> overrides this per folder, so make
          sure it&apos;s set on the lab folder, not just on individual files.
        </li>
        <li>
          <strong>Permissions on shared collaborations</strong> are tracked by
          Apple ID. If someone&apos;s share is revoked, ResearchOS will see
          empty or unreadable files. Reaccept the share via the email link.
        </li>
        <li>
          <strong>Hidden <code>.icloud</code> placeholder files</strong> appear
          if the file is online-only. If you see <code>.taskname.json.icloud</code>{" "}
          instead of <code>taskname.json</code>, the file isn&apos;t local. Run{" "}
          <em>Keep Downloaded</em> again.
        </li>
      </ul>

      <h2>Apple documentation</h2>
      <ul>
        <li>
          <a
            href="https://support.apple.com/guide/mac-help/find-files-on-your-mac-with-icloud-drive-mh43995/mac"
            target="_blank"
            rel="noopener noreferrer"
          >
            Use iCloud Drive on your Mac (Apple Support)
          </a>
        </li>
        <li>
          <a
            href="https://support.apple.com/en-us/HT212614"
            target="_blank"
            rel="noopener noreferrer"
          >
            Collaborate on folders with iCloud Drive (Apple Support)
          </a>
        </li>
      </ul>
    </WikiPage>
  );
}
