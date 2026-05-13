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

      <h2>How purchases and funding accounts fit together</h2>
      <p>
        Two things live on this tab and they pair up:
      </p>
      <ul>
        <li>
          <strong>Funding accounts</strong> are lab-wide budgets (e.g.,{" "}
          <em>NIH R01 GM-141289</em>, <em>USDA Hatch</em>). They live at{" "}
          <code>lab/funding_accounts/</code> and are visible to every user in
          the folder. Each account has a total budget and a running spend.
        </li>
        <li>
          <strong>Purchase items</strong> are individual orders (e.g.,{" "}
          <em>ITS1F primers, IDT</em>). Each one debits exactly one funding
          account. Purchases are per-user, so your shopping list and your
          labmate&apos;s are separate.
        </li>
      </ul>
      <p>
        The page rolls everyone&apos;s purchases up into per-account totals at
        the top, so the lab as a whole can see how much of each grant has
        been spent.
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
        src="/wiki/screenshots/purchases-funding-modal.png"
        alt="The Manage Funding Accounts modal showing existing accounts with budgets and remaining balances."
        caption="The Manage Funding Accounts modal: the lab-wide budget settings."
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
