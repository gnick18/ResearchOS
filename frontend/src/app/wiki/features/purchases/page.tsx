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
        alt="The Purchases page header with an amber '+ New Purchase' button at the top right, the three filter chips 'All / Project purchases / Miscellaneous' below the header, and a single reverse-chronological list of purchase orders beneath."
        caption="Header, filter chips, and the unified order list. The amber '+ New Purchase' button and the segmented filter chips were added in the 2026-05-22 Purchases redesign."
      />

      <h2>Cost transparency, not a filing cabinet</h2>
      <p>
        A purchase order in ResearchOS is a task with its <strong>task_type</strong>
        {" "}set to <code>purchase</code>. Each row on the page is one of those tasks,
        and inside each row is a small spreadsheet of line items (the actual things
        you bought). The page is built around lookup, not data entry. Lab purchase
        lifecycles are short, often only a few days from order to arrival, so the
        common question is &ldquo;did we already buy that primer?&rdquo;
      </p>
      <p>
        The header at the top reads{" "}
        <strong>Purchases &middot; N orders &middot; $X.XX total</strong>, where the
        total comes from every line item across every order visible to you. To the
        right is the <strong>Manage Funding Accounts</strong> button, which expands
        a panel inline above the list so you can add or edit grant codes without
        leaving the page.
      </p>

      <h2>Creating a purchase</h2>
      <p>
        The amber <strong>+ New Purchase</strong> button in the top-right of the
        page header opens <code>NewPurchaseModal</code>. The modal collapses the
        two-step data model (parent purchase task + first line item) into a single
        form, so the common case of logging one item takes one interaction instead
        of two.
      </p>

      {/* TODO recapture: purchases-new-purchase-modal.png pending. Capture
       *  with ?wikiCapture=1 against fixture data, then restore the
       *  <Screenshot> block here. Removed for now so the page does not
       *  render a broken-image placeholder.
       */}

      <p>
        The modal has six fields:
      </p>
      <ul>
        <li>
          <strong>Item Name</strong> (required): a native <code>&lt;datalist&gt;</code>
          autocomplete surfaces every distinct item name from your purchase history,
          de-duped case-insensitively with the most-recent record winning. When the
          typed value matches a prior item name exactly, <strong>Vendor</strong> and
          {" "}<strong>Price per unit</strong> fill in automatically. Quantity stays
          at 1; funding string stays unchanged (recurring purchases often re-bill
          against a different grant).
        </li>
        <li>
          <strong>Vendor</strong>: free text, optional. Not auto-filled unless an
          exact Item Name match triggers the recall logic above.
        </li>
        <li>
          <strong>Category</strong>: a <code>&lt;select&gt;</code> listing your
          non-archived, non-shared owned projects plus a synthetic{" "}
          <strong>Miscellaneous</strong> option at the bottom. Defaults to the first
          owned project alphabetically; falls back to Miscellaneous if you have no
          owned projects yet. Choosing Miscellaneous routes the purchase to the
          hidden <code>_misc_purchases</code> bucket (see below).
        </li>
        <li>
          <strong>Price per unit</strong> and <strong>Quantity</strong>: numeric
          free-text inputs. Price defaults blank; quantity defaults to 1.
        </li>
        <li>
          <strong>Funding string</strong>: a <code>&lt;datalist&gt;</code>
          autocomplete pulls from your existing funding accounts (for example,{" "}
          <code>NIH-R01-12345</code>). Typing a new string and saving creates a
          budget-zero funding account automatically so the string appears in future
          dropdowns without a separate setup step. The field is optional; leave it
          blank to record the purchase without a funding association.
        </li>
      </ul>
      <p>
        On save, the modal creates a <code>task_type: &quot;purchase&quot;</code> parent
        task dated today with a one-day duration, then immediately creates the first
        line item under it. After saving you can expand the row in the list and use
        the inline PurchaseEditor to add more line items to the same order.
      </p>

      <Callout variant="info" title="Tour integration">
        During the onboarding tour, a <code>DemoPurchasesViewer</code> component
        mounts on the <code>/purchases</code> route to show Alex&apos;s fixture
        data as a read-only overlay. The tour also drives this modal end-to-end via
        the BeakerBot cursor script. Production users who are not in the tour never
        see the demo overlay.
      </Callout>

      <h2>The unified scroll</h2>
      <p>
        Above the order list is a three-chip segmented control that scopes what
        you see. <strong>All</strong> shows every purchase task and is always
        visible. <strong>Project purchases</strong> filters to orders attached to
        a real project, hiding the Miscellaneous bucket. The third chip,{" "}
        <strong>Miscellaneous</strong>, shows only the ad-hoc purchases in the
        hidden <code>_misc_purchases</code> bucket; this chip is hidden entirely
        when <code>miscTaskCount === 0</code> so a freshly-onboarded account does
        not see a confusing empty bucket. All three chips display a live count
        badge that reflects the full purchase list, not just the filtered view,
        so the badge numbers stay stable as you switch tabs.
      </p>
      <p>
        The list itself is a single column sorted by start date, newest first. There is no
        active vs earlier split. A completed order looks almost identical to an
        in-flight one: same row, same colors, with a small green dot and the text{" "}
        <code>· Complete</code> appended to the metadata line. The row itself is
        not tinted, so completed orders don&apos;t dominate the page once most
        of your purchases have landed.
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

      <h2>The Miscellaneous bucket</h2>
      <p>
        The existing data model requires every purchase task to have a{" "}
        <code>project_id</code>. Purchases that do not belong to any real project,
        like conference flights, lab snacks, or one-off equipment, still need
        somewhere to land. Rather than making <code>project_id</code> nullable and
        updating every reader (Gantt, Workbench, search, activity log), ResearchOS
        creates a per-user hidden project named <code>_misc_purchases</code> and
        routes those purchases there.
      </p>
      <p>
        The hidden project never appears on Home, Workbench, Gantt, the project
        picker, or anywhere in the app that calls{" "}
        <code>fetchAllProjectsIncludingShared</code> without explicitly opting in.
        The <code>/purchases</code> route is the only surface that passes{" "}
        <code>{"{ includeHidden: true }"}</code>, so the bucket is visible
        (and filterable) there but invisible everywhere else.
      </p>

      <Callout variant="tip" title="Two things named Miscellaneous">
        Be careful not to conflate two distinct concepts that share the same
        label. The <strong>Category select in NewPurchaseModal</strong> picks
        which project the parent purchase task routes to: choosing
        &ldquo;Miscellaneous&rdquo; routes to the{" "}
        <code>_misc_purchases</code> hidden project. Separately, the{" "}
        <strong>Miscellaneous filter chip</strong> on the order list surfaces
        exactly those tasks. Neither of these is the same as the free-text{" "}
        <strong>category column on individual PurchaseItems</strong> inside an
        expanded order (documented below in &ldquo;Vendor and category as
        first-class fields&rdquo;). That column is per-line-item, nullable,
        and never auto-set except when the modal save path writes the reserved{" "}
        <code>Miscellaneous</code> string to signal downstream filters.
      </Callout>

      <h2>Vendor and category as first-class fields</h2>
      <p>
        Lab purchasing has heavy vendor reuse. The same supplier shows up across
        dozens of orders, often spelled three different ways. To make that data
        useful for analytics, every line item now carries a{" "}
        <strong>vendor</strong> and a <strong>category</strong>, both stored as
        nullable free-text strings on{" "}
        <code>PurchaseItem</code>. They are free text, not enums, since lab
        conventions vary too much for a fixed taxonomy.
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

      <Callout variant="info" title="Free-text fields vs. project routing">
        The free-text <strong>vendor</strong> and <strong>category</strong>{" "}
        columns on individual <code>PurchaseItem</code> rows are distinct from
        the top-level project routing. The top-level routing has one reserved
        bucket: <strong>Miscellaneous</strong> routes to the hidden{" "}
        <code>_misc_purchases</code> project. One is the project the order lives
        in, the other is a per-line-item annotation inside an order.
      </Callout>

      <h2>The loose model and the soft warning</h2>
      <p>
        ResearchOS does not block you from attaching a purchase item to a task
        whose type is not <code>purchase</code>. That is on purpose. Reagents
        often tie to a specific experiment task, and you don&apos;t want to lose
        that experiment-to-spend link.
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
        caption="The soft amber note in PurchaseEditor when the parent task is not a purchase. The Lab Overview surface does not show this warning, since the lab-wide review wants a quieter dashboard."
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

      <h3>CSV export</h3>
      <p>
        The top-right of the dashboard has an <strong>Export CSV</strong>{" "}
        button that downloads the currently filtered scope (time range plus
        project filter, plus any funding-card filter you have clicked) as a
        flat file named <code>purchases-export-YYYY-MM-DD.csv</code>. Columns
        are item id, item name, vendor, category, funding string, project
        name, task name, start date, total price, and owner.
      </p>

      {/* TODO screenshot agent: recapture the dashboard header to drop the old "View in Lab Mode" link.
          Route: /purchases (scrolled to dashboard)
          Fixture: ?wikiCapture=1
          Viewport: desktop 1440x900
          State: any user fixture; dashboard with the Export CSV button visible (no Lab Mode link)
          Save to: frontend/public/wiki/screenshots/purchases-csv-export.png
      */}
      <Screenshot
        src="/wiki/screenshots/purchases-csv-export.png"
        alt="The dashboard header with the green Export CSV button at the top right."
        caption="Export CSV downloads only what is currently in scope."
      />

      <p>
        Next to the export button, PIs see a{" "}
        <strong>Open in Lab Overview</strong> shortcut that opens the same
        purchase data inside the LabPurchases Tool popup on{" "}
        <Link href="/wiki/features/lab-overview">/lab-overview</Link>,
        where the funding-bar, burn-rate, and pending-approval surfaces all
        live in one place.
      </p>

      <h2>The PI experience</h2>
      <p>
        PIs do not have <code>/purchases</code> in their nav. The
        canonical surface for them is the LabPurchases Tool inside the Lab
        Overview, opened either from a pinned widget tile or from the Tools
        launcher in the header. The popup is a four-tab dashboard:
      </p>
      <ul>
        <li>
          <strong>Pending approvals</strong>. The work queue. Each row is a
          purchase waiting on the PI with inline{" "}
          <strong>Approve</strong> and <strong>Decline</strong> buttons. The
          first action of a fresh session unlocks the 5-minute edit window;
          subsequent rows process without re-prompting. See{" "}
          <Link href="/wiki/features/lab-head/edit-session-and-password">
            Edit session and password
          </Link>.
        </li>
        <li>
          <strong>All purchases</strong>. A flat lab-wide view of every
          purchase across every member, filterable by member, project, and
          funding string.
        </li>
        <li>
          <strong>Funding</strong>. The funding-account cards (spent vs.
          budget) rolled up across the whole lab, not just the PI&apos;s
          own purchases.
        </li>
        <li>
          <strong>Spending</strong>. The full spend-over-time chart and the
          breakdown lenses (project / vendor / category), same shape as the
          dashboard at the bottom of <code>/purchases</code> but with lab-wide
          scope.
        </li>
      </ul>

      <h3>The decline state</h3>
      <p>
        A declined purchase carries a <code>declined_at</code> timestamp and
        renders with a red <code>PurchaseDeclinedBadge</code> wherever it
        appears: in the member&apos;s own list, in the All Purchases tab, in
        the Lab Activity stream. The Pending Approvals tab also shows a{" "}
        <strong>Recently declined</strong> section at the bottom so a PI
        can <strong>Re-approve</strong> a previously-declined purchase
        without making the member resubmit. Each decline and each re-approve
        writes a row to the audit log (see{" "}
        <Link href="/wiki/features/lab-head/audit-log">Audit log</Link>).
      </p>

      <h3>The three purchases widget variants</h3>
      <p>
        On the Lab Overview, the purchases Tool has three tile variants you
        can pin to the canvas or the sidebar rail:
      </p>
      <ul>
        <li>
          <strong>Funding bars.</strong> A horizontal bar per funding account
          showing spent vs. budget. Good for &quot;how much grant is
          left.&quot;
        </li>
        <li>
          <strong>Burn rate.</strong> A small trend chart of weekly spend
          with a range selector. The range buttons are <strong>4w</strong>,{" "}
          <strong>8w</strong>, <strong>12w</strong>, and <strong>6mo</strong>.
          Good for &quot;are we accelerating.&quot;
        </li>
        <li>
          <strong>Pending count.</strong> A single big number plus the top
          few waiting purchases. Good for &quot;do I need to approve
          something right now.&quot;
        </li>
      </ul>
      <p>
        Clicking any of the three variant tiles opens the same four-tab
        popup described above. See{" "}
        <Link href="/wiki/features/lab-overview/widgets-and-tools">
          Widgets and Tools
        </Link>{" "}
        for the broader catalog.
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
