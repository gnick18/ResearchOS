import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function CompanionFeaturePage() {
  return (
    <WikiPage
      title="Companion"
      intro="The Companion is a phone app that pairs to the laptop running ResearchOS, so the work you do at the bench (snap a gel, scan a handwritten page, glance at today, follow a method, track stock) lands in the right experiment without walking back to your computer. Your phone is where the bench happens, and the Companion makes it a real part of your notebook instead of a camera roll you transcribe later."
    >
      <p>
        Most lab notebooks assume you are sitting at a keyboard. Real lab work
        happens standing at a bench with gloves on, a gel in one hand and a
        timer running. The Companion exists for that moment. It is a small,
        focused app for iOS and Android that talks to your laptop, so a photo
        you take or a page you scan files itself into the correct experiment,
        and the things you need to check (what is due today, the steps of the
        method you are running, whether you are low on a reagent) are one tap
        away on the device already in your pocket.
      </p>

      <h2>Navigation at a glance</h2>
      <p>
        The Companion is built around four bottom tabs plus a center Capture
        button. The tabs stay visible on every screen so you can switch tasks
        without backtracking.
      </p>
      <ul>
        <li>
          <strong>Home.</strong> The glance surface. A greeting, a live status
          card (lab name and connection freshness), a Today section (overdue,
          today, upcoming tasks from the laptop), a Tools launcher (Timers,
          Calc, Wiki, Sync), and a Recent list of your latest captures. The
          notification bell and settings icon live in the Home header.
        </li>
        <li>
          <strong>Notebook.</strong> Capture actions for the bench: Take a
          photo, Quick note, Scan a handwritten note, Upload from camera roll,
          and View method on phone. Sends use the{" "}
          <strong>NotebookChooser</strong> to route each item into the right
          notebook or experiment. The captured photo outbox (Inbox) appears
          below when photos are queued.
        </li>
        <li>
          <strong>Methods.</strong> Your full protocol library, browsable and
          searchable offline. See{" "}
          <Link href="/wiki/features/companion/view-method">
            View a method on your phone
          </Link>{" "}
          for details on offline download, favorites, and the active-experiment
          recommendations band.
        </li>
        <li>
          <strong>Inventory.</strong> Scan a package barcode to receive,
          deduct, or reorder. See{" "}
          <Link href="/wiki/features/companion/inventory-scanning">
            Inventory scanning
          </Link>
          .
        </li>
      </ul>
      <p>
        The center button in the tab bar is a Capture action, not a tab. Tapping
        it opens the Notebook capture surface so you can shoot a photo or scan a
        page directly, without first switching to the Notebook tab. Calc, Timers,
        and Wiki are also reachable but are launched from the Home hub Tools
        launcher, not from the tab bar.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-home-hub.png"
        alt="The redesigned Companion Home tab on a phone, showing the greeting, live status card, Today task section, Tools launcher tiles for Timers, Calc, Wiki, and Sync, and the Recent captures list."
        caption="The Companion Home hub: greeting, status card, Today, Tools launcher, and Recent. Notification bell and settings icons live in the header."
      />

      <h2>Home hub in detail</h2>
      <p>
        The Home tab is the starting point every time you unlock your phone at
        the bench. Its contents update on focus and reflect your live lab state.
      </p>
      <ul>
        <li>
          <strong>Greeting and status card.</strong> A time-of-day greeting
          using your first name (stripped from the paired display name), next to
          a pill showing the lab name, connection state (Live / Offline / Idle),
          and last-synced freshness.
        </li>
        <li>
          <strong>Active experiments band.</strong> When the laptop has an open
          experiment, a scrollable strip appears so you can tap straight into
          its method.
        </li>
        <li>
          <strong>Running timer.</strong> When a Companion timer is active, a
          live countdown card appears here. Tap it to jump to the Timers screen.
        </li>
        <li>
          <strong>Today.</strong> Overdue tasks surface at the top in red,
          today&apos;s scheduled tasks below in blue, and upcoming tasks in
          amber. The count of due items shows next to the label.
        </li>
        <li>
          <strong>Tools launcher.</strong> Four tiles: Timers (bench countdown),
          Calc (lab calculator), Wiki (the ResearchOS help docs), and Sync
          (force a fresh pull from the laptop). All four are reachable with one
          tap.
        </li>
        <li>
          <strong>Recent.</strong> The last three captures from your outbox,
          each showing its caption and send status (Queued, Sending, Sent,
          Failed). Hidden when the outbox is empty.
        </li>
      </ul>

      <h2>Today panel</h2>
      <p>
        The <strong>Today panel</strong> is a full-screen overlay that opens
        from the <strong>Today</strong> button in the Notebook tab&apos;s
        header. The button shows an amber count badge when tasks are due or
        overdue. The panel slides down over the screen and can be dismissed
        with a swipe or a tap on the scrim. It is not a pull-down of the
        Notebook body. See{" "}
        <Link href="/wiki/features/companion/today-glance">Today glance</Link>{" "}
        for the three stat tiles and task rows it contains.
      </p>

      <h2>The five things it does at the bench</h2>
      <p>
        The Companion is deliberately small. It does the handful of things that
        are genuinely better on a phone than on a laptop, and it sends each
        result back to the laptop where the rest of your notebook lives.
      </p>
      <ul>
        <li>
          <strong>Capture and route a photo.</strong> Take or upload a photo,
          caption it, and file it straight into an experiment&apos;s Lab Notes
          or Results. See{" "}
          <Link href="/wiki/features/companion/capture-and-route">
            Capture and route
          </Link>
          .
        </li>
        <li>
          <strong>Scan a handwritten page.</strong> Scan a notebook page and the
          handwriting becomes searchable text on the laptop. See{" "}
          <Link href="/wiki/features/companion/scanning-notes">
            Scanning handwritten notes
          </Link>
          .
        </li>
        <li>
          <strong>Glance at today.</strong> Open the Today panel to see what is
          scheduled, overdue, and coming up. See{" "}
          <Link href="/wiki/features/companion/today-glance">Today glance</Link>.
        </li>
        <li>
          <strong>Read a method.</strong> Browse your offline method library or
          open the method for the experiment you are running. See{" "}
          <Link href="/wiki/features/companion/view-method">
            View a method on your phone
          </Link>
          .
        </li>
        <li>
          <strong>Track inventory.</strong> Barcode-scan to count stock down,
          see what is low, and receive a delivery. See{" "}
          <Link href="/wiki/features/companion/inventory-scanning">
            Inventory scanning
          </Link>
          .
        </li>
      </ul>

      <h2>Get the app</h2>
      <p>
        The Companion ships as a dev-client build for iOS and Android, not as a
        listing you install from Expo Go. Once you have the app on your phone,
        the only setup is a one-time pairing to a laptop running ResearchOS,
        covered on the{" "}
        <Link href="/wiki/features/companion/pairing">Pairing</Link> page. There
        is no account to create and no password to set, because pairing is done
        with public keys rather than a login.
      </p>
      <p>
        If you want to see what the app does before pairing a real laptop, the
        pairing screen offers a <strong>Try the demo</strong> path. It runs the
        app against sample data with a fake pairing, so you can walk through
        capture, scanning, today, methods, and inventory with no laptop in the
        loop.
      </p>

      <h2>Why your captures stay private</h2>
      <p>
        The Companion talks to the laptop through a relay server, but that relay
        is built so it can never read what passes through it. Every snapshot the
        laptop sends and every command the phone sends is sealed end-to-end to
        the phone&apos;s own X25519 key with authenticated encryption, so the
        relay only ever holds ciphertext, not the key to open it. A breach of the
        relay cannot read your captures, because the relay never had the key in
        the first place.
      </p>
      <p>
        Captured images go one step further. The moment the laptop pulls a photo
        off the relay, that photo is deleted from the relay. The relay is a
        hand-off point, not storage. And like the rest of ResearchOS, the
        Companion is local-first, so your captures, notes, and timers stay on the
        phone until you choose to send them, and the app keeps working when you
        are offline (a basement microscope room, a cold room, a spotty corner of
        the building).
      </p>

      <Callout variant="info" title="Requirements at a glance">
        <ul>
          <li>A dev-client build of the Companion on iOS or Android.</li>
          <li>
            A one-time pairing to a laptop running ResearchOS before first use.
          </li>
          <li>
            Camera permission, used for the pairing QR scan, bench photos, and
            barcode scanning.
          </li>
          <li>
            Notification permission is optional. Timers run without it; you just
            will not get a banner when one finishes.
          </li>
        </ul>
      </Callout>

      <h2>Start here</h2>
      <p>
        New to the Companion? Pair your phone first, then work through the
        actions in whatever order matches your bench.
      </p>
      <ul>
        <li>
          <Link href="/wiki/features/companion/pairing">Pairing</Link>, the
          one-time QR setup that links your phone to a laptop.
        </li>
        <li>
          <Link href="/wiki/features/companion/capture-and-route">
            Capture and route
          </Link>
          , photos that file themselves into the right experiment.
        </li>
        <li>
          <Link href="/wiki/features/companion/scanning-notes">
            Scanning handwritten notes
          </Link>
          , handwriting that becomes searchable text.
        </li>
        <li>
          <Link href="/wiki/features/companion/today-glance">Today glance</Link>,
          the full-screen panel of what is due.
        </li>
        <li>
          <Link href="/wiki/features/companion/view-method">
            View a method on your phone
          </Link>
          , browse the offline library or read steps and log a variation at the
          bench.
        </li>
        <li>
          <Link href="/wiki/features/companion/inventory-scanning">
            Inventory scanning
          </Link>
          , barcode-scan to track stock.
        </li>
      </ul>
    </WikiPage>
  );
}
