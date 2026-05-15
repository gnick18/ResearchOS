import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function PurchasesFeaturePage() {
  return (
    <WikiPage
      title="Purchases & Funding"
      intro="Track what the lab is ordering, what's already arrived, and which funding account is paying. You'll see two versions of the same data: a per-user Purchases page for managing your own orders, and a Purchases tab inside Lab Mode that pools everyone's orders against the shared funding accounts."
    >
      <Screenshot
        src="/wiki/screenshots/purchases-list.png"
        alt="The Purchases page listing several purchase-order rows with item counts and totals, with one row expanded into a line-item table."
        caption="The Purchases page is a list of purchase orders. Click a row to expand it and edit the items inside."
      />

      <h2>What you see on the Purchases tab</h2>
      <p>
        Each row on the Purchases page is one <strong>purchase order</strong>{" "}
        (e.g., &ldquo;April reagent order&rdquo; or &ldquo;Plasmid kit&rdquo;).
        A purchase order is a task that you flagged with the type set to{" "}
        <strong>Purchase</strong>. Open a task popup anywhere (Gantt, Home, or
        a project page), pick <strong>Purchase</strong> as the task type, and
        the order shows up here.
      </p>
      <p>
        The header along the top shows how many purchase orders you have and
        the running grand total in dollars. To the right is the{" "}
        <strong>Manage Funding Accounts</strong> button. The small green or
        grey dot on each row is the order&apos;s completion status, and the
        down-arrow on the right side of the row expands it.
      </p>
      <p>
        When you click a row to expand it, the order opens into a table of
        line items. Each row in the table is one thing you&apos;re buying:
        item name, quantity, vendor link, CAS or accession number, price per
        unit, shipping, a computed total, the funding account paying for it,
        and a free-form notes field. The blue tinted row at the bottom is
        empty and waiting for you to add a new line. Start typing an item
        name and ResearchOS suggests matches from past orders, so you
        don&apos;t have to retype a vendor URL or unit price you&apos;ve
        already entered before. Clicking on any existing row puts it into
        inline edit mode (the row turns amber) where you can change anything
        on it.
      </p>
      <p>
        When the order arrives, click the round green checkmark in the
        bottom-right corner of the expanded view to mark the whole order
        complete. The dot on the collapsed row turns green and the row tints
        a faint green so you can scan the list and see what&apos;s finished.
        The red trash icon next to the checkmark deletes the entire order
        and every line item under it, so use that one carefully.
      </p>

      <h2>The Spending dashboard below the list</h2>
      <p>
        Scroll past the purchase orders and the page closes out with a{" "}
        <strong>Spending dashboard</strong>. It pulls from the same orders
        above and turns them into charts so you can see where money is going
        without leaving the page.
      </p>
      <p>
        The dashboard starts with a controls bar (a <strong>Time range</strong>
        {" "}dropdown for <em>Last 30 days</em>, <em>Last 90 days</em>,{" "}
        <em>Last 12 months</em>, <em>All time</em>, or <em>Custom</em> with
        date inputs, plus an <strong>All projects</strong> checkbox that
        overrides the global project filter just for this view). Below it sit
        three sections:
      </p>
      <ul>
        <li>
          <strong>Funding accounts</strong>: a grid of cards, one per account,
          showing dollars spent against the budget with a coloured progress
          bar (emerald under budget, red when over). Items with no funding
          string land on a dashed <em>Uncategorized</em> card.
        </li>
        <li>
          <strong>Spend over time</strong>: a vertical bar chart of monthly
          spend across the selected window. Empty months render as zero-height
          bars so the time axis matches the time-range selection.
        </li>
        <li>
          <strong>Breakdown by Project / Vendor / Category</strong>: a
          horizontal bar chart with a three-way toggle in the section header.
          Switch lenses to slice the same window of spend a different way.
        </li>
      </ul>
      <p>
        An <strong>Export CSV</strong> button at the top-right of the
        dashboard downloads the items in the current window with item name,
        vendor, category, funding string, project, host task, date, total,
        and owner columns. The amber banner at the bottom calls out any items
        sitting on tasks that aren&apos;t typed as a purchase, so you can
        catch spend that&apos;s leaking into other task types.
      </p>

      <h2>Managing funding accounts</h2>
      <p>
        Click <strong>Manage Funding Accounts</strong> at the top right and
        a panel opens inline above the order list. The button label flips to{" "}
        <strong>Hide Funding Manager</strong> while it&apos;s open, so you
        can collapse it back down without leaving the page.
      </p>
      <Screenshot
        src="/wiki/screenshots/purchases-funding-panel.png"
        alt="The Funding Accounts panel expanded inline above the order list, showing existing accounts with their budgets and an Add Account input row at the bottom."
        caption="The Funding Accounts panel is inline, not a popup. Add a name, budget, and optional description, then hit Add Account."
      />
      <p>
        Each account has a name (e.g., <code>NIH-R01-12345</code> or
        &ldquo;Internal bridge&rdquo;), a total budget, and an optional
        one-line description. Type into the input row at the bottom and hit
        <strong> Add Account</strong> to create one. Click <strong>Edit</strong>{" "}
        next to an existing account to change its budget, or <strong>Delete</strong>{" "}
        to remove it. Deleting an account doesn&apos;t delete the orders that
        referenced it. Those line items keep their funding label, they just
        roll up under &ldquo;Uncategorized&rdquo; in Lab Mode.
      </p>
      <Callout variant="info" title="Funding accounts are lab-wide">
        Funding accounts are stored in the shared lab folder, not in your own
        user folder. Adding one makes it show up on every labmate&apos;s
        Purchases page and in the funding dropdown when they add a line item.
        That&apos;s the whole point. One person in the lab can manage the
        list of grants and everyone gets to pick from it.
      </Callout>

      <h2>Purchases in Lab Mode</h2>
      <p>
        Open <strong>Lab Mode</strong> from the top bar and pick the{" "}
        <strong>Purchases</strong> tab. This is the same underlying data, but
        pooled across every user in the folder. Every labmate&apos;s purchase
        orders show up in one list, each row tagged with a coloured user
        avatar so you can see at a glance who placed which order.
      </p>
      <Screenshot
        src="/wiki/screenshots/purchases-lab-funding-cards.png"
        alt="Lab Mode's Funding Accounts Overview showing four budget cards. Each card has spent, in view, budget, and remaining values, and a coloured progress bar across the bottom."
        caption="The Funding Accounts Overview in Lab Mode. Each card shows total lab spend against budget with a coloured progress bar (amber under 10% remaining, red when over budget)."
      />
      <p>
        The top of the Lab Mode tab is where the <strong>budget bars</strong>
        {" "}live. Each funding account gets its own card showing how much has
        been spent across the whole lab, how much is left, and a coloured
        progress bar that turns amber when an account is running low and red
        when it&apos;s over budget. The &ldquo;In view&rdquo; line on each
        card narrows the figure to just the labmates you&apos;ve picked with
        the user-filter button (bottom-right of Lab Mode). Click any account
        card to filter the list below to just that funding account.
      </p>
      <Screenshot
        src="/wiki/screenshots/purchases-lab-list.png"
        alt="The Lab Mode purchases list with rows tinted by user colour. Each row shows a username avatar, the order name, a Complete or Pending pill, the project, and the order date."
        caption="Cross-user purchase list inside Lab Mode. Coloured avatars attribute each order to a labmate."
      />
      <p>
        Below the funding cards are four summary tiles (Total Purchases,
        Completed, Pending, and Spent in view) and a{" "}
        <strong>List / Summary</strong> toggle. <strong>List</strong> is the
        row-per-order view shown above. Click a row to open the order popup,
        where the line-item table opens read-only. You can browse a
        labmate&apos;s items, but you can&apos;t add or edit anything in
        someone else&apos;s order from Lab Mode.
      </p>
      <p>
        <strong>Summary</strong> rearranges the same data into three rollups:
        a bar list of spend by month (most recent twelve months that have any
        spend in them), a list of spend by user, and a list of spend by
        project. The <strong>Export CSV</strong> button at the top right of
        the toggle row downloads a flat row-per-item file of whatever&apos;s
        in the current view (so the user filter, funding filter, and the
        view&apos;s date ordering all carry through to the export).
      </p>
      <p>
        For a full walkthrough of the Lab Mode tab&apos;s controls (card colours,
        the &ldquo;In view&rdquo; vs &ldquo;Spent&rdquo; distinction, filter
        stacking, CSV export details), see{" "}
        <Link href="/wiki/features/lab-mode/purchases">Lab Mode &rarr; Lab-wide purchases</Link>.
      </p>

      <h2>How a typical lab uses this</h2>
      <p>
        A PI opens the Lab Mode Purchases tab a week before a grant deadline
        to see how much of the R01 has actually been spent and which
        big-ticket items are still pending. The progress bar on the funding
        card tells the story in under a second, and the Summary view&apos;s
        per-month list shows where the bursts of spending happened.
      </p>
      <p>
        A grad student adds a new purchase task on their Gantt for a primer
        order, jumps over to the Purchases page, expands the order, and types
        each oligo into the new-line row. Catalog suggestions auto-fill the
        vendor URL and price from last quarter&apos;s order so they only
        need to type the quantity. They pick the right funding account from
        the dropdown, and the next time anyone opens Lab Mode the budget bar
        reflects the new spend.
      </p>
      <p>
        A lab manager opens the Funding Accounts panel the moment a new
        grant is awarded, types in the grant code and budget, and the account
        is instantly pickable on every labmate&apos;s Purchases page.
      </p>

      <Callout variant="tip" title="Filter combos in Lab Mode">
        Click a funding-account card to filter the list to just that grant.
        Combine it with the user-filter button in the bottom-right of Lab
        Mode to get &ldquo;everything one labmate bought on one grant&rdquo;
        in two clicks, then hit Export CSV to drop the result into a
        spreadsheet.
      </Callout>
    </WikiPage>
  );
}
