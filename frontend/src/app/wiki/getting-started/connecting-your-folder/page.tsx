import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function ConnectingYourFolderPage() {
  return (
    <WikiPage
      intro="Pick a folder on your disk. ResearchOS will read and write JSON files inside it (no cloud, no upload). On a brand-new visit, BeakerBot waves at you from the upper-right with an optional 3-minute walkthrough you can take before linking anything."
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
        caption="The first screen you see on a fresh install. (Screenshot pending recapture: the current layout floats BeakerBot in the upper-right corner with a Take the 3-minute walkthrough CTA, and the RISE credentials stamp sits in the bottom-right. The two cards in the middle still drive the folder link/create flow described below.)"
      />

      <h2>The page layout, at a glance</h2>
      <p>
        Three things are on this screen on a first visit:
      </p>
      <ul>
        <li>
          <strong>The two folder cards in the middle</strong>: Link Existing
          Folder on the left, Create New Folder on the right. Either one starts
          the actual folder-link flow.
        </li>
        <li>
          <strong>BeakerBot in the upper-right</strong>: a small sky-blue
          beaker mascot waving at you. Below the mascot is a white speech
          bubble that explains the optional walkthrough, plus a button labeled{" "}
          <strong>Take the 3-minute walkthrough</strong>. Skip past it
          entirely if you already know what you want to do.
        </li>
        <li>
          <strong>The RISE credentials stamp in the bottom-right</strong>: a
          small badge that names the academic project this app was built under
          (a UW-Madison RISE grant). Pure authority signal; nothing to click.
        </li>
      </ul>

      <Callout variant="tip" title="The walkthrough is optional and doesn't link a folder">
        Clicking <strong>Take the 3-minute walkthrough</strong> opens a 4-beat
        modal (welcome, data security, folder choice, cloud provider). It
        runs the BeakerBot intro in slide form, then closes and returns you to
        this same picker. The modal never picks a folder for you. Returning
        users skip it entirely. See{" "}
        <em>The optional walkthrough modal</em>, below, for what each beat
        covers.
      </Callout>

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
          <code>shared/</code>) and shows the user-picker screen. After you
          pick or create a username, the in-product BeakerBot tour auto-fires
          on the empty account. That tour is a different thing from the
          walkthrough modal on this picker page; see{" "}
          <Link href="/wiki/getting-started/welcome-wizard">
            Welcome Tour (BeakerBot)
          </Link>{" "}
          for the breakdown.
        </Step>
      </Steps>

      <h2>The optional walkthrough modal</h2>
      <p>
        The <strong>Take the 3-minute walkthrough</strong> button on the
        picker opens a small 4-beat modal that introduces the app before you
        commit to picking a folder. It is opt-in, not auto-fire: brand-new
        users see the speech bubble&apos;s gentle nudge (&ldquo;New here? It
        is strongly recommended to take a short onboarding walkthrough (2-3
        minutes). Returning? Just take it from here.&rdquo;), and returning
        users ignore it entirely. The four beats are:
      </p>
      <ol>
        <li>
          <strong>Welcome.</strong> BeakerBot waves and gives you a two-sentence
          pitch for ResearchOS. There is also a small heart easter egg if you
          click the mascot.
        </li>
        <li>
          <strong>Data security.</strong> The core promise: your data NEVER
          leaves your computer. No upload, no central server, no telemetry on
          your research. See <Link href="/wiki/security">Security</Link> for
          the full story.
        </li>
        <li>
          <strong>Folder choice.</strong> Local (recommended for solo) or
          cloud-synced (for cross-device or multi-person lab). Local skips
          the next beat and closes the modal; cloud advances to beat 4.
        </li>
        <li>
          <strong>Cloud provider.</strong> Picks the cloud you want to host
          the folder in (OneDrive, Google Drive, Dropbox, Box, iCloud) and
          links you to the per-provider setup guide. Closing the modal returns
          you to the picker; the folder link itself still happens through the
          picker cards above.
        </li>
      </ol>
      <p>
        A small <strong>Skip</strong> link sits in the corner of every beat
        so you can bail back to the picker at any time. The modal does NOT
        write anything to disk and does NOT persist a &ldquo;seen&rdquo; flag;
        reopening it is a one-click decision you make each visit.
      </p>

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
