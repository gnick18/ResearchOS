import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionPairingPage() {
  return (
    <WikiPage
      title="Pairing"
      intro="Pairing is the one-time step that links your phone to a laptop running ResearchOS. You scan a QR code shown on the laptop, the two devices exchange public keys, and from then on your phone can send captures and pull glances from that laptop. There is no account and no password, because pairing proves the link with cryptographic keys instead of a login."
    >
      <p>
        Before the Companion can do anything useful, it needs to know which
        laptop it is working with. A lab has many people and many machines, and a
        photo you snap has to land in your notebook, not someone else&apos;s. So
        the first thing the app asks you to do is pair, and pairing is built
        around a QR code the laptop shows and the phone scans.
      </p>

      <h2>Why a QR code, and why no password</h2>
      <p>
        Pairing has to do two jobs at once. It has to be quick enough that nobody
        avoids it, and it has to be trustworthy enough that a capture cannot be
        misrouted or read by anyone else. A QR code scanned in person does both.
        The laptop shows a code that carries a signed grant, the phone scans it
        face to face, and the in-person scan is itself the proof that this phone
        belongs with this laptop. No password to type, mistype, or share, and no
        account to create.
      </p>
      <p>
        When you scan, the phone verifies the grant is genuinely signed, then
        generates its own device keys and registers with the relay under those
        keys. From that point on, everything the laptop sends to your phone is
        sealed to your phone&apos;s key, so the relay in the middle only ever
        carries ciphertext. The keys, not a shared secret, are what make the link
        safe.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-pairing-qr.png"
        alt="The Companion hub on a laptop showing a pairing QR code, next to the phone's camera view framing that code during a scan."
        caption="The laptop's Companion hub shows the pairing QR; the phone scans it to link the two devices."
      />
      {/* SCREENSHOT: split or side-by-side of the laptop Companion hub pairing QR
          and the phone scanning it. Capture the laptop side with ?wikiCapture=1
          and the phone side from the dev-client. Save to
          frontend/public/wiki/screenshots/companion-pairing-qr.png */}

      <h2>Pair your phone</h2>
      <Steps>
        <Step>
          <p>
            On the laptop, open the <strong>Companion hub</strong> from the
            button in the app header. It shows a pairing QR code.
          </p>
        </Step>
        <Step>
          <p>
            On the phone, open the Companion and choose to pair. Grant{" "}
            <strong>camera permission</strong> when asked, since the app needs
            the camera to read the code.
          </p>
        </Step>
        <Step>
          <p>
            Point the phone at the QR code on the laptop screen. The phone
            verifies the signed grant, generates its device keys, and registers
            with the relay.
          </p>
        </Step>
        <Step>
          <p>
            The app confirms the link and drops you on the home screen. You are
            paired, and you only do this once for that laptop.
          </p>
        </Step>
      </Steps>

      <Callout variant="info" title="Camera permission is for the QR and for photos">
        The camera permission you grant during pairing is the same one the app
        uses later to take photos and scan barcodes. You are asked once, at the
        moment the code needs scanning, so the request makes sense in context.
      </Callout>

      <h2>Try the demo without a laptop</h2>
      <p>
        If you want to look around before you pair anything real, the pairing
        screen has a <strong>Try the demo</strong> option. It runs a fake pairing
        against sample data, so the app behaves as though it is connected to a
        laptop full of experiments without one being present. Every screen works,
        nothing you do there touches a real notebook, and you can leave the demo
        and pair for real whenever you are ready.
      </p>

      <h2>Laptop-side settings</h2>
      <p>
        Two companion preferences live in the laptop&apos;s{" "}
        <strong>Companion hub</strong> (the phone button in the app header, or
        Settings). Both are in the hub&apos;s <strong>Settings</strong> tab.
      </p>
      <ul>
        <li>
          <strong>Show Companion button on Home.</strong> Toggles the phone
          button in the app header. When off, the Companion is still reachable
          from Settings, but the button does not appear on every page.
        </li>
        <li>
          <strong>Auto-publish snapshots to paired phones.</strong> Controls
          whether the laptop actively pushes today, inventory, and notebook
          snapshots to paired phones. When off, the phone can still pull
          snapshots manually (pull-to-refresh), but the laptop stops the
          automatic push.
        </li>
      </ul>

      <Callout variant="tip" title="Pair once, then forget it">
        Pairing is a setup step, not a daily one. After your phone is linked to
        your laptop, capturing a photo, scanning a page, or glancing at today
        just works. The next stop is{" "}
        <Link href="/wiki/features/companion/capture-and-route">
          Capture and route
        </Link>
        , where that first photo files itself into an experiment.
      </Callout>
    </WikiPage>
  );
}
