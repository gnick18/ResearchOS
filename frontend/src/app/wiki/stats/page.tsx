import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";

export default function StatsHubPage() {
  return (
    <WikiPage
      title="Reading your statistics"
      intro="When the Data Hub runs a test, it hands back numbers and a one-line plain-language verdict. These pages explain what those numbers mean in the language a working scientist actually uses, so you can read your own result, write it up honestly, and know when to trust it. You do not need to be a statistician. You need to know what question each test answers and how to turn its output into a sentence."
    >
      <Callout variant="info" title="How to use this section">
        Each page starts with what the test is and when a lab actually reaches
        for it, then shows you how to read the exact fields the Data Hub
        reports, with a worked example that turns the numbers into a sentence.
        Start with{" "}
        <Link href="/wiki/stats/effect-sizes">
          effect sizes and confidence intervals
        </Link>{" "}
        if you read only one. It is the idea every other page leans on.
      </Callout>

      <h2>Start here</h2>
      <p>
        Almost every result in the Data Hub reports a <strong>p-value</strong>,
        a number that tells you how surprising your data would be if nothing
        were really going on. A small p-value is a useful flag, but it does not
        tell you how big an effect is or whether it matters. For that you need
        the <strong>effect size</strong> and its{" "}
        <strong>confidence interval</strong>. That foundation page is worth
        reading before anything else, because every test below reports a version
        of the same three things, a direction, a size, and a range of
        uncertainty.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/effect-sizes">
            Effect sizes and confidence intervals
          </Link>
          , why the size of a difference matters more than a bare p-value, and
          how to read a 95% confidence interval.
        </li>
      </ul>

      <h2>Comparing groups</h2>
      <p>
        These tests answer &quot;are these groups really different, and by how
        much?&quot; Reach for them when you have a measured outcome (a
        fluorescence reading, a growth rate, a concentration) split across two
        or more conditions.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/anova">
            ANOVA, post-hoc tests, and two-way ANOVA
          </Link>
          , comparing three or more groups at once, then finding which specific
          pairs differ.
        </li>
        <li>
          <Link href="/wiki/stats/repeated-measures">
            Repeated measures, mixed models, and nested designs
          </Link>
          , for when the same subjects are measured more than once, or your
          replicates are cells within mice rather than independent samples.
        </li>
      </ul>

      <h2>Relationships</h2>
      <p>
        These answer &quot;do these two things move together, and can I predict
        one from the other?&quot; Reach for them when both of your variables are
        measured numbers rather than groups.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/correlation-and-regression">
            Correlation and regression
          </Link>
          , measuring how tightly two variables track each other, and fitting a
          line you can read a slope off of.
        </li>
      </ul>

      <h2>Curves</h2>
      <p>
        Some biology is not a straight line. A drug saturates, a binding curve
        plateaus, an enzyme runs out of substrate. These pages cover fitting a
        shaped curve and reading the parameters that summarize it.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/dose-response">
            Dose-response curves
          </Link>
          , covering EC50 and IC50, the 4PL and 5PL sigmoid fits, the Hill
          slope, and comparing or sharing fits across datasets.
        </li>
      </ul>

      <h2>Survival and time-to-event</h2>
      <p>
        When your outcome is &quot;how long until something happens,&quot; and
        some subjects have not had it happen yet, you need methods built for
        that. Reach for these for time to relapse, time to death, or time to any
        defined event.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/survival">
            Survival curves and hazard ratios
          </Link>
          , covering Kaplan-Meier curves, the log-rank test, and the Cox hazard
          ratio.
        </li>
      </ul>

      <h2>Counts and categories</h2>
      <p>
        When your data are counts in categories (responded or did not, mutant or
        wild type) rather than measured numbers, you compare proportions instead
        of means.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/contingency">
            Contingency tables, odds ratios, and relative risk
          </Link>
          , covering chi-square and Fisher exact tests, plus the odds ratio that
          logistic regression also reports.
        </li>
      </ul>

      <h2>Screening and data quality</h2>
      <p>
        Two practical tools that sit alongside the rest, one for judging how well
        a measurement separates two groups, one for the honest question of
        whether a stray point is really an error.
      </p>
      <ul>
        <li>
          <Link href="/wiki/stats/roc-auc">ROC curves and AUC</Link>, how well a
          continuous measurement tells two groups apart, with sensitivity,
          specificity, and a cut point.
        </li>
        <li>
          <Link href="/wiki/stats/outliers">Outlier tests</Link>, the Grubbs
          test, and the honest caution that removing a data point needs a real
          reason.
        </li>
      </ul>

      <h2>Planning and assumption checking</h2>
      <p>
        Before you run a test, the <strong>power and sample-size planner</strong>{" "}
        lets you work out three questions in any direction: given an effect size,
        alpha, and a target power, how large does your sample need to be? Given
        the sample you already have, what power do you achieve? Given your sample
        and power target, what is the smallest effect you could detect? The
        planner covers the two-sample t-test, the paired t-test, one-way ANOVA,
        and Pearson correlation.
      </p>
      <p>
        After you have data, the <strong>assumption Report Card</strong> runs the
        checks your chosen test relies on and surfaces them in plain language.
        For parametric tests it runs a Shapiro-Wilk normality test on each group
        and a Levene or Brown-Forsythe equal-variance test across groups, and
        tells you whether each assumption passes at your chosen alpha. A failing
        check is a prompt to look at a nonparametric alternative, not a verdict
        that the parametric result is wrong.
      </p>

      <Callout variant="tip" title="Every number is checked">
        Every test in these pages is validated against the tools labs already
        trust (scipy, statsmodels, lifelines, scikit-learn, and R) on the{" "}
        <Link href="/transparency">transparency page</Link>, which reruns the
        same inputs through those packages and shows the numbers line up. The
        result you read in the Data Hub is the same one those packages would give
        you.
      </Callout>
    </WikiPage>
  );
}
