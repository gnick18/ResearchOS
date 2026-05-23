import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function LabModePurchasesPage() {
  return (
    <WikiPage
      title="Lab-wide purchases"
      intro="Every purchase order from every selected user, rolled up by funding account. Built for the 'how much grant money is left?' question."
    >
      <Screenshot
        src="/wiki/screenshots/lab-mode-purchases.png"
        alt="The Purchases tab in Lab Mode showing funding-account cards along the top and a list of purchase orders below."
        caption="Funding accounts sit at the top. Click any card to filter the list below to only that account's spend."
      />

      <h2>What you&apos;re looking at</h2>
      <p>
        The personal Purchases page tracks one user&apos;s spend. The Lab Mode
        version pulls in every selected user&apos;s purchase orders and groups
        the spend by funding account, so a Lab Head or admin can see how the lab is
        burning down each grant.
      </p>
      <p>The page is two stacked layers:</p>
      <ul>
        <li>
          <strong>Funding accounts overview</strong> on top: a card per
          account with budget, total spent, in-view spent, and remaining.
        </li>
        <li>
          <strong>Purchase orders</strong> on the bottom: either a flat list
          of orders or a summary view with per-month, per-user, and
          per-project rollups.
        </li>
      </ul>

      <Callout variant="info" title="Stats row and conditional sections">
        A stats row at the top of the page shows Total Purchases, Completed,
        Pending, and Spent for the current user and funding-account selection
        at a glance. The funding-accounts section below it only renders when at
        least one funding account exists in the lab folder; if no accounts have
        been created yet, you go straight to the purchase order list.
      </Callout>

      <h2>Funding-account cards</h2>
      <p>Each card shows four numbers and a progress bar:</p>
      <ul>
        <li>
          <strong>Spent</strong>: the total burned on this account across the
          whole lab, regardless of who&apos;s selected in the user filter.
        </li>
        <li>
          <strong>In view</strong>: the subset of that spend coming from the
          users you have currently selected. Lets you scope to one person or a
          subteam.
        </li>
        <li>
          <strong>Budget</strong>: the total budget set on the account when
          it was created. Edit this from the personal Purchases page.
        </li>
        <li>
          <strong>Remaining</strong>: budget minus spent. The dollar amount
          goes red when you&apos;re over budget, emerald otherwise.
        </li>
      </ul>
      <p>
        The progress bar mirrors the same color logic: emerald under 80%
        spent, amber between 80% and 100%, red over budget. A small badge in
        the top-right of the card spells out <strong>Low</strong> or{" "}
        <strong>Over Budget</strong> when either threshold is hit.
      </p>
      <p>
        An extra dashed <strong>Uncategorized</strong> card shows up if any
        line items in view don&apos;t have a funding account assigned. Useful
        for noticing receipts that nobody categorized yet.
      </p>

      <h2>Filtering by funding account</h2>
      <p>
        Clicking a funding card toggles it as a filter. The list below
        narrows to purchase orders that touched that account, and the summary
        view&apos;s rollups recompute for that subset. Click the card again,
        or hit <strong>Clear filter</strong>, to widen back out.
      </p>
      <p>
        Filtering by funding account stacks with the user filter. You can ask
        &quot;what did Alex and Morgan spend on the NIH grant last month?&quot;
        by selecting two users in the floating chip and clicking one funding
        card.
      </p>

      <h2>List vs Summary</h2>
      <p>
        The toggle above the orders flips between two ways of seeing the same
        data:
      </p>
      <ul>
        <li>
          <strong>List</strong>: one row per purchase order, newest first.
          Each row shows the buyer&apos;s avatar, the order name, project,
          date, and a status pill (<em>Complete</em> or <em>Pending</em>).
          Click a row to open the order&apos;s task popup.
        </li>
        <li>
          <strong>Summary</strong>: three rollups in one view (a bar chart of
          monthly spend over the last twelve months, a &quot;Spend by user&quot;
          table, and a &quot;Spend by project&quot; table). All three respect
          the current user filter and funding filter, so the numbers always
          match what&apos;s in the list.
        </li>
      </ul>

      <h2>Export CSV</h2>
      <p>
        The <strong>Export CSV</strong> button in the top-right writes one row
        per line item (not per order) with username, task id, task name,
        task start date, task complete, project, item name, quantity, unit
        price, shipping, total, funding account, link, and CAS number. The export respects every
        active filter, so a finance request like &quot;all NIH spend Q1&quot;
        is a select-the-filters-then-export workflow.
      </p>

      <Callout variant="info" title="Why card numbers can disagree">
        <strong>Spent</strong> on a card is lab-wide; <strong>In view</strong>{" "}
        is only the selected-user subset. The first answers &quot;how much of
        this grant has the lab used?&quot; and the second answers &quot;how
        much of it did this particular subgroup use?&quot; Both are derived
        live from line items, so they stay correct even when funding accounts
        were created without setting an initial spend.
      </Callout>

      <h2>How this differs from the per-user Purchases page</h2>
      <ul>
        <li>
          <strong>Funding-account view sits up top.</strong> The personal
          Purchases page can show this too, but in Lab Mode it&apos;s the
          headline.
        </li>
        <li>
          <strong>Spend rollups are cross-user.</strong> The per-user
          Purchases page can&apos;t roll up other people&apos;s line items.
        </li>
        <li>
          <strong>Read-only.</strong> No edit, no new-purchase button. Order
          creation and edits happen in the owner&apos;s dashboard.
        </li>
      </ul>
      <p>
        For setting up funding accounts, line-item structure, and the editor
        UI, see <Link href="/wiki/features/purchases">Purchases &amp; Funding</Link>.
      </p>
    </WikiPage>
  );
}
