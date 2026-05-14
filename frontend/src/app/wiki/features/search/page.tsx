import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";
import Callout from "@/components/wiki/Callout";

export default function SearchFeaturePage() {
  return (
    <WikiPage
      intro="A filter-driven search page that finds tasks across every project under your user. Fill in the form, click Search, click a result card to open its task popup."
    >
      <Screenshot
        src="/wiki/screenshots/search-results.png"
        alt="The Search page with a keywords input, a row of filter dropdowns, and Search and Clear buttons."
        caption="The Search page. Type into Keywords, narrow with the filters, then click Search."
      />

      <h2>What the page looks like</h2>
      <p>
        The page opens with an empty filter card and a placeholder that reads
        &ldquo;Enter search criteria above.&rdquo; Type into the Keywords box
        (or use any of the dropdowns), then click the blue{" "}
        <strong>Search</strong> button. Results render below as a grid of
        cards, one per matching task. The <strong>Clear</strong> button next
        to it resets every filter and empties the result grid.
      </p>

      <Callout variant="info" title="Press Enter to search">
        Pressing Enter while focused on the Keywords box runs the search
        without needing to click the button.
      </Callout>

      <h2>The filters</h2>
      <p>
        Every filter is optional. Leave them blank to match everything, or
        combine as many as you want — all filters AND together.
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
          <strong>Method Category</strong> is the broader version — it matches
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

      <h2>Search in Lab Mode</h2>
      <p>
        Lab Mode has its own search panel (find it on the Lab tab). The form
        is the same shape with one addition: a <strong>User</strong> dropdown
        that scopes the search to one labmate&apos;s data, or to whoever is
        currently selected in the global lab user filter. The lab search also
        returns project and method cards alongside task cards, badged with
        the owner&apos;s name and color.
      </p>

      <Callout variant="tip" title="What gets searched, and what doesn't">
        Keywords match against task names, task tags, and method
        names/tags — not against note bodies, results text, or PCR protocol
        contents. Use the Notes page or a method&apos;s own editor to search
        the inside of those files.
      </Callout>
    </WikiPage>
  );
}
