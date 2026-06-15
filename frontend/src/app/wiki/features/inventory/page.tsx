import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function InventoryFeaturePage() {
  return (
    <WikiPage
      title="Inventory"
      intro="The inventory you will actually keep. Most lab inventories die because they ask for precision the bench cannot sustain. Inventory in ResearchOS asks for almost nothing (a coarse count and the occasional one-tap status) and computes the signals that actually matter (what is expiring, what has gone stale, what is running low) from data you type once, or never."
    >
      <Screenshot
        src="/wiki/screenshots/inventory-signal-list.png"
        alt="The Inventory list view showing stock items grouped by signal, with colored status chips for expiring, low, and empty items and a search bar at the top."
        caption="The Inventory list with signal-driven grouping. Expiring, low, and empty items surface at the top so the most urgent reorders are visible without scrolling."
      />

      <h2>Why most lab inventories become fiction</h2>
      <p>
        Almost every electronic lab notebook ships an inventory, and almost
        every academic lab abandons the one it has. The reason is always the
        same. The system stores a precise running amount (for example
        &ldquo;47.3 mL remaining&rdquo;) and expects you to decrement it every
        time you pipette. Nobody does that for more than a week. Within a month
        the numbers are wrong, and within a quarter the whole inventory is
        fiction. A wrong inventory is worse than no inventory, because people
        trust it, skip a reorder, and find an empty bottle on experiment day.
      </p>
      <p>
        So Inventory is built around a different question. The question is not
        what we can track. It is what a busy lab will realistically keep current
        with near-zero effort, and how to make those few things produce real
        value. The answer is to count containers instead of volumes, flip status
        with one tap instead of doing math, and let the passage of time compute
        the rest.
      </p>

      <h2>The big idea, count containers not volumes</h2>
      <p>
        The primary number on a stock is a <strong>count of physical
        containers</strong>. Three vials, two bottles, one plate, a box of
        tips. You change that count only when a whole container is{" "}
        <strong>finished</strong> (you throw out the empty tube, three goes to
        two) or a new one <strong>arrives</strong>. That is an event that
        happens roughly monthly per item, it is unambiguous (the empty tube is
        in your hand), and it takes one tap. It never asks you to remember how
        much you used, do arithmetic, or update anything mid-experiment.
      </p>
      <p>
        There is an optional per-container amount label (for example &ldquo;1
        mL&rdquo; or &ldquo;100 ug&rdquo;) for people who want to record how big
        each container is, but it is never required and it is never decremented
        for you. It is a label, not a ledger. A lab that wants more detail can
        add it, and a lab that wants none never sees a number it is obligated to
        keep accurate.
      </p>
      <p>
        Alongside the count, every stock carries a coarse status (in stock,
        low, empty). You flip it with a one-tap control the moment you notice at
        the bench, because your eyeball is the sensor and no threshold math is
        needed for that to be useful. If you also set a low-at-count threshold
        (for example, flag when vials drop below two), the status flips itself
        and even the tap becomes optional. The point is that Inventory is useful
        whether you maintain a count, tap a status, both, or neither, and it
        degrades gracefully instead of lying.
      </p>

      <Callout variant="tip" title="Type expiry once, then forget it">
        Expiry is the one date worth typing, and you type it exactly once, when
        the tube arrives or straight off the vendor label. After that the
        calendar does the work forever. You never revisit it, and the
        expiring-soon signal stays correct on its own.
      </Callout>

      <h2>The three zero-upkeep signals</h2>
      <p>
        The payoff of an inventory is not the stock list you scroll. It is three
        signals, and all three are derived from data you enter once at receive,
        or not at all, and then maintained by the calendar rather than by you.
        These are the center of the feature, not an afterthought.
      </p>
      <ul>
        <li>
          <strong>Expiring soon and expired.</strong> Driven by the expiration
          date you typed once. The clock does the rest forever. This is what
          keeps you from running a failed experiment on dead reagent, or
          tossing money on an antibody that lapsed months ago.
        </li>
        <li>
          <strong>Stale and untouched.</strong> Driven by the received date
          (stamped automatically) plus the last time the record was touched
          (also automatic). Pure time math, zero ongoing input. This surfaces
          the six forgotten tubes in the back of the freezer, and the inverse, a
          critical reagent nobody has confirmed is still there.
        </li>
        <li>
          <strong>Low or empty.</strong> Driven by the container count and an
          optional low-at-count threshold, or by a single manual low tap. This
          is what keeps you from re-buying what you already have, and from
          discovering you are out on experiment day.
        </li>
      </ul>
      <p>
        None of these needs an accurate running total of anything. Expiry and
        staleness need zero ongoing input at all. That is the point. The value
        lives in signals that the passage of time computes for free.
      </p>

      <h2>The Supplies hub, where ordering becomes inventory</h2>
      <p>
        Inventory does not live alone. It shares a home with{" "}
        <Link href="/wiki/features/purchases">Purchases</Link> under a single
        Supplies hub, presented as two tabs. The reason they sit together is
        that one feeds the other. Purchases answers &ldquo;what did we
        buy.&rdquo; Inventory answers &ldquo;what do we have, where is it, and
        is it still good.&rdquo; The receive event is the seam between them.
      </p>
      <p>
        When you mark a purchase order <strong>received</strong>, which is
        something the buyer already does, Inventory offers to add it for you. It
        pre-fills the name, vendor, catalog number, and link from the line item
        you bought, defaults the container count to the quantity ordered, stamps
        the received date, and asks only for expiry and (optionally) a location.
        The buyer is already standing there with the box, so capturing it costs
        one extra field. Over a few months of normal ordering, the inventory
        builds itself out of the reagents the lab actually churns through, with
        no separate data-entry chore.
      </p>
      <p>
        The flow runs the other way too. When finishing a container drops an
        item below its low threshold, that item lands in the Purchases{" "}
        <strong>reorder queue</strong>, so &ldquo;we are nearly out&rdquo; turns
        into &ldquo;this is on the list to buy&rdquo; without anyone retyping the
        reagent. The loop closes (you buy it, you receive it, it becomes stock,
        you finish it, it queues to buy again) and each hand-off carries the
        details forward for you.
      </p>

      <Callout variant="info" title="Never start from a blank database">
        The bar to start an inventory is meant to be near zero. Received
        purchases populate it for you, hand-added items autocomplete their name,
        vendor, and catalog number from your past purchases, and you can skip
        location entirely with a free-text note like &ldquo;-80 door,
        left.&rdquo; Nobody is forced to build a freezer tree before recording
        that they own something.
      </Callout>

      <h2>Barcode scanning from the desktop webcam</h2>
      <p>
        Finishing a container is a roughly monthly one-tap event, and a barcode
        scan is simply that tap made faster. ResearchOS scans through your
        desktop webcam (the app is Chrome and Edge only, so the browser&apos;s
        built-in barcode reader is available), no separate hardware required.
      </p>
      <p>
        There are two things you can scan. A <strong>container code</strong> is
        a lab-applied label on one specific tube or box. Scanning it counts that
        container down by one, re-derives the status (to empty at zero, to low
        when it crosses your threshold), and drops the item into the reorder
        queue when it crosses low, all guarded by a quick-undo toast in case you
        mis-scanned. A <strong>product barcode</strong> is the manufacturer code
        shared by every container of a product. Scanning a known one finds the
        item, and scanning an unknown one starts registering it.
      </p>
      <p>
        Lab reagents from suppliers like NEB, Sigma-Aldrich, and Thermo Fisher
        mostly do not carry the retail barcodes that consumer databases know, so
        the high-value path is the lab-applied container code you control, not a
        manufacturer lookup. An optional product lookup can pre-fill name and
        vendor on a scanned manufacturer barcode, but it is a bonus rather than
        a dependency. It never blocks, it falls straight to manual entry when it
        misses, and it is off until you bring your own lookup key in settings, so
        no shared key gets burned.
      </p>

      <Callout variant="tip" title="Scan from your phone too">
        The Companion app on iOS and Android has a dedicated Inventory scanning
        tab that uses the phone camera as a barcode scanner, so you can scan
        container codes while standing at the freezer without needing a laptop
        webcam. See{" "}
        <Link href="/wiki/features/companion/inventory-scanning">
          Companion: inventory scanning
        </Link>{" "}
        for the full mobile flow.
      </Callout>

      <h2>The storage map</h2>
      <p>
        When you want to know not just that you own something but exactly where
        it sits, the storage map gives you a location tree (freezer, then rack,
        then box, nested as deep as your storage really goes) with a{" "}
        <strong>box grid</strong> at the bottom. The grid is a rows-by-columns
        layout with A1-style positions, the same cell scheme a plate uses, and
        each filled cell shows the stock that lives there. Cells are colored by
        status, so a box of expiring or low tubes reads at a glance.
      </p>
      <p>
        Click an empty cell to place a stock there, or a filled cell to see what
        it holds (item name, lot, expiry, count) and move or remove it. A
        breadcrumb above the grid shows the full path of the box you are looking
        at. The map is optional. You can run a perfectly useful inventory with
        nothing but the free-text location note, and reach for the freezer tree
        only when finding a specific tube is worth it.
      </p>

      <Screenshot
        src="/wiki/screenshots/inventory-storage-map.png"
        alt="The storage map panel showing a freezer tree on the left (freezer, rack, box hierarchy) and a rows-by-columns box grid on the right with colored cells indicating stock status."
        caption="The storage map. Navigate the location tree on the left and click any cell to see what sits there or to move a stock in or out."
      />

      <h2>Spreadsheet import for an existing inventory</h2>
      <p>
        If your lab already keeps a list somewhere (and most do, usually a
        spreadsheet), you do not have to re-enter it. The import path lets you{" "}
        <strong>paste straight from Excel or Google Sheets</strong> to bulk-load
        what you already have, so an existing inventory comes across in one
        action instead of one row at a time. Combined with the self-populating
        receive flow, this means the cold start, the part where most inventories
        never get off the ground, is close to free.
      </p>

      <h2>Item categories</h2>
      <p>
        Every inventory item belongs to exactly one category. The category you
        choose drives which extra typed fields appear in the detail editor. The
        full set of categories is listed below.
      </p>
      <ul>
        <li>
          <strong>Reagent</strong> (the default). Generic chemical or consumable
          with no typed extension fields.
        </li>
        <li>
          <strong>Antibody</strong>. Carries target, host species, clonality and
          clone, conjugate, isotype, reactivity, applications (for example WB,
          IF, IHC, FACS), recommended dilution, and an RRID for reproducibility.
          Antibodies are also the textbook case for opt-in precise consumption
          tracking, since they are expensive, finite, and often shared between
          users.
        </li>
        <li>
          <strong>Plasmid</strong>. Carries backbone, insert, resistance,
          bacterial host, size in base pairs, source and Addgene number, and an
          attached sequence file. Lines up with the cloning and sequencing work
          elsewhere in the app.
        </li>
        <li>
          <strong>Enzyme</strong>, <strong>Primer</strong>,{" "}
          <strong>Cell line</strong>, <strong>Strain</strong>. Plain categories
          with no extra typed fields today. A future version will add typed
          fields to each the same way antibodies and plasmids were extended.
        </li>
        <li>
          <strong>Kit</strong>. A multi-component commercial kit treated as a
          single inventory record. Track kit lots and expiry dates without
          splitting the kit into individual components.
        </li>
        <li>
          <strong>Equipment</strong>. A single piece of shared equipment.
          Equipment items have no container-count semantics since there is
          normally one instance, but they carry storage location, expiry (for
          calibration deadlines), and the same staleness signals as any other
          item.
        </li>
        <li>
          <strong>Other</strong>. For anything that does not fit the categories
          above.
        </li>
      </ul>
      <p>
        All categories share the same stock list, storage positions, expiry,
        staleness signals, low-count threshold, history, trash, search, and
        sharing. The category only controls which extra fields the detail editor
        renders.
      </p>

      <h2>Precise consumption is opt-in, never the default</h2>
      <p>
        The volume-ledger model that sinks most inventories (deduct a few
        microliters per experiment) is the right tool for a narrow set of cases,
        like an expensive monoclonal antibody, a controlled substance, or a
        shared aliquot people argue over. For those, a precise per-use record is
        worth the effort because the stakes justify it.
      </p>
      <p>
        So that behavior is an explicit per-item toggle, off by default. When
        off, which is the vast majority, the item lives entirely in the count,
        status, and expiry world above, and you never see a volume field you are
        obligated to maintain. When on, that one item exposes the deduct-from-
        stock workflow and a per-use audit trail. Inventory is fully useful with
        consumption tracking off for every item. It is a power feature you reach
        for when a specific reagent earns it, not a foundation everything sits
        on.
      </p>

      <Callout variant="info" title="History, trash, search, and sharing come for free">
        Inventory rides the same rails as the rest of ResearchOS, so every item
        and stock inherits{" "}
        <Link href="/wiki/features/version-history">version history</Link>,{" "}
        <Link href="/wiki/features/trash">trash with a recovery window</Link>,{" "}
        <Link href="/wiki/features/search">search</Link>, and{" "}
        <Link href="/wiki/features/sharing-and-permissions">
          sharing and permissions
        </Link>{" "}
        with no inventory-specific machinery. In a shared lab folder, new
        inventory records default to whole-lab edit, so the lab gets a de-facto
        shared inventory while every item stays attributable to whoever added
        it.
      </Callout>
    </WikiPage>
  );
}
