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
        method you are running, whether you are low on a reagent) are one
        pull-down away on the device already in your pocket.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-home.png"
        alt="The Companion app home screen on a phone, showing the five main actions and a connected status to a paired laptop."
        caption="The Companion home screen, paired to a laptop and ready to capture."
      />
      {/* SCREENSHOT: Companion app home screen on a phone, paired state, showing
          the five hero actions. Capture from the mobile dev-client build. Save to
          frontend/public/wiki/screenshots/companion-home.png */}

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
          handwriting becomes searchable text on the laptop, read on the device.
          See{" "}
          <Link href="/wiki/features/companion/scanning-notes">
            Scanning handwritten notes
          </Link>
          .
        </li>
        <li>
          <strong>Glance at today.</strong> Pull down a list of what is
          scheduled, overdue, and coming up. See{" "}
          <Link href="/wiki/features/companion/today-glance">Today glance</Link>.
        </li>
        <li>
          <strong>Read a method.</strong> Open the method for the experiment you
          are running, big and scrollable, and log a variation from the bench.
          See{" "}
          <Link href="/wiki/features/companion/view-method">
            View a method on your phone
          </Link>
          .
        </li>
        <li>
          <strong>Track inventory.</strong> Barcode-scan to count stock down,
          see what is low, and mark a purchase as arrived. See{" "}
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
        home screen offers a <strong>Try the demo</strong> path. It runs the app
        against sample data with a fake pairing, so you can walk through capture,
        scanning, today, methods, and inventory with no laptop in the loop.
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
            Camera permission, used for the pairing QR scan and for photos.
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
          the pull-down of what is due.
        </li>
        <li>
          <Link href="/wiki/features/companion/view-method">
            View a method on your phone
          </Link>
          , read steps and log a variation at the bench.
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
