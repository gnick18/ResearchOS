import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";

export default function SearchFeaturePage() {
  return (
    <WikiPage
      intro="Full-text search across projects, tasks, methods, notes, and experiments — yours plus anything shared in the lab folder."
    >
      <Screenshot
        src="/wiki/screenshots/search-results.png"
        alt="The Search page with a query in the box and results grouped by type."
      />

      <h2>Search basics</h2>
      <ul>
        <li>
          Type any word or phrase. Results stream as you type — no need to
          press Enter.
        </li>
        <li>
          Results are grouped by type: Projects, Tasks, Methods, Notes,
          Experiments. Each row shows a short snippet of where the match was
          found.
        </li>
        <li>
          Click a result to jump to its full editor — task popup for tasks,
          method editor for methods, etc.
        </li>
      </ul>

      <h2>Filters</h2>
      <ul>
        <li>
          <strong>Type filter</strong> — limit to just one of the categories
          above.
        </li>
        <li>
          <strong>User filter</strong> — when you have shared lab data, scope
          to one user&apos;s content.
        </li>
      </ul>
    </WikiPage>
  );
}
