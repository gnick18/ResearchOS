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
        src="/wiki/screenshots/datahub-overview.png"
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
        table offers eight archetypes.
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
      <p>
        A <strong>Contingency</strong> table holds counts in a grid of two
        categorical factors. It runs the chi-square test of independence, and for
        a 2x2 table it adds Fisher&apos;s exact test with the relative risk and the
        odds ratio.
      </p>
      <p>
        A <strong>Nested</strong> table records technical replicates nested inside
        biological replicates, for example cells within a mouse or mice within a
        treatment. It runs the nested t-test for two top-level groups and the
        nested one-way ANOVA for three or more, so technical replicates are not
        treated as independent.
      </p>
      <p>
        A <strong>Parts of whole</strong> table describes the composition of a
        single whole, a category label and a value per slice. It draws pie, donut,
        and 100-percent stacked-bar figures, each slice as its percent of the total.
      </p>
      <p>
        An <strong>Info sheet</strong> is a documentation table. It holds notes and
        constants that describe a dataset so the context travels with the data. It
        runs no analysis and draws no figure.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-table-types.png"
        alt="The New data table dialog showing the eight table type tiles, Column, XY, Grouped, Survival, Contingency, Nested, Parts of whole, and Info sheet, each with a short description."
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

      <h2>Transforms and derived tables</h2>
      <p>
        Sometimes the raw numbers are not the numbers you analyze. Data Hub can
        produce a new table that is computed from an existing one, so the cleaning
        step is explicit and repeatable rather than a one-off edit you cannot
        retrace. Five transforms ship: a general transform that applies a function
        to every value, normalize, transpose (swap rows and columns),
        remove-baseline (subtract a chosen baseline), and fraction-of-total (each
        value as its share of its column or row).
      </p>
      <p>
        A transform creates a derived table that keeps a live link to its source.
        When you open the derived table, it recomputes from the source&apos;s
        current content rather than from a saved snapshot, so an edit to the
        original flows through automatically and the derived table can never go
        stale. If the source is deleted, the derived table shows a clear empty
        state instead of silently keeping old numbers.
      </p>

      <h2>Running an analysis</h2>
      <p>
        New analysis offers only the tests that are valid for the open table, so
        you never pick a test the data cannot support. The set is broad and grows
        with the table type.
      </p>
      <p>
        From a <strong>Column</strong> table: unpaired and paired t-tests, one-way
        ANOVA with Tukey comparisons, and their rank-based counterparts
        (Mann-Whitney U, Wilcoxon signed-rank, Kruskal-Wallis); repeated-measures
        ANOVA and its mixed-model cousin (a random-intercept linear mixed model)
        for within-subject designs; multiple linear regression; and the Grubbs
        outlier test.
      </p>
      <p>
        From an <strong>XY</strong> table: Pearson and Spearman correlation, linear
        regression, simple logistic regression, the ROC curve with AUC, dose-response
        curve fitting (4PL and 5PL) with model comparison by AICc and an
        extra-sum-of-squares F test, and global (shared-parameter) fitting across
        several curves at once.
      </p>
      <p>
        From the design-specific tables: two-way ANOVA from a{" "}
        <strong>Grouped</strong> table; Kaplan-Meier survival with the log-rank and
        Gehan-Breslow-Wilcoxon tests plus Cox proportional-hazards regression from
        a <strong>Survival</strong> table; the chi-square and Fisher exact tests
        from a <strong>Contingency</strong> table; and the nested t-test and nested
        one-way ANOVA from a <strong>Nested</strong> table.
      </p>
      <p>
        Every result leads with a plain-language verdict, a sentence that states
        the practical takeaway before the numbers. Does it differ, which way, by
        how much. The full statistics table follows, laid out the way a methods
        section reads it.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-stats-anova.png"
        alt="A results sheet showing a plain-language verdict at the top, an ANOVA table with SS, df, MS, F, and p columns, and a Tukey comparisons table with significance asterisks."
        caption="The results sheet. The plain-language verdict comes first, then the full statistics table, then the pairwise comparisons."
      />

      <h2>A tour of the analyses</h2>
      <p>
        The same results-sheet pattern carries every analysis, from the everyday
        comparisons to the pharmacology fits and the survival models.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-stats-dose-response.png"
        alt="A dose-response results sheet with a fitted sigmoidal curve over the data points and an EC50, Hill slope, Top, and Bottom parameter table."
        caption="Dose-response. A 4PL or 5PL logistic fit reports the EC50 with an asymmetric confidence interval, the Hill slope, and the plateaus, with model comparison by AICc."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-survival.png"
        alt="A Kaplan-Meier survival results sheet with step curves for two arms and a log-rank test summary."
        caption="Survival. Kaplan-Meier curves per arm with the log-rank and Gehan-Breslow-Wilcoxon tests, plus Cox proportional-hazards regression."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-roc-auc.png"
        alt="An ROC curve results sheet plotting true positive rate against false positive rate with the area under the curve and the optimal cut point."
        caption="ROC and AUC. The full curve, the area under it with a confidence interval, and the optimal cut point by Youden's J."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-linear-regression.png"
        alt="A linear regression results sheet with the fitted line over the scatter and a slope, intercept, and R-squared table."
        caption="Linear regression. Slope and intercept with their standard errors and confidence intervals, R-squared, and the residual standard error."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-multiple-regression.png"
        alt="A multiple regression results sheet with one row per predictor showing coefficient, standard error, t, p, standardized beta, and VIF."
        caption="Multiple regression. Each predictor with its coefficient, confidence interval, standardized beta, and VIF, plus the overall model fit."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-contingency.png"
        alt="A contingency results sheet showing an observed and expected count matrix, the chi-square statistic, and 2x2 relative risk and odds ratio measures."
        caption="Contingency. The chi-square test on the count matrix, and for a 2x2 table Fisher's exact test with relative risk and odds ratio."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-repeated-measures.png"
        alt="A repeated-measures ANOVA results sheet with the condition F and p and the Greenhouse-Geisser and Huynh-Feldt sphericity corrections."
        caption="Repeated measures. Within-subject ANOVA with the Greenhouse-Geisser and Huynh-Feldt sphericity corrections, alongside a random-intercept mixed model."
      />
      <Screenshot
        src="/wiki/screenshots/datahub-stats-outliers.png"
        alt="A Grubbs outlier screen showing each flagged value with its per-step G statistic and critical value."
        caption="Outliers. The Grubbs test screens each column on its own, flagging values with their per-step G statistic against the critical value."
      />

      <h2>Show the code</h2>
      <p>
        Every analysis carries a Show the code toggle that reveals the exact
        open-source Python (scipy, statsmodels, lifelines) that reproduces it,
        with your real group names and values baked in. Paste it into a notebook
        and you get the same numbers. This is the answer to the question a closed
        tool cannot answer, which is where a given number actually came from.
      </p>
      <p>
        The same proof extends to the picture. Every figure carries its own code
        export, the matplotlib that redraws it from the same group names and values
        the on-screen figure used, so the plot is as reproducible as the
        statistic. Both halves answer the same question for the number and for the
        figure.
      </p>
      <p>
        Data Hub also drafts the paragraphs a paper needs. From a finished
        analysis it writes a Methods sentence that names the test and cites the
        canonical reference for it, a Results sentence that reports the finding
        with the inline statistics from the engine, and a formatted reference list
        that includes the open-source software the engine computed with. The
        numbers come only from the engine; the phrasing and the citations are the
        curation.
      </p>
      <Callout variant="info" title="Validated against the references">
        The statistics engine is checked against external reference values
        (scipy, statsmodels, lifelines, R, and a NIST certified dataset) in an
        automated test suite, so the numbers Data Hub reports match the tools the
        field already trusts. The public{" "}
        <Link href="/transparency">Transparency of tests</Link> page documents
        this approach for the bioinformatics tools, and Data Hub follows the same
        rule. No statistic ships without a reference-pinned test.
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
        src="/wiki/screenshots/datahub-guided-analysis.png"
        alt="The guided analysis wizard showing a recommended test at the top and an assumption Report Card below with pass, fail, and note rows in plain language."
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
      <p>
        For a Column table you can also draw an estimation plot, the modern
        effect-size figure that shows the raw data alongside the bootstrap sampling
        distribution of the mean difference and its confidence interval, in the
        Gardner-Altman style for two groups and the Cumming style for three or more
        sharing one control. It shows the size of the effect rather than only a
        yes or no significance star, and the interval comes straight from the same
        validated bootstrap the results sheet reports.
      </p>
      <Screenshot
        src="/wiki/screenshots/datahub-stats-effect-sizes.png"
        alt="An estimation plot showing the raw data of each group on the left and the bootstrap sampling distribution of the mean difference with its confidence interval on the right."
        caption="An estimation plot. It shows the raw data and the bootstrap distribution of the effect with its confidence interval, not just a significance star."
      />
      <p>
        Error bars come straight from the raw replicates, the same numbers the
        grid footer shows, so a figure of a table is always consistent with that
        table. Significance brackets are pulled from a stored ANOVA, so the right
        stars drop onto the figure with one toggle rather than being drawn by hand.
      </p>
      <p>
        Color is its own studio. The Palette Studio replaces a single color
        dropdown with a browseable palette library filtered by how many series the
        plot has, a custom per-series mode, a generate-and-lock workflow, import
        from a coolors.co URL, and your own saved palettes, with the live figure as
        the preview as you choose.
      </p>
      <p>
        Cleaning a figure is part of the same loop. Right-click a data cell to
        exclude it: the value stays visible and editable in the grid, but every
        analysis and every plot treats it as absent, so it drops out of the mean,
        the error bars, the dots, and the stored test at once. Nothing is deleted
        and nothing is hidden.
      </p>
      <Callout variant="tip" title="A real publication page behind the figure">
        Every figure sits on a plot artboard, an Illustrator-style page in real
        units. Drop the figure onto a chosen paper size, position and scale it to
        exact units on a pan-and-zoom canvas, and export the page as an exact SVG.
        The same artboard is shared with the{" "}
        <Link href="/wiki/features/phylo">phylogenetics Tree Studio</Link>, so a
        figure means the same thing in both places.
      </Callout>
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
        src="/wiki/screenshots/datahub-import-data.png"
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
      <p>
        A few threads tie it to the rest of the app. The power and sample-size
        planner answers the design question before any data is collected, how many
        subjects you need to detect an effect, how much power a planned n gives
        you, or the smallest effect that n can reliably detect, running against the
        same engine the analyses use. BeakerBot can create a Data Hub table for you
        from pasted data in one step, detecting the columns and writing the table.
        And a Data Hub table can drive a layer in the{" "}
        <Link href="/wiki/features/phylo">phylogenetics Tree Studio</Link>, so a
        metadata table can render as a tip-aligned plot beside a tree.
      </p>
    </WikiPage>
  );
}
