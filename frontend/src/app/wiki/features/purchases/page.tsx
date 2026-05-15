import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function PurchasesFeaturePage() {
  return (
    <WikiPage
      title="Purchases & Funding"
      intro="The Purchases page answers a single question for grant management: where is the money going right now? It pairs a flat reverse-chronological list of every purchase order with a live spending dashboard, so a PI can scan recent activity and check budget burn without leaving the page."
    >
      <Screenshot
        src="/wiki/screenshots/purchases-unified-scroll.png"
        alt="The Purchases page header reading 'Purchases · N orders · $X.XX total' above a single reverse-chronological list of purchase orders. Completed orders carry a green dot and ' · Complete' suffix."
        caption="One list, newest first. Completed orders stay in place with a green dot and a ' · Complete' suffix rather than getting hidden in a separate section."
      />

      <h2>Cost transparency, not a filing cabinet</h2>
      <p>
        A purchase order in ResearchOS is a task with its <strong>task_type</strong>
        {" "}set to <code>purchase</code>. Each row on the page is one of those tasks,
        and inside each row is a small spreadsheet of line items (the actual things
        you bought). The page is built around lookup, not data entry. Lab purchase
        lifecycles are short, often only a few days from order to arrival, so the
        dominant interaction is &ldquo;did we already buy that primer?&rdquo; rather
        than tracking long-lived projects.
      </p>
      <p>
        The header at the top reads{" "}
        <strong>Purchases &middot; N orders &middot; $X.XX total</strong>, where the
        total comes from every line item across every order visible to you. To the
        right is the <strong>Manage Funding Accounts</strong> button, which expands
        a panel inline above the list so you can add or edit grant codes without
        leaving the page.
      </p>

      <h2>The unified scroll</h2>
      <p>
        The list is a single column sorted by start date, newest first. There is no
        active vs earlier split. A completed order looks almost identical to an
        in-flight one: same row, same colors, with a small green dot and the text{" "}
        <code>· Complete</code> appended to the metadata line. The row itself is
        not tinted. This keeps the page scannable when most of your purchases
        eventually finish, so the &ldquo;done&rdquo; rows do not dominate the
        visual weight.
      </p>
      <p>
        Click any row to expand it into a line-item table. Each row is one thing
        you are buying with columns for item name, quantity, vendor link, CAS or
        accession number, price per unit, shipping, computed total, the funding
        account paying for it, plus the new <strong>Vendor</strong> and{" "}
        <strong>Category</strong> columns. The blue-tinted row at the bottom is
        empty and waiting for a new line. The round green checkmark at the
        bottom-right of the expanded view marks the whole order complete, and the
        red trash icon next to it deletes the entire order plus every line item
        under it.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-expanded-order.png"
        alt="One purchase order expanded into a line-item table. The vendor and category columns are visible, and an autocomplete datalist suggestion is open beneath one of the vendor inputs."
        caption="An expanded order. Vendor and category are first-class columns, and both inputs draw from a datalist of values used elsewhere in your purchase history."
      />

      <h2>Vendor and category as first-class fields</h2>
      <p>
        Lab purchasing has heavy vendor reuse. The same supplier shows up across
        dozens of orders, often spelled three different ways. To make that data
        useful for analytics, every line item now carries a{" "}
        <strong>vendor</strong> and a <strong>category</strong>, both stored as
        nullable free-text strings on{" "}
        <code>PurchaseItem</code>. They are deliberately not enums. Lab
        conventions vary too much, and a forced taxonomy would either be wrong
        for most labs or so generic it would not differentiate anything.
      </p>
      <p>
        Each input is wired to a <code>&lt;datalist&gt;</code> sourced from{" "}
        <code>purchasesApi.listAllIncludingShared</code>, deduplicated, non-null
        values only. So the first time you type <code>Sigma</code> into a vendor
        cell, the dropdown surfaces every distinct vendor you (or anyone sharing
        with you) has typed before. Suggestions update as new values are added
        elsewhere, including in shared purchase tasks. There is no central
        catalog to maintain. The data you enter is the catalog.
      </p>

      <Callout variant="tip" title="Why not an enum?">
        A free-text field with autocomplete keeps the surface low-friction for
        researchers who already know what vendor they mean, while still letting
        the dashboard group <code>Sigma Aldrich</code> and{" "}
        <code>Sigma-Aldrich</code> together once someone fixes the spelling. An
        enum would force every lab to either use one of our buckets or carry a{" "}
        <em>misc.</em> tail forever.
      </Callout>

      <h2>The loose model and the soft warning</h2>
      <p>
        ResearchOS does not block you from attaching a purchase item to a task
        whose type is not <code>purchase</code>. That is on purpose. Reagents
        legitimately get tied to a specific experiment task, and forcing a
        rigid type boundary would push researchers into either making
        every-experiment-also-a-purchase or losing the experiment-to-spend link
        entirely.
      </p>
      <p>
        Opening a purchase editor against a non-purchase task surfaces a soft
        amber note above the line-item table. The system does not block you. The
        items will show up under <strong>Items on non-purchase tasks</strong> in
        the dashboard below so they stay visible.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-non-purchase-warning.png"
        alt="The PurchaseEditor showing a yellow informational banner above the line-item table, reading 'This task is not typed as a purchase order. Items added here will appear in the spending dashboard's Items on non-purchase tasks line.'"
        caption="The soft amber note in PurchaseEditor when the parent task is not a purchase. Lab Mode does not show this warning, since multi-user review wants a quieter surface."
      />

      <h2>The spending dashboard</h2>
      <p>
        Scroll past the order list and the page closes out with a live spending
        dashboard. Every number on it is recomputed from the same set of items
        you can see above. The on-disk <code>FundingAccount.spent</code> field
        is known-stale and is not used here. Live computation avoids drift bugs
        when an item is edited or moved.
      </p>

      <h3>Time range and project scope</h3>
      <p>
        The top of the dashboard has two controls. The{" "}
        <strong>time range</strong> dropdown chooses the window: <em>Last 30
        days</em>, <em>Last 90 days</em>, <em>Last 12 months</em> (the default),{" "}
        <em>All time</em>, or a <em>Custom date range</em> with from and to
        inputs. The <strong>All projects</strong> checkbox lets the dashboard
        ignore the global project filter when you want to see the full picture.
        It is off by default, meaning the dashboard respects whichever projects
        you have filtered to in the top bar. Toggle it on to see all projects
        in the dashboard without losing your top-bar filter elsewhere.
      </p>

      <h3>Funding-account cards</h3>
      <p>
        Below the controls is a row of cards, one per funding account. Each card
        shows the account name, dollars spent, total budget, dollars remaining,
        and a progress bar. The numbers are computed live from items in the
        current window. Over-budget cards turn red. Items with a funding string
        that does not match any account roll up under an{" "}
        <em>Uncategorized</em> card. Click any card to filter the rest of the
        dashboard to just that funding string.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-dashboard-funding-cards.png"
        alt="A grid of three funding-account cards showing spent, budget, remaining, and a progress bar. One card is over budget and tinted red."
        caption="Each card is live-computed from items in the current window. Click a card to scope the dashboard to that funding string."
      />

      <h3>Spend over time</h3>
      <p>
        Next is a vertical bar chart of monthly spend across the selected window.
        Empty months still render as zero-height bars so the time span on the
        x-axis matches your range selection. Hover any bar to see the dollar
        total and item count for that month.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-dashboard-spend-over-time.png"
        alt="A vertical bar chart of monthly spend. Hover state shows '$X.XX (N items)' for one of the months."
        caption="The default window is the last 12 months. Empty months render as zero-bars rather than collapsing the axis, so you can see gaps in spending."
      />

      <h3>Breakdown by project, vendor, or category</h3>
      <p>
        Below the time chart is a horizontal bar chart with a segmented control
        in the section header to switch lenses. The same set of items in the
        current window is regrouped by project, by vendor, or by category. Items
        with no value for the active lens (no vendor set, no category set,
        or a task with no project) render under{" "}
        <em>Uncategorized</em> in gray.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-dashboard-breakdown-project.png"
        alt="The breakdown chart with the Project lens selected, showing horizontal bars for each project that had spend in the window."
        caption="Project lens. Bars are sorted by total spend, descending."
      />

      <Screenshot
        src="/wiki/screenshots/purchases-dashboard-breakdown-vendor.png"
        alt="The same breakdown chart with the Vendor lens selected, regrouping the same window of spend by vendor name."
        caption="Vendor lens. The autocomplete keeps spellings consistent enough for the groups to be meaningful."
      />

      <Screenshot
        src="/wiki/screenshots/purchases-dashboard-breakdown-category.png"
        alt="The breakdown chart with the Category lens selected, grouping spend by the free-text category field on each item."
        caption="Category lens. Items with no category roll into an Uncategorized bar."
      />

      <h3>Items on non-purchase tasks</h3>
      <p>
        Near the bottom of the dashboard is a thin amber line that reads{" "}
        <strong>Items on non-purchase tasks:</strong> followed by a count and a
        dollar total. Click it to expand an inline table of those items with
        their host task name and amount. This panel exists because the loose
        model lets you legitimately attach a reagent purchase to a specific
        experiment task. The panel keeps that visible so spend does not silently
        leak into other task types.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-non-purchase-panel-expanded.png"
        alt="The 'Items on non-purchase tasks' panel expanded into a small table listing each item, the host task name, the task type, and the dollar amount."
        caption="Expanded view of the amber panel. From here, open the host task in /workbench to reclassify it as a purchase or move the item to a proper purchase order."
      />

      <h3>CSV export and Lab Mode link</h3>
      <p>
        The top-right of the dashboard has two affordances. <strong>Export
        CSV</strong> downloads the currently filtered scope (time range plus
        project filter, plus any funding-card filter you have clicked) as a flat
        file named <code>purchases-export-YYYY-MM-DD.csv</code>. Columns are
        item id, item name, vendor, category, funding string, project name,
        task name, start date, total price, and owner.
      </p>

      <Screenshot
        src="/wiki/screenshots/purchases-csv-export.png"
        alt="The dashboard header showing the 'View in Lab Mode →' link and the green 'Export CSV' button at the top right."
        caption="Export CSV downloads only what is currently in scope. The View in Lab Mode link opens /lab?tab=purchases for cross-lab investigation."
      />

      <p>
        Next to the export button, <strong>View in Lab Mode →</strong> opens{" "}
        <code>/lab?tab=purchases</code>. Lab Mode pools every labmate&apos;s
        purchases against the shared funding accounts and is documented in{" "}
        <Link href="/wiki/features/lab-mode/purchases">Lab Mode &rarr; Lab-wide purchases</Link>.
      </p>

      <Callout variant="info" title="Empty state">
        When you have no purchases yet, the spend-over-time chart shows the
        prompt <em>Add your first purchase to see spend breakdowns here.</em>{" "}
        The funding cards still render with a zero spent value against each
        account&apos;s budget, so the budget scaffold is visible from day one.
      </Callout>

      <h2>Managing funding accounts</h2>
      <p>
        Click <strong>Manage Funding Accounts</strong> at the top right and a
        panel opens inline above the order list. The button label flips to{" "}
        <strong>Hide Funding Manager</strong> while it is open, so you can
        collapse it back down without leaving the page. Each account has a name
        (for example <code>NIH-R01-12345</code>), a total budget, and an
        optional one-line description.
      </p>
      <Callout variant="info" title="Funding accounts are lab-wide">
        Funding accounts are stored in the shared lab folder, not in your own
        user folder. Adding one makes it pickable on every labmate&apos;s
        Purchases page and in the funding dropdown when they add a line item.
        That is the point. One person in the lab can manage the list of grants
        and everyone gets to pick from it.
      </Callout>

      <h2>Why this works</h2>
      <p>
        The dashboard uses{" "}
        <a
          href="https://recharts.org"
          target="_blank"
          rel="noopener noreferrer"
        >
          Recharts
        </a>{" "}
        (<code>recharts@^3.8.1</code> in <code>frontend/package.json</code>),
        lazy-loaded on the <code>/purchases</code> route. It is code-split out
        of the shared root bundle, so adding the charts here did not slow down
        the rest of the app. Around 104 KB gzipped on this one route.
      </p>

      <h2>Future considerations</h2>
      <p>
        A few things in this area are not yet shipped, listed here so you do not
        spend time looking for them:
      </p>
      <ul>
        <li>Per-item dates (the time axis uses the parent task&apos;s start date)</li>
        <li>A <code>Task.completed_at</code> timestamp</li>
        <li>Multi-currency support</li>
        <li>Recurring or subscription purchases</li>
        <li>OCR receipt import</li>
        <li>Anomaly detection and spending alerts</li>
        <li>Budget-threshold notifications</li>
        <li>A catalog-prefilled vendor and category list (datalist autocomplete is the only source today)</li>
      </ul>
    </WikiPage>
  );
}
