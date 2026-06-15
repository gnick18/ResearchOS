import Link from "next/link";
import WikiPage from "@/components/wiki/WikiPage";
import Callout from "@/components/wiki/Callout";
import Screenshot from "@/components/wiki/Screenshot";

export default function ContingencyPage() {
  return (
    <WikiPage
      title="Contingency tables, odds ratios, and relative risk"
      intro="When your data are counts in categories rather than measured numbers, responded or did not, mutant or wild type, survived or died, you compare proportions. A contingency table lays those counts out, and a handful of tests and effect sizes tell you whether the categories are linked and how strongly. This page covers chi-square, Fisher exact, logistic regression as a first-class analysis, the odds ratio, and relative risk."
    >
      <h2>What a contingency table is</h2>
      <p>
        A <strong>contingency table</strong> is a grid of counts. It can be any
        size: two outcomes by two groups (2x2), three treatment arms by four
        response categories (3x4), or any R-by-C arrangement. The question is
        always the same: does the distribution of counts across columns depend
        on which row you are in, or are the rows and columns independent and any
        apparent pattern is just chance?
      </p>

      <h2 id="chi-square">Chi-square and Fisher exact</h2>
      <p>
        For any R&times;C table the Data Hub runs the{" "}
        <strong>Pearson chi-square test of independence</strong>. It compares the
        counts you observed against the counts you would expect if the rows and
        columns were independent. The test is reliable when the expected count in
        every cell is reasonably large (a common rule of thumb is at least 5); the
        result reports the minimum expected count so you can check.
      </p>
      <p>
        For a <strong>2x2 table</strong>, the Data Hub always reports all three
        of the following, regardless of cell counts.
      </p>
      <ul>
        <li>
          <strong>Chi-square</strong> (Pearson, uncorrected), the standard
          large-sample statistic.
        </li>
        <li>
          <strong>Chi-square with Yates continuity correction</strong>, which
          subtracts 0.5 from each absolute deviation before squaring, giving a
          slightly more conservative result for the 2x2 case.
        </li>
        <li>
          <strong>Fisher&apos;s exact test</strong>, which computes the
          probability directly from the hypergeometric distribution rather than
          approximating, so it stays accurate when counts are small. Fisher exact
          is only computed for 2x2 tables; for larger tables the chi-square is the
          right test.
        </li>
      </ul>
      <p>
        All three report a <strong>p-value</strong> for whether the categories are
        associated. As elsewhere, that tells you whether there is a link, not how
        strong it is. For strength, you want the effect sizes below.
      </p>

      <h2 id="odds-ratios">Odds ratios</h2>
      <p>
        The <strong>odds ratio</strong> is the workhorse effect size for
        two-by-two data. Odds are a count ratio, the number with the outcome
        divided by the number without it. The odds ratio compares the odds in one
        group against the odds in the other.
      </p>
      <ul>
        <li>
          An odds ratio of <strong>1</strong> means the outcome is equally likely
          in both groups, no association.
        </li>
        <li>
          <strong>Above 1</strong> means higher odds in the first group. An odds
          ratio of 3 means the exposed group had three times the odds of the
          outcome.
        </li>
        <li>
          <strong>Below 1</strong> means lower odds, a protective association.
        </li>
      </ul>
      <p>
        The Data Hub reports the <strong>odds ratio</strong> with its{" "}
        <strong>95% confidence interval</strong>. If the interval excludes 1, the
        association is statistically clear, the same call the test&apos;s p-value
        makes, and the interval&apos;s width tells you the precision.
      </p>

      <Screenshot
        src="/wiki/screenshots/datahub-stats-contingency.png"
        alt="A 2x2 contingency result in the Data Hub, reporting the Yates-corrected and uncorrected chi-square, Fisher's exact p-value, the relative risk, and the odds ratio with its interval, above the observed and expected count tables."
        caption="A 2x2 table. The Data Hub reports the chi-square (Yates-corrected and uncorrected), Fisher's exact p for small counts, the relative risk, and the odds ratio with its 95 percent confidence interval, then shows the observed counts against the counts you would expect if the two factors were unrelated."
      />

      <Callout variant="info" title="Logistic regression is a first-class analysis">
        <strong>Logistic regression</strong> is its own analysis in the Data Hub,
        not just an extension of the contingency table. It predicts a yes/no
        outcome from a continuous predictor and reports the odds ratio for that
        predictor, read exactly as above, with its 95% confidence interval and
        p-value. The practical advantage over a contingency table is that logistic
        regression works directly on the continuous predictor without binning it,
        and it reports the X value at which the predicted probability equals 0.5,
        a useful summary for dose-response-style binary data. When the data are
        separable (all zeros on one side, all ones on the other) the standard
        maximum-likelihood estimate diverges; the engine detects this and falls
        back to{" "}
        <strong>Firth&apos;s penalized-likelihood correction</strong>{" "}
        automatically, keeping the estimates finite and flagging the method in the
        result. The odds ratio a logistic regression reports is the same quantity
        as the contingency table odds ratio, but conditioned on the continuous
        predictor value, just like a coefficient in{" "}
        <Link href="/wiki/stats/correlation-and-regression#multiple">
          multiple regression
        </Link>
        .
      </Callout>

      <h2>Relative risk, and when to use which</h2>
      <p>
        <strong>Relative risk</strong> compares the actual probability of the
        outcome between groups, not the odds. A relative risk of 2 means the
        outcome was twice as <em>likely</em> in one group. It is often the more
        intuitive number, and it is the right one when you sampled groups and then
        watched for outcomes (a cohort or a trial). The odds ratio is the natural
        choice for case-control designs and is what logistic regression produces.
        When the outcome is rare the two numbers nearly coincide; when it is common
        the odds ratio looks more extreme than the relative risk, so do not read an
        odds ratio as if it were a risk ratio.
      </p>

      <h2>A worked example</h2>
      <p>
        Of 50 treated patients, 10 relapsed; of 50 controls, 25 relapsed.
        Fisher&apos;s exact test gives p = 0.002. The odds ratio is 0.27 (95% CI
        0.11 to 0.64) and the relative risk is 0.40. You would write &quot;relapse
        was less frequent on treatment, 20% versus 50% (relative risk 0.40, odds
        ratio 0.27, 95% CI 0.11 to 0.64, Fisher exact p = 0.002).&quot; The
        interval not crossing 1 is what makes the association clear.
      </p>

      <p>
        ResearchOS validates the chi-square, Yates-corrected chi-square, Fisher
        exact test, odds ratio, relative risk, and logistic regression (including
        the Firth fallback) against scipy and statsmodels on the{" "}
        <Link href="/transparency">transparency page</Link>.
      </p>
    </WikiPage>
  );
}
