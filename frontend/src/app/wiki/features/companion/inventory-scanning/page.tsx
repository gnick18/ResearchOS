import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function CompanionInventoryScanningPage() {
  return (
    <WikiPage
      title="Inventory scanning"
      intro="Scan a barcode at the freezer to count stock down, see what is running low, and receive a delivery. The Companion turns the phone into the scanner your inventory always wanted, so keeping stock current is a quick scan at the bench instead of a chore you do back at the laptop."
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
        src="/wiki/screenshots/companion-inventory-scan-flow.png"
        alt="The Companion scan flow on a phone: the camera viewfinder with corner bracket reticle framing a barcode, then the matched tracked-item card showing remaining units, a stock bar, and Deduct and Low, reorder ASAP buttons."
        caption="Scan a barcode. If it is tracked, the deduct view shows units remaining and a one-tap Deduct button. If it is low, the reorder button appears."
      />

      <h2>The full scan flow</h2>
      <p>
        Every scan starts the same way: tap <strong>Scan a package</strong> on
        the Inventory tab, point the phone at a barcode, and the app resolves it
        in one of two paths.
      </p>

      <h3>Recognized barcode (tracked item)</h3>
      <Steps>
        <Step>
          <p>
            The app matches the scan against your tracked-stock list and shows
            the item name, units remaining, total, and a stock bar. A{" "}
            <strong>Low</strong> or <strong>In stock</strong> pill appears on the
            right.
          </p>
        </Step>
        <Step>
          <p>
            Pick how many units you used with the quantity chips (1, 2, 3, or 5)
            and tap <strong>Deduct</strong>. The laptop applies the deduction on
            its next check.
          </p>
        </Step>
        <Step>
          <p>
            If the item is linked to a purchase order and is running low, a{" "}
            <strong>Low, reorder ASAP</strong> danger button appears. Tapping it
            posts a reorder action directly from the freezer door.
          </p>
        </Step>
      </Steps>

      <h3>Unrecognized barcode (new package)</h3>
      <Steps>
        <Step>
          <p>
            An amber callout says the barcode is not recognized. Below it, the
            app lists recent purchase orders awaiting arrival. If one looks like a
            match (vendor and name align), tap it to{" "}
            <strong>mark it arrived</strong>. The laptop links the barcode to that
            order.
          </p>
        </Step>
        <Step>
          <p>
            No matching order? Two options appear below the orders list:{" "}
            <strong>Add a purchase item</strong> (creates a purchase order and
            tracks the barcode at once) or{" "}
            <strong>Just track in stock</strong> (adds to inventory only, no
            purchase order).
          </p>
        </Step>
        <Step>
          <p>
            After arriving or adding, the optional{" "}
            <strong>Track this barcode</strong> step appears. Set how many units
            each scan counts as, how many are in the box, and the unit label
            (reaction, tube, mL, well, use). This makes every future scan of that
            barcode show the item by name with a live count. Tap{" "}
            <strong>No thanks</strong> to skip tracking.
          </p>
        </Step>
      </Steps>

      <h2>Add a purchase item manually</h2>
      <p>
        If you do not have a barcode to scan, the{" "}
        <strong>+ Add a purchase item</strong> button on the Inventory tab opens
        a form directly. Fill in the name, vendor, catalog number, and quantity,
        and the purchase is saved to your lab without needing a scan.
      </p>

      <h2>Reorder low filter</h2>
      <p>
        The <strong>Tracked items</strong> section on the Inventory tab shows all
        your tracked stock. When any item is low (remaining units at or below its
        reorder point), an action link appears next to the section label. Toggle
        it to <strong>Reorder low</strong> to filter the list down to only the
        items that need attention. Tap <strong>Show all</strong> to return to the
        full list.
      </p>

      <h2>Purchase orders list</h2>
      <p>
        Below tracked items, the <strong>Purchase orders</strong> section lists
        recent orders that have been placed but not yet marked arrived. Each row
        shows the item name, vendor, the date ordered, and an{" "}
        <strong>Ordered</strong> status pill. When a delivery comes in, scan the
        package barcode to mark it arrived and link it to the order automatically.
      </p>

      <h2>Where the data comes from</h2>
      <p>
        The inventory the phone shows is delivered by the laptop as a sealed
        inventory snapshot, so the relay carries your stock list without being
        able to read it. The phone unseals the snapshot with its own key, you act
        on it at the bench, and your scans flow back as device-signed actions the
        laptop applies on its next check. The inventory of record still lives on
        the laptop; the phone is the fast scanning surface in front of it.
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
        Scan the last vial down at the freezer, see the item flip to low, and tap
        the reorder button, all before you have walked back to your desk. When a
        delivery arrives, scan the box barcode to match it to the open order and
        mark it arrived at the receiving bench where it happens.
      </Callout>
    </WikiPage>
  );
}
