import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { Steps, Step } from "@/components/wiki/Steps";

export default function PurchasesFeaturePage() {
  return (
    <WikiPage
      title="Purchases & Funding"
      intro="Track reagents and equipment you need to buy, and which funding account is paying for them."
    >
      <Screenshot
        src="/wiki/screenshots/purchases-list.png"
        alt="The Purchases page with unpurchased and purchased columns and per-funding-account totals."
        caption="Unpurchased on the left, purchased on the right, per-account totals at the top."
      />

      <h2>Two columns and a budget bar</h2>
      <p>
        The Purchases page has two columns of cards (<strong>Unpurchased</strong>
        on the left, <strong>Purchased</strong> on the right) and a row of
        budget totals along the top. Each card is one order — an item, its
        vendor, the price, and which funding account is paying. Drag a card
        from left to right when the order arrives.
      </p>
      <p>
        The totals along the top are per <strong>funding account</strong>{" "}
        (e.g., your R01, an internal bridge grant). Funding accounts are
        shared across the whole lab, so when your labmate buys reagents the
        budget bar updates here too. Add or edit accounts from{" "}
        <strong>Manage Funding Accounts</strong>.
      </p>

      <h2>Add a purchase</h2>
      <Steps>
        <Step>
          Click <strong>New Purchase</strong>. Enter the item name, vendor,
          quantity, and unit cost.
        </Step>
        <Step>
          Pick a <strong>funding account</strong> from the drop-down. The
          drop-down is shared with the lab, so if a teammate just added a new
          grant it&apos;ll show up here too.
        </Step>
        <Step>
          The item lands in the <strong>Unpurchased</strong> column. When the
          order goes in, mark it <strong>Purchased</strong>. It moves to the
          right column and counts against the funding account&apos;s spend.
        </Step>
      </Steps>

      <h2>Manage funding accounts</h2>
      <Screenshot
        src="/wiki/screenshots/purchases-funding-panel.png"
        alt="The Manage Funding Accounts panel expanded inline on the Purchases page, showing existing accounts with budgets and remaining balances."
        caption="The Manage Funding Accounts panel: the lab-wide budget settings, expanded inline."
      />
      <p>
        Click <strong>Manage Funding Accounts</strong> to add or edit an
        account (e.g., grant name, code, total budget). The list is shared
        with everyone in the lab folder. The Purchases page shows running
        totals per account so you can see at a glance how much budget remains.
      </p>

      <Callout variant="tip" title="Quick filter">
        Use the funding-account drop-down at the top of the page to filter
        the list. Combined with the Purchased / Unpurchased split, you get a
        per-grant shopping list in one click.
      </Callout>
    </WikiPage>
  );
}
