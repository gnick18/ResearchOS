import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import Callout from "@/components/wiki/Callout";

export default function SearchFeaturePage() {
  return (
    <WikiPage
      title="Search"
      intro="A filter-driven search page that finds tasks across every project you own or have shared with you. Fill in the form, click Search, click a result card to open its task popup."
    >
      <Screenshot
        src="/wiki/screenshots/search-results.png"
        alt="The Search page with a keywords input, a row of filter dropdowns, and Search and Clear buttons."
        caption="The Search page. Type into Keywords, narrow with the filters, then click Search."
      />

      <h2>What the page looks like</h2>
      <p>
        The page opens with an empty filter card and a placeholder that reads
        &ldquo;Search to get started&rdquo; over &ldquo;Enter keywords, dates,
        or filters above.&rdquo; Type into the Keywords box (or use any of the
        dropdowns), then click the blue{" "}
        <strong>Search</strong> button. Results render below as a grid of
        cards, one per matching task. The <strong>Clear</strong> button next
        to it resets every filter and empties the result grid.
      </p>

      <Callout variant="info" title="Press Enter to search">
        Pressing Enter while focused on the Keywords box runs the search
        without needing to click the button.
      </Callout>
      <p>
        You can also land here pre-loaded. Choosing &ldquo;Search everything
        for&rdquo; in the BeakerSearch palette opens{" "}
        <code>/search?keywords=&lt;your query&gt;</code>, which seeds the
        Keywords box and runs the search automatically.
      </p>

      <h2>The filters</h2>
      <p>
        Every filter is optional. Leave them blank to match everything, or
        combine as many as you want. All filters AND together.
      </p>
      <ul>
        <li>
          <strong>Keywords</strong> matches the task name, its tags, and the
          name and tags of its first attached method. Multiple words AND
          together (e.g., <code>yeast pcr</code> only returns tasks where both
          words appear).
        </li>
        <li>
          <strong>Date From</strong> and <strong>Date To</strong> restrict to
          tasks whose schedule overlaps the range.
        </li>
        <li>
          <strong>Task Type</strong> narrows to one of the three task shapes
          (i.e., Experiments, Purchases, or List Tasks).
        </li>
        <li>
          <strong>Project</strong> limits results to tasks inside one project.
        </li>
        <li>
          <strong>Specific Method</strong> matches tasks whose first attached
          method is the one you pick.{" "}
          <strong>Method Category</strong> is the broader version and matches
          on the method&apos;s folder.
        </li>
        <li>
          <strong>Completion Status</strong> filters to complete or incomplete
          tasks.
        </li>
      </ul>

      <h2>The result cards</h2>
      <p>
        Each card carries a colored stripe matching its project, the task
        name, a project pill, a task-type pill (purple for experiments, amber
        for purchases, gray for list tasks), the schedule and duration, the
        method (when one is attached), and the first few tags. A green{" "}
        <strong>Complete</strong> badge appears in the corner if the task is
        marked done. Clicking anywhere on the card opens the same task popup
        you&apos;d get from clicking the task on the GANTT or Home page.
      </p>

      <h2>Export experiments from search results</h2>
      <p>
        The Search page doubles as the launch pad for bulk exports. Click the{" "}
        <strong>Select</strong> button next to the result count and the cards
        sprout a checkbox in the top-right corner. Tick one or more result
        cards (a blue ring and the checked mark show selection), and the
        header swaps in a counter (<em>N selected</em>), a blue{" "}
        <strong>Export selected</strong> button, and a <strong>Cancel</strong>{" "}
        button that drops you out of select mode.
      </p>
      <Screenshot
        src="/wiki/screenshots/search-export-selected.png"
        alt="Search results in select mode: three cards ticked with blue rings and the Export selected button visible at the top of the results list."
        caption="Select mode on Search. Tick the cards you want and click Export selected to open the format dialog."
      />
      <p>
        Clicking <strong>Export selected</strong> opens the same{" "}
        <strong>Export</strong> dialog the experiment popup uses. It offers{" "}
        <strong>PDF report</strong>, <strong>HTML report</strong>, and{" "}
        <strong>Raw ResearchOS format</strong>, plus a{" "}
        <strong>Combined PDF</strong> option (only when you pick more than one)
        that merges every selected experiment into one navigable PDF with a
        cover page, a clickable index, and bookmarks. The dialog heading counts
        what you picked (for example, <em>Export 3 experiments</em>) with a
        reminder that multi-experiment exports produce a zip with one file per
        experiment.
      </p>
      <ul>
        <li>
          <strong>PDF</strong> packages each experiment as its own selectable-text
          PDF with table of contents and outline pane, then drops every PDF
          into a single <code>experiments-&lt;YYYY-MM-DD&gt;.zip</code>.
        </li>
        <li>
          <strong>HTML</strong> gives each experiment its own subfolder inside
          the zip (one self-contained HTML page plus an{" "}
          <code>attachments/</code> tree), so you can open each report
          independently without an extra unzip step.
        </li>
        <li>
          <strong>Raw</strong> nests one <code>&lt;name&gt;-raw.zip</code>{" "}
          per experiment inside the outer zip, keeping each bundle ready to
          drop into another ResearchOS user&apos;s{" "}
          <strong>Settings → Import experiment</strong> dialog.
        </li>
      </ul>
      <p>
        See{" "}
        <Link href="/wiki/features/experiments">
          Export an experiment
        </Link>{" "}
        on the Experiments page for a deeper walkthrough of what each format
        bundles and which one to pick.
      </p>

      <Callout variant="tip" title="What gets searched, and what doesn't">
        The search scope includes your own tasks plus every task that has been
        shared with you (including tasks hosted into your projects by labmates).
        Keywords match against task names, task tags, and method names and tags;
        they do not match against note bodies, results text, or PCR protocol
        contents. Open the Notes page or a method&apos;s own editor to search
        the inside of those files.
      </Callout>
    </WikiPage>
  );
}
