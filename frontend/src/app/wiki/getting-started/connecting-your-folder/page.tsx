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
      <Callout variant="info" title="Chromium browsers only">
        ResearchOS uses the File System Access API, which is only available in
        Chromium-based browsers (Chrome, Edge, Brave). Safari and Firefox are
        not supported. See{" "}
        <Link href="/wiki/getting-started/browser-requirements">
          Browser Requirements
        </Link>{" "}
        for details.
      </Callout>

      <Screenshot
        src="/wiki/screenshots/folder-connect.png"
        alt="The folder-connect screen with two cards: Link Existing Folder on the left and Create New Folder on the right, plus a demo button and setup-guide link below."
        caption="The first screen you see on a fresh install. (Screenshot predates the drag-drop addition — see below.)"
      />

      <h2>What you&apos;ll do</h2>
      <Steps>
        <Step>
          Click <strong>Link Folder</strong> if you already have a ResearchOS
          folder. The button opens your operating system&apos;s folder picker.
          Alternatively, you can <strong>drag a folder directly onto the
          &ldquo;Link Existing Folder&rdquo; card</strong> instead of clicking
          the button. The card highlights with a dashed blue border and shows
          &ldquo;Drop your lab folder here, or click below to pick&rdquo; as
          you drag over it. Release to connect.
        </Step>
        <Step>
          To create a new folder, type a name in the <strong>Folder Name</strong>{" "}
          input on the <strong>Create New Folder</strong> card first. The{" "}
          <strong>Choose Location</strong> button is disabled until the name
          field is non-empty. Once you type a name, click{" "}
          <strong>Choose Location</strong> to open the OS folder picker and
          select where to save it.
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

      <Callout variant="info" title="Just kicking the tires?">
        Skip the folder picker and visit{" "}
        <Link href="/wiki/getting-started/demo-mode">Demo Mode</Link> instead.
        It opens the app at <code>/demo</code> with a seeded fake yeast lab
        you can click around in. No folder, no install, edits disappear on
        reload.
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
        After your first connect, ResearchOS remembers the folder name via
        browser storage. On your next visit, instead of the two-card picker
        you see a dedicated <strong>reconnect screen</strong>: it shows the
        folder name in a bold heading (<em>Reconnect to [your-folder]</em>)
        and a prominent <strong>Continue</strong> button that re-attaches
        without reopening the OS picker. A smaller{" "}
        <strong>Pick a different folder</strong> link below the button lets
        you switch to a different location if needed. The browser may show a
        one-time permission prompt the first time you reconnect after a
        browser restart.
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
