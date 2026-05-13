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
      />

      <h2>Add a purchase</h2>
      <Steps>
        <Step>
          Click <strong>New Purchase</strong>. Enter the item name, vendor,
          quantity, and unit cost.
        </Step>
        <Step>
          Optionally pick a <strong>funding account</strong> from the
          drop-down. Funding accounts are shared across the lab and live
          under <code>lab/funding_accounts/</code>.
        </Step>
        <Step>
          The item lands in the <strong>Unpurchased</strong> column. When the
          order goes in, mark it <strong>Purchased</strong> — it moves to the
          right column and counts against the funding account&apos;s spend.
        </Step>
      </Steps>

      <h2>Funding accounts</h2>
      <p>
        Click <strong>Manage Funding Accounts</strong> to add a new account
        (grant name, code, total budget). The list is shared with everyone in
        the lab folder. The Purchases page shows running totals per account so
        you can see at a glance how much budget remains.
      </p>

      <Callout variant="tip" title="Quick filter">
        Use the funding-account drop-down at the top of the page to filter the
        list. Combined with the Purchased / Unpurchased split, you get a
        per-grant shopping list in one click.
      </Callout>
    </WikiPage>
  );
}
