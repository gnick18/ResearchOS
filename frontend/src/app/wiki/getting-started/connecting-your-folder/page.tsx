import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ConnectingYourFolderPage() {
  return (
    <WikiPage
      intro="Pick a folder on your disk. ResearchOS will read and write JSON files inside it (no cloud, no upload)."
    >
      <Screenshot
        src="/wiki/screenshots/folder-connect.png"
        alt="The Connect Folder screen with the central Connect Folder button highlighted."
        caption="The first screen you see on a fresh install."
      />

      <h2>What you&apos;ll do</h2>
      <Steps>
        <Step>
          Click <strong>Connect Folder</strong> on the welcome screen. Your
          operating system&apos;s folder picker opens.
        </Step>
        <Step>
          Pick an <strong>empty folder</strong> (or create a new one) on your
          disk. A name like <code>ResearchOS</code> or <code>lab-data</code> is
          fine.
        </Step>
        <Step>
          The browser asks for permission to read and write that folder. Click{" "}
          <strong>Allow on every visit</strong> so you don&apos;t get reprompted.
        </Step>
        <Step>
          ResearchOS initializes the folder structure (e.g., <code>users/</code>,{" "}
          <code>shared/</code>) and shows the user-picker screen.
        </Step>
      </Steps>

      <Callout variant="tip" title="Already have data? Pick the same folder.">
        If you&apos;ve used ResearchOS before, point it at the same folder you
        used last time. Your projects, tasks, methods, and notes will load
        exactly as you left them.
      </Callout>

      <h2>What gets created inside the folder</h2>
      <p>
        ResearchOS creates a simple tree the first time you connect:
      </p>
      <pre className="my-3 rounded-lg bg-gray-50 border border-gray-200 px-4 py-3 overflow-x-auto text-[12px] text-gray-700 font-mono leading-relaxed">{`your-folder/
├── users/
│   ├── <your-username>/
│   │   ├── projects/
│   │   ├── tasks/
│   │   ├── methods/
│   │   ├── notes/
│   │   ├── Images/
│   │   └── settings.json
│   └── public/        ← shared methods & protocols
└── lab/               ← shared funding accounts`}</pre>

      <p>
        Everything is plain JSON and plain image files. You can back up the
        folder by copying it, version-control it with git, or open it in Finder
        / Explorer at any time.
      </p>

      <h2>Reconnecting later</h2>
      <p>
        After your first connect, ResearchOS remembers the folder via the
        browser&apos;s storage. On the next visit, it tries to reconnect
        silently. If the browser has forgotten the permission, you&apos;ll see a
        small <strong>Allow</strong> dialog. This is much faster than picking
        the folder again.
      </p>

      <Callout variant="warning" title="Clearing site data disconnects you">
        If you clear the site&apos;s data (e.g., browser settings → clear data),
        the folder handle is wiped. Your data on disk is untouched. You just
        have to pick the folder again next time you open ResearchOS.
      </Callout>

      <h2>Setting up a shared lab folder</h2>
      <p>
        If multiple people in your lab should share one folder, put the folder
        inside OneDrive, Google Drive, Dropbox, or iCloud, and follow{" "}
        <Link href="/wiki/shared-lab-accounts">Shared Lab Accounts</Link>. The
        critical step is making sure the folder is{" "}
        <strong>always available offline</strong> on every member&apos;s laptop.
      </p>
    </WikiPage>
  );
}
