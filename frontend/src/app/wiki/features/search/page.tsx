import WikiPage from "@/components/wiki/WikiPage";
import Screenshot from "@/components/wiki/Screenshot";

export default function SearchFeaturePage() {
  return (
    <WikiPage
      intro="Full-text search across projects, tasks, methods, notes, and experiments. Yours plus anything shared in the lab folder."
    >
      <Screenshot
        src="/wiki/screenshots/search-results.png"
        alt="The Search page with a query in the box and results grouped by type."
        caption="Results stream in as you type, grouped by entity type."
      />

      <h2>What gets searched</h2>
      <p>
        Search runs against the JSON files in your folder live. There&apos;s
        no persistent index. Every project, task, method, PCR protocol, note,
        and experiment under your user (plus anything shared with you from
        another user) is in scope.
      </p>
      <p>
        Because the search reads from disk on demand, it stays in sync with
        whatever&apos;s actually in the folder, including changes a teammate
        just synced over from another machine.
      </p>

      <h2>Search basics</h2>
      <ul>
        <li>
          Type any word or phrase. Results stream as you type, so there&apos;s
          no need to press Enter.
        </li>
        <li>
          Results are grouped by type (i.e., Projects, Tasks, Methods, Notes,
          Experiments). Each row shows a short snippet of where the match was
          found.
        </li>
        <li>
          Click a result to jump to its full editor (e.g., task popup for
          tasks, method editor for methods).
        </li>
      </ul>

      <h2>Filters</h2>
      <ul>
        <li>
          <strong>Type filter</strong> limits results to just one of the
          categories above.
        </li>
        <li>
          <strong>User filter</strong>, when you have shared lab data, scopes
          to one user&apos;s content.
        </li>
      </ul>
    </WikiPage>
  );
}
