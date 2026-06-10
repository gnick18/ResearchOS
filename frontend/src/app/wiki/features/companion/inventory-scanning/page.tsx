import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function CompanionInventoryScanningPage() {
  return (
    <WikiPage
      title="Inventory scanning"
      intro="Scan a barcode at the freezer to count stock down, see what is running low, and mark an ordered purchase as arrived. The Companion turns the phone into the scanner your inventory always wanted, so keeping stock current is a quick scan at the bench instead of a chore you do back at the laptop."
    >
      <p>
        Inventory only stays accurate if updating it is nearly free. The moment
        it takes a walk back to the laptop and a few clicks, people stop, and the
        list drifts into fiction. The Companion removes that friction. The
        barcode is already on the tube, the phone is already in your pocket, so
        counting a container down or confirming a delivery is a scan you do
        standing right where the reagent lives.
      </p>

      <Screenshot
        src="/wiki/screenshots/companion-inventory.png"
        alt="The Companion inventory screen on a phone, with the camera framing a reagent barcode and a list of low-stock items below."
        caption="Scan a barcode to count a container down; low-stock items are listed below."
      />
      {/* SCREENSHOT: Companion inventory screen on a phone with a barcode in the
          camera frame and a low-stock list. Capture from the dev-client. Save to
          frontend/public/wiki/screenshots/companion-inventory.png */}

      <h2>What you can do</h2>
      <ul>
        <li>
          <strong>Scan to track stock.</strong> Scan a container barcode to count
          that stock down, the same one-tap finish event you would do on the
          laptop, made faster with the phone&apos;s camera.
        </li>
        <li>
          <strong>See what is low.</strong> The screen shows the items running
          low, so a freezer check turns into a reorder list without opening your
          computer.
        </li>
        <li>
          <strong>Mark a purchase arrived.</strong> When a box shows up, mark the
          ordered purchase as <strong>arrived</strong> from the phone, so the
          delivery is logged at the receiving bench where it happens.
        </li>
      </ul>

      <h2>Where the data comes from</h2>
      <p>
        The inventory the phone shows is delivered by the laptop as a sealed
        inventory snapshot, so the relay carries your stock list without being
        able to read it. The phone unseals the snapshot with its own key, you act
        on it at the bench, and your scans flow back to keep the laptop&apos;s
        record current. The inventory of record still lives on the laptop; the
        phone is the fast scanning surface in front of it.
      </p>

      <Callout variant="info" title="It is the same inventory, just in your hand">
        Counting a container down on the phone is the same event as finishing one
        on the laptop, so the two stay in step. The full model, counting
        containers rather than volumes, the low and expiry signals, and how a
        received purchase becomes stock, is covered on the{" "}
        <Link href="/wiki/features/inventory">Inventory</Link> page. The Companion
        adds the bench-side scanner without changing how any of that works.
      </Callout>

      <Callout variant="tip" title="Close the loop without a round trip">
        Scan the last vial down at the freezer, see the item flip to low, and it
        is queued to reorder, all before you have walked back to your desk. The
        receiving end works the same way. A delivered box is marked arrived on the
        phone and becomes stock on the laptop, so ordering and inventory stay
        connected with no retyping.
      </Callout>
    </WikiPage>
  );
}
