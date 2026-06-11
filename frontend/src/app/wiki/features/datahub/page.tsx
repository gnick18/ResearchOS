import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";
import { TryInDemo } from "@/components/wiki/TryInDemo";

export default function DataHubFeaturePage() {
  return (
    <WikiPage
      title="Data Hub"
      intro="Data Hub is a free, open-source GraphPad Prism alternative built into ResearchOS. It runs your statistics and your publication figures entirely in the browser, so your data never leaves your folder."
    >
      <Screenshot
        src="/wiki/screenshots/datahub-tab-overview.png"
        alt="The Data Hub tab with the navigator rail on the left listing data tables, analyses, and graphs, and a publication figure with significance brackets in the main panel."
        caption="Data Hub. The navigator rail holds your tables, analyses, and figures; the main panel shows the data grid, the results sheet, or the figure you are working on."
      />

      <TryInDemo href="/datahub">Try Data Hub</TryInDemo>

      <h2>What Data Hub is and why it exists</h2>
      <p>
        Prism and its peers are graphical front ends over math that is already
        settled and already available as proven open-source code. The value they
        sell is the workflow, not the statistics. Data Hub reproduces that
        workflow on top of battle-tested open-source libraries, so you get the
        guided analysis experience without the per-seat license and without
        sending your unpublished data to anyone.
      </p>
      <p>
        Everything runs on your own machine, in the browser. There is no server
        doing the computation, so your raw numbers stay in your data folder the
        same way your notes and sequences do. The reason this matters is simple.
        Your data is yours, the math is open, and you can read the exact code
        behind every number Data Hub reports.
      </p>
      <p>
        Data Hub lives at <code>/datahub</code> and is organized like the rest of
        ResearchOS. Documents are scoped to projects (collections) with optional
        subfolders, and they stand on their own rather than being born attached to
        a single experiment, so one workbook can pull together data from wherever
        it came from.
      </p>

      <h2>The three-pane navigator</h2>
      <p>
        The left rail is the navigator. A collection selector at the top scopes
        the workbook list to one project or opens it to everything at once. Below
        it, the Data Tables section lists your tables in a foldered tree. Two more
        sections, Results and Graphs, hold the analyses and figures that belong to
        the table you have open. Selecting a table opens its data grid; selecting
        an analysis opens its results sheet; selecting a figure opens the graph
        editor.
      </p>

      <h2>Table types</h2>
      <p>
        Like Prism, Data Hub shapes the table to the analysis you intend, so the
        grid and the available tests match how your data is actually laid out. New
        table offers four archetypes.
      </p>
      <p>
        A <strong>Column</strong> table is the starting point. Each column is a
        treatment group and each row is a replicate. The footer shows the mean,
        SD, SEM, and n for every group, recomputed live as you type, with no
        separate summarize step.
      </p>
      <p>
        An <strong>XY</strong> table pairs an X column with one or more Y columns,
        one observation per row. This is the shape for dose-response curves, time
        courses, and standard curves, and it unlocks correlation, linear
        regression, and fitted curves.
      </p>
      <p>
        A <strong>Grouped</strong> table records two factors at once. Each row is a
        level of the row factor, each column group is a level of the column
        factor, and replicate subcolumns sit under each group. That replication is
        what lets a two-way ANOVA estimate the interaction between the two factors.
      </p>
      <p>
        A <strong>Survival</strong> table records time-to-event data. Each row is a
        subject with a follow-up time, an event indicator (1 if the event
        happened, 0 if the subject was censored), and an optional group label so
        arms can be compared with a Kaplan-Meier curve and the log-rank test.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-new-table.png"
        alt="The New data table dialog showing the four table type tiles: Column, XY, Grouped, and Survival, each with a short description."
        caption="New table. Pick the archetype that matches your data; the grid and the available analyses follow from it."
      />

      <h2>The data grid and live summary</h2>
      <p>
        The grid is where you enter raw replicates. You only ever enter the
        numbers once. The summary statistics, every analysis, and every figure all
        read from the same cells, so an edit to a single replicate flows through to
        the footer, the results sheet, and any graph immediately. There is no
        recalculation step to forget.
      </p>
      <Callout variant="info" title="Your data is version controlled">
        Every Data Hub document is stored as a cell-level version-controlled
        document, the same technology behind{" "}
        <Link href="/wiki/features/version-history">Version History</Link> for
        notes. The dataset and the analysis choices are both versioned, so a
        change is never silently lost and two people editing different cells
        converge cleanly.
      </Callout>

      <h2>Running an analysis</h2>
      <p>
        New analysis offers only the tests that are valid for the open table, so
        you never pick a test the data cannot support. A Column table offers
        unpaired and paired t-tests and one-way ANOVA with Tukey comparisons, plus
        their rank-based counterparts (Mann-Whitney U, Wilcoxon signed-rank,
        Kruskal-Wallis). An XY table offers Pearson and Spearman correlation and
        linear regression. A Grouped table offers two-way ANOVA. A Survival table
        offers Kaplan-Meier with the log-rank test.
      </p>
      <p>
        Every result leads with a plain-language verdict, a sentence that states
        the practical takeaway before the numbers. Does it differ, which way, by
        how much. The full statistics table follows, laid out the way a methods
        section reads it.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-results-sheet.png"
        alt="A results sheet showing a plain-language verdict at the top, an ANOVA table with SS, df, MS, F, and p columns, and a Tukey comparisons table with significance asterisks."
        caption="The results sheet. The plain-language verdict comes first, then the full statistics table, then the pairwise comparisons."
      />

      <h2>Show the code</h2>
      <p>
        Every analysis carries a Show the code toggle that reveals the exact
        open-source Python (scipy, statsmodels, lifelines) that reproduces it,
        with your real group names and values baked in. Paste it into a notebook
        and you get the same numbers. This is the answer to the question a closed
        tool cannot answer, which is where a given number actually came from.
      </p>
      <Callout variant="info" title="Validated against the references">
        The statistics engine is checked against external reference values
        (scipy, R, and NIST) in an automated test suite, so the numbers Data Hub
        reports match the tools the field already trusts. The public{" "}
        <Link href="/transparency">Transparency of tests</Link> page documents
        this approach for the bioinformatics tools, and Data Hub follows the same
        rule: no statistic ships without a reference-pinned test.
      </Callout>

      <h2>The guided analysis wizard</h2>
      <p>
        Most bench scientists are not statisticians, and the most common analysis
        mistake is running a t-test or an ANOVA on data that breaks the test&apos;s
        assumptions. The guided wizard exists to prevent that. It asks a few plain
        questions about what you are comparing, then it does not just name a test.
        It checks the assumptions and shows you what it found.
      </p>
      <p>
        The assumption Report Card checks normality (Shapiro-Wilk, per group) and
        equal variance (Brown-Forsythe across groups), reports each as a
        plain-language pass or fail with a one-line reason, and when an assumption
        fails it falls back to the matching rank-based test that does not need that
        assumption, telling you why it switched. The recommendation you see is
        therefore already assumption-aware.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-guided-wizard.png"
        alt="The guided analysis wizard showing a recommended test at the top and an assumption Report Card below with PASS, FAIL, and NOTE rows in plain language."
        caption="The guided wizard. It recommends a test and shows the assumption Report Card, switching to a rank-based test automatically when an assumption fails."
      />

      <h2>Publication-quality graphs</h2>
      <p>
        New graph generates a figure from the open table. The figure is real SVG,
        so it stays an infinitely scalable vector for a paper and also exports as a
        crisp hi-DPI PNG for a slide, or copies straight to the clipboard to paste
        into a document.
      </p>
      <p>
        A Column table makes a column scatter (every replicate as a point over the
        group mean, the default, because individual points show the real spread a
        reviewer wants to see) or a bar with SD or SEM error bars. An XY table
        makes a scatter with a fitted curve laid over it (a least-squares line, a
        four-parameter dose-response logistic, Michaelis-Menten, exponential decay
        or association, and more). A Grouped table makes a grouped bar chart, one
        cluster per row level and one bar per group. A Survival table makes a
        Kaplan-Meier step curve, one line per arm.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-graph-editor.png"
        alt="The graph editor with a column scatter figure on the left showing points, a mean line, error bars, and significance brackets, and a styling panel on the right with error-bar, color, and axis controls."
        caption="The graph editor. The figure is live SVG; every control on the right redraws it, and the export stays a true vector."
      />
      <p>
        Error bars come straight from the raw replicates, the same numbers the
        grid footer shows, so a figure of a table is always consistent with that
        table. Significance brackets are pulled from a stored ANOVA, so the right
        stars drop onto the figure with one toggle rather than being drawn by hand.
      </p>
      <Callout variant="tip" title="One source of truth">
        Because the footer stats, the analysis, and the figure all read the same
        cells, you cannot end up with a bar chart that disagrees with the table it
        came from. Change a replicate and the points move, the error bars resize,
        and the stored test re-runs.
      </Callout>

      <h2>Importing data</h2>
      <p>
        You do not have to retype data you already have. Data Hub imports CSV
        files, pasted Excel ranges (with a transpose option for the common
        wrong-orientation case), and binary .xlsx workbooks. It detects the header
        row and the per-column types and maps the data onto a table. The honest
        limit, accepted up front, is that no free browser library can round-trip a
        native embedded Excel chart, so Data Hub reads the data and the formulas
        and re-plots natively rather than trying to preserve the original chart
        object.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-import.png"
        alt="The import dialog showing a pasted Excel range with detected columns, a transpose toggle, and a preview of how the data will map onto a table."
        caption="Import. Paste from Excel or pick a CSV or .xlsx file; Data Hub detects the structure and previews the table before creating it."
      />

      <h2>Referencing Data Hub in notes and results</h2>
      <p>
        A table, an analysis, or a figure can be referenced from a note or a
        result. The Copy reference button writes a link that renders as a live
        chip wherever you paste it, and clicking the chip opens the table in Data
        Hub. A figure can also be dropped into a note as an image with the
        figure&apos;s Copy button (which puts a PNG on the clipboard) or its Export
        PNG path. The chip keeps the live link to the analysis; the image captures
        the figure as it looked.
      </p>

      <h2>Connection to the rest of the app</h2>
      <p>
        Data Hub documents participate in the same project and folder structure as
        notes, experiments, methods, and sequences, and they go through the same{" "}
        <Link href="/wiki/features/trash">Trash</Link> flow with the same recovery
        window when deleted. The point of building the analysis surface into
        ResearchOS rather than leaving it in a separate paid application is that
        your data, your statistics, and your figures all live in one place that
        you own.
      </p>
    </WikiPage>
  );
}
